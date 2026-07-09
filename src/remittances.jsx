// Remittances module (invoice-generation Slice 1, MSR). Drop an MSR "Vendor ACH
// Payment Detail" PDF -> parse rows (main: parse-msr-remittance) -> match each row
// to an order (matchMsrRow) -> read that WO's bid-sheet items (read-bid-lineitems)
// -> reconcile (reconcileMsrRow) -> render a readable per-WO report with a
// MATCH / OFF badge vs the paid amount. Read-only for Slice 1; editing/export is
// Slice 4. AMH is Slice 2 (portal API). Shared helpers import from app.jsx.
import React from 'react';
import { ActionBtn } from './primitives.jsx';
import { HeaderChips, useServiceLibraryStore } from './app.jsx';
import { money, matchMsrRow, reconcileMsrRow, matchAmhRow, reconcileAmhRow, bidItemsToInvoiceLines } from './orders-logic.js';

const STATUS_STYLE = {
  match:      { label: 'MATCH',        fg: '#065f46', bg: 'rgba(16,185,129,0.15)' },
  off:        { label: 'OFF',          fg: '#991b1b', bg: 'rgba(220,38,38,0.15)' },
  'no-items': { label: 'NO BID SHEET', fg: '#92400e', bg: 'rgba(245,158,11,0.18)' },
  unavailable:{ label: 'UNAVAILABLE',  fg: '#92400e', bg: 'rgba(245,158,11,0.18)' },
  unmatched:  { label: 'NO WO',        fg: 'var(--text-2)', bg: 'var(--bg-surface-2)' },
};

