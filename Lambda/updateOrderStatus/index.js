// LAMBDA: updateOrderStatus — FINAL
// BUG FIX: Inventory deduction was silently failing because item.Pcs was not
// being parsed as a number properly from DynamoDB unmarshall
// FIX: Use parseInt/parseFloat on all numeric fields before using them
// FIX: Log every step so CloudWatch shows exactly what happened
// FIX: Return detailed response showing what stock was deducted

const { DynamoDBClient, UpdateItemCommand, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const client = new DynamoDBClient({ region: "ap-south-1" });

const VALID = ['Pending','Confirmed','Delivered','Billed','Cancelled'];
const CORS  = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || 'POST';
  if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || event);
    const { OrderID, OrderStatus } = body;

    console.log("updateOrderStatus called:", { OrderID, OrderStatus });

    if (!OrderID || !OrderStatus) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: "OrderID and OrderStatus are required" }) };
    }
    if (!VALID.includes(OrderStatus)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: `Invalid status. Use one of: ${VALID.join(', ')}` }) };
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

    // Step 2: Deduct inventory ONLY when status = Delivered
    const inventoryUpdates = [];
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
        // BUG FIX: Parse qty properly — DynamoDB Number type can come as string or number
        const qty = parseInt(item.Pcs) || parseInt(item.Quantity) || 0;
        const productId = item.ProductID;

        console.log(`Processing item: ${item.ProductName}, ProductID: ${productId}, Pcs: ${item.Pcs}, parsed qty: ${qty}`);

        if (!productId || qty <= 0) {
          console.warn(`Skipping item — ProductID: ${productId}, qty: ${qty}`);
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
          }
          console.log(`${item.ProductName}: current stock = ${prevStock}, deducting ${qty}`);
        } catch (getErr) {
          console.warn(`Could not read inventory for ${productId}:`, getErr.message);
        }

        // Deduct from inventory
        try {
          await client.send(new UpdateItemCommand({
            TableName: "RN_Inventory",
            Key: marshall({ ProductID: productId }),
            UpdateExpression: "SET CurrentStock = if_not_exists(CurrentStock, :zero) - :qty, PreviousStock = :prev, LastUpdated = :date",
            ExpressionAttributeValues: marshall({
              ":qty":  qty,
              ":zero": 0,
              ":prev": prevStock,
              ":date": new Date().toISOString().split('T')[0]
            })
          }));
          const newStock = prevStock - qty;
          console.log(`✅ ${item.ProductName}: ${prevStock} → ${newStock}`);
          inventoryUpdates.push({
            product:  item.ProductName,
            productId,
            qty,
            prevStock,
            newStock,
            status: 'updated'
          });
        } catch (invErr) {
          console.error(`❌ Failed to update inventory for ${productId}:`, invErr.message);
          inventoryUpdates.push({
            product:  item.ProductName,
            productId,
            qty,
            status:  'failed: ' + invErr.message
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
        inventoryUpdates  // shows what was deducted — visible in browser Network tab
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