// LAMBDA: RN_DaySummaryAgent
// Agent 2 — End of Day Summary
// Runs daily at 7 PM IST via EventBridge (cron: 30 13 * * ? *)
// Scans today's orders + inventory → sends full day summary to owner on Telegram
// Can also be triggered manually from Lambda Test tab

const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const dynamo    = new DynamoDBClient({ region: "ap-south-1" });
const BOT_TOKEN = "8749440870:AAF_Iu3KVUSnSjpl2gSKr-sin_AaWHG3Sts";
const CHAT_ID   = "8701799887";  // Your personal Telegram chat ID

async function sendTelegram(text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        chat_id:    CHAT_ID,
        text:       text,
        parse_mode: "HTML"
      })
    });
    const json = await res.json();
    if (!json.ok) console.error("Telegram error:", json.description);
    return json;
  } catch (e) {
    console.error("sendTelegram failed:", e.message);
  }
}

exports.handler = async (event) => {
  console.log("RN_DaySummaryAgent triggered:", JSON.stringify(event).substring(0, 200));

  try {
    const today = new Date().toISOString().split("T")[0];
    const dateLabel = new Date().toLocaleDateString("en-IN", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric"
    });
    const timeStr = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true
    });

    // Step 1: Fetch today's orders
    const ordersRes = await dynamo.send(new ScanCommand({
      TableName: "RN_Orders",
      FilterExpression: "OrderDate = :date",
      ExpressionAttributeValues: { ":date": { S: today } }
    }));
    const orders = ordersRes.Items.map(i => unmarshall(i));
    console.log(`Found ${orders.length} orders for ${today}`);

    // Step 2: Fetch inventory for low stock check
    const invRes    = await dynamo.send(new ScanCommand({ TableName: "RN_Inventory" }));
    const inventory = invRes.Items.map(i => unmarshall(i));
    const lowStock  = inventory.filter(i => (i.CurrentStock || 0) <= (i.MinimumStock || 0));

    // Step 3: Calculate stats
    const delivered    = orders.filter(o => ["Delivered", "Billed"].includes(o.OrderStatus));
    const confirmed    = orders.filter(o => o.OrderStatus === "Confirmed");
    const pending      = orders.filter(o => o.OrderStatus === "Pending");
    const totalAmt     = orders.reduce((s, o) => s + (parseFloat(o.TotalOrderAmount) || 0), 0);
    const deliveredAmt = delivered.reduce((s, o) => s + (parseFloat(o.TotalOrderAmount) || 0), 0);
    const pendingAmt   = pending.reduce((s, o) => s + (parseFloat(o.TotalOrderAmount) || 0), 0);
    const delivPct     = orders.length > 0
      ? Math.round((delivered.length / orders.length) * 100) : 0;

    // Step 4: Beat-wise breakdown
    const byBeat = {};
    orders.forEach(o => {
      const beat = o.Beat || "Unassigned";
      if (!byBeat[beat]) byBeat[beat] = { count: 0, delivered: 0, total: 0 };
      byBeat[beat].count++;
      byBeat[beat].total += parseFloat(o.TotalOrderAmount) || 0;
      if (["Delivered", "Billed"].includes(o.OrderStatus)) byBeat[beat].delivered++;
    });

    // Step 5: Build message
    let msg = "";

    if (orders.length === 0) {
      msg =
        `📊 <b>Day Summary — ${dateLabel}</b>\n` +
        `<b>R.N. Agencies, Nagapattinam</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `No orders were placed today.\n\n`;
    } else {
      msg =
        `📊 <b>Day Summary — ${dateLabel}</b>\n` +
        `<b>R.N. Agencies, Nagapattinam</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +

        `💰 <b>Total Business: Rs. ${totalAmt.toFixed(0)}</b>\n` +
        `📦 Total Orders: ${orders.length} | Delivery: ${delivPct}%\n\n` +

        `<b>Order Status:</b>\n` +
        `  ✅ Delivered: ${delivered.length} orders (Rs. ${deliveredAmt.toFixed(0)})\n`;

      if (confirmed.length > 0) {
        msg += `  🔵 Confirmed (not yet delivered): ${confirmed.length}\n`;
      }
      if (pending.length > 0) {
        msg += `  ⚠️ Still Pending: ${pending.length} (Rs. ${pendingAmt.toFixed(0)})\n`;
      }

      // Beat breakdown
      const beatEntries = Object.entries(byBeat)
        .sort((a, b) => b[1].total - a[1].total);

      if (beatEntries.length > 0) {
        msg += `\n<b>Beat-wise:</b>\n`;
        beatEntries.forEach(([beat, data]) => {
          const pct = data.count > 0
            ? Math.round((data.delivered / data.count) * 100) : 0;
          const icon = pct === 100 ? "✅" : pct > 0 ? "🔵" : "⏳";
          msg +=
            `  ${icon} ${beat}: ${data.count} order${data.count > 1 ? "s" : ""} · ` +
            `Rs. ${data.total.toFixed(0)} · ${pct}% delivered\n`;
        });
      }
    }

    // Low stock warning in summary
    if (lowStock.length > 0) {
      msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `⚠️ <b>Low Stock (${lowStock.length} item${lowStock.length > 1 ? "s" : ""}):</b>\n`;
      lowStock.slice(0, 5).forEach(item => {
        msg += `  • ${item.ProductName}: ${item.CurrentStock || 0} left (min ${item.MinimumStock || 0})\n`;
      });
      if (lowStock.length > 5) {
        msg += `  ... and ${lowStock.length - 5} more\n`;
      }
    }

    msg +=
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `<i>Auto-summary at ${timeStr} · RN Agencies Agent</i>`;

    // Step 6: Send to Telegram
    await sendTelegram(msg);
    console.log("Day summary sent successfully");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message:       "Day summary sent",
        date:          today,
        totalOrders:   orders.length,
        totalAmount:   totalAmt,
        delivered:     delivered.length,
        pending:       pending.length,
        lowStockCount: lowStock.length
      })
    };

  } catch (err) {
    console.error("RN_DaySummaryAgent error:", err);
    try {
      await sendTelegram(
        `❌ <b>Day Summary Agent Error</b>\n\n` +
        `Could not generate today's summary:\n${err.message}\n\n` +
        `<i>Check CloudWatch logs for RN_DaySummaryAgent</i>`
      );
    } catch (_) {}

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Agent error", error: err.message })
    };
  }
};