export function RemittancesModule({ orders, toast }) {
  const fmt = (n) => '$' + money(n).toFixed(2);
  const [report, setReport] = React.useState(null);   // { blocks, statementTotal, fileName } | null
  const [loading, setLoading] = React.useState(false);
  // Service library drives MSR per-line taxable (via the resolveBidLine matcher), so the
  // divide-out tax breakdown is accurate. May be null while loading -> lines fall back to
  // non-taxable (tax 0), total still matches (MSR grand = face regardless).
  const [lib] = useServiceLibraryStore();

  const run = React.useCallback(async (source) => {
    const api = source === 'amh'
      ? (window.remittance && window.remittance.parseAmh)
      : (window.remittance && window.remittance.parseMsr);
    if (!api) {
      toast && toast('Remittance parser unavailable - fully restart the app (not just reload)', 'err');
      return;
    }
    setLoading(true);
    try {
      const res = await api();
      if (res && res.canceled) { setLoading(false); return; }
      if (!res || !res.ok) {
        toast && toast('Parse failed: ' + ((res && res.error) || 'unknown'), 'err');
        setLoading(false); return;
      }
      const rows = Array.isArray(res.rows) ? res.rows : [];
      let blocks;
      if (source === 'amh') {
        // AMH itemize = the matched WO's captured order.bidItems (AMH API data
        // {name,qty,price}); price is the inclusive Premier line price (Core Truth #2)
        // so vendorTax 0. A WO with no captured bidItems -> reconcile flags 'unavailable'.
        blocks = rows.map((row) => {
          const match = matchAmhRow(row, orders);
          const bid = (match.order && Array.isArray(match.order.bidItems)) ? match.order.bidItems : [];
          const items = bid.map(b => ({ name: String((b && b.name) || ''), unitPrice: b && b.price, vendorTax: (b && b.vendorTax) || 0, qty: b && b.qty }));
          // order.bidAmount = the authoritative tax-inclusive bid total; used as the tax
          // fallback for WOs captured before per-line vendorTax was stored.
          const inclusive = match.order ? parseFloat(String(match.order.bidAmount || '').replace(/[^0-9.]/g, '')) : null;
          return reconcileAmhRow(row, match, items, Number.isFinite(inclusive) ? inclusive : null);
        });
      } else {
        // MSR itemize = the WO folder bid sheet(s), read per-WO via IPC (concurrent).
        const msrLib = (lib && Array.isArray(lib.MSR)) ? lib.MSR : [];
        const genLib = (lib && Array.isArray(lib.General)) ? lib.General : null;
        blocks = await Promise.all(rows.map(async (row) => {
          const match = matchMsrRow(row, orders);
          let items = [];
          if (match.order && window.woFolder && window.woFolder.readBidLineItems) {
            try {
              const r = await window.woFolder.readBidLineItems(match.order);
              if (r && r.ok && Array.isArray(r.items)) items = r.items;
            } catch (_) { /* no folder / read error -> reconcile flags no-items */ }
          }
          // Resolve each read line against the MSR library so its taxable flag drives the
          // per-line divide-out breakdown (reuses the resolveBidLine matcher). Shape in:
          // {desc,unitPrice,qty} -> bidItems {name=desc, qty, price}.
          const resolved = bidItemsToInvoiceLines(
            items.map(it => ({ name: String(it.desc || ''), qty: it.qty, price: it.unitPrice })),
            msrLib, 'MSR', genLib);
          return reconcileMsrRow(row, match, resolved);
        }));
      }
      const fileName = String(res.path || '').split(/[\\/]/).pop() || 'remittance.pdf';
      const total = source === 'amh' ? res.paymentTotal : res.statementTotal;
      setReport({ blocks, statementTotal: total, fileName, source });
    } catch (e) {
      toast && toast('Parse error: ' + (e.message || e), 'err');
    }
    setLoading(false);
  }, [orders, toast, lib]);

  const paidSum = report ? money(report.blocks.reduce((s, b) => s + b.paid, 0)) : 0;
  const matched = report ? report.blocks.filter(b => b.status === 'match').length : 0;
  const flagged = report ? report.blocks.filter(b => b.status !== 'match').length : 0;
  const stmt = report && report.statementTotal != null ? money(report.statementTotal) : null;
  const stmtOk = stmt == null || Math.abs(stmt - paidSum) < 0.005;

  return (
    <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '10px 18px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Remittances
          </div>
          <ActionBtn onClick={() => run('msr')} disabled={loading}>
            {loading ? 'Parsing...' : 'Open MSR PDF'}
          </ActionBtn>
          <ActionBtn onClick={() => run('amh')} disabled={loading}>
            {loading ? 'Parsing...' : 'Open AMH PDF'}
          </ActionBtn>
          {report && (
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {report.fileName} · {report.blocks.length} WOs · {matched} match · {flagged} flagged
            </div>
          )}
          <div style={{ flex: 1 }} />
          <HeaderChips />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px' }}>
        {!report && (
          <div style={{ color: 'var(--text-3)', fontSize: 14, maxWidth: 560, lineHeight: 1.6 }}>
            Open an <b>MSR</b> "Vendor ACH Payment Detail" or an <b>AMH</b> "ACHVendor" remittance PDF.
            Each paid work order is matched (MSR by Invoice Notes number, AMH by the W#B# invoice), its
            line items are pulled (MSR from the WO folder bid sheet, AMH from the captured bid), and the
            computed total is checked against the amount paid. AMH WOs that aged out of the portal API
            window show as "unavailable" (enter items manually).
          </div>
        )}

        {report && (
          <>
            {/* Statement cross-check bar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16, marginBottom: 14,
              padding: '10px 14px', borderRadius: 10,
              border: '1px solid var(--border-1)', background: 'var(--bg-surface)',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Paid (sum of WOs)</div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Bricolage Grotesque', sans-serif" }}>{fmt(paidSum)}</div>
              </div>
              {stmt != null && (
                <>
                  <div style={{ color: 'var(--text-3)' }}>vs</div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>{report.source === 'amh' ? 'Payment total' : 'Statement total'}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Bricolage Grotesque', sans-serif" }}>{fmt(stmt)}</div>
                  </div>
                  <div style={{
                    marginLeft: 'auto', padding: '4px 12px', borderRadius: 999, fontWeight: 700, fontSize: 13,
                    color: stmtOk ? '#065f46' : '#991b1b',
                    background: stmtOk ? 'rgba(16,185,129,0.15)' : 'rgba(220,38,38,0.15)',
                  }}>{stmtOk ? 'STATEMENT BALANCED' : 'OFF BY ' + fmt(Math.abs(stmt - paidSum))}</div>
                </>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {report.blocks.map((b, i) => (
                <ReportBlock key={i} b={b} fmt={fmt} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ReportBlock({ b, fmt }) {
  const st = STATUS_STYLE[b.status] || STATUS_STYLE.unmatched;
  const offBy = Math.abs(b.delta);
  return (
    <div style={{ border: '1px solid var(--border-1)', borderRadius: 10, background: 'var(--bg-surface)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{b.address || '(no address)'}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          WO {b.orderId || b.woId || '?'} · {b.invoiceNum || 'no invoice #'}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ padding: '3px 10px', borderRadius: 999, fontWeight: 700, fontSize: 12, color: st.fg, background: st.bg }}>
          {st.label}
        </div>
      </div>

      {b.lines.length > 0 && (
        <div style={{ padding: '8px 14px' }}>
          {/* column headers: description | pre-tax | tax | post-tax */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 90px', gap: 8, padding: '2px 0 4px',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
            <span>Item</span><span style={{ textAlign: 'right' }}>Pre-tax</span>
            <span style={{ textAlign: 'right' }}>Tax</span><span style={{ textAlign: 'right' }}>Post-tax</span>
          </div>
          {b.lines.map((l, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 90px', gap: 8, padding: '3px 0', fontSize: 13, borderTop: '1px solid var(--border-1)' }}>
              <span style={{ color: 'var(--text-1)' }}>{l.desc || '(no description)'}{l.qty > 1 ? ' ×' + l.qty : ''}</span>
              <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{fmt(l.pre)}</span>
              <span style={{ textAlign: 'right', color: l.tax > 0 ? 'var(--text-1)' : 'var(--text-3)' }}>{fmt(l.tax)}</span>
              <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{fmt(l.post)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 90px 80px 90px', gap: 8, alignItems: 'baseline', padding: '8px 14px',
        borderTop: '2px solid var(--border-2)', background: 'var(--bg-canvas)', fontWeight: 700,
      }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)' }}>
          Paid {fmt(b.paid)}
          {b.status === 'off' && <span style={{ color: '#991b1b', marginLeft: 10 }}>Off by {fmt(offBy)}</span>}
        </span>
        <span style={{ textAlign: 'right', fontSize: 13 }}>{fmt(b.preTax != null ? b.preTax : b.computed)}</span>
        <span style={{ textAlign: 'right', fontSize: 13 }}>{fmt(b.tax || 0)}</span>
        <span style={{ textAlign: 'right', fontSize: 13, color: Math.abs(b.delta) < 0.005 ? '#065f46' : 'var(--text-1)' }}>{fmt(b.postTax != null ? b.postTax : b.computed)}</span>
      </div>

      {b.flags.length > 0 && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border-1)' }}>
          {b.flags.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>⚑ {f}</div>
          ))}
        </div>
      )}
    </div>
  );
}
