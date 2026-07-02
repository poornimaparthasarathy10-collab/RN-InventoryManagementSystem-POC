// LAMBDA: scanBill — FINAL FIXED v3
// Handles HTTP API Gateway event format correctly
// GET /scanBill = diagnostics
// POST /scanBill with {imageData, mediaType} = scan bill

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Api-Key,X-Requested-With",
  "Access-Control-Allow-Methods": "POST,GET,OPTIONS"
};

exports.handler = async (event) => {
  // Log everything — visible in CloudWatch → Monitor → View logs
  console.log("EVENT keys:", Object.keys(event).join(', '));
  console.log("httpMethod:", event.httpMethod);
  console.log("requestContext.http:", JSON.stringify(event.requestContext?.http || {}));
  console.log("queryStringParameters:", JSON.stringify(event.queryStringParameters || {}));
  console.log("body (first 200):", String(event.body || '').substring(0, 200));

  // Detect method — HTTP API uses requestContext.http.method, REST uses httpMethod
  const method = (
    event.requestContext?.http?.method ||
    event.httpMethod ||
    'POST'
  ).toUpperCase();

  // OPTIONS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  // GET request = run diagnostics (no image needed)
  // Also triggered by POST with {"test":true} for Lambda console testing
  let bodyParsed = {};
  try {
    if (event.body) {
      bodyParsed = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    }
  } catch(_) {}

  const isDiag = method === 'GET' || bodyParsed.test === true;

  if (isDiag) {
    console.log("Running diagnostics...");
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const keyOk  = apiKey.length > 20 && apiKey.startsWith('sk-');

    const result = {
      step1_lambda:   "✅ Lambda is running",
      step2_api_key:  keyOk
        ? `✅ API key set (${apiKey.substring(0,12)}...)`
        : `❌ ANTHROPIC_API_KEY not set or invalid (got: "${apiKey.substring(0,8)}")`,
      step3_internet: "testing...",
      step4_claude:   "not tested yet",
      fix: null
    };

    if (!keyOk) {
      result.step3_internet = "skipped";
      result.step4_claude   = "skipped";
      result.fix = "Go to Lambda → Configuration → Environment variables → set ANTHROPIC_API_KEY to your sk-ant-... key from console.anthropic.com";
      return { statusCode: 200, headers: CORS, body: JSON.stringify(result, null, 2) };
    }

    // Test internet
    try {
      const r = await fetch('https://api.anthropic.com', {
        signal: AbortSignal.timeout(6000)
      });
      result.step3_internet = `✅ Internet works (anthropic.com responded ${r.status})`;
    } catch(e) {
      result.step3_internet = `❌ No internet: ${e.message}`;
      result.fix = "Lambda cannot reach internet. Check Lambda → Configuration → VPC (should be No VPC). Also check security group outbound rules allow HTTPS (port 443).";
      return { statusCode: 200, headers: CORS, body: JSON.stringify(result, null, 2) };
    }

    // Test Claude API with real call
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages:   [{ role: 'user', content: 'Say OK' }]
        }),
        signal: AbortSignal.timeout(20000)
      });
      const data = await r.json();
      console.log("Claude test:", r.status, JSON.stringify(data).substring(0, 300));

      if (r.status === 200) {
        result.step4_claude = `✅ Claude API works! Response: "${data.content?.[0]?.text || 'OK'}"`;
        result.fix = "🎉 Everything is working! You can now scan bills.";
      } else if (r.status === 401) {
        result.step4_claude = `❌ API key rejected (401): ${data.error?.message || 'authentication failed'}`;
        result.fix = "Your API key is invalid or expired. Get a new one: console.anthropic.com → API Keys → Create Key";
      } else {
        result.step4_claude = `⚠️ Claude returned ${r.status}: ${JSON.stringify(data).substring(0,200)}`;
        result.fix = "Unexpected response from Claude. Check console.anthropic.com for account issues.";
      }
    } catch(e) {
      result.step4_claude = `❌ Claude call failed: ${e.message}`;
      result.fix = "Could not call Claude API. " + e.message;
    }

    return { statusCode: 200, headers: CORS, body: JSON.stringify(result, null, 2) };
  }

  // ── Normal scan: POST with imageData ─────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  if (!apiKey.startsWith('sk-')) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({
      message: "ANTHROPIC_API_KEY not set in Lambda environment variables"
    })};
  }

  const { imageData, mediaType } = bodyParsed;
  if (!imageData) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({
      message: "imageData (base64) is required in request body"
    })};
  }

  const sizeKB = Math.round(imageData.length * 0.75 / 1024);
  console.log(`Scanning: ~${sizeKB}KB, mediaType: ${mediaType}`);

  if (imageData.length > 5_500_000) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({
      message: `Image too large (~${sizeKB}KB). Please use a photo under 4MB.`
    })};
  }

  const imgType = ['image/jpeg','image/jpg','image/png','image/webp']
    .includes(mediaType) ? mediaType : 'image/jpeg';

  let claudeResp;
  try {
    claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imgType, data: imageData } },
            { type: 'text',  text: `This is a supplier invoice or handwritten delivery bill for a wholesale FMCG distributor in Tamil Nadu, India. Extract ALL product line items.

Return ONLY a JSON object — no markdown fences, no explanation:
{
  "invoiceNumber": "string or null",
  "invoiceDate": "YYYY-MM-DD or null",
  "supplierName": "string or null",
  "supplierGSTIN": "string or null",
  "items": [
    {
      "productName": "exact name as written",
      "hsnCode": "string or null",
      "quantity": number,
      "uom": "BOX or PCS or PKT or KG or LTR",
      "mrp": number or null,
      "rate": number or null,
      "amount": number or null
    }
  ]
}

Parsing rules:
- quantity must be a positive integer, never null
- Handwritten "2Boz" = quantity:2, uom:"BOX"
- Handwritten "1Bag" = quantity:1, uom:"PKT"  
- Default uom = "BOX"
- Return ONLY the raw JSON, nothing else` }
          ]
        }]
      }),
      signal: AbortSignal.timeout(25000)
    });
  } catch(e) {
    console.error("Claude fetch error:", e.message);
    return { statusCode: 502, headers: CORS, body: JSON.stringify({
      message: "Cannot reach Claude API: " + e.message
    })};
  }

  if (!claudeResp.ok) {
    const errText = await claudeResp.text();
    console.error("Claude error:", claudeResp.status, errText.substring(0,300));
    return { statusCode: 502, headers: CORS, body: JSON.stringify({
      message: `Claude API error ${claudeResp.status}`,
      detail:  errText.substring(0, 300)
    })};
  }

  const data = await claudeResp.json();
  const raw  = (data.content?.[0]?.text || '').trim();
  console.log("Claude response:", raw.substring(0, 500));

  let parsed;
  try {
    const clean = raw.replace(/^```json\s*/i,'').replace(/^```/,'').replace(/```$/,'').trim();
    parsed = JSON.parse(clean);
  } catch(e) {
    return { statusCode: 422, headers: CORS, body: JSON.stringify({
      message: "Bill unclear — try a clearer, well-lit photo where all text is readable"
    })};
  }

  const items = (parsed.items || [])
    .filter(i => i.productName && String(i.productName).trim())
    .map(i => ({
      productName: String(i.productName).trim(),
      hsnCode:     i.hsnCode ? String(i.hsnCode) : null,
      quantity:    Math.max(1, parseInt(i.quantity) || 1),
      uom:         ['BOX','PCS','PKT','KG','LTR'].includes(String(i.uom||'').toUpperCase())
                     ? String(i.uom).toUpperCase() : 'BOX',
      mrp:    i.mrp    != null ? parseFloat(i.mrp)    : null,
      rate:   i.rate   != null ? parseFloat(i.rate)   : null,
      amount: i.amount != null ? parseFloat(i.amount) : null,
    }));

  return { statusCode: 200, headers: CORS, body: JSON.stringify({
    message:       items.length > 0 ? "Bill scanned successfully" : "No items found — try a clearer photo",
    invoiceNumber: parsed.invoiceNumber || null,
    invoiceDate:   parsed.invoiceDate   || null,
    supplierName:  parsed.supplierName  || null,
    supplierGSTIN: parsed.supplierGSTIN || null,
    itemCount:     items.length,
    items
  })};
};