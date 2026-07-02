const { DynamoDBClient, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "ap-south-1" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,X-Api-Key",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || event);
    const { OrderID } = body;

    console.log("generateBill called for OrderID:", OrderID);

    if (!OrderID) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: "OrderID is required" }) };
    }

    // Step 1: Get order from RN_Orders
    const orderRes = await client.send(new GetItemCommand({
      TableName: "RN_Orders",
      Key: { OrderID: { S: OrderID } }
    }));

    if (!orderRes.Item) {
      return { statusCode: 404, headers: CORS, body: JSON.stringify({ message: `Order ${OrderID} not found` }) };
    }

    const order = unmarshall(orderRes.Item);
    console.log("Order found:", order.InvoiceNumber);

    // Step 2: Get order items from RN_OrderItems
    const itemsRes = await client.send(new ScanCommand({
      TableName: "RN_OrderItems",
      FilterExpression: "OrderID = :id",
      ExpressionAttributeValues: { ":id": { S: OrderID } }
    }));

    const items = itemsRes.Items.map(i => unmarshall(i));
    console.log(`Found ${items.length} items`);

    // Step 3: Calculate totals
    const subTotal   = items.reduce((s, i) => s + (parseFloat(i.Amount)     || 0), 0);
    const cgstTotal  = items.reduce((s, i) => s + (parseFloat(i.CGSTAmount) || 0), 0);
    const sgstTotal  = items.reduce((s, i) => s + (parseFloat(i.SGSTAmount) || 0), 0);
    const grandTotal = items.reduce((s, i) => s + (parseFloat(i.NetAmount)  || 0), 0);

    // Step 4: Build HTML bill
    const itemRows = items.map((item, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${item.ProductName || '—'}</td>
        <td>${item.HSNCode || '—'}</td>
        <td style="text-align:center">${item.Pcs || 0}</td>
        <td style="text-align:right">Rs. ${parseFloat(item.Rate || 0).toFixed(2)}</td>
        <td style="text-align:right">Rs. ${parseFloat(item.Amount || 0).toFixed(2)}</td>
        <td style="text-align:center">${item.CGSTRate || 0}%</td>
        <td style="text-align:right">Rs. ${parseFloat(item.CGSTAmount || 0).toFixed(2)}</td>
        <td style="text-align:center">${item.SGSTRate || 0}%</td>
        <td style="text-align:right">Rs. ${parseFloat(item.SGSTAmount || 0).toFixed(2)}</td>
        <td style="text-align:right; font-weight:700">Rs. ${parseFloat(item.NetAmount || 0).toFixed(2)}</td>
      </tr>
    `).join('');

    const BillHTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice — ${order.InvoiceNumber}</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 20px; }
    .header { text-align: center; border-bottom: 2px solid #111; padding-bottom: 12px; margin-bottom: 16px; }
    .header h1 { font-size: 22px; font-weight: 900; letter-spacing: 1px; }
    .header p  { font-size: 12px; color: #444; margin-top: 4px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .meta-box  { border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; }
    .meta-box h4 { font-size: 11px; text-transform: uppercase; color: #666; margin-bottom: 6px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
    .meta-box p  { margin: 3px 0; font-size: 12px; }
    .meta-box strong { font-weight: 700; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
    th { background: #1e3a5f; color: #fff; padding: 7px 8px; text-align: left; font-size: 10px; text-transform: uppercase; }
    td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; }
    tr:nth-child(even) td { background: #f9f9f9; }
    .totals-box { margin-left: auto; width: 300px; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; }
    .totals-box table { margin: 0; font-size: 12px; }
    .totals-box td { padding: 6px 12px; border-bottom: 1px solid #f0f0f0; }
    .totals-box .grand { background: #1e3a5f; color: #fff; font-weight: 700; font-size: 14px; }
    .footer { margin-top: 40px; display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .footer .sig-box { border-top: 1px solid #aaa; padding-top: 6px; font-size: 11px; color: #555; text-align: center; }
    .status-badge { display:inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 700;
      background: ${order.OrderStatus === 'Delivered' ? '#dcfce7' : order.OrderStatus === 'Confirmed' ? '#dbeafe' : '#fef9c3'};
      color:       ${order.OrderStatus === 'Delivered' ? '#166534' : order.OrderStatus === 'Confirmed' ? '#1e40af' : '#854d0e'}; }
    @media print { body { padding: 10px; } }
  </style>
</head>
<body>

  <div class="header">
    <h1>R.N. AGENCIES</h1>
    <p>Distributors of FMCG Products &nbsp;|&nbsp; Nagapattinam, Tamil Nadu</p>
    <p>Ph: 04365-221911 &nbsp;|&nbsp; GSTIN: 33XXXXX0000X1ZX</p>
  </div>

  <div class="meta-grid">
    <div class="meta-box">
      <h4>Bill to</h4>
      <p><strong>${order.ShopName || '—'}</strong></p>
      <p>Beat: ${order.Beat || '—'}</p>
      <p>Shop ID: ${order.ShopID || '—'}</p>
    </div>
    <div class="meta-box">
      <h4>Invoice details</h4>
      <p><strong>Invoice No:</strong> ${order.InvoiceNumber || OrderID}</p>
      <p><strong>Order ID:</strong> ${OrderID}</p>
      <p><strong>Date:</strong> ${order.OrderDate || new Date().toISOString().split('T')[0]}</p>
      <p><strong>Salesman:</strong> ${order.SalesMan || '—'}</p>
      <p><strong>Status:</strong> <span class="status-badge">${order.OrderStatus}</span></p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Product</th>
        <th>HSN</th>
        <th style="text-align:center">Qty</th>
        <th style="text-align:right">Rate</th>
        <th style="text-align:right">Amount</th>
        <th style="text-align:center">CGST%</th>
        <th style="text-align:right">CGST</th>
        <th style="text-align:center">SGST%</th>
        <th style="text-align:right">SGST</th>
        <th style="text-align:right">Net Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <div class="totals-box">
    <table>
      <tr><td>Subtotal</td><td style="text-align:right">Rs. ${subTotal.toFixed(2)}</td></tr>
      <tr><td>CGST</td><td style="text-align:right">Rs. ${cgstTotal.toFixed(2)}</td></tr>
      <tr><td>SGST</td><td style="text-align:right">Rs. ${sgstTotal.toFixed(2)}</td></tr>
      <tr class="grand"><td>GRAND TOTAL</td><td style="text-align:right">Rs. ${grandTotal.toFixed(2)}</td></tr>
    </table>
  </div>

  <div class="footer">
    <div class="sig-box">Customer Signature</div>
    <div class="sig-box">For R.N. Agencies<br/><br/>Authorised Signatory</div>
  </div>

</body>
</html>`;

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        message:       "Bill generated successfully",
        OrderID,
        InvoiceNumber: order.InvoiceNumber,
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