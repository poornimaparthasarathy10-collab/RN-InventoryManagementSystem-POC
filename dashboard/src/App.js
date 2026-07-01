import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import config from './config';
import './App.css';
import { exportToCSV, printAsPDF, buildReportHTML } from './Exportutils';

// ─── Safe response parser ────────────────────────────────────────────────────
// Handles BOTH "API Gateway wrapped" responses {body: '{"key":"val"}'}
// AND "already parsed" responses {"key":"val"}
function safe(res) {
  let d = res.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) {} }
  if (d && typeof d.body === 'string') { try { d = JSON.parse(d.body); } catch (_) {} }
  return d || {};
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const isoToday  = () => new Date().toISOString().split('T')[0];
const fmtDate   = d => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
const fmtNow    = () => new Date().toLocaleString('en-IN', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:true });
const timeFromId = id => {
  const ms = parseInt((id || '').replace('ORD', ''));
  if (!ms || isNaN(ms)) return '';
  return new Date(ms).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
};
const n = v => parseFloat(v) || 0;

// ─── FIX: FormField and SelectField at MODULE LEVEL (outside every component) ─
// Defining them INSIDE AddStock caused React to remount them on every keystroke
// because each render produced a NEW component type → input lost focus after 1 letter.
// At module level they are stable references → no remount → typing works normally.
function FormField({ label, value, onChange, type, placeholder }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <input
        type={type || 'text'}
        value={value}
        placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)}
        autoComplete="off"
      />
    </div>
  );
}
function SelectField({ label, value, onChange, children }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}

