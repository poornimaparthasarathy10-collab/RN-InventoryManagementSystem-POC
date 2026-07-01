// LAMBDA: addStock — FINAL VERSION
// Handles all edge cases including missing RN_StockIntake table

const { DynamoDBClient, UpdateItemCommand, PutItemCommand, GetItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const client = new DynamoDBClient({ region: "ap-south-1" });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  // ── Step 1: Parse request body ───────────────────────────────────────────
  let body;
  try {
    body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || event);
  } catch (parseErr) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: "Invalid JSON in request body", error: parseErr.message }) };
  }

  const { ProductID, Quantity, MRP, Rate, DSPrice, Discount, IGSTRate,
          InvoiceNumber, SupplierName, SupplierGSTIN, InvoiceDate, UOM } = body;

  // ── Step 2: Validate inputs ──────────────────────────────────────────────
  if (!ProductID || typeof ProductID !== 'string' || ProductID.trim() === '') {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: "ProductID is required and must be a non-empty string" }) };
  }
  const qty = parseInt(Quantity);
  if (isNaN(qty) || qty <= 0) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ message: "Quantity must be a positive number. Received: " + Quantity }) };
  }

  const today = new Date().toISOString().split('T')[0];

  // ── Step 3: Read current stock (non-fatal if missing) ────────────────────
  let previousStock = 0;
  try {
    const cur = await client.send(new GetItemCommand({
      TableName: "RN_Inventory",
      Key: marshall({ ProductID: ProductID.trim() })
    }));
    if (cur.Item) {
      const inv = unmarshall(cur.Item);
      previousStock = typeof inv.CurrentStock === 'number' ? inv.CurrentStock : 0;
    }
  } catch (getErr) {
    console.warn("Could not read current stock (non-fatal):", getErr.message);
    // Continue — first time this product enters inventory
  }

  // ── Step 4: Update inventory ─────────────────────────────────────────────
  // if_not_exists(CurrentStock, :zero) handles new products with no row yet
  // We do NOT set ProductID here — it's the primary key, DynamoDB forbids updating it
  try {
    await client.send(new UpdateItemCommand({
      TableName: "RN_Inventory",
      Key: marshall({ ProductID: ProductID.trim() }),
      UpdateExpression: "SET CurrentStock = if_not_exists(CurrentStock, :zero) + :qty, PreviousStock = :prev, LastUpdated = :date",
      ExpressionAttributeValues: marshall({
        ":qty":  qty,
        ":zero": 0,
        ":prev": previousStock,
        ":date": today
      })
    }));
  } catch (invErr) {
    console.error("FAILED at inventory update:", invErr);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({
      message: "Failed to update RN_Inventory",
      step: "inventory_update",
      error: invErr.message,
      ProductID, qty
    })};
  }

  // ── Step 5: Update product MRP/Rate (non-fatal) ──────────────────────────
  if (MRP || Rate) {
    try {
      await client.send(new UpdateItemCommand({
        TableName: "RN_Products",
        Key: marshall({ ProductID: ProductID.trim() }),
        UpdateExpression: "SET MRP = :mrp, Rate = :rate",
        ExpressionAttributeValues: marshall({
          ":mrp":  parseFloat(MRP)  || 0,
          ":rate": parseFloat(Rate) || 0
        })
      }));
    } catch (prodErr) {
      console.warn("Could not update RN_Products (non-fatal):", prodErr.message);
    }
  }

  // ── Step 6: Save stock intake record (non-fatal if RN_StockIntake missing) ─
  const StockID  = "STK" + Date.now();
  const newStock = previousStock + qty;
  try {
    await client.send(new PutItemCommand({
      TableName: "RN_StockIntake",
      Item: marshall({
        StockID,
        ProductID:     ProductID.trim(),
        Quantity:      qty,
        MRP:           parseFloat(MRP)      || 0,
        Rate:          parseFloat(Rate)     || 0,
        DSPrice:       parseFloat(DSPrice)  || 0,
        Discount:      parseFloat(Discount) || 0,
        IGSTRate:      parseFloat(IGSTRate) || 0,
        InvoiceNumber: InvoiceNumber || '',
        SupplierName:  SupplierName  || '',
        SupplierGSTIN: SupplierGSTIN || '',
        InvoiceDate:   InvoiceDate   || today,
        UOM:           UOM || 'PCS',
        IntakeDate:    today,
        PreviousStock: previousStock,
        NewStock:      newStock
      })
    }));
  } catch (intakeErr) {
    // RN_StockIntake might not exist — inventory was already updated so return success
    // but include a warning so we can see it in logs
    console.warn("Could not save to RN_StockIntake (non-fatal):", intakeErr.message);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({
      message: "Stock added successfully (intake log skipped — RN_StockIntake may not exist)",
      ProductID, QuantityAdded: qty,
      PreviousStock: previousStock,
      NewStock: newStock,
      StockID,
      warning: "RN_StockIntake write failed: " + intakeErr.message
    })};
  }

  // ── Step 7: All good ─────────────────────────────────────────────────────
  return { statusCode: 200, headers: CORS, body: JSON.stringify({
    message: "Stock added successfully",
    ProductID, QuantityAdded: qty,
    PreviousStock: previousStock,
    NewStock: newStock,
    StockID
  })};
};