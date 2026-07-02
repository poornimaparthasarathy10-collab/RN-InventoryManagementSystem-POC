const { DynamoDBClient, UpdateItemCommand, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "ap-south-1" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

const VALID = ['Pending', 'Confirmed', 'Delivered', 'Billed', 'Cancelled'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || event);
    const { OrderID, OrderStatus } = body;

    console.log("updateOrderStatus called:", { OrderID, OrderStatus });

    if (!OrderID || !OrderStatus) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: "OrderID and OrderStatus are required" }) };
    }
    if (!VALID.includes(OrderStatus)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: `Invalid status. Use: ${VALID.join(', ')}` }) };
    }

    // Step 1: Update order status in RN_Orders
    await client.send(new UpdateItemCommand({
      TableName: "RN_Orders",
      Key: marshall({ OrderID }),
      UpdateExpression: "SET OrderStatus = :s, LastModified = :ts",
      ExpressionAttributeValues: marshall({
        ":s":  OrderStatus,
        ":ts": new Date().toISOString()
      })
    }));

    console.log("Order status updated to:", OrderStatus);

    const inventoryUpdates = [];

    // Step 2: Deduct inventory ONLY when status = Delivered
    if (OrderStatus === 'Delivered') {
      console.log("Fetching order items for inventory deduction...");

      const itemsRes = await client.send(new ScanCommand({
        TableName: "RN_OrderItems",
        FilterExpression: "OrderID = :id",
        ExpressionAttributeValues: { ":id": { S: OrderID } }
      }));

      const orderItems = itemsRes.Items.map(i => unmarshall(i));
      console.log(`Found ${orderItems.length} order items for ${OrderID}`);

      if (orderItems.length === 0) {
        console.warn("No order items found — inventory not updated");
      }

      for (const item of orderItems) {
        // Parse qty — handle both number and Decimal types from DynamoDB
        const qty = parseInt(item.Pcs) || parseInt(item.Quantity) || 0;
        const productId = item.ProductID;

        console.log(`Processing: ${item.ProductName}, ProductID: ${productId}, qty: ${qty}`);

        if (!productId || qty <= 0) {
          console.warn(`Skipping — ProductID: ${productId}, qty: ${qty}`);
          inventoryUpdates.push({
            product: item.ProductName,
            productId,
            qty,
            status: 'skipped — zero qty or missing ProductID'
          });
          continue;
        }

        // Get current stock before deduction
        let prevStock = 0;
        try {
          const cur = await client.send(new GetItemCommand({
            TableName: "RN_Inventory",
            Key: marshall({ ProductID: productId })
          }));
          if (cur.Item) {
            const inv = unmarshall(cur.Item);
            prevStock = parseInt(inv.CurrentStock) || 0;
          } else {
            console.warn(`Product ${productId} not found in RN_Inventory — skipping`);
            inventoryUpdates.push({
              product: item.ProductName, productId, qty,
              status: 'skipped — product not in inventory table'
            });
            continue;
          }
        } catch (getErr) {
          console.error(`Failed to get current stock for ${productId}:`, getErr.message);
        }

        // Deduct from inventory — never go below 0
        const newStock = Math.max(0, prevStock - qty);

        try {
          await client.send(new UpdateItemCommand({
            TableName: "RN_Inventory",
            Key: marshall({ ProductID: productId }),
            UpdateExpression: "SET CurrentStock = :newStock, PreviousStock = :prev, LastUpdated = :date",
            ExpressionAttributeValues: marshall({
              ":newStock": newStock,
              ":prev":     prevStock,
              ":date":     new Date().toISOString().split('T')[0]
            })
          }));

          console.log(`✅ ${item.ProductName}: ${prevStock} → ${newStock}`);
          inventoryUpdates.push({
            product:   item.ProductName,
            productId,
            qty,
            prevStock,
            newStock,
            status:    'updated'
          });
        } catch (invErr) {
          console.error(`❌ Failed to update inventory for ${productId}:`, invErr.message);
          inventoryUpdates.push({
            product:   item.ProductName,
            productId,
            qty,
            status:    'failed: ' + invErr.message
          });
        }
      }
    }

    console.log("Done. Inventory updates:", JSON.stringify(inventoryUpdates));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        message:          `Order ${OrderStatus} successfully`,
        OrderID,
        OrderStatus,
        inventoryUpdates
      })
    };

  } catch (err) {
    console.error("updateOrderStatus error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: "Error updating order", error: err.message })
    };
  }
};