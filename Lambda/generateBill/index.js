// LAMBDA: generateBill — FINAL
// BUG FIX 1: Does NOT change OrderStatus at all — status only changes via updateOrderStatus
// BUG FIX 2: Bill HTML now has a prominent Print/Download PDF button built in
// BUG FIX 3: Returns full CORS headers on all responses including errors

const { DynamoDBClient, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const dynamo = new DynamoDBClient({ region: "ap-south-1" });
const s3     = new S3Client({ region: "ap-south-1" });
const BUCKET = "rn-agencies-bills";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || 'POST';
  if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || event);
    const { OrderID } = body;
    if (!OrderID) return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: "OrderID required" }) };

    // Get order header
    const orderRes = await dynamo.send(new GetItemCommand({
      TableName: "RN_Orders", Key: marshall({ OrderID })
    }));
    if (!orderRes.Item) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: "Order not found: " + OrderID }) };
    }
    const order = unmarshall(orderRes.Item);
    console.log("Generating bill for order:", OrderID, "Shop:", order.ShopName, "Status:", order.OrderStatus);

    // Get order items
    const itemsRes = await dynamo.send(new ScanCommand({
      TableName: "RN_OrderItems",
      FilterExpression: "OrderID = :id",
      ExpressionAttributeValues: { ":id": { S: OrderID } }
    }));
    const items = itemsRes.Items.map(i => unmarshall(i));
    console.log("Found", items.length, "items for order", OrderID);

    const subtotal  = items.reduce((s, i) => s + (parseFloat(i.Amount)      || 0), 0);
    const totalCGST = items.reduce((s, i) => s + (parseFloat(i.CGSTAmount)  || 0), 0);
    const totalSGST = items.reduce((s, i) => s + (parseFloat(i.SGSTAmount)  || 0), 0);
    const grandTotal = items.length > 0
      ? items.reduce((s, i) => s + (parseFloat(i.NetAmount) || 0), 0)
      : parseFloat(order.TotalOrderAmount) || 0;

    // Build bill HTML — includes print/PDF button
    const BillHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${order.InvoiceNumber || OrderID}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;font-size:12px;color:#111;background:#f5f5f5}
