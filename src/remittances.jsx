// Remittances module (invoice-generation Slice 1, MSR). Drop an MSR "Vendor ACH
// Payment Detail" PDF -> parse rows (main: parse-msr-remittance) -> match each row
// to an order (matchMsrRow) -> read that WO's bid-sheet items (read-bid-lineitems)
// -> reconcile (reconcileMsrRow) -> render a readable per-WO report with a
// MATCH / OFF badge vs the paid amount. Read-only for Slice 1; editing/export is
// Slice 4. AMH is Slice 2 (portal API). Shared helpers import from app.jsx.
import React from 'react';
import { ActionBtn } from './primitives.jsx';
import { HeaderChips, useServiceLibraryStore } from './app.jsx';
import { money, matchMsrRow, reconcileMsrRow, matchAmhRow, reconcileAmhRow, bidItemsToInvoiceLines, reconcileBlockToInvoice, normWoNum, sentinelTag, upsertRemittanceHistory, removeRemittanceById } from './orders-logic.js';

// Item 1: load + persist the remittance_history KV array (window.storage over
// wo-data.json). Mirrors useServiceLibraryStore (app.jsx): mount-load, callback-persist,
// single key, no new IPC/file. Default [] while loading / when storage is unavailable.
function useRemittanceHistory() {
  const [history, setHistory] = React.useState([]);
  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = window.storage && await window.storage.get('remittance_history');
        const v = r && r.value;
        if (live) setHistory(Array.isArray(v) ? v : []);
      } catch { if (live) setHistory([]); }
    })();
    return () => { live = false; };
  }, []);
  const persist = React.useCallback((next) => {
    setHistory(next);
    if (window.storage && window.storage.set) window.storage.set('remittance_history', next).catch(() => {});
  }, []);
  return [history, persist];
}

const STATUS_STYLE = {
  match:      { label: 'MATCH',        fg: '#065f46', bg: 'rgba(16,185,129,0.15)' },
  off:        { label: 'OFF',          fg: '#991b1b', bg: 'rgba(220,38,38,0.15)' },
  'no-items': { label: 'NO BID SHEET', fg: '#92400e', bg: 'rgba(245,158,11,0.18)' },
  unavailable:{ label: 'UNAVAILABLE',  fg: '#92400e', bg: 'rgba(245,158,11,0.18)' },
  unmatched:  { label: 'NO WO',        fg: 'var(--text-2)', bg: 'var(--bg-surface-2)' },
};

