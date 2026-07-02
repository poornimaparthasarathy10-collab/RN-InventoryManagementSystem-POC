// LAMBDA: RN_LowStockAgent
// Agent 1 — Low Stock Alert
// Runs daily at 8 AM IST via EventBridge (cron: 30 2 * * ? *)
// Checks RN_Inventory → sends Telegram alert to owner if any item is low
// Can also be triggered manually from Lambda Test tab

const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const dynamo     = new DynamoDBClient({ region: "ap-south-1" });
const BOT_TOKEN  = "8749440870:AAF_Iu3KVUSnSjpl2gSKr-sin_AaWHG3Sts";
const CHAT_ID    = "8701799887";  // Your personal Telegram chat ID

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
  console.log("RN_LowStockAgent triggered:", JSON.stringify(event).substring(0, 200));

  try {
    // Step 1: Fetch all inventory
    const res       = await dynamo.send(new ScanCommand({ TableName: "RN_Inventory" }));
    const inventory = res.Items.map(i => unmarshall(i));
    console.log(`Scanned ${inventory.length} inventory items`);

    // Step 2: Categorise
    const critical = inventory.filter(i => (i.CurrentStock || 0) === 0);
    const low      = inventory.filter(i => (i.CurrentStock || 0) > 0 && (i.CurrentStock || 0) <= (i.MinimumStock || 0));
    const ok       = inventory.filter(i => (i.CurrentStock || 0) > (i.MinimumStock || 0));

    const dateStr  = new Date().toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric"
    });
    const timeStr  = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true
    });

    // Step 3: Build message
    let msg = "";

    if (critical.length === 0 && low.length === 0) {
      // All good — send a brief OK message so you know the agent ran
      msg =
        `✅ <b>Stock Check — ${dateStr}</b>\n` +
        `R.N. Agencies, Nagapattinam\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `All <b>${ok.length} products</b> are sufficiently stocked.\n` +
        `No action needed today.\n\n` +
        `<i>Auto-check at ${timeStr}</i>`;
    } else {
      msg =
        `🚨 <b>Low Stock Alert — ${dateStr}</b>\n` +
        `<b>R.N. Agencies, Nagapattinam</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n`;

      if (critical.length > 0) {
        msg += `🔴 <b>OUT OF STOCK (${critical.length} item${critical.length > 1 ? "s" : ""})</b>\n`;
        critical.forEach(item => {
          msg += `  • ${item.ProductName}\n`;
          msg += `    Stock: 0 | Min required: ${item.MinimumStock || 0}\n`;
        });
        msg += "\n";
      }

      if (low.length > 0) {
        msg += `🟡 <b>LOW STOCK (${low.length} item${low.length > 1 ? "s" : ""})</b>\n`;
        low.forEach(item => {
          const shortage = (item.MinimumStock || 0) - (item.CurrentStock || 0);
          msg += `  • ${item.ProductName}\n`;
          msg += `    Stock: ${item.CurrentStock} | Min: ${item.MinimumStock || 0} | Need: +${shortage}\n`;
        });
        msg += "\n";
      }

      msg +=
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ OK: ${ok.length} products\n` +
        `⚠️ Needs reorder: ${critical.length + low.length} products\n\n` +
        `<i>Auto-check at ${timeStr} · RN Agencies Agent</i>`;
    }

    // Step 4: Send to Telegram
    await sendTelegram(msg);
    console.log("Telegram message sent successfully");

    return {
      statusCode: 200,
      body: JSON.stringify({
        message:  "Low stock agent ran successfully",
        critical: critical.length,
        low:      low.length,
        ok:       ok.length,
        total:    inventory.length
      })
    };

  } catch (err) {
    console.error("RN_LowStockAgent error:", err);
    // Try to send error alert to Telegram so you know something went wrong
    try {
      await sendTelegram(
        `❌ <b>Stock Agent Error</b>\n\n` +
        `The low stock check failed:\n${err.message}\n\n` +
        `<i>Check CloudWatch logs for RN_LowStockAgent</i>`
      );
    } catch (_) {}

    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Agent error", error: err.message })
    };
  }
};