.page{background:#fff;max-width:900px;margin:0 auto;padding:24px}
.print-bar{background:#1B4332;color:#fff;padding:10px 24px;display:flex;align-items:center;justify-content:space-between;max-width:900px;margin:0 auto 0}
.print-bar span{font-size:13px;opacity:.85}
.print-btn{background:#fff;color:#1B4332;border:none;padding:8px 20px;border-radius:5px;font-size:13px;font-weight:700;cursor:pointer}
.print-btn:hover{background:#f0f0f0}
.top{text-align:center;border-bottom:2px solid #1B4332;padding-bottom:14px;margin-bottom:16px}
.co{font-size:22px;font-weight:700;color:#1B4332;letter-spacing:1px}
.addr{font-size:11px;color:#555;margin-top:4px;line-height:1.7}
.type{margin-top:8px;font-size:13px;font-weight:700;letter-spacing:1px;color:#1B4332;border:1px solid #1B4332;display:inline-block;padding:2px 14px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:14px 0}
.box{background:#f9f9f9;border:1px solid #ddd;padding:10px 14px}
.box strong{display:block;font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;border-bottom:1px solid #eee;padding-bottom:4px}
.row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px}
h3{font-size:12px;font-weight:700;color:#1B4332;text-transform:uppercase;letter-spacing:.5px;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #ccc}
table{width:100%;border-collapse:collapse;font-size:11px}
thead tr{background:#1B4332;color:#fff}
th{padding:7px 5px;text-align:center;font-size:10px;font-weight:600}
th:nth-child(2){text-align:left}
tbody tr:nth-child(even){background:#f5faf5}
td{padding:5px;text-align:center;border-bottom:1px solid #eee}
td:nth-child(2){text-align:left}
.tot{display:flex;justify-content:flex-end;margin-top:14px}
.tbox{border:1px solid #b2dfb2;padding:10px 16px;min-width:240px;background:#f5faf5}
.trow{display:flex;justify-content:space-between;font-size:12px;padding:3px 0}
.grand{font-size:14px;font-weight:700;color:#1B4332;border-top:1px solid #1B4332;margin-top:6px;padding-top:6px}
.foot{text-align:center;margin-top:24px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#888}
.empty{text-align:center;padding:20px;color:#aaa;font-style:italic}
.status-badge{display:inline-block;padding:2px 10px;border-radius:3px;font-size:11px;font-weight:700;background:#e8f5e9;color:#1B4332;margin-left:8px}
@media print{
  .print-bar{display:none !important}
  body{background:#fff}
  .page{padding:10px}
}
</style>
</head>
<body>
<div class="print-bar">
  <span>R.N. Agencies — Invoice ${order.InvoiceNumber || OrderID}</span>
  <button class="print-btn" onclick="window.print()">⬇ Download PDF / Print</button>
</div>
<div class="page">
  <div class="top">
    <div class="co">R.N. AGENCIES</div>
    <div class="addr">
      21/1, Perumal West St, Nagapattinam — 611001, Tamil Nadu<br>
      Ph: 04365-221911 &nbsp;|&nbsp; GSTIN: 33AADPB8923C1ZA &nbsp;|&nbsp; PAN: AADPB8923C
    </div>
    <div class="type">TAX INVOICE — CREDIT BILL</div>
  </div>

  <div class="meta">
    <div class="box">
      <strong>Bill to</strong>
      <div class="row"><span>Shop</span><span><b>${order.ShopName || '—'}</b></span></div>
      <div class="row"><span>Beat</span><span>${order.Beat || '—'}</span></div>
      <div class="row"><span>Salesman</span><span>${order.SalesMan || '—'}</span></div>
    </div>
    <div class="box">
      <strong>Invoice details</strong>
      <div class="row"><span>Invoice No</span><span><b>${order.InvoiceNumber || '—'}</b></span></div>
      <div class="row"><span>Date</span><span>${order.OrderDate || '—'}</span></div>
      <div class="row"><span>Order ID</span><span style="font-size:10px">${order.OrderID}</span></div>
      <div class="row"><span>Status</span><span><span class="status-badge">${order.OrderStatus || '—'}</span></span></div>
    </div>
  </div>

  <h3>Order items (${items.length} product${items.length !== 1 ? 's' : ''})</h3>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Product description</th><th>HSN</th><th>MRP</th>
        <th>Pcs</th><th>Rate</th><th>Amount</th>
        <th>CGST%</th><th>CGST</th><th>SGST%</th><th>SGST</th><th>Net amount</th>
      </tr>
    </thead>
    <tbody>
      ${items.length === 0
        ? `<tr><td colspan="12" class="empty">No items found for this order</td></tr>`
        : items.map((item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${item.ProductName || '—'}</td>
        <td>${item.HSNCode || '—'}</td>
        <td>${parseFloat(item.MRP || 0).toFixed(2)}</td>
        <td><b>${item.Pcs || 0}</b></td>
        <td>${parseFloat(item.Rate || 0).toFixed(2)}</td>
        <td>${parseFloat(item.Amount || 0).toFixed(2)}</td>
        <td>${item.CGSTRate || 0}%</td>
        <td>${parseFloat(item.CGSTAmount || 0).toFixed(2)}</td>
        <td>${item.SGSTRate || 0}%</td>
        <td>${parseFloat(item.SGSTAmount || 0).toFixed(2)}</td>
        <td><b>${parseFloat(item.NetAmount || 0).toFixed(2)}</b></td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="tot">
    <div class="tbox">
      <div class="trow"><span>Subtotal</span><span>Rs. ${subtotal.toFixed(2)}</span></div>
      <div class="trow"><span>CGST</span><span>Rs. ${totalCGST.toFixed(2)}</span></div>
      <div class="trow"><span>SGST</span><span>Rs. ${totalSGST.toFixed(2)}</span></div>
      <div class="trow grand"><span>Grand total</span><span>Rs. ${grandTotal.toFixed(2)}</span></div>
    </div>
  </div>

  <div class="foot">
    <p>Thank you for your business with R.N. Agencies, Nagapattinam</p>
    <p style="margin-top:4px">Computer-generated invoice · Ph: 04365-221911 · GSTIN: 33AADPB8923C1ZA</p>
  </div>
</div>
</body>
</html>`;

    // Save to S3 (non-fatal)
    try {
      const fileName = `bills/${order.OrderDate || 'unknown'}/${order.InvoiceNumber || OrderID}.html`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: fileName, Body: BillHTML, ContentType: "text/html"
      }));
    } catch (s3err) { console.warn("S3 save skipped:", s3err.message); }

    // ── CRITICAL FIX: NO STATUS CHANGE HERE ──────────────────────────────────
    // Bill generation is completely independent of delivery status.
    // Status flow: Pending → Confirmed → Delivered
    // That flow happens ONLY in the updateOrderStatus Lambda.
    // ─────────────────────────────────────────────────────────────────────────

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        message:       "Bill generated successfully",
        OrderID,
        InvoiceNumber: order.InvoiceNumber,
        ShopName:      order.ShopName,
        TotalAmount:   grandTotal,
        CurrentStatus: order.OrderStatus, // returned for info only — not changed
        BillHTML
      })
    };
  } catch (err) {
    console.error("generateBill error:", err);
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ message: "Error generating bill", error: err.message })
    };
  }
};