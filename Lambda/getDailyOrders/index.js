// LAMBDA: getDailyOrders
// FIX: Returns ALL statuses (Pending + Confirmed + Delivered + Billed) — not just Pending
// FIX: CORS headers on every response including errors
const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");
const client = new DynamoDBClient({ region: "ap-south-1" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  try {
    const today = new Date().toISOString().split('T')[0];
    // KEY FIX: removed AND OrderStatus = :status filter
    const ordersRes = await client.send(new ScanCommand({
      TableName: "RN_Orders",
      FilterExpression: "OrderDate = :date",
      ExpressionAttributeValues: { ":date": { S: today } }
    }));
    const orders = ordersRes.Items.map(i => unmarshall(i));
    if (orders.length === 0) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        message: "No orders today", date: today,
        totalOrders: 0, totalAmount: 0, deliveryByBeat: {}
      })};
    }
    const sheet = [];
    for (const order of orders) {
      const itemsRes = await client.send(new ScanCommand({
        TableName: "RN_OrderItems",
        FilterExpression: "OrderID = :id",
        ExpressionAttributeValues: { ":id": { S: order.OrderID } }
      }));
      sheet.push({
        OrderID: order.OrderID,
        InvoiceNumber: order.InvoiceNumber,
        ShopName: order.ShopName,
        ShopID: order.ShopID,
        Beat: order.Beat,
        SalesMan: order.SalesMan,
        OrderDate: order.OrderDate,
        ExpectedDeliveryDate: order.ExpectedDeliveryDate,
        OrderStatus: order.OrderStatus,
        TotalOrderAmount: order.TotalOrderAmount || 0,
        Items: itemsRes.Items.map(i => {
          const x = unmarshall(i);
          return {
            ProductName: x.ProductName, HSNCode: x.HSNCode,
            Pcs: x.Pcs, Rate: x.Rate, Amount: x.Amount || 0,
            CGSTRate: x.CGSTRate, CGSTAmount: x.CGSTAmount || 0,
            SGSTRate: x.SGSTRate, SGSTAmount: x.SGSTAmount || 0,
            NetAmount: x.NetAmount || 0
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
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      message: "Orders fetched", date: today,
      totalOrders: orders.length,
      totalAmount: Math.round(totalAmount * 100) / 100,
      deliveryByBeat: byBeat
    })};
  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ message: "Error", error: err.message }) };
  }
};