// ─── App root ────────────────────────────────────────────────────────────────
export default function App() {
  const [page,        setPage]        = useState('dashboard');
  const [orders,      setOrders]      = useState([]);
  const [inventory,   setInventory]   = useState([]);
  const [products,    setProducts]    = useState([]);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [refreshing,  setRefreshing]  = useState(false);
  const [toast,       setToast]       = useState(null);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const fetchOrders = useCallback(async () => {
    try {
      const res = await axios.post(`${config.API_BASE_URL}${config.endpoints.getDailyOrders}`, {});
      const d   = safe(res);
      const all = [];
      if (d.deliveryByBeat) Object.values(d.deliveryByBeat).forEach(b => all.push(...b));
      if (Array.isArray(d.orders)) all.push(...d.orders);
      all.sort((a, b) => (b.OrderID || '').localeCompare(a.OrderID || ''));
      setOrders(all);
      setLastRefresh(new Date());
    } catch (e) { console.error('fetchOrders', e); }
  }, []);

  const fetchInventory = useCallback(async () => {
    try {
      const res = await axios.post(`${config.API_BASE_URL}${config.endpoints.getInventory}`, {});
      const d   = safe(res);
      setInventory(d.inventory || []);
      setLastRefresh(new Date());
    } catch (e) { console.error('fetchInventory', e); }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await axios.post(`${config.API_BASE_URL}${config.endpoints.getProducts}`, {});
      const d   = safe(res);
      setProducts(d.products || []);
    } catch (e) { console.error('fetchProducts', e); }
  }, []);

  // FIX: refreshAll is async, shows loading state, shows toast on done
  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchOrders(), fetchInventory(), fetchProducts()]);
      showToast('Data refreshed ✓');
    } catch (e) {
      showToast('Refresh failed — check network', true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchOrders, fetchInventory, fetchProducts, showToast]);

  useEffect(() => {
    refreshAll();
    const t = setInterval(fetchOrders, 120000);
    return () => clearInterval(t);
  }, []); // eslint-disable-line

  const pending   = orders.filter(o => o.OrderStatus === 'Pending');
  const confirmed = orders.filter(o => o.OrderStatus === 'Confirmed');
  const delivered = orders.filter(o => ['Delivered', 'Billed'].includes(o.OrderStatus));
  const totalAmt  = orders.reduce((s, o) => s + n(o.TotalOrderAmount), 0);
  const lowStock  = inventory.filter(i => n(i.CurrentStock) <= n(i.MinimumStock));

  const navItems = [
    { id:'dashboard', label:'Dashboard',  icon:'⊞' },
    { id:'orders',    label:'Orders',     icon:'≡', badge: pending.length },
    { id:'routes',    label:'Routes',     icon:'◎' },
    { id:'inventory', label:'Inventory',  icon:'▦', badge: lowStock.length },
    { id:'addstock',  label:'Add Stock',  icon:'+' },
    { id:'reports',   label:'Reports',    icon:'▤' },
    { id:'products',  label:'Products',   icon:'◈' },
  ];
  const titles = {
    dashboard:'Dashboard', orders:'All Orders', routes:'Delivery Routes',
    inventory:'Inventory', addstock:'Add Stock', reports:'Day Report', products:'Product Master'
  };

  return (
    <div className="layout">
      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="co-name">R.N. Agencies</div>
          <div className="co-sub">Nagapattinam · Distribution</div>
        </div>
        <nav className="sidebar-nav">
          {navItems.map(nav => (
            <div
              key={nav.id}
              className={`nav-item ${page === nav.id ? 'active' : ''}`}
              onClick={() => setPage(nav.id)}
            >
              <span className="nav-icon">{nav.icon}</span>
              <span>{nav.label}</span>
              {nav.badge > 0 && <span className="nav-badge">{nav.badge}</span>}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          {isoToday()}<br/>Ph: 04365-221911
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="main">
        {/* Top bar */}
        <div className="topbar">
          <div>
            <div className="topbar-title">{titles[page]}</div>
            <div className="topbar-sub">
              {lastRefresh ? `Updated ${fmtNow()}` : 'Loading…'}
            </div>
          </div>
          <div className="topbar-right">
            <button
              className="refresh-btn"
              onClick={refreshAll}
              disabled={refreshing}
            >
              {refreshing ? '⟳ Refreshing…' : '↻ Refresh'}
            </button>
          </div>
        </div>

        {/* Toast */}
        {toast && (
          <div className={`toast ${toast.isError ? 'toast-error' : ''}`}>
            {toast.msg}
          </div>
        )}

        {/* Pages */}
        <div className="page-content">
          {page === 'dashboard' && (
            <Dashboard
              orders={orders} pending={pending} confirmed={confirmed}
              delivered={delivered} totalAmt={totalAmt} lowStock={lowStock}
              setPage={setPage}
              fetchOrders={fetchOrders} fetchInventory={fetchInventory}
              showToast={showToast}
            />
          )}
          {page === 'orders' && (
            <Orders
              orders={orders}
              fetchOrders={fetchOrders} fetchInventory={fetchInventory}
              showToast={showToast}
            />
          )}
          {page === 'routes' && (
            <Routes
              orders={orders}
              fetchOrders={fetchOrders} fetchInventory={fetchInventory}
              showToast={showToast}
            />
          )}
          {page === 'inventory' && (
            <Inventory inventory={inventory} fetchInventory={fetchInventory} />
          )}
          {page === 'addstock' && (
            <AddStock
              products={products}
              fetchInventory={fetchInventory}
              showToast={showToast}
            />
          )}
          {page === 'reports' && (
            <Reports orders={orders} inventory={inventory} />
          )}
          {page === 'products' && (
            <Products products={products} fetchProducts={fetchProducts} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function Dashboard({ orders, pending, confirmed, delivered, totalAmt, lowStock, setPage, fetchOrders, fetchInventory, showToast }) {
  return (
    <div>
      {lowStock.length > 0 && (
        <div className="alert-banner" onClick={() => setPage('inventory')}>
          ⚠ {lowStock.length} item{lowStock.length > 1 ? 's are' : ' is'} low on stock — click to view
        </div>
      )}

      <div className="metric-row">
        <div className="metric-card accent">
          <div className="metric-label">Today's total</div>
          <div className="metric-value">Rs.{totalAmt.toFixed(0)}</div>
          <div className="metric-sub">{orders.length} orders placed</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pending</div>
          <div className="metric-value warn">{pending.length}</div>
          <div className="metric-sub">Awaiting confirm</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Confirmed</div>
          <div className="metric-value info">{confirmed.length}</div>
          <div className="metric-sub">Out for delivery</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Delivered</div>
          <div className="metric-value success">{delivered.length}</div>
          <div className="metric-sub">Completed today</div>
        </div>
      </div>

      {pending.length > 0 && (
        <>
          <div className="section-header">
            <div className="section-title">⚡ Needs action</div>
            <button className="refresh-btn" onClick={() => setPage('orders')}>View all →</button>
          </div>
          <OrdersTable
            orders={pending.slice(0, 8)}
            fetchOrders={fetchOrders} fetchInventory={fetchInventory}
            showToast={showToast} compact
          />
        </>
      )}

      {confirmed.length > 0 && (
        <>
          <div className="section-header" style={{ marginTop: 24 }}>
            <div className="section-title">🚚 Out for delivery</div>
          </div>
          <OrdersTable
            orders={confirmed.slice(0, 5)}
            fetchOrders={fetchOrders} fetchInventory={fetchInventory}
            showToast={showToast} compact
          />
        </>
      )}

      {orders.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <p>No orders today. Orders from Telegram appear here automatically.</p>
        </div>
      )}
    </div>
  );
}

// ─── ORDERS ──────────────────────────────────────────────────────────────────
function Orders({ orders, fetchOrders, fetchInventory, showToast }) {
  const [status, setStatus] = useState('All');
  const [beat,   setBeat]   = useState('All');

  const beats = ['All', ...new Set(orders.map(o => o.Beat).filter(Boolean))];
  const counts = {
    All:       orders.length,
    Pending:   orders.filter(o => o.OrderStatus === 'Pending').length,
    Confirmed: orders.filter(o => o.OrderStatus === 'Confirmed').length,
    Delivered: orders.filter(o => ['Delivered', 'Billed'].includes(o.OrderStatus)).length,
  };

  const filtered = orders
    .filter(o => status === 'All' || (status === 'Delivered'
      ? ['Delivered', 'Billed'].includes(o.OrderStatus)
      : o.OrderStatus === status))
    .filter(o => beat === 'All' || o.Beat === beat);

  const tabClass = t => status === t ? `stab active-${t.toLowerCase()}` : 'stab';

  return (
    <div>
      <div className="status-tabs">
        {['All', 'Pending', 'Confirmed', 'Delivered'].map(t => (
          <button key={t} className={tabClass(t)} onClick={() => setStatus(t)}>
            {t} ({counts[t]})
          </button>
        ))}
      </div>

      {beats.length > 2 && (
        <div className="filter-row">
          <span className="filter-label">Beat:</span>
          <select className="filter-select" value={beat} onChange={e => setBeat(e.target.value)}>
            {beats.map(b => <option key={b}>{b}</option>)}
          </select>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <p>No {status !== 'All' ? status.toLowerCase() : ''} orders found</p>
        </div>
      ) : (
        <OrdersTable
          orders={filtered}
          fetchOrders={fetchOrders} fetchInventory={fetchInventory}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── ORDERS TABLE (shared by Dashboard + Orders page) ────────────────────────
function OrdersTable({ orders, fetchOrders, fetchInventory, showToast, compact }) {
  const [expandedId, setExpandedId] = useState(null);
  const [busyMap,    setBusyMap]    = useState({});

  const setBusy = (k, v) => setBusyMap(m => ({ ...m, [k]: v }));

  const updateStatus = async (order, newStatus) => {
    const k = order.OrderID + newStatus;
    setBusy(k, true);
    try {
      await axios.post(
        `${config.API_BASE_URL}${config.endpoints.updateOrderStatus}`,
        { OrderID: order.OrderID, OrderStatus: newStatus }
      );
      showToast(`Marked as ${newStatus}`);
      await fetchOrders();
      // FIX: inventory deducted ONLY on Delivered — not on Confirm, not on Bill
      if (newStatus === 'Delivered' && fetchInventory) await fetchInventory();
    } catch (e) {
      console.error('updateStatus', e);
      showToast('Failed to update status', true);
    }
    setBusy(k, false);
  };

  // FIX: generateBill no longer changes the order status at all
  // Status: Pending → Confirmed → Delivered  (only via updateStatus buttons above)
  // Bill can be printed at ANY time without affecting the status
  const generateBill = async (order) => {
    const k = order.OrderID + '_bill';
    setBusy(k, true);
    try {
      const res = await axios.post(
        `${config.API_BASE_URL}${config.endpoints.generateBill}`,
        { OrderID: order.OrderID }
      );
      const d = safe(res);
      if (!d.BillHTML) {
        showToast('Bill HTML missing — check Lambda logs', true);
        setBusy(k, false);
        return;
      }
      const blob = new Blob([d.BillHTML], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      showToast('Bill opened in new tab ✓');
      // No status change — order remains in its current state
    } catch (e) {
      console.error('generateBill', e);
      showToast('Error generating bill', true);
    }
    setBusy(k, false);
  };

  const badgeCls = s => ({
    Pending:'badge-pending', Confirmed:'badge-confirmed',
    Delivered:'badge-delivered', Billed:'badge-billed'
  }[s] || 'badge-pending');

  return (
    <div className="orders-table-wrap">
      <table className="orders-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Invoice / Shop</th>
            {!compact && <th>Beat</th>}
            <th>Amount</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => {
            const isExp    = expandedId === order.OrderID;
            const bConfirm = busyMap[order.OrderID + 'Confirmed'];
            const bDeliver = busyMap[order.OrderID + 'Delivered'];
            const bBill    = busyMap[order.OrderID + '_bill'];
            return (
              <React.Fragment key={order.OrderID}>
                <tr className={isExp ? 'expanded' : ''}>
                  <td style={{ fontSize:12, color:'#64748B', whiteSpace:'nowrap' }}>
                    {timeFromId(order.OrderID) || order.OrderDate}
                  </td>
                  <td>
                    <div className="shop-name">{order.ShopName}</div>
                    <div className="order-inv">{order.InvoiceNumber}</div>
                    {compact && <div style={{ fontSize:11, color:'#94A3B8' }}>{order.Beat}</div>}
                  </td>
                  {!compact && <td style={{ color:'#64748B' }}>{order.Beat || '—'}</td>}
                  <td style={{ fontWeight:700, whiteSpace:'nowrap' }}>
                    Rs. {n(order.TotalOrderAmount).toFixed(0)}
                  </td>
                  <td>
                    <span className={`badge ${badgeCls(order.OrderStatus)}`}>
                      {order.OrderStatus}
                    </span>
                  </td>
                  <td>
                    <div className="action-cell">
                      {order.OrderStatus === 'Pending' && (
                        <button
                          className="btn-action btn-confirm"
                          disabled={bConfirm}
                          onClick={() => updateStatus(order, 'Confirmed')}
                        >
                          {bConfirm ? '…' : '✓ Confirm'}
                        </button>
                      )}
                      {(order.OrderStatus === 'Confirmed' || order.OrderStatus === 'Billed') && (
                        <button
                          className="btn-action btn-deliver"
                          disabled={bDeliver}
                          onClick={() => updateStatus(order, 'Delivered')}
                        >
                          {bDeliver ? '…' : '🚚 Mark Delivered'}
                        </button>
                      )}
                      {order.OrderStatus === 'Delivered' && (
                        <span className="btn-done">✓ Delivered</span>
                      )}
                      <button
                        className="btn-action btn-bill"
                        disabled={bBill}
                        onClick={() => generateBill(order)}
                      >
                        {bBill ? '…' : '🧾 Bill'}
                      </button>
                      <button
                        className="btn-action"
                        style={{ background:'#F8FAFC', border:'1px solid #E2E8F0', color:'#555' }}
                        onClick={() => setExpandedId(isExp ? null : order.OrderID)}
                      >
                        {isExp ? '▲' : '▼'}
                      </button>
                    </div>
                  </td>
                </tr>
                {isExp && (
                  <tr>
                    <td colSpan={compact ? 5 : 6} className="order-expand">
                      {!order.Items || order.Items.length === 0 ? (
                        <span style={{ color:'#94A3B8', fontSize:12 }}>No item details available</span>
                      ) : (
                        <div className="order-items-mini">
                          {order.Items.map((item, i) => (
                            <div key={i}>
                              <span>{item.ProductName} × {item.Pcs}</span>
                              <span>Rs. {n(item.NetAmount || item.Amount).toFixed(2)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── ROUTES ──────────────────────────────────────────────────────────────────
function Routes({ orders, fetchOrders, fetchInventory, showToast }) {
  const [busyId, setBusyId] = useState(null);

  const byBeat = {};
  orders.forEach(o => {
    const b = o.Beat || 'Unassigned';
    if (!byBeat[b]) byBeat[b] = [];
    byBeat[b].push(o);
  });

  const updateStatus = async (order, newStatus) => {
    setBusyId(order.OrderID);
    try {
      await axios.post(
        `${config.API_BASE_URL}${config.endpoints.updateOrderStatus}`,
        { OrderID: order.OrderID, OrderStatus: newStatus }
      );
      showToast(`${order.ShopName} — ${newStatus}`);
      await fetchOrders();
      if (newStatus === 'Delivered' && fetchInventory) await fetchInventory();
    } catch (e) { showToast('Failed to update', true); }
    setBusyId(null);
  };

  if (Object.keys(byBeat).length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🗺</div>
        <p>No routes today. Orders from Telegram appear here automatically.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 18 }}>
        <div>
          <div className="section-title">Today's delivery routes</div>
          <div className="section-sub">
            {fmtDate(new Date())} · {Object.keys(byBeat).length} beat{Object.keys(byBeat).length > 1 ? 's' : ''}
          </div>
        </div>
      </div>
      <div className="beat-grid">
        {Object.entries(byBeat).map(([beat, beatOrders]) => {
          const done  = beatOrders.filter(o => ['Delivered','Billed'].includes(o.OrderStatus)).length;
          const pct   = beatOrders.length > 0 ? Math.round((done / beatOrders.length) * 100) : 0;
          const total = beatOrders.reduce((s, o) => s + n(o.TotalOrderAmount), 0);
          const color = pct === 100 ? '#15803D' : pct > 0 ? '#1D4ED8' : '#C2410C';
          return (
            <div key={beat} className="beat-card">
              <div className="beat-card-header">
                <div>
                  <div className="beat-name">{beat}</div>
                  <div className="beat-progress">
                    {done}/{beatOrders.length} delivered · Rs. {total.toFixed(0)}
                  </div>
                </div>
                <div className="beat-pct" style={{ color }}>{pct}%</div>
              </div>
              <div className="beat-prog-bar">
                <div className="beat-prog-fill" style={{ width:`${pct}%`, background:color }} />
              </div>
              <div className="beat-shops">
                {beatOrders.map(order => {
                  const done2 = ['Delivered','Billed'].includes(order.OrderStatus);
                  const busy  = busyId === order.OrderID;
                  return (
                    <div key={order.OrderID} className={`beat-shop-row ${done2 ? 'delivered-row' : ''}`}>
                      <div style={{ fontSize:16, width:24, textAlign:'center', flexShrink:0 }}>
                        {done2 ? '✅' : '⏳'}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div className="beat-shop-name">{order.ShopName}</div>
                        <div style={{ fontSize:11, color:'#94A3B8' }}>{order.InvoiceNumber}</div>
                      </div>
                      <span className="beat-shop-amt">Rs. {n(order.TotalOrderAmount).toFixed(0)}</span>
                      {order.OrderStatus === 'Pending' && (
                        <button className="btn-action btn-confirm" disabled={busy}
                          onClick={() => updateStatus(order, 'Confirmed')}>
                          {busy ? '…' : 'Confirm'}
                        </button>
                      )}
                      {(order.OrderStatus === 'Confirmed' || order.OrderStatus === 'Billed') && (
                        <button className="btn-action btn-deliver" disabled={busy}
                          onClick={() => updateStatus(order, 'Delivered')}>
                          {busy ? '…' : 'Delivered'}
                        </button>
                      )}
                      {done2 && (
                        <span className="btn-done" style={{ minWidth:60, textAlign:'center' }}>Done</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── INVENTORY ────────────────────────────────────────────────────────────────
function Inventory({ inventory, fetchInventory }) {
  const sorted = [...inventory].sort((a, b) => {
    const aLow = n(a.CurrentStock) <= n(a.MinimumStock);
    const bLow = n(b.CurrentStock) <= n(b.MinimumStock);
    if (aLow && !bLow) return -1;
    if (!aLow && bLow) return 1;
    return (a.ProductName || '').localeCompare(b.ProductName || '');
  });

  if (sorted.length === 0) {
    return <div className="empty-state"><div className="empty-icon">📦</div><p>Loading inventory…</p></div>;
  }

  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Current stock</th>
            <th>Previous</th>
            <th>Change</th>
            <th>Minimum</th>
            <th>Last updated</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(item => {
            const cur  = n(item.CurrentStock);
            const min  = n(item.MinimumStock);
            const prev = item.PreviousStock != null ? n(item.PreviousStock) : null;
            const isLow  = cur <= min;
            const change = prev !== null ? cur - prev : null;
            const pct    = min > 0 ? Math.min(Math.round((cur / (min * 5)) * 100), 100) : 100;
            return (
              <tr key={item.ProductID} className={isLow ? 'low-row' : ''}>
                <td>
                  <div className="product-name-cell">{item.ProductName}</div>
                  <div className="product-id-cell">{item.ProductID}</div>
                </td>
                <td>
                  <span className={`stock-num ${isLow ? 'low' : 'ok'}`}>{cur}</span>
                  <span className="stock-bar-wrap">
                    <span className="stock-bar" style={{ width:`${pct}%`, background:isLow?'#DC2626':'#15803D' }} />
                  </span>
                </td>
                <td style={{ color:'#64748B' }}>{prev !== null ? prev : '—'}</td>
                <td style={{ fontWeight:700, color: change===null?'#94A3B8':change<0?'#DC2626':change>0?'#15803D':'#94A3B8' }}>
                  {change !== null ? (change > 0 ? '+' + change : change) : '—'}
                </td>
                <td style={{ color:'#64748B' }}>{min}</td>
                <td style={{ fontSize:12, color:'#94A3B8' }}>
                  {item.LastUpdated ? fmtDate(item.LastUpdated) : '—'}
                </td>
                <td>
                  <span className={`badge ${isLow ? 'badge-low' : 'badge-ok'}`}>
                    {isLow ? '⚠ LOW' : '✓ OK'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── ADD STOCK ────────────────────────────────────────────────────────────────
// FIX: Uses FormField/SelectField defined at module level → no focus loss
// NEW: Scan Bill tab — upload photo → Claude AI reads it → fills form
function AddStock({ products, fetchInventory, showToast }) {
  const EMPTY = {
    productId:'', qty:'', mrp:'', rate:'', dsPrice:'',
    discount:'0', igst:'', invoiceNo:'', supplierName:'',
    supplierGstin:'', invoiceDate:'', uom:'PCS'
  };
  const [form,          setForm]          = useState(EMPTY);
  const [busy,          setBusy]          = useState(false);
  const [scanMode,      setScanMode]      = useState(false);
  const [scanning,      setScanning]      = useState(false);
  const [scannedItems,  setScannedItems]  = useState(null);
  const [scannedMeta,   setScannedMeta]   = useState(null);
  const [submittingAll, setSubmittingAll] = useState(false);
  const fileRef = useRef(null);

  const set = (k, v) => {
    if (k === 'productId') {
      const p = products.find(pr => pr.ProductID === v);
      setForm(prev => ({
        ...prev, productId: v,
        mrp:  p ? String(p.MRP  || '') : prev.mrp,
        rate: p ? String(p.Rate || '') : prev.rate,
      }));
    } else {
      setForm(prev => ({ ...prev, [k]: v }));
    }
  };

  const submitManual = async () => {
    if (!form.productId) { showToast('Select a product', true); return; }
    if (!form.qty || parseInt(form.qty) <= 0) { showToast('Enter a valid quantity', true); return; }
    setBusy(true);
    try {
      const res = await axios.post(`${config.API_BASE_URL}${config.endpoints.addStock}`, {
        ProductID:    form.productId,
        Quantity:     parseInt(form.qty),
        MRP:          parseFloat(form.mrp)      || 0,
        Rate:         parseFloat(form.rate)     || 0,
        DSPrice:      parseFloat(form.dsPrice)  || 0,
        Discount:     parseFloat(form.discount) || 0,
        IGSTRate:     parseFloat(form.igst)     || 0,
        InvoiceNumber: form.invoiceNo,
        SupplierName:  form.supplierName,
        SupplierGSTIN: form.supplierGstin,
        InvoiceDate:   form.invoiceDate,
        UOM:           form.uom,
      });
      const d = safe(res);
      showToast(`Stock added! ${d.PreviousStock} → ${d.NewStock} units`);
      setTimeout(() => fetchInventory(), 900);
      setForm(EMPTY);
    } catch (e) {
      console.error('addStock error', e);
      showToast(`Error: ${e.response?.data?.message || e.message}`, true);
    }
    setBusy(false);
  };

  const handleScanFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Please choose an image file (JPG or PNG)', true); return;
    }
    setScanning(true);
    setScannedItems(null);
    setScannedMeta(null);
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const resp = await axios.post(
        `${config.API_BASE_URL}${config.endpoints.scanBill}`,
        { imageData: base64, mediaType: file.type }
      );
      const d = safe(resp);
      if (!d.items || d.items.length === 0) {
        showToast('No items found — try a clearer photo', true);
        setScanning(false);
        return;
      }
      setScannedMeta({
        invoiceNumber: d.invoiceNumber,
        invoiceDate:   d.invoiceDate,
        supplierName:  d.supplierName,
        supplierGSTIN: d.supplierGSTIN,
      });
      // Try to auto-match each scanned item to our product catalogue
      const enriched = d.items.map(item => {
        const name = (item.productName || '').toLowerCase();
        const matched = products.find(p => {
          const pn = p.ProductName.toLowerCase();
          return pn.includes(name.substring(0, 6)) || name.includes(pn.substring(0, 6));
        });
        return { ...item, productId: matched?.ProductID || '', selected: true };
      });
      setScannedItems(enriched);
      showToast(`Found ${enriched.length} items in bill ✓`);
    } catch (e) {
      console.error('scanBill error', e);
      const status = e.response?.status;
      const detail = e.response?.data?.message || e.response?.data?.error || e.message || 'Unknown error';
      if (status === 404) {
        showToast('scanBill route not connected — check API Gateway integration', true);
      } else if (status === 500 && detail.includes('ANTHROPIC_API_KEY')) {
        showToast('Set ANTHROPIC_API_KEY in Lambda environment variables', true);
      } else if (status === 400 && detail.includes('too large')) {
        showToast('Photo too large — use a smaller image (under 4MB)', true);
      } else if (status === 502) {
        showToast('Cannot reach Claude API — check Lambda internet access', true);
      } else {
        showToast(`Scan error (${status||'network'}): ${detail.substring(0,60)}`, true);
      }
    }
    setScanning(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const updateScanned = (i, field, val) =>
    setScannedItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: val } : item));

  const submitAllScanned = async () => {
    const todo = scannedItems.filter(i => i.selected && i.productId);
    if (todo.length === 0) { showToast('Select at least one matched item', true); return; }
    setSubmittingAll(true);
    let ok = 0, fail = 0;
    for (const item of todo) {
      try {
        await axios.post(`${config.API_BASE_URL}${config.endpoints.addStock}`, {
          ProductID:    item.productId,
          Quantity:     parseInt(item.quantity) || 1,
          MRP:          parseFloat(item.mrp)    || 0,
          Rate:         parseFloat(item.rate)   || 0,
          InvoiceNumber: scannedMeta?.invoiceNumber || '',
          SupplierName:  scannedMeta?.supplierName  || '',
          SupplierGSTIN: scannedMeta?.supplierGSTIN || '',
          InvoiceDate:   scannedMeta?.invoiceDate   || isoToday(),
          UOM:           item.uom || 'BOX',
        });
        ok++;
      } catch (_) { fail++; }
    }
    await fetchInventory();
    showToast(`${ok} item${ok !== 1 ? 's' : ''} added${fail > 0 ? `, ${fail} failed` : ''}`);
    if (fail === 0) { setScannedItems(null); setScannedMeta(null); setScanMode(false); }
    setSubmittingAll(false);
  };

  return (
    <div>
      {/* Mode switcher */}
      <div style={{ display:'flex', gap:10, marginBottom:20 }}>
        <button className={`stab ${!scanMode ? 'active-all' : ''}`}
          onClick={() => { setScanMode(false); setScannedItems(null); }}>
          ✏️ Manual entry
        </button>
        <button className={`stab ${scanMode ? 'active-all' : ''}`}
          onClick={() => setScanMode(true)}>
          📷 Scan supplier bill
        </button>
      </div>

      {/* ── SCAN MODE ── */}
      {scanMode && (
        <div>
          <div className="form-card">
            <div className="form-card-title">Upload supplier bill or handwritten list</div>
            <p style={{ fontSize:13, color:'#64748B', marginBottom:16, lineHeight:1.6 }}>
              Works with <strong>printed invoices</strong> (GST bills with HSN codes) and
              <strong> handwritten order lists</strong>.<br/>
              Claude AI reads the photo and fills in all details automatically.
            </p>
            <div style={{ border:'2px dashed #CBD5E1', borderRadius:10, padding:28, textAlign:'center', background:'#F8FAFC' }}>
              <div style={{ fontSize:36, marginBottom:10 }}>📄</div>
              <p style={{ fontSize:14, color:'#475569', marginBottom:14 }}>
                Take a clear photo of the bill<br/>
                <span style={{ fontSize:12, color:'#94A3B8' }}>JPG or PNG · max 5 MB</span>
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleScanFile}
                style={{ display:'none' }}
                id="bill-upload"
              />
              <label
                htmlFor="bill-upload"
                className="submit-btn"
                style={{ display:'inline-block', padding:'10px 28px', cursor: scanning ? 'wait' : 'pointer', opacity: scanning ? 0.6 : 1 }}
              >
                {scanning ? '🤖 Scanning… (~10 sec)' : '📷 Choose photo / Take picture'}
              </label>
            </div>
          </div>

          {scannedItems && (
            <div className="form-card">
              <div className="form-card-title">
                Review scanned items — {scannedItems.length} found
              </div>
              {scannedMeta && (
                <div style={{ background:'#F0FDF4', border:'1px solid #BBF7D0', borderRadius:8, padding:'10px 14px', marginBottom:14, fontSize:13, lineHeight:1.7 }}>
                  {scannedMeta.supplierName  && <><strong>Supplier:</strong> {scannedMeta.supplierName}&nbsp;&nbsp;</>}
                  {scannedMeta.invoiceNumber && <><strong>Invoice:</strong> {scannedMeta.invoiceNumber}&nbsp;&nbsp;</>}
                  {scannedMeta.invoiceDate   && <><strong>Date:</strong> {scannedMeta.invoiceDate}</>}
                </div>
              )}
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                  <thead>
                    <tr style={{ background:'#F8FAFC' }}>
                      {['✓','Scanned name','Match to product','Qty','Unit','Rate'].map(h => (
                        <th key={h} style={{ padding:'8px 10px', textAlign:'left', borderBottom:'1px solid #E2E8F0', fontSize:11, color:'#64748B', fontWeight:700, textTransform:'uppercase' }}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {scannedItems.map((item, i) => (
                      <tr key={i} style={{ background: item.selected ? '#fff' : '#FFFBF0', borderBottom:'1px solid #F1F5F9' }}>
                        <td style={{ padding:'8px 10px', textAlign:'center' }}>
                          <input type="checkbox" checked={item.selected}
                            onChange={e => updateScanned(i, 'selected', e.target.checked)}
                            style={{ width:16, height:16, cursor:'pointer' }} />
                        </td>
                        <td style={{ padding:'8px 10px', color:'#374151', maxWidth:160, fontSize:12 }}>
                          {item.productName}
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          <select
                            value={item.productId}
                            onChange={e => updateScanned(i, 'productId', e.target.value)}
                            style={{ padding:'5px 8px', borderRadius:6, border:'1px solid #D1D5DB', fontSize:12, minWidth:140 }}
                          >
                            <option value="">— select —</option>
                            {products.map(p => (
                              <option key={p.ProductID} value={p.ProductID}>{p.ProductName}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          <input type="number" value={item.quantity}
                            onChange={e => updateScanned(i, 'quantity', e.target.value)}
                            style={{ width:60, padding:'5px 6px', borderRadius:6, border:'1px solid #D1D5DB', fontSize:13, textAlign:'center' }} />
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          <select value={item.uom}
                            onChange={e => updateScanned(i, 'uom', e.target.value)}
                            style={{ padding:'5px 6px', borderRadius:6, border:'1px solid #D1D5DB', fontSize:12 }}>
                            {['BOX','PCS','PKT','KG','LTR'].map(u => <option key={u}>{u}</option>)}
                          </select>
                        </td>
                        <td style={{ padding:'8px 10px' }}>
                          <input type="number" value={item.rate || ''}
                            onChange={e => updateScanned(i, 'rate', e.target.value)}
                            placeholder="0.00"
                            style={{ width:72, padding:'5px 6px', borderRadius:6, border:'1px solid #D1D5DB', fontSize:13, textAlign:'center' }} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display:'flex', gap:10, marginTop:16 }}>
                <button className="submit-btn" onClick={submitAllScanned} disabled={submittingAll}>
                  {submittingAll
                    ? 'Adding to inventory…'
                    : `Add ${scannedItems.filter(i => i.selected && i.productId).length} items to inventory`}
                </button>
                <button
                  onClick={() => { setScannedItems(null); setScannedMeta(null); }}
                  style={{ padding:'10px 18px', background:'#fff', border:'1px solid #D1D5DB', borderRadius:8, cursor:'pointer', fontSize:13 }}
                >
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MANUAL MODE ── */}
      {!scanMode && (
        <div>
          <div className="form-card">
            <div className="form-card-title">Supplier details</div>
            <div className="form-grid">
              <FormField label="Supplier name"  value={form.supplierName}  onChange={v => set('supplierName', v)}  placeholder="Sri Raman Enterprises" />
              <FormField label="Supplier GSTIN" value={form.supplierGstin} onChange={v => set('supplierGstin', v)} placeholder="33ACCFS9106K1Z1" />
              <FormField label="Invoice number" value={form.invoiceNo}     onChange={v => set('invoiceNo', v)}     placeholder="1065" />
              <FormField label="Invoice date"   value={form.invoiceDate}   onChange={v => set('invoiceDate', v)}   type="date" />
            </div>
          </div>

          <div className="form-card">
            <div className="form-card-title">Product details</div>
            <SelectField label="Product" value={form.productId} onChange={v => set('productId', v)}>
              <option value="">— Select product —</option>
              {products.map(p => (
                <option key={p.ProductID} value={p.ProductID}>{p.ProductName}</option>
              ))}
            </SelectField>
            <div className="form-grid-3">
              <FormField label="Quantity received" type="number" value={form.qty}      onChange={v => set('qty', v)}      placeholder="100" />
              <SelectField label="Unit" value={form.uom} onChange={v => set('uom', v)}>
                <option value="PCS">PCS — Pieces</option>
                <option value="PKT">PKT — Packet</option>
                <option value="BOX">BOX — Box</option>
                <option value="KG">KG — Kilogram</option>
                <option value="LTR">LTR — Litre</option>
              </SelectField>
              <FormField label="MRP"             type="number" value={form.mrp}       onChange={v => set('mrp', v)}      placeholder="120.00" />
              <FormField label="DS Gross price"  type="number" value={form.dsPrice}   onChange={v => set('dsPrice', v)}  placeholder="42.00" />
              <FormField label="Net rate/piece"  type="number" value={form.rate}      onChange={v => set('rate', v)}     placeholder="39.00" />
              <FormField label="Discount %"      type="number" value={form.discount}  onChange={v => set('discount', v)} placeholder="0" />
              <FormField label="IGST %"          type="number" value={form.igst}      onChange={v => set('igst', v)}     placeholder="5" />
            </div>
            <button className="submit-btn" onClick={submitManual} disabled={busy}>
              {busy ? 'Adding…' : 'Add Stock to Inventory'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── REPORTS ──────────────────────────────────────────────────────────────────
function Reports({ orders, inventory }) {
  const delivered = orders.filter(o => ['Delivered','Billed'].includes(o.OrderStatus));
  const pending   = orders.filter(o => o.OrderStatus === 'Pending');
  const totalAmt  = orders.reduce((s, o) => s + n(o.TotalOrderAmount), 0);
  const delivAmt  = delivered.reduce((s, o) => s + n(o.TotalOrderAmount), 0);
  const pendAmt   = pending.reduce((s, o) => s + n(o.TotalOrderAmount), 0);
  const lowStock  = inventory.filter(i => n(i.CurrentStock) <= n(i.MinimumStock));

  const byBeat = {};
  orders.forEach(o => {
    const b = o.Beat || 'Unassigned';
    if (!byBeat[b]) byBeat[b] = { count:0, delivered:0, total:0 };
    byBeat[b].count++;
    byBeat[b].total += n(o.TotalOrderAmount);
    if (['Delivered','Billed'].includes(o.OrderStatus)) byBeat[b].delivered++;
  });

  const prodSold = {};
  orders.forEach(o => (o.Items || []).forEach(item => {
    const name = item.ProductName || 'Unknown';
    if (!prodSold[name]) prodSold[name] = { qty:0, amt:0 };
    prodSold[name].qty += item.Pcs || 0;
    prodSold[name].amt += n(item.NetAmount || item.Amount);
  }));

  return (
    <div>
      <div className="section-header">
        <div>
          <div className="section-title">Day report — {fmtDate(new Date())}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="print-btn" onClick={() => {
            const orderRows = orders.map(o => [
              o.OrderDate, o.InvoiceNumber, o.ShopName, o.Beat,
              o.OrderStatus, (o.TotalOrderAmount||0).toFixed(2)
            ]);
            exportToCSV('RN_DayReport', ['Date','Invoice','Shop','Beat','Status','Amount'], orderRows);
          }}>📥 Excel</button>
          <button className="print-btn" onClick={() => {
            const html = buildReportHTML(orders, inventory, fmtDate(new Date()));
            printAsPDF('RN_Day_Report', html);
          }}>📄 PDF</button>
          <button className="print-btn" onClick={() => window.print()}>🖨 Print</button>
        </div>
      </div>

      <div className="metric-row" style={{ marginBottom:20 }}>
        <div className="metric-card accent">
          <div className="metric-label">Total business</div>
          <div className="metric-value">Rs.{totalAmt.toFixed(0)}</div>
          <div className="metric-sub">{orders.length} orders</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Delivered</div>
          <div className="metric-value success">Rs.{delivAmt.toFixed(0)}</div>
          <div className="metric-sub">{delivered.length} orders</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pending value</div>
          <div className="metric-value warn">Rs.{pendAmt.toFixed(0)}</div>
          <div className="metric-sub">{pending.length} orders</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Low stock</div>
          <div className="metric-value" style={{ color: lowStock.length > 0 ? '#DC2626' : '#15803D' }}>
            {lowStock.length}
          </div>
          <div className="metric-sub">{lowStock.length > 0 ? 'Need reorder' : 'All OK'}</div>
        </div>
      </div>

      <div className="report-grid">
        <div className="report-card">
          <div className="report-card-title">Beat-wise</div>
          {Object.keys(byBeat).length === 0 ? (
            <div style={{ color:'#94A3B8', fontSize:13 }}>No orders today</div>
          ) : (
            <table className="report-table">
              <thead><tr><th>Beat</th><th>Orders</th><th>Delivered</th><th>Total</th></tr></thead>
              <tbody>
                {Object.entries(byBeat).sort((a,b) => b[1].total - a[1].total).map(([b, d]) => (
                  <tr key={b}>
                    <td style={{ fontWeight:600 }}>{b}</td>
                    <td>{d.count}</td>
                    <td>{d.delivered}/{d.count}</td>
                    <td style={{ fontWeight:700 }}>Rs.{d.total.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="report-card">
          <div className="report-card-title">Products sold</div>
          {Object.keys(prodSold).length === 0 ? (
            <div style={{ color:'#94A3B8', fontSize:13 }}>No item data available</div>
          ) : (
            <table className="report-table">
              <thead><tr><th>Product</th><th>Qty</th><th>Amount</th></tr></thead>
              <tbody>
                {Object.entries(prodSold).sort((a,b) => b[1].amt - a[1].amt).map(([name, d]) => (
                  <tr key={name}>
                    <td style={{ fontWeight:600 }}>{name}</td>
                    <td>{d.qty}</td>
                    <td>Rs.{d.amt.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {lowStock.length > 0 && (
        <div className="report-card">
          <div className="report-card-title">Low stock — needs reorder</div>
          <table className="report-table">
            <thead><tr><th>Product</th><th>Current</th><th>Minimum</th><th>Shortage</th></tr></thead>
            <tbody>
              {lowStock.map(item => (
                <tr key={item.ProductID}>
                  <td style={{ fontWeight:600 }}>{item.ProductName}</td>
                  <td style={{ color:'#DC2626', fontWeight:700 }}>{n(item.CurrentStock)}</td>
                  <td>{n(item.MinimumStock)}</td>
                  <td style={{ color:'#C2410C', fontWeight:700 }}>
                    +{Math.max(0, n(item.MinimumStock) - n(item.CurrentStock))} needed
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── PRODUCTS ─────────────────────────────────────────────────────────────────
function Products({ products, fetchProducts }) {
  const exportProducts = () => {
    const rows = products.map(p => [p.ProductID, p.ProductName, p.HSNCode, p.MRP, p.Rate, p.CGSTRate+'%', p.SGSTRate+'%']);
    exportToCSV('RN_Products', ['Product ID','Product Name','HSN Code','MRP','Rate','CGST%','SGST%'], rows);
  };
  const pdfProducts = () => {
    const rows = products.map((p,i) => `<tr><td>${i+1}</td><td>${p.ProductID}</td><td>${p.ProductName}</td><td>${p.HSNCode||''}</td><td>Rs.${p.MRP}</td><td>Rs.${p.Rate}</td><td>${p.CGSTRate}%</td><td>${p.SGSTRate}%</td></tr>`).join('');
    printAsPDF('RN_Products', `<h1>R.N. Agencies — Product Master</h1><div class="sub">Ph: 04365-221911 | Nagapattinam</div><br/><table><thead><tr><th>#</th><th>ID</th><th>Product</th><th>HSN</th><th>MRP</th><th>Rate</th><th>CGST</th><th>SGST</th></tr></thead><tbody>${rows}</tbody></table>`);
  };
  return products.length === 0 ? (
    <div className="empty-state"><div className="empty-icon">◈</div><p>Loading products…</p></div>
  ) : (
    <div>
    <div style={{display:'flex',gap:8,marginBottom:14,justifyContent:'flex-end'}}>
      <button className="print-btn" onClick={exportProducts}>📥 Excel</button>
      <button className="print-btn" onClick={pdfProducts}>📄 PDF</button>
    </div>
    <div className="prod-table-wrap">
      <table className="prod-table">
        <thead>
          <tr><th>ID</th><th>Product name</th><th>HSN</th><th>MRP</th><th>Rate</th><th>CGST%</th><th>SGST%</th></tr>
        </thead>
        <tbody>
          {products.map(p => (
            <tr key={p.ProductID}>
              <td style={{ color:'#94A3B8', fontFamily:'monospace', fontSize:12 }}>{p.ProductID}</td>
              <td style={{ fontWeight:600 }}>{p.ProductName}</td>
              <td>{p.HSNCode}</td>
              <td>Rs. {p.MRP}</td>
              <td style={{ fontWeight:600 }}>Rs. {p.Rate}</td>
              <td>{p.CGSTRate}%</td>
              <td>{p.SGSTRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </div>
  );
}