export function RemittancesModule({ orders, toast, onCaptureAmh, onCaptureAmhBatch, onCaptureAmhForRemittance, onEnsureMsrOrders, onSaveInvoice, onBillMatched, masterCatalog = 'General' }) {
  const fmt = (n) => '$' + money(n).toFixed(2);
  const [report, setReport] = React.useState(null);   // { blocks, statementTotal, fileName } | null
  const [loading, setLoading] = React.useState(false);
  const [busyIdx, setBusyIdx] = React.useState(null);  // block index mid-fetch
  const [busyAll, setBusyAll] = React.useState(false); // batch fetch / bill in flight
  // Service library drives MSR per-line taxable (via the resolveBidLine matcher), so the
  // divide-out tax breakdown is accurate. May be null while loading -> lines fall back to
  // non-taxable (tax 0), total still matches (MSR grand = face regardless).
  const [lib] = useServiceLibraryStore();
  const [history, persistHistory] = useRemittanceHistory();

  // Re-reconcile ONE AMH block from a freshly captured wo (per-line vendorTax). Defined
  // above run() so the import auto-fetch can reuse it without a dep-array TDZ.
  const reconcileAmhFromWo = React.useCallback((block, order, wo) => {
    const bid = Array.isArray(wo && wo.bidItems) ? wo.bidItems : [];
    const items = bid.map(b => ({ name: String((b && b.name) || ''), unitPrice: b && b.price, vendorTax: (b && b.vendorTax) || 0, qty: b && b.qty }));
    const inclusive = parseFloat(String((wo && wo.bidAmount) || '').replace(/[^0-9.]/g, ''));
    const row = { amount: block.paid, woId: block.woId, invoiceNum: block.invoiceNum, bidNum: block.bidNum, revisit: block.revisit };
    return reconcileAmhRow(row, { order: { ...order, ...wo }, matchBy: block.matchBy }, items, Number.isFinite(inclusive) ? inclusive : null);
  }, []);

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
        // Remittance is the source of truth: fetch EVERY paid WO fresh from the portal by
        // its remittance WO# and AUTO-CREATE any WO not yet in the app
        // (captureAmhForRemittance). Reconcile each row DIRECTLY against the fresh capture
        // (inclusive Premier line price, Core Truth #2), not stale app data -- so a paid WO
        // that was never captured still lands. Fallback (web build / a WO that truly can't
        // be fetched): match against existing app orders, else 'unavailable'.
        let byNum = {};
        if (onCaptureAmhForRemittance) {
          const cap = await onCaptureAmhForRemittance(rows.map(r => r.woId));
          if (cap && cap.ok) byNum = cap.byNum || {};
          else toast && toast('AMH fetch failed: ' + ((cap && cap.error) || 'unknown') + ' - showing stored data', 'warn');
        }
        blocks = rows.map((row) => {
          const cw = byNum[normWoNum(row.woId)];
          let match, items, inclusive;
          if (cw && cw.wo) {
            const wo = cw.wo;
            match = { order: { id: cw.orderId, woId: wo.woId, address: wo.address, propertyId: wo.propertyId, bidItems: wo.bidItems, bidAmount: wo.bidAmount }, matchBy: 'woId' };
            items = (Array.isArray(wo.bidItems) ? wo.bidItems : []).map(b => ({ name: String((b && b.name) || ''), unitPrice: b && b.price, vendorTax: (b && b.vendorTax) || 0, qty: b && b.qty }));
            inclusive = parseFloat(String(wo.bidAmount || '').replace(/[^0-9.]/g, ''));
          } else {
            match = matchAmhRow(row, orders);
            const bid = (match.order && Array.isArray(match.order.bidItems)) ? match.order.bidItems : [];
            items = bid.map(b => ({ name: String((b && b.name) || ''), unitPrice: b && b.price, vendorTax: (b && b.vendorTax) || 0, qty: b && b.qty }));
            inclusive = match.order ? parseFloat(String(match.order.bidAmount || '').replace(/[^0-9.]/g, '')) : null;
          }
          return reconcileAmhRow(row, match, items, Number.isFinite(inclusive) ? inclusive : null);
        });
      } else {
        // MSR itemize = the WO folder bid sheet(s), read per-WO via IPC (concurrent).
        // Parity with AMH: auto-create any paid WO not yet in the app from the remittance
        // row (ensureMsrOrders) so it lands in the nexus; its line items still come from the
        // folder bid sheet (MSR's official itemization source; no in-app portal API).
        const msrLib = (lib && Array.isArray(lib.MSR)) ? lib.MSR : [];
        const genLib = (lib && Array.isArray(lib[masterCatalog])) ? lib[masterCatalog] : null;
        const ensured = onEnsureMsrOrders ? onEnsureMsrOrders(rows) : {};
        blocks = await Promise.all(rows.map(async (row) => {
          const ens = ensured[normWoNum(row.woId)];
          const match = ens ? { order: ens, matchBy: 'woId' } : matchMsrRow(row, orders);
          let items = [];
          let stated = null;
          if (match.order && window.woFolder && window.woFolder.readBidLineItems) {
            try {
              const r = await window.woFolder.readBidLineItems(match.order, row.amount);
              if (r && r.ok && Array.isArray(r.items)) items = r.items;
              if (r && Number.isFinite(Number(r.statedTotal))) stated = Number(r.statedTotal);
            } catch (_) { /* no folder / read error -> reconcile flags no-items */ }
          }
          // Resolve each read line against the MSR library so its taxable flag drives the
          // per-line divide-out breakdown (reuses the resolveBidLine matcher). Shape in:
          // {desc,unitPrice,qty} -> bidItems {name=desc, qty, price}.
          const resolved = bidItemsToInvoiceLines(
            items.map(it => ({ name: String(it.desc || ''), qty: it.qty, price: it.unitPrice })),
            msrLib, 'MSR', genLib);
          return reconcileMsrRow(row, match, resolved, stated);
        }));
      }
      const fileName = String(res.path || '').split(/[\\/]/).pop() || 'remittance.pdf';
      const total = source === 'amh' ? res.paymentTotal : res.statementTotal;
      setReport({ blocks, statementTotal: total, fileName, source });

      // Item 1: persist the reconciled report so the user can reopen it later. Snapshot =
      // the report (blocks carry woId/orderId for live rehydrate) plus stamp fields; upsert
      // de-dupes on source+fileName+invoiceDate so a same-day re-parse replaces, not piles.
      const invoiceDate = new Date().toISOString().slice(0, 10);
      const snapshot = { blocks, statementTotal: total, fileName, source, id: source + '-' + Date.now(), invoiceDate };
      persistHistory(upsertRemittanceHistory(history, snapshot));

      // R5: auto-populate the Invoice record for VERIFIED-ACCURATE WOs (status 'match',
      // per-line tax present). AMH blocks already carry fresh per-line tax (capture-first
      // above). FILL-EMPTY-ONLY -- never clobber a saved/edited invoice on a re-parse; the
      // explicit "Bill matched" button force-overwrites. Suspect LINES carry their flag
      // through so they surface for review in the editor.
      if (onBillMatched) {
        const auto = [];
        for (const b of blocks) {
          if (!b.orderId || b.status !== 'match' || !b.lines.length) continue;
          if (source === 'amh' && b.taxFromBidAmount) continue;
          auto.push({ id: b.orderId, invoice: reconcileBlockToInvoice(b, source) });
        }
        if (auto.length) {
          const n = await Promise.resolve(onBillMatched(auto, { fillEmptyOnly: true, silent: true }));
          if (n) toast && toast('Auto-billed ' + n + ' verified WO(s) to Invoices');
        }
      }
    } catch (e) {
      toast && toast('Parse error: ' + (e.message || e), 'err');
    }
    setLoading(false);
  }, [orders, toast, lib, onBillMatched, onCaptureAmhForRemittance, onEnsureMsrOrders, history, persistHistory, masterCatalog]);

  const updateBlock = React.useCallback((idx, next) => {
    setReport(r => r ? { ...r, blocks: r.blocks.map((b, i) => i === idx ? next : b) } : r);
  }, []);

  // On-demand single-WO AMH re-fetch: re-capture the WO, re-reconcile this block with
  // the fresh per-line vendorTax so it stops falling back to the aggregate bid tax.
  const fetchAmh = React.useCallback(async (idx, block) => {
    if (!onCaptureAmh) { toast && toast('Fetch is only available in the desktop app', 'err'); return; }
    const order = orders.find(o => o.id === block.orderId);
    if (!order) { toast && toast('Matched WO not found', 'err'); return; }
    setBusyIdx(idx);
    const res = await onCaptureAmh(order);
    setBusyIdx(null);
    if (!res || !res.ok) { toast && toast('Fetch failed: ' + ((res && res.error) || 'unknown') + ' (WO may have aged out of the portal)', 'err'); return; }
    const fresh = reconcileAmhFromWo(block, order, res.wo || {});
    updateBlock(idx, fresh);
    toast && toast(fresh.status === 'match' ? 'Items fetched -- reconciled' : 'Fetched (' + fresh.status + ')', fresh.status === 'match' ? 'ok' : 'warn');
  }, [onCaptureAmh, orders, toast, updateBlock, reconcileAmhFromWo]);

  // Batch: re-fetch EVERY matched AMH block in ONE login, then re-reconcile each.
  const fetchAllAmh = React.useCallback(async () => {
    if (!report || report.source !== 'amh' || !onCaptureAmhBatch) return;
    const orderList = report.blocks.filter(b => b.orderId).map(b => orders.find(o => o.id === b.orderId)).filter(Boolean);
    if (!orderList.length) { toast && toast('No matched AMH work orders to fetch', 'err'); return; }
    setBusyAll(true);
    const res = await onCaptureAmhBatch(orderList);
    setBusyAll(false);
    if (!res || !res.ok) { toast && toast('Batch fetch failed: ' + ((res && res.error) || 'unknown'), 'err'); return; }
    const woById = res.woById || {};
    let got = 0;
    setReport(r => r ? { ...r, blocks: r.blocks.map(b => {
      const wo = b.orderId && woById[b.orderId];
      if (!wo) return b;
      got++;
      return reconcileAmhFromWo(b, orders.find(o => o.id === b.orderId) || {}, wo);
    }) } : r);
    toast && toast('Fetched ' + got + ' WO(s); ' + (orderList.length - got) + ' aged out of the portal window', got ? 'ok' : 'warn');
  }, [report, onCaptureAmhBatch, orders, toast, reconcileAmhFromWo]);

  // Slice 3: persist the reconciled block as the WO's invoice + stamp its invoice #.
  // AMH aggregate-fallback blocks lack per-line tax -> require a fresh fetch first
  // (a folded invoice would be short the tax). Reuses saveInvoice (dup guard + history).
  const saveBlock = React.useCallback((block) => {
    if (!onSaveInvoice || !report) return;
    if (!block.orderId || !block.lines.length) { toast && toast('Nothing to save for this line', 'err'); return; }
    if (report.source === 'amh' && block.taxFromBidAmount) {
      toast && toast('Fetch AMH items first -- per-line tax is missing, invoice would be short the tax', 'warn'); return;
    }
    const inv = reconcileBlockToInvoice(block, report.source);
    onSaveInvoice(block.orderId, inv);   // saveInvoice toasts + guards duplicates
  }, [onSaveInvoice, report, toast]);

  // Bulk: bill every MATCHED block onto its WO invoice (fill empty / overwrite present)
  // in one pass. Skips off/unavailable/no-items; AMH aggregate-fallback blocks need a
  // fetch first (counted, not billed). Flagged (suspect) lines carry through so the
  // user vets them via the editor warning icon.
  const billMatched = React.useCallback(() => {
    if (!report || !onBillMatched) return;
    const entries = [];
    let needFetch = 0;
    for (const b of report.blocks) {
      if (!b.orderId || b.status !== 'match' || !b.lines.length) continue;
      if (report.source === 'amh' && b.taxFromBidAmount) { needFetch++; continue; }
      entries.push({ id: b.orderId, invoice: reconcileBlockToInvoice(b, report.source) });
    }
    if (!entries.length) {
      toast && toast(needFetch ? 'Fetch AMH items first for ' + needFetch + ' WO(s) (per-line tax missing)' : 'No matched WOs to bill', 'warn');
      return;
    }
    setBusyAll(true);
    Promise.resolve(onBillMatched(entries)).finally(() => {
      setBusyAll(false);
      if (needFetch) toast && toast(needFetch + ' AMH WO(s) skipped -- Fetch all AMH items first', 'warn');
    });
  }, [report, onBillMatched, toast]);

  // Click-to-copy a short field (WO#, invoice#, property id) to speed up manual entry.
  const copyText = React.useCallback((text) => {
    const s = String(text == null ? '' : text);
    if (!s) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(s).then(() => toast && toast('Copied: ' + s), () => toast && toast('Copy failed', 'err'));
    }
  }, [toast]);

  // R4: export the whole reconciled remittance as an Excel invoice file in Downloads
  // ([CLIENT]_[DATE]_Invoice.xlsx). Main writes the xlsx (exceljs); renderer only ships
  // the plain report blocks. Replaces the old markdown-to-clipboard export.
  const exportXlsx = React.useCallback(async () => {
    if (!report) return;
    if (!window.remittance || !window.remittance.exportXlsx) { toast && toast('Export unavailable - fully restart the app', 'err'); return; }
    setBusyAll(true);
    try {
      const res = await window.remittance.exportXlsx({
        source: report.source, fileName: report.fileName,
        blocks: report.blocks, statementTotal: report.statementTotal,
      });
      if (res && res.ok) toast && toast('Saved to Downloads: ' + (res.name || 'invoice.xlsx'));
      else toast && toast('Export failed: ' + ((res && res.error) || 'unknown'), 'err');
    } catch (e) { toast && toast('Export error: ' + (e.message || e), 'err'); }
    setBusyAll(false);
  }, [report, toast]);

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
          <ActionBtn onClick={() => run('msr')} disabled={loading}
            title="Open an MSR 'Vendor ACH Payment Detail' PDF and reconcile each paid WO against its bid sheet">
            {loading ? 'Parsing...' : 'Open MSR PDF'}
          </ActionBtn>
          <ActionBtn onClick={() => run('amh')} disabled={loading}
            title="Open an AMH 'ACHVendor' remittance PDF and reconcile each paid WO against its captured bid">
            {loading ? 'Parsing...' : 'Open AMH PDF'}
          </ActionBtn>
          {report && report.source === 'amh' && onCaptureAmhBatch && (
            <ActionBtn onClick={fetchAllAmh} disabled={loading || busyAll}
              title="Re-pull every matched AMH WO from the portal in one login for exact per-line tax">
              {busyAll ? 'Working…' : 'Fetch all AMH items'}
            </ActionBtn>
          )}
          {report && onBillMatched && (
            <ActionBtn onClick={billMatched} disabled={loading || busyAll}
              title="Write the verified line items onto each matched WO's invoice and stamp the invoice # (fills empty, overwrites existing)">Bill matched</ActionBtn>
          )}
          {report && (
            <>
              <ActionBtn onClick={exportXlsx} disabled={busyAll}
                title="Save this remittance as an Excel invoice file in your Downloads folder">Export</ActionBtn>
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {report.fileName} · {report.blocks.length} WOs · {matched} match · {flagged} flagged
              </div>
            </>
          )}
          <div style={{ flex: 1 }} />
          <HeaderChips />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 18px' }}>
        {!report && (
          <>
            <div style={{ color: 'var(--text-3)', fontSize: 14, maxWidth: 560, lineHeight: 1.6 }}>
              Open an <b>MSR</b> "Vendor ACH Payment Detail" or an <b>AMH</b> "ACHVendor" remittance PDF.
              Each paid work order is matched (MSR by Invoice Notes number, AMH by the W#B# invoice), its
              line items are pulled (MSR from the WO folder bid sheet, AMH from the captured bid), and the
              computed total is checked against the amount paid. AMH WOs that aged out of the portal API
              window show as "unavailable" (enter items manually).
            </div>
            <RemittanceHistoryPanel history={history}
              onOpen={setReport}
              onDelete={(id) => persistHistory(removeRemittanceById(history, id))} />
          </>
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
                <ReportBlock key={i} b={b} fmt={fmt} source={report.source}
                  busy={busyIdx === i} onCopy={copyText}
                  onFetch={report.source === 'amh' ? () => fetchAmh(i, b) : null}
                  onSave={() => saveBlock(b)} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Item 1: saved-remittance list (top-level component, not inline -- A5). Rows newest-
// first (upsert already prepends). Click a row -> rehydrate via onOpen(setReport); the
// blocks carry woId/orderId so the module's Fetch/Bill/Save act on the CURRENT orders.
// Per-row delete is a hard delete of the user's own log.
function RemittanceHistoryPanel({ history, onOpen, onDelete }) {
  if (!history || !history.length) return null;
  const rowBtn = {
    height: 24, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
    border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-2)',
    fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
  };
  return (
    <div style={{ marginTop: 20, maxWidth: 720 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 8 }}>
        Saved remittances
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map((s) => {
          const blocks = Array.isArray(s.blocks) ? s.blocks : [];
          const match = blocks.filter(b => b.status === 'match').length;
          const flagged = blocks.filter(b => b.status !== 'match').length;
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
              border: '1px solid var(--border-1)', borderRadius: 8, background: 'var(--bg-surface)' }}>
              <div onClick={() => onOpen(s)} title="Reopen this remittance"
                style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }}>{s.invoiceDate}</span>
                <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>{s.source}</span>
                <span style={{ color: 'var(--text-2)' }}>{s.fileName}</span>
                <span style={{ color: 'var(--text-3)' }}>· {match} match / {flagged} flagged</span>
              </div>
              <button onClick={() => onDelete(s.id)} title="Delete this saved remittance" style={rowBtn}>Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportBlock({ b, fmt, source, busy, onFetch, onSave, onCopy }) {
  const st = STATUS_STYLE[b.status] || STATUS_STYLE.unmatched;
  const offBy = Math.abs(b.delta);
  // Fetch shows for any AMH block matched to a WO (re-pull per-line tax / aged-out items).
  const showFetch = onFetch && b.orderId;
  // Save shows once there are lines to persist AND a WO to save onto; AMH aggregate-
  // fallback blocks are blocked in saveBlock (prompt to fetch first).
  const showSave = onSave && b.orderId && b.lines.length > 0;
  const miniBtn = {
    height: 26, padding: '0 10px', borderRadius: 6, cursor: busy ? 'default' : 'pointer',
    border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 600, opacity: busy ? 0.5 : 1,
  };
  // Click-to-copy field: mid weight (600, below the 700 address), monospace-ish tabular
  // for the numbers, cursor+title cueing the copy. Falls back to plain text if no onCopy.
  // transform (optional) maps the DISPLAYED value to the COPIED string (e.g. WO# copies
  // as "WO <num>" for the AMH memo, but shows the bare number). Copy-string only -- the
  // stored woId/id are never mutated.
  const copyField = (label, value, transform) => {
    if (!value) return null;
    const copied = transform ? transform(value) : value;
    return (
      <span onClick={onCopy ? () => onCopy(copied) : undefined}
        title={onCopy ? 'Click to copy ' + label : label}
        style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-2)', cursor: onCopy ? 'pointer' : 'default',
          fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    );
  };
  const propId = b.propertyId || b.propCode;
  return (
    <div style={{ border: '1px solid var(--border-1)', borderRadius: 10, background: 'var(--bg-surface)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{b.address || '(no address)'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-3)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>WO</span>
          {copyField('WO number', b.orderId || b.woId, v => 'WO ' + v) || <span>?</span>}
          <span style={{ color: 'var(--text-3)' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Inv</span>
          {copyField('invoice #', b.invoiceNum) || <span style={{ color: 'var(--text-3)' }}>no invoice #</span>}
          {propId && (<>
            <span style={{ color: 'var(--text-3)' }}>·</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Prop</span>
            {copyField('property ID', propId)}
          </>)}
        </div>
        <div style={{ flex: 1 }} />
        {showFetch && (
          <button onClick={onFetch} disabled={busy} title="Re-pull this WO from the AMH portal for per-line tax" style={miniBtn}>
            {busy ? 'Fetching…' : 'Fetch AMH items'}
          </button>
        )}
        {showSave && (
          <button onClick={onSave} disabled={busy} title="Save these lines as the WO invoice and stamp the invoice #" style={miniBtn}>
            Save to WO
          </button>
        )}
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
          {b.lines.map((l, i) => {
            // RazorSync entry: the catalog SENTINEL chip, the Description, and the PRE-TAX
            // Price are each click-to-copy (2d). Price copies l.pre (pre-tax) because
            // RazorSync re-applies tax on a taxable-sentinel line -- copying post would
            // double-tax; non-taxable lines have pre === post anyway.
            const tag = sentinelTag(l);
            return (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px 90px', gap: 8, padding: '3px 0', fontSize: 13, borderTop: '1px solid var(--border-1)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-1)', minWidth: 0 }}>
                  {tag && (
                    <span onClick={onCopy ? () => onCopy(tag) : undefined}
                      title={onCopy ? 'Click to copy catalog name ' + tag : tag}
                      style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 5,
                        border: '1px solid var(--border-1)', color: 'var(--text-2)', background: 'var(--bg-canvas)',
                        cursor: onCopy ? 'pointer' : 'default' }}>{tag}</span>
                  )}
                  <span onClick={onCopy ? () => onCopy(l.desc || '') : undefined}
                    title={onCopy ? 'Click to copy description' : undefined}
                    style={{ cursor: onCopy ? 'pointer' : 'default', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.desc || '(no description)'}{l.qty > 1 ? ' ×' + l.qty : ''}
                  </span>
                </span>
                <span onClick={onCopy ? () => onCopy(l.pre) : undefined}
                  title={onCopy ? 'Click to copy pre-tax price' : undefined}
                  style={{ textAlign: 'right', color: 'var(--text-2)', cursor: onCopy ? 'pointer' : 'default' }}>{fmt(l.pre)}</span>
                <span style={{ textAlign: 'right', color: l.tax > 0 ? 'var(--text-1)' : 'var(--text-3)' }}>{fmt(l.tax)}</span>
                <span style={{ textAlign: 'right', color: 'var(--text-2)' }}>{fmt(l.post)}</span>
              </div>
            );
          })}
          <CopyStepper lines={b.lines} onCopy={onCopy} />
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

// Item 2f: walk a WO's fields in RazorSync ENTRY ORDER -- per line [sentinel, description,
// pre-tax price] -- copying one field per click so the user can tab straight through the
// RazorSync form. Top-level component (A5), one per ReportBlock. Keeps the per-field
// buttons above as a fallback.
function CopyStepper({ lines, onCopy }) {
  const steps = React.useMemo(() => {
    const out = [];
    for (const l of Array.isArray(lines) ? lines : []) {
      const line = l.desc || '(no description)';
      out.push({ value: sentinelTag(l), line, field: 'catalog name' });
      out.push({ value: l.desc || '', line, field: 'description' });
      out.push({ value: l.pre, line, field: 'pre-tax price' });
    }
    return out;
  }, [lines]);
  // cursor = the next field to copy. This is LEGIT user-driven state (each click advances
  // it); the renderer cannot compute it, so useState is correct here -- NOT an A1/A2
  // derived-state smell. Do not hoist or derive it.
  const [cursor, setCursor] = React.useState(0);
  if (!steps.length || !onCopy) return null;
  const done = cursor >= steps.length;
  const next = done ? null : steps[cursor];
  const copyNext = () => { if (done) return; onCopy(next.value); setCursor(c => c + 1); };
  const btn = {
    height: 26, padding: '0 12px', borderRadius: 6, cursor: 'pointer',
    border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-1)' }}>
      <button onClick={copyNext} disabled={done} style={{ ...btn, opacity: done ? 0.5 : 1, cursor: done ? 'default' : 'pointer' }}>
        {done ? 'All copied' : 'Copy next'}
      </button>
      <button onClick={() => setCursor(0)} style={{ ...btn, fontWeight: 500 }}>Reset</button>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
        {done ? 'Walked all ' + steps.length + ' fields — Reset to restart'
              : 'Next: ' + next.line + ' · ' + next.field}
      </span>
    </div>
  );
}
