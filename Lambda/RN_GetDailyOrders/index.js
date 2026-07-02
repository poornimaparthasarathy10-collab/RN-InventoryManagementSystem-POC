const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "ap-south-1" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS"
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const today = new Date().toISOString().split('T')[0];

    // Fetch today's orders AND any older orders still Pending or Confirmed
    const ordersRes = await client.send(new ScanCommand({
      TableName: "RN_Orders",
      FilterExpression: "OrderDate = :date OR OrderStatus = :pending OR OrderStatus = :confirmed",
      ExpressionAttributeValues: {
        ":date":      { S: today },
        ":pending":   { S: "Pending" },
        ":confirmed": { S: "Confirmed" }
      }
    }));

    const orders = ordersRes.Items.map(i => unmarshall(i));

    // Deduplicate — an order can match multiple conditions
    const seen = new Set();
    const unique = orders.filter(o => {
      if (seen.has(o.OrderID)) return false;
      seen.add(o.OrderID);
      return true;
    });

    if (unique.length === 0) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({
          message: "No orders found", date: today,
          totalOrders: 0, totalAmount: 0, deliveryByBeat: {}
        })
      };
    }

    const sheet = [];
    for (const order of unique) {
      const itemsRes = await client.send(new ScanCommand({
        TableName: "RN_OrderItems",
        FilterExpression: "OrderID = :id",
        ExpressionAttributeValues: { ":id": { S: order.OrderID } }
      }));
      sheet.push({
        OrderID:              order.OrderID,
        InvoiceNumber:        order.InvoiceNumber,
        ShopName:             order.ShopName,
        ShopID:               order.ShopID,
        Beat:                 order.Beat,
        SalesMan:             order.SalesMan,
        OrderDate:            order.OrderDate,
        ExpectedDeliveryDate: order.ExpectedDeliveryDate,
        OrderStatus:          order.OrderStatus,
        TotalOrderAmount:     order.TotalOrderAmount || 0,
        Items: itemsRes.Items.map(i => {
          const x = unmarshall(i);
          return {
            ProductName: x.ProductName,
            HSNCode:     x.HSNCode,
            Pcs:         x.Pcs,
            Rate:        x.Rate,
            Amount:      x.Amount || 0,
            CGSTRate:    x.CGSTRate,
            CGSTAmount:  x.CGSTAmount || 0,
            SGSTRate:    x.SGSTRate,
            SGSTAmount:  x.SGSTAmount || 0,
            NetAmount:   x.NetAmount || 0
          };
        })
      });
    }

    const byBeat = sheet.reduce((acc, o) => {
      const b = o.Beat || "Unassigned";
      if (!acc[b]) acc[b] = [];
      acc[b].push(o);
      return acc;
    }, {});

    const totalAmount = sheet.reduce((s, o) => s + (o.TotalOrderAmount || 0), 0);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        message: "Orders fetched",
        date: today,
        totalOrders: unique.length,
        totalAmount: Math.round(totalAmount * 100) / 100,
        deliveryByBeat: byBeat
      })
    };

  } catch (err) {
    console.error("getDailyOrders error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: "Error fetching orders", error: err.message })
    };
  }
};