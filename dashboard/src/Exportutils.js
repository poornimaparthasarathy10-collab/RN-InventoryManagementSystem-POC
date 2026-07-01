// exportUtils.js — Copy this file to src/exportUtils.js
// Provides: exportToCSV, exportToPDF, exportBillPDF
// No external libraries needed — pure browser APIs

// ── CSV / Excel export ────────────────────────────────────────────────────────
// Creates a .csv file that opens in Excel automatically
export function exportToCSV(filename, headers, rows) {
  const escape = v => {
    if (v == null) return '';
    const s = String(v);
    // Wrap in quotes if contains comma, quote, or newline
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(','))
  ];
  const csv    = '\uFEFF' + lines.join('\r\n'); // BOM for Excel UTF-8
  const blob   = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url    = URL.createObjectURL(blob);
  const a      = document.createElement('a');
  a.href       = url;
  a.download   = filename + '_' + new Date().toISOString().split('T')[0] + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ── Print as PDF (uses browser print dialog → Save as PDF) ───────────────────
// Opens a new window with clean HTML, triggers print dialog
// User selects "Save as PDF" in the print dialog
export function printAsPDF(title, htmlContent) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('Please allow popups for this site to use PDF export'); return; }
  win.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; color: #111; }
    h1 { font-size: 18px; color: #1B4332; margin-bottom: 4px; }
    .sub { font-size: 11px; color: #666; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th { background: #1B4332; color: #fff; padding: 7px 8px; text-align: left; font-size: 11px; }
    td { padding: 6px 8px; border-bottom: 1px solid #eee; font-size: 12px; }
    tr:nth-child(even) td { background: #f9f9f9; }
    .summary { display: flex; gap: 20px; margin-bottom: 16px; flex-wrap: wrap; }
    .sum-box { border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; min-width: 140px; }
    .sum-label { font-size: 10px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
    .sum-val { font-size: 20px; font-weight: 700; color: #1B4332; }
    .section-title { font-size: 13px; font-weight: 700; color: #1B4332; text-transform: uppercase; 
                     letter-spacing: .5px; margin: 16px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #ccc; }
    @media print { 
      body { padding: 0; } 
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <button class="no-print" onclick="window.print()" 
    style="margin-bottom:16px;padding:8px 20px;background:#1B4332;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">
    🖨 Save as PDF / Print
  </button>
  ${htmlContent}
</body>
</html>`);
  win.document.close();
  // Auto-trigger print after a short delay (let styles load)
  setTimeout(() => { try { win.print(); } catch(_) {} }, 600);
}

// ── Build report HTML for PDF ─────────────────────────────────────────────────
export function buildReportHTML(orders, inventory, dateStr) {
  const delivered = orders.filter(o => ['Delivered','Billed'].includes(o.OrderStatus));
  const pending   = orders.filter(o => o.OrderStatus === 'Pending');
  const totalAmt  = orders.reduce((s,o) => s + (parseFloat(o.TotalOrderAmount)||0), 0);
  const delivAmt  = delivered.reduce((s,o) => s + (parseFloat(o.TotalOrderAmount)||0), 0);
  const pendAmt   = pending.reduce((s,o) => s + (parseFloat(o.TotalOrderAmount)||0), 0);

  const byBeat = {};
  orders.forEach(o => {
    const b = o.Beat || 'Unassigned';
    if (!byBeat[b]) byBeat[b] = { count:0, delivered:0, total:0 };
    byBeat[b].count++;
    byBeat[b].total += parseFloat(o.TotalOrderAmount)||0;
    if (['Delivered','Billed'].includes(o.OrderStatus)) byBeat[b].delivered++;
  });

  const prodSold = {};
  orders.forEach(o => (o.Items||[]).forEach(item => {
    const nm = item.ProductName || 'Unknown';
    if (!prodSold[nm]) prodSold[nm] = { qty:0, amt:0 };
    prodSold[nm].qty += item.Pcs || 0;
    prodSold[nm].amt += parseFloat(item.NetAmount||item.Amount||0);
  }));

  const lowStock = inventory.filter(i => (i.CurrentStock||0) <= (i.MinimumStock||0));

  const beatRows = Object.entries(byBeat)
    .sort((a,b) => b[1].total - a[1].total)
    .map(([b,d]) => `<tr><td>${b}</td><td>${d.count}</td><td>${d.delivered}/${d.count}</td><td>Rs.${d.total.toFixed(0)}</td></tr>`)
    .join('');

  const prodRows = Object.entries(prodSold)
    .sort((a,b) => b[1].amt - a[1].amt)
    .map(([nm,d]) => `<tr><td>${nm}</td><td>${d.qty}</td><td>Rs.${d.amt.toFixed(0)}</td></tr>`)
    .join('');

  const lowRows = lowStock
    .map(i => `<tr><td>${i.ProductName}</td><td style="color:#DC2626;font-weight:700">${i.CurrentStock||0}</td><td>${i.MinimumStock||0}</td><td>+${Math.max(0,(i.MinimumStock||0)-(i.CurrentStock||0))}</td></tr>`)
    .join('');

  return `
    <h1>R.N. Agencies — Day Report</h1>
    <div class="sub">Date: ${dateStr} &nbsp;|&nbsp; Nagapattinam &nbsp;|&nbsp; Ph: 04365-221911</div>
    <div class="summary">
      <div class="sum-box"><div class="sum-label">Total Business</div><div class="sum-val">Rs.${totalAmt.toFixed(0)}</div></div>
      <div class="sum-box"><div class="sum-label">Orders</div><div class="sum-val">${orders.length}</div></div>
      <div class="sum-box"><div class="sum-label">Delivered</div><div class="sum-val" style="color:#15803D">Rs.${delivAmt.toFixed(0)}</div></div>
      <div class="sum-box"><div class="sum-label">Pending</div><div class="sum-val" style="color:#C2410C">Rs.${pendAmt.toFixed(0)}</div></div>
    </div>
    <div class="section-title">Beat-wise Summary</div>
    <table><thead><tr><th>Beat</th><th>Orders</th><th>Delivered</th><th>Total</th></tr></thead>
    <tbody>${beatRows || '<tr><td colspan="4">No orders</td></tr>'}</tbody></table>
    <div class="section-title">Products Sold Today</div>
    <table><thead><tr><th>Product</th><th>Qty Sold</th><th>Amount</th></tr></thead>
    <tbody>${prodRows || '<tr><td colspan="3">No data</td></tr>'}</tbody></table>
    ${lowStock.length > 0 ? `
    <div class="section-title">Low Stock — Needs Reorder</div>
    <table><thead><tr><th>Product</th><th>Current</th><th>Minimum</th><th>Shortage</th></tr></thead>
    <tbody>${lowRows}</tbody></table>` : ''}
  `;
}