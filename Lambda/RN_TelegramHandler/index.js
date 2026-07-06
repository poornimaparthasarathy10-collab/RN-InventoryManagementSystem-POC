// LAMBDA: telegramBot — FINAL
// Complete rewrite with stock availability check
// FIX: All orders going to one shop — ChatID lookup now always uses string
// FIX: Stock check before accepting order
// FIX: Partial orders handled correctly

const { DynamoDBClient, PutItemCommand, GetItemCommand, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");
const dynamo = new DynamoDBClient({ region: "ap-south-1" });

const BOT_TOKEN = process.env.BOT_TOKEN;
const TAPI = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Send Telegram message ─────────────────────────────────────────────────────
async function tSend(chatId, text, extra = {}) {
  try {
    const res = await fetch(`${TAPI}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text, parse_mode: "HTML", ...extra })
    });
    const json = await res.json();
    if (!json.ok) console.error("Telegram send error:", json.description);
    return json;
  } catch (e) { console.error("tSend exception:", e.message); }
}

// ── DB: get shop by Telegram chat ID ─────────────────────────────────────────
async function getShopByChatId(chatId) {
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: "RN_TelegramUsers",
      Key: marshall({ ChatID: String(chatId) })  // FIX: always string
    }));
    if (res.Item) {
      const shop = unmarshall(res.Item);
      console.log("Found shop for chatId", chatId, ":", shop.ShopName);
      return shop;
    }
    console.log("No shop found for chatId:", chatId);
    return null;
  } catch (e) {
    console.error("getShopByChatId error:", e.message);
    return null;
  }
}

// ── DB: get shop by ShopID from RN_Shops ─────────────────────────────────────
async function getShopByID(shopId) {
  try {
    const res = await dynamo.send(new GetItemCommand({
      TableName: "RN_Shops",
      Key: marshall({ ShopID: shopId.toUpperCase() })
    }));
    return res.Item ? unmarshall(res.Item) : null;
  } catch (e) {
    console.error("getShopByID error:", e.message);
    return null;
  }
}

// ── DB: get all products ──────────────────────────────────────────────────────
async function getProducts() {
  try {
    const res = await dynamo.send(new ScanCommand({ TableName: "RN_Products" }));
    return res.Items.map(i => unmarshall(i));
  } catch (e) {
    console.error("getProducts error:", e.message);
    return [];
  }
}

// ── DB: get inventory map {ProductID: currentStock} ──────────────────────────
async function getInventoryMap() {
  try {
    const res = await dynamo.send(new ScanCommand({ TableName: "RN_Inventory" }));
    const map = {};
    res.Items.map(i => unmarshall(i)).forEach(i => {
      map[i.ProductID] = typeof i.CurrentStock === 'number' ? i.CurrentStock : 0;
    });
    return map;
  } catch (e) {
    console.error("getInventoryMap error:", e.message);
    return {};
  }
}

// ── DB: get today's orders for a shop ────────────────────────────────────────
async function getShopOrdersToday(shopId) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const res = await dynamo.send(new ScanCommand({
      TableName: "RN_Orders",
      FilterExpression: "ShopID = :sid AND OrderDate = :date",
      ExpressionAttributeValues: { ":sid": { S: shopId }, ":date": { S: today } }
    }));
    return res.Items.map(i => unmarshall(i));
  } catch (e) {
    console.error("getShopOrdersToday error:", e.message);
    return [];
  }
}

// ── Match product name (fuzzy) ────────────────────────────────────────────────
function matchProduct(text, products) {
  const t = text.toLowerCase().trim();
  if (t.length < 2) return null;
  // 1. Exact
  let p = products.find(pr => pr.ProductName.toLowerCase() === t);
  if (p) return p;
  // 2. Full contains
  p = products.find(pr => pr.ProductName.toLowerCase().includes(t));
  if (p) return p;
  // 3. Text contains product name
  p = products.find(pr => t.includes(pr.ProductName.toLowerCase()));
  if (p) return p;
  // 4. First 5 chars match
  if (t.length >= 5) {
    p = products.find(pr => pr.ProductName.toLowerCase().startsWith(t.substring(0, 5)));
    if (p) return p;
  }
  return null;
}

// ── Parse order lines ─────────────────────────────────────────────────────────
function parseOrder(text, products, invMap) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const confirmed = [];  // items we can fulfill
  const partial = [];    // items we can partially fulfill
  const noStock = [];    // items exist but out of stock
  const notFound = [];   // items not in catalogue

  for (const line of lines) {
    // Match "Product Name - Qty" or "Product Name – Qty" or "Product Name x Qty"
    const m = line.match(/^(.+?)[\-–—:x×]\s*(\d+)\s*$/i);
    if (!m) { notFound.push(`"${line}" (format not recognised)`); continue; }

    const productText = m[1].trim();
    const requested   = parseInt(m[2]);
    if (!requested || requested <= 0) { notFound.push(`"${line}" (invalid qty)`); continue; }

    const product = matchProduct(productText, products);
    if (!product) { notFound.push(`"${productText}" (not in catalogue)`); continue; }

    const stock = invMap[product.ProductID] || 0;

    if (stock <= 0) {
      noStock.push({ product, requested });
    } else if (stock < requested) {
      partial.push({ product, requested, fulfil: stock });
    } else {
      confirmed.push({ product, qty: requested });
    }
  }
  return { confirmed, partial, noStock, notFound };
}

// ── Save order to DynamoDB ────────────────────────────────────────────────────
async function saveOrder(shop, items) {
  const ts          = Date.now();
  const OrderID     = "ORD" + ts;
  const InvoiceNumber = "INV" + ts;
  const today       = new Date().toISOString().split('T')[0];
  let total         = 0;

  for (const { product, qty } of items) {
    const rate     = parseFloat(product.Rate    || 0);
    const cgstRate = parseFloat(product.CGSTRate || 0);
    const sgstRate = parseFloat(product.SGSTRate || 0);
    const amount   = rate * qty;
    const cgst     = (amount * cgstRate) / 100;
    const sgst     = (amount * sgstRate) / 100;
    const net      = amount + cgst + sgst;
    total += net;

    const oid = "OI" + Date.now() + Math.random().toString(36).slice(2, 6);
    await dynamo.send(new PutItemCommand({
      TableName: "RN_OrderItems",
      Item: marshall({
        OrderItemID: oid, OrderID,
        ProductID:   product.ProductID,
        ProductName: product.ProductName,
        HSNCode:     product.HSNCode  || '',
        MRP:         parseFloat(product.MRP || 0),
        Pcs:         qty, Rate: rate, Amount: amount,
        CGSTRate: cgstRate, CGSTAmount: cgst,
        SGSTRate: sgstRate, SGSTAmount: sgst,
        NetAmount: net, Discount: 0, TaxableValue: amount
      })
    }));
  }

  await dynamo.send(new PutItemCommand({
    TableName: "RN_Orders",
    Item: marshall({
      OrderID, ShopID: shop.ShopID, ShopName: shop.ShopName,
      InvoiceNumber, Beat: shop.Beat || '',
      SalesMan: "Telegram",
      OrderDate: today, ExpectedDeliveryDate: today,
      OrderStatus: "Pending",
      TotalOrderAmount: Math.round(total * 100) / 100
    })
  }));

  return { OrderID, InvoiceNumber, total: Math.round(total * 100) / 100 };
}

// ── Main handler ──────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log("Telegram event:", JSON.stringify(event).substring(0, 500));

  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || event);

    // ── Callback query (inline buttons) ──────────────────────────────────────
    if (body.callback_query) {
      const cb     = body.callback_query;
      const chatId = cb.message.chat.id;
      await fetch(`${TAPI}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callback_query_id: cb.id })
      });

      if (cb.data === 'view_products') {
        const products = await getProducts();
        const invMap   = await getInventoryMap();
        if (products.length === 0) {
          await tSend(chatId, "⚠️ No products available. Call: 04365-221911");
        } else {
          let msg = "📦 <b>Products &amp; Stock</b>\n\n";
          products.forEach((p, i) => {
            const s = invMap[p.ProductID] || 0;
            const icon = s <= 0 ? '🔴' : s < 5 ? '🟡' : '🟢';
            msg += `${i+1}. ${icon} <b>${p.ProductName}</b> — Rs.${p.Rate}`;
            if (s <= 0)  msg += ' <i>(out of stock)</i>';
            else if (s < 10) msg += ` <i>(${s} left)</i>`;
            msg += '\n';
          });
          msg += "\n🟢 OK  🟡 Low  🔴 Out of stock";
          await tSend(chatId, msg);
        }
      }
      return { statusCode: 200, body: "OK" };
    }

    // ── Regular message ───────────────────────────────────────────────────────
    const msg  = body.message;
    if (!msg)  return { statusCode: 200, body: "OK" };

    const chatId  = msg.chat.id;
    const rawText = (msg.text || '').trim();
    const name    = msg.from?.first_name || 'there';
    const cmd     = rawText.split(/\s+/)[0].toLowerCase();

    console.log("Message from chatId:", chatId, "text:", rawText.substring(0, 100));

    // ── /start ────────────────────────────────────────────────────────────────
    if (cmd === '/start') {
      const shop = await getShopByChatId(chatId);
      if (shop) {
        await tSend(chatId,
          `🙏 <b>Welcome back, ${shop.ShopName}!</b>\n\n` +
          `Commands:\n` +
          `/products — See products &amp; stock\n` +
          `/myorders — Today's orders\n` +
          `/myshop — Your details\n` +
          `/help — Help\n\n` +
          `To order:\n<code>Product Name - Quantity\nProduct Name - Quantity</code>`,
          { reply_markup: { inline_keyboard: [[{ text: "📦 View Products & Stock", callback_data: "view_products" }]] } }
        );
      } else {
        await tSend(chatId,
          `🙏 <b>Welcome to R.N. Agencies!</b>\n\n` +
          `Hello ${name}! To place orders, first register:\n\n` +
          `<b>/register YOUR_SHOP_ID</b>\n\n` +
          `Example: <code>/register S001</code>\n\n` +
          `No Shop ID? Call: <b>04365-221911</b>`
        );
      }
      return { statusCode: 200, body: "OK" };
    }

    // ── /help ─────────────────────────────────────────────────────────────────
    if (cmd === '/help') {
      await tSend(chatId,
        `❓ <b>R.N. Agencies — Help</b>\n\n` +
        `<b>Register:</b>\n<code>/register S001</code>\n\n` +
        `<b>Order (one item per line):</b>\n` +
        `<code>ATTA 500G - 5\nSurf Excel - 3\nDettol 250ml - 2</code>\n\n` +
        `<b>Commands:</b>\n` +
        `/products — Products &amp; stock status\n` +
        `/myorders — Today's orders\n` +
        `/myshop — Your shop details\n\n` +
        `Contact: 04365-221911`
      );
      return { statusCode: 200, body: "OK" };
    }

    // ── /products ─────────────────────────────────────────────────────────────
    if (cmd === '/products') {
      const products = await getProducts();
      const invMap   = await getInventoryMap();
      if (products.length === 0) {
        await tSend(chatId, "⚠️ No products found. Call: 04365-221911");
        return { statusCode: 200, body: "OK" };
      }
      let msg = "📦 <b>Products — R.N. Agencies</b>\n\n";
      products.forEach((p, i) => {
        const s    = invMap[p.ProductID] || 0;
        const icon = s <= 0 ? '🔴' : s < 5 ? '🟡' : '🟢';
        msg += `${i+1}. ${icon} <b>${p.ProductName}</b>\n`;
        msg += `   Rate: Rs.${p.Rate}`;
        if (p.MRP) msg += ` | MRP: Rs.${p.MRP}`;
        if (s <= 0)   msg += ` | <i>Out of stock</i>`;
        else if (s < 10) msg += ` | <i>${s} left</i>`;
        msg += '\n';
      });
      msg += "\n🟢 Available  🟡 Low  🔴 Out of stock";
      await tSend(chatId, msg);
      return { statusCode: 200, body: "OK" };
    }

    // ── /myshop ───────────────────────────────────────────────────────────────
    if (cmd === '/myshop') {
      const shop = await getShopByChatId(chatId);
      if (!shop) {
        await tSend(chatId, "❌ Not registered.\n\n<b>/register YOUR_SHOP_ID</b>");
      } else {
        await tSend(chatId,
          `🏪 <b>Your Shop</b>\n\n` +
          `ID: ${shop.ShopID}\nName: <b>${shop.ShopName}</b>\n` +
          `Beat: ${shop.Beat || 'Not assigned'}\nRegistered: ${shop.RegisteredDate}\n\n` +
          `Contact: 04365-221911`
        );
      }
      return { statusCode: 200, body: "OK" };
    }

    // ── /myorders ─────────────────────────────────────────────────────────────
    if (cmd === '/myorders') {
      const shop = await getShopByChatId(chatId);
      if (!shop) {
        await tSend(chatId, "❌ Please register first.\n\n<b>/register YOUR_SHOP_ID</b>");
        return { statusCode: 200, body: "OK" };
      }
      const orders = await getShopOrdersToday(shop.ShopID);
      if (orders.length === 0) {
        await tSend(chatId, "📋 No orders today yet.\n\nSend products to place an order!");
      } else {
        const icons = { Pending:'⏳', Confirmed:'✅', Delivered:'🚚', Billed:'🧾' };
        let msg  = "📋 <b>Your Orders Today</b>\n\n";
        let total = 0;
        orders.forEach((o, i) => {
          msg += `${i+1}. ${icons[o.OrderStatus]||'•'} ${o.InvoiceNumber}\n`;
          msg += `   Rs.${(o.TotalOrderAmount||0).toFixed(0)} — ${o.OrderStatus}\n\n`;
          total += o.TotalOrderAmount || 0;
        });
        msg += `<b>Total today: Rs.${total.toFixed(0)}</b>`;
        await tSend(chatId, msg);
      }
      return { statusCode: 200, body: "OK" };
    }

    // ── /register SHOPID ──────────────────────────────────────────────────────
    if (cmd === '/register') {
      const parts  = rawText.split(/\s+/);
      if (parts.length < 2) {
        await tSend(chatId, "❌ Include Shop ID.\nExample: <code>/register S001</code>\nCall: 04365-221911");
        return { statusCode: 200, body: "OK" };
      }
      const shopId = parts[1].trim().toUpperCase();

      // Check if already registered
      const existing = await getShopByChatId(chatId);
      if (existing) {
        await tSend(chatId, `ℹ️ Already registered as <b>${existing.ShopName}</b>.\nTo change, call: 04365-221911`);
        return { statusCode: 200, body: "OK" };
      }

      // Look up shop
      const shopData = await getShopByID(shopId);
      if (!shopData) {
        await tSend(chatId,
          `❌ Shop ID <b>${shopId}</b> not found.\n\nCheck the ID or call: <b>04365-221911</b>`
        );
        return { statusCode: 200, body: "OK" };
      }

      // Register — store ChatID as STRING
      await dynamo.send(new PutItemCommand({
        TableName: "RN_TelegramUsers",
        Item: marshall({
          ChatID:         String(chatId),   // CRITICAL: must be string
          ShopID:         shopId,
          ShopName:       shopData.ShopName,
          Beat:           shopData.Beat || '',
          RegisteredDate: new Date().toISOString().split('T')[0]
        })
      }));

      await tSend(chatId,
        `✅ <b>Registered!</b>\n\n` +
        `🏪 <b>${shopData.ShopName}</b>\n` +
        `Beat: ${shopData.Beat || 'Not assigned'}\n\n` +
        `Place an order by typing:\n` +
        `<code>Product Name - Quantity\nProduct Name - Quantity</code>\n\n` +
        `Type /products to see what is available.`,
        { reply_markup: { inline_keyboard: [[{ text: "📦 See Products", callback_data: "view_products" }]] } }
      );
      return { statusCode: 200, body: "OK" };
    }

    // ── Unknown command ────────────────────────────────────────────────────────
    if (rawText.startsWith('/')) {
      await tSend(chatId, `Unknown command. Type /help to see available commands.`);
      return { statusCode: 200, body: "OK" };
    }

    // ── Order text ────────────────────────────────────────────────────────────
    const shop = await getShopByChatId(chatId);
    if (!shop) {
      await tSend(chatId,
        `👋 Hello ${name}! Register first to place orders.\n\n` +
        `<b>/register YOUR_SHOP_ID</b>\n\nCall: 04365-221911`
      );
      return { statusCode: 200, body: "OK" };
    }

    const products = await getProducts();
    if (products.length === 0) {
      await tSend(chatId, "⚠️ Cannot load products right now. Please try in a minute or call: 04365-221911");
      return { statusCode: 200, body: "OK" };
    }

    const invMap = await getInventoryMap();
    const { confirmed, partial, noStock, notFound } = parseOrder(rawText, products, invMap);

    // Nothing at all recognised
    if (confirmed.length === 0 && partial.length === 0 && noStock.length === 0) {
      let msg = "❓ I couldn't match any products.\n\n";
      if (notFound.length > 0) {
        msg += `<b>Not recognised:</b>\n`;
        notFound.forEach(n => { msg += `  • ${n}\n`; });
        msg += "\n";
      }
      msg += "Format: <code>Product Name - Quantity</code>\nType /products to see available items.";
      await tSend(chatId, msg);
      return { statusCode: 200, body: "OK" };
    }

    // Build items to fulfill (confirmed + partial at available qty)
    const toFulfil = [
      ...confirmed,
      ...partial.map(p => ({ product: p.product, qty: p.fulfil }))
    ];

    // All out of stock
    if (toFulfil.length === 0) {
      let msg = "🔴 <b>All requested items are out of stock</b>\n\n";
      noStock.forEach(({ product }) => { msg += `  • ${product.ProductName}\n`; });
      msg += "\nWe will restock soon. Call: 04365-221911";
      await tSend(chatId, msg);
      return { statusCode: 200, body: "OK" };
    }

    // Save order
    const { OrderID, InvoiceNumber, total } = await saveOrder(shop, toFulfil);

    // Build confirmation message
    let confirm = `✅ <b>Order Received!</b>\n\n`;
    confirm += `🏪 <b>${shop.ShopName}</b>\n`;
    confirm += `📋 Invoice: <b>${InvoiceNumber}</b>\n\n`;
    confirm += `<b>Items confirmed:</b>\n`;
    confirmed.forEach(({ product, qty }) => {
      const amt = parseFloat(product.Rate || 0) * qty;
      confirm += `  ✓ ${product.ProductName} × ${qty} = Rs.${amt.toFixed(0)}\n`;
    });
    if (partial.length > 0) {
      confirm += `\n<b>Partial (sending available qty):</b>\n`;
      partial.forEach(({ product, requested, fulfil }) => {
        confirm += `  ⚠️ ${product.ProductName}: asked ${requested}, sending ${fulfil}\n`;
      });
    }
    if (noStock.length > 0) {
      confirm += `\n🔴 <b>Out of stock (not included):</b>\n`;
      noStock.forEach(({ product }) => { confirm += `  • ${product.ProductName}\n`; });
    }
    if (notFound.length > 0) {
      confirm += `\n❓ <b>Not found in catalogue:</b>\n`;
      notFound.forEach(n => { confirm += `  • ${n}\n`; });
    }
    confirm += `\n💰 <b>Total: Rs.${total.toFixed(0)}</b>\n\n`;
    confirm += `⏳ Order is with R.N. Agencies.\n`;
    confirm += `Delivery today or tomorrow.\n\n`;
    confirm += `Questions? Call: 04365-221911`;

    await tSend(chatId, confirm);
    return { statusCode: 200, body: "OK" };

  } catch (err) {
    console.error("TelegramBot UNHANDLED error:", err);
    // Always 200 to Telegram — never let it retry
    return { statusCode: 200, body: "OK" };
  }
};