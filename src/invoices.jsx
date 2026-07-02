// Invoice cluster, carved out of app.jsx: tax model (TAX_RATE/money/
// computeInvoiceTotals) + AddServiceItemModal + ServiceLibrary + InvoiceEditor +
// InvoicesModule. Shared helpers import from app.jsx (live-binding cycle,
// eval-safe). App renders ServiceLibrary / InvoicesModule / InvoiceEditor.
import React from 'react';
import { ActionBtn } from './primitives.jsx';
import {
  LIBRARY_TABS, emptyLibrary, useServiceLibraryStore, Modal, SimpleListEditor, MenuItem, HeaderChips, OtherTabMatches,
} from './app.jsx';
import { bidItemsToInvoiceLines, orderNumberMatches, findOtherViewMatches } from './orders-logic.js';
import { useTypeToSearch, useModalOpenFlag } from './search-hook.js';

// ── Invoice tax model (slice 2) ───────────────────────────────────────────────
// TAX_RATE is the tax-INCLUSIVE multiplier (1 + 0.0725). MSR library/quoted
// prices are tax-INCLUSIVE, so for an MSR WO a taxable line's pre-tax unit is
// price / TAX_RATE (dividing back out the embedded tax). Every other WO quotes
// pre-tax, so the unit price is used as-is and tax is added on top. Non-taxable
// lines (e.g. AMH, already all-inclusive) never get tax applied.
const TAX_RATE = 1.0725;

function money(n) {
  const v = (typeof n === 'number' && !Number.isNaN(n)) ? n : 0;
  return Math.round(v * 100) / 100;
}

// Pure. invoice = { number, date, lineItems:[{name,desc,qty,unitPrice,category,taxable,agreement}] }.
// pm = the WO's PM (e.g. 'MSR'); only MSR triggers the divide-out rule.
// Returns per-line breakdown + { taxableSubtotal, nonTaxableSubtotal, tax, grandTotal }.
function computeInvoiceTotals(invoice, pm) {
  const isMSR = String(pm || '').toUpperCase() === 'MSR';
  const lines = (invoice && Array.isArray(invoice.lineItems)) ? invoice.lineItems : [];
  let taxableSubtotal = 0;   // pre-tax sum of taxable lines
  let nonTaxableSubtotal = 0;
  const rows = lines.map((li) => {
    const qty = Number(li.qty) > 0 ? Number(li.qty) : 1;
    const unit = money(Number(li.unitPrice));
    const taxable = !!li.taxable;
    // Accumulate raw (unrounded) line values so the cent rounding happens once
    // on the subtotals, not per line (avoids 1-cent drift on multi-line invoices).
    const preTaxUnitRaw = (taxable && isMSR) ? (unit / TAX_RATE) : unit;
    const lineRaw = preTaxUnitRaw * qty;
    if (taxable) taxableSubtotal += lineRaw;
    else nonTaxableSubtotal += lineRaw;
    return { ...li, qty, unitPrice: unit, preTaxUnit: money(preTaxUnitRaw), lineSubtotal: money(lineRaw) };
  });
  taxableSubtotal = money(taxableSubtotal);
  nonTaxableSubtotal = money(nonTaxableSubtotal);
  const tax = money(taxableSubtotal * (TAX_RATE - 1));
  const grandTotal = money(taxableSubtotal + tax + nonTaxableSubtotal);
  return { rows, taxableSubtotal, nonTaxableSubtotal, tax, grandTotal };
}

// Live-verify handle for the MSR 1.0725 round-trip (console: __invoiceCalc(...)).
if (typeof window !== 'undefined') { window.__invoiceCalc = computeInvoiceTotals; }

// Slice 2 (#6): Add Service Item modal — replaces the old insert-blank-row
// behavior. Catalog defaults to the tab the user was viewing; sub-category is
// internal-only (exportLibrary whitelists fields, so it never reaches xlsx).
function AddServiceItemModal({ defaultCatalog, subCats, onAdd, onClose }) {
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [price, setPrice] = React.useState('');
  const [taxable, setTaxable] = React.useState(true);
  const [catalog, setCatalog] = React.useState(defaultCatalog || LIBRARY_TABS[0]);
  // subCat '__new' = user is typing a brand-new sub-category in newSub.
  const [subCat, setSubCat] = React.useState('');
  const [newSub, setNewSub] = React.useState('');
  const inputRef = React.useRef(null);
  // Explicit focus (autoFocus inside a freshly-mounted Modal can be cleared in
  // the same React-18 commit, leaving the field unresponsive).
  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  const fld = {
    display: 'block', marginTop: 4, width: '100%', padding: '8px', borderRadius: 8,
    border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box',
  };
  const submit = () => {
    if (!name.trim()) return;
    const sub = subCat === '__new' ? newSub.trim() : subCat;
    onAdd({
      name: name.trim(), desc: desc.trim(),
      price: price === '' ? 0 : parseFloat(price) || 0,
      // AMH prices are tax-inclusive; the catalog never carries a taxable flag
      // (its table column is hidden too).
      taxable: catalog === 'AMH' ? false : taxable,
      catalog, subCategory: sub || null,
    });
  };
  const onEnter = (e) => { if (e.key === 'Enter') submit(); };
  return (
    <Modal open onClose={onClose} title="Add service item" width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Name
          <input ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} style={fld} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Description
          <input value={desc} onChange={(e) => setDesc(e.target.value)} onKeyDown={onEnter} style={fld} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Price
          <input value={price} onChange={(e) => setPrice(e.target.value)} type="number" step="0.01" placeholder="0.00"
            onKeyDown={onEnter} style={fld} />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Catalog
          <select value={catalog} onChange={(e) => setCatalog(e.target.value)} style={fld}>
            {LIBRARY_TABS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {catalog !== 'AMH' && (
          <label style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={taxable} onChange={(e) => setTaxable(e.target.checked)} />
            Taxable
          </label>
        )}
        <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Sub-category
          <select value={subCat} onChange={(e) => setSubCat(e.target.value)} style={fld}>
            <option value="">None</option>
            {(subCats || []).map(s => <option key={s} value={s}>{s}</option>)}
            <option value="__new">+ New sub-category...</option>
          </select>
          {subCat === '__new' && (
            <input value={newSub} onChange={(e) => setNewSub(e.target.value)} onKeyDown={onEnter}
              placeholder="New sub-category name" style={fld} />
          )}
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <ActionBtn onClick={onClose}>Cancel</ActionBtn>
          <ActionBtn primary disabled={!name.trim()} onClick={submit}>Add item</ActionBtn>
        </div>
      </div>
    </Modal>
  );
}

export function ServiceLibrary({ toast, subCats, setSubCats }) {
  const [lib, persist] = useServiceLibraryStore();
  const [tab, setTab] = React.useState('General');
  const [q, setQ] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [subCatsOpen, setSubCatsOpen] = React.useState(false);
  const searchRef = React.useRef(null);
  useTypeToSearch({ setValue: setQ, inputRef: searchRef });

  const items = (lib && lib[tab]) || [];
  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = items.map((it, i) => ({ it, i }));
    if (!needle) return rows;
    return rows.filter(({ it }) =>
      (it.name || '').toLowerCase().includes(needle) || (it.desc || '').toLowerCase().includes(needle));
  }, [items, q]);

  // Slice 2 (#6): sub-category display. Column shows when sub-categories are
  // configured or any item carries one; rows group under header rows
  // (uncategorized first, then settings order, then unknown alphabetical).
  const showSubCol = (subCats && subCats.length > 0) || items.some(it => it && it.subCategory);
  const subOptions = React.useMemo(() => {
    const set = new Set(subCats || []);
    for (const it of items) if (it && it.subCategory) set.add(it.subCategory);
    return [...(subCats || []), ...[...set].filter(s => !(subCats || []).includes(s)).sort()];
  }, [subCats, items]);
  const colCount = 3 + (showSubCol ? 1 : 0) + (tab !== 'AMH' ? 1 : 0) + 1;
  const grouped = React.useMemo(() => {
    if (!filtered.some(({ it }) => it && it.subCategory)) return [{ sub: null, rows: filtered }];
    const order = [''].concat(subCats || []);
    const buckets = new Map();
    for (const r of filtered) {
      const key = (r.it && r.it.subCategory) || '';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(r);
    }
    const known = order.filter(k => buckets.has(k));
    const unknown = [...buckets.keys()].filter(k => !order.includes(k)).sort();
    return [...known, ...unknown].map(k => ({ sub: k || null, rows: buckets.get(k) }));
  }, [filtered, subCats]);

  const setItems = React.useCallback((nextItems) => {
    persist({ ...(lib || emptyLibrary()), [tab]: nextItems });
  }, [lib, tab, persist]);

  const updateItem = (idx, patch) => setItems(items.map((it, i) => i === idx ? { ...it, ...patch } : it));
  const deleteItem = (idx) => setItems(items.filter((_, i) => i !== idx));
  // Slice 2 (#6): "+ Add item" opens a modal instead of inserting a blank row.
  // A sub-category typed fresh in the modal is appended to the settings list
  // so it shows up in every dropdown from then on.
  const addFromModal = ({ name, desc, price, taxable, catalog, subCategory }) => {
    const item = { name, desc, price, taxable };
    if (subCategory) item.subCategory = subCategory;
    if (subCategory && setSubCats && !(subCats || []).includes(subCategory)) {
      setSubCats([...(subCats || []), subCategory]);
    }
    persist({ ...(lib || emptyLibrary()), [catalog]: [item, ...((lib && lib[catalog]) || [])] });
    setAdding(false);
    if (catalog !== tab) setTab(catalog);
    toast('Added to ' + catalog + (subCategory ? ' · ' + subCategory : ''));
  };

  const btn = (label, onClick, primary) => (
    <button onClick={onClick} style={{
      height: 32, padding: '0 12px', borderRadius: 7, cursor: 'pointer',
      border: primary ? 'none' : '1px solid var(--border-1)',
      background: primary ? 'var(--accent)' : 'var(--bg-surface)',
      color: primary ? 'var(--accent-fg)' : 'var(--text-1)',
      fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
    }}>{label}</button>
  );

  const cellInput = (val, onChange, opts = {}) => (
    <input
      value={val == null ? '' : val}
      onChange={(e) => onChange(e.target.value)}
      type={opts.type || 'text'} step={opts.step}
      style={{
        width: '100%', boxSizing: 'border-box', height: 28, padding: '0 8px',
        border: '1px solid var(--border-1)', borderRadius: 6,
        background: 'var(--bg-canvas)', color: 'var(--text-1)',
        fontFamily: 'inherit', fontSize: 13, textAlign: opts.type === 'number' ? 'right' : 'left',
      }}
    />
  );

  return (
    <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '10px 18px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Service Library
          </div>
          <div style={{ flex: 1 }} />
          {btn('Sub-categories', () => setSubCatsOpen(true))}
          <HeaderChips />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            ref={searchRef}
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items..."
            style={{
              flex: 1, height: 30, padding: '0 10px', borderRadius: 7,
              border: '1px solid var(--border-1)', background: 'var(--bg-canvas)',
              color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13,
            }}
          />
          {btn('+ Add item', () => setAdding(true))}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* Module sidebar: catalog tab nav (replaces top tab pills). */}
        <aside style={{
          width: 200, flexShrink: 0,
          borderRight: '1px solid var(--border-1)', background: 'var(--bg-surface)',
          padding: '12px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto',
        }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Catalogs
          </div>
          {LIBRARY_TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              width: '100%', height: 30, padding: '0 10px', borderRadius: 7, cursor: 'pointer',
              border: '1px solid ' + (tab === t ? 'var(--accent)' : 'var(--border-1)'),
              background: tab === t ? 'var(--bg-row-sel)' : 'transparent',
              color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13,
              fontWeight: tab === t ? 600 : 400, textAlign: 'left',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>{t}</span>
              <span style={{ color: 'var(--text-3)' }}>{((lib && lib[t]) || []).length}</span>
            </button>
          ))}
        </aside>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px 18px' }}>
        {lib === null ? (
          <div style={{ padding: 24, color: 'var(--text-3)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-3)' }}>
            {items.length === 0 ? `No items in ${tab}. Use "+ Add item", or seed/import from Settings > Service Library.` : 'No matches.'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-canvas)', zIndex: 1 }}>
                <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-3)', fontWeight: 600, width: '44%' }}>Item Name</th>
                <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-3)', fontWeight: 600, width: '30%' }}>Description</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', color: 'var(--text-3)', fontWeight: 600, width: 110 }}>Price</th>
                {showSubCol && <th style={{ textAlign: 'left', padding: '8px 6px', color: 'var(--text-3)', fontWeight: 600, width: 130 }}>Sub-category</th>}
                {tab !== 'AMH' && <th style={{ textAlign: 'center', padding: '8px 6px', color: 'var(--text-3)', fontWeight: 600, width: 70 }}>Taxable</th>}
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {grouped.map(g => (
                <React.Fragment key={g.sub || '__none'}>
                  {g.sub && (
                    <tr>
                      <td colSpan={colCount} style={{ padding: '12px 6px 4px', fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{g.sub}</td>
                    </tr>
                  )}
                  {g.rows.map(({ it, i }) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border-1)' }}>
                  <td style={{ padding: '4px 6px' }}>{cellInput(it.name, (v) => updateItem(i, { name: v }))}</td>
                  <td style={{ padding: '4px 6px' }}>{cellInput(it.desc, (v) => updateItem(i, { desc: v }))}</td>
                  <td style={{ padding: '4px 6px' }}>{cellInput(it.price, (v) => updateItem(i, { price: v === '' ? 0 : parseFloat(v) || 0 }), { type: 'number', step: '0.01' })}</td>
                  {showSubCol && (
                  <td style={{ padding: '4px 6px' }}>
                    <select value={it.subCategory || ''} onChange={(e) => updateItem(i, { subCategory: e.target.value || undefined })} style={{
                      width: '100%', boxSizing: 'border-box', height: 28, padding: '0 4px',
                      border: '1px solid var(--border-1)', borderRadius: 6,
                      background: 'var(--bg-canvas)', color: 'var(--text-1)',
                      fontFamily: 'inherit', fontSize: 12,
                    }}>
                      <option value="">—</option>
                      {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  )}
                  {tab !== 'AMH' && (
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <input type="checkbox" checked={!!it.taxable} onChange={(e) => updateItem(i, { taxable: e.target.checked })} />
                  </td>
                  )}
                  <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                    <button onClick={() => deleteItem(i)} title="Delete" style={{
                      border: 'none', background: 'transparent', color: 'var(--text-3)',
                      cursor: 'pointer', fontSize: 15, lineHeight: 1,
                    }}>×</button>
                  </td>
                </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
        </div>
      </div>
      {adding && (
        <AddServiceItemModal
          defaultCatalog={tab}
          subCats={subCats}
          onAdd={addFromModal}
          onClose={() => setAdding(false)}
        />
      )}
      {subCatsOpen && (
        <SimpleListEditor
          title="Library sub-categories"
          singular="sub-category"
          items={subCats}
          setItems={setSubCats}
          onClose={() => setSubCatsOpen(false)}
        />
      )}
    </div>
  );
}

// ── Invoice editor (slice 2) ──────────────────────────────────────────────────
// Full-screen overlay. Records an invoice on a WO: manual invoice #/date, line
// items (autocompleted from the service library), per-line labor/material
// category + taxable flag, live totals via computeInvoiceTotals. Persists the
// invoice through onSave(invoice). NOT mounted yet - slice 3 wires the entry
// point (module launcher). order = the WO record; library = { General, AMH }.
function blankLine() {
  return { name: '', desc: '', qty: 1, unitPrice: 0, category: 'labor', taxable: false, agreement: '' };
}
const normInvoiceNum = (n) => String(n == null ? '' : n).trim().toLowerCase();
export function InvoiceEditor({ order, library, existingNumbers, onSave, onClose }) {
  useModalOpenFlag(true);   // full-screen overlay: silence type-to-search underneath
  const pm = (order && order.pm) || '';
  const isMSR = String(pm).toUpperCase() === 'MSR';
  // Invoice numbers already used by OTHER work orders (duplicate guard).
  const usedNumbers = React.useMemo(
    () => new Set((existingNumbers || []).map(normInvoiceNum)),
    [existingNumbers]
  );
  const tabName = String(pm).toUpperCase() === 'AMH' ? 'AMH' : 'General';
  const catalog = (library && Array.isArray(library[tabName])) ? library[tabName] : [];
  const catalogByName = React.useMemo(() => {
    const m = new Map();
    for (const it of catalog) if (it && it.name) m.set(it.name, it);
    return m;
  }, [catalog]);

  const existing = order && order.invoice;
  const [number, setNumber] = React.useState((existing && existing.number) || '');
  const [date, setDate] = React.useState((existing && existing.date) || new Date().toISOString().slice(0, 10));
  const [lines, setLines] = React.useState(() => {
    if (existing && Array.isArray(existing.lineItems) && existing.lineItems.length) {
      return existing.lineItems.map(li => ({ ...blankLine(), ...li }));
    }
    // No saved invoice yet -> pre-populate from the WO's scraped bidItems.
    // bidItemsToInvoiceLines (orders-logic.js) reads the description from
    // bidItem.name (scrapers put it there, no desc field), matches the service
    // library, and falls back to a Labor!/Materials! sentinel keeping the bid
    // description. blankLine spread keeps forward-compatible line defaults.
    const built = bidItemsToInvoiceLines(order && order.bidItems, catalog, tabName);
    if (built.length) return built.map(li => ({ ...blankLine(), ...li }));
    return [blankLine()];
  });

  const setLine = (idx, patch) => setLines(ls => ls.map((l, i) => i === idx ? { ...l, ...patch } : l));
  const removeLine = (idx) => setLines(ls => ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls);
  const addLine = () => setLines(ls => [...ls, blankLine()]);

  // Picking a catalog name autofills price/desc/taxable; user may override after.
  // Sentinel items (Labor!/Materials!) have an empty library desc — keep the
  // existing line desc so bid context isn't wiped on fallback.
  const pickName = (idx, name) => {
    const hit = catalogByName.get(name);
    if (hit) setLine(idx, {
      name,
      ...(hit.desc ? { desc: hit.desc } : {}),
      unitPrice: typeof hit.price === 'number' ? hit.price : (parseFloat(hit.price) || 0),
      taxable: !!hit.taxable,
      agreement: tabName,
    });
    else setLine(idx, { name });
  };

  const totals = React.useMemo(
    () => computeInvoiceTotals({ lineItems: lines }, pm),
    [lines, pm]
  );

  const fmt = (n) => '$' + money(n).toFixed(2);

  const isDup = !!String(number).trim() && usedNumbers.has(normInvoiceNum(number));

  const save = () => {
    if (!String(number).trim()) { onSave && onSave(null, 'Invoice # is required'); return; }
    if (isDup) { onSave && onSave(null, `Invoice # ${String(number).trim()} is already used by another work order`); return; }
    const clean = lines
      .filter(l => String(l.name).trim() || Number(l.unitPrice))
      .map(l => ({
        name: String(l.name).trim(),
        desc: String(l.desc || '').trim(),
        qty: Number(l.qty) > 0 ? Number(l.qty) : 1,
        unitPrice: money(Number(l.unitPrice)),
        category: l.category === 'material' ? 'material' : 'labor',
        taxable: !!l.taxable,
        agreement: l.agreement || tabName,
      }));
    if (!clean.length) { onSave && onSave(null, 'Add at least one line item'); return; }
    onSave && onSave({ number: String(number).trim(), date, lineItems: clean });
  };

  const inputStyle = {
    boxSizing: 'border-box', height: 28, padding: '0 8px',
    border: '1px solid var(--border-1)', borderRadius: 6,
    background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 13,
  };
  const th = (label, align, w) => (
    <th style={{ textAlign: align || 'left', padding: '8px 6px', color: 'var(--text-3)', fontWeight: 600, width: w }}>{label}</th>
  );
  const totalRow = (label, val, strong) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '3px 0',
      fontWeight: strong ? 700 : 400, fontSize: strong ? 15 : 13, color: 'var(--text-1)' }}>
      <span style={{ color: strong ? 'var(--text-1)' : 'var(--text-2)' }}>{label}</span>
      <span>{val}</span>
    </div>
  );

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg-canvas)',
      display: 'flex', flexDirection: 'column',
    }}>
      <datalist id="invoice-item-names">
        {catalog.map((it, i) => <option key={i} value={it.name} />)}
      </datalist>

      <div style={{ flexShrink: 0, padding: '14px 22px', borderBottom: '1px solid var(--border-1)',
        display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
          Invoice
        </div>
        <div style={{ color: 'var(--text-2)', fontSize: 13 }}>
          WO {(order && order.id) || ''} · {pm || 'no PM'}{order && order.address ? ' · ' + order.address : ''}
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ height: 32, padding: '0 14px', borderRadius: 7, cursor: 'pointer',
          border: '1px solid var(--border-1)', background: 'var(--bg-surface)', color: 'var(--text-1)',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>Cancel</button>
        <button onClick={save} disabled={isDup} style={{ height: 32, padding: '0 14px', borderRadius: 7,
          cursor: isDup ? 'not-allowed' : 'pointer',
          border: 'none', background: 'var(--accent)', color: 'var(--accent-fg)',
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600, opacity: isDup ? 0.5 : 1 }}>Save invoice</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px 22px 22px' }}>
        <div style={{ display: 'flex', gap: 18, marginBottom: 16 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-3)' }}>
            Invoice #
            <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="e.g. 1042"
              style={{ ...inputStyle, height: 32, width: 180,
                borderColor: isDup ? 'var(--flag-emergency)' : 'var(--border-1)' }} />
            {isDup && <span style={{ color: 'var(--flag-emergency)', fontSize: 11 }}>Already used by another WO</span>}
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-3)' }}>
            Date
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
              style={{ ...inputStyle, height: 32, width: 180 }} />
          </label>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {th('Item', 'left', '34%')}
              {th('Description', 'left', '26%')}
              {th('Category', 'left', 110)}
              {th('Qty', 'right', 60)}
              {th('Unit price', 'right', 110)}
              {th('Tax', 'center', 50)}
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} style={{ borderTop: '1px solid var(--border-1)' }}>
                <td style={{ padding: '4px 6px' }}>
                  <input list="invoice-item-names" value={l.name} onChange={(e) => pickName(i, e.target.value)}
                    placeholder="Item name" style={{ ...inputStyle, width: '100%' }} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input value={l.desc} onChange={(e) => setLine(i, { desc: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <select value={l.category} onChange={(e) => setLine(i, { category: e.target.value })}
                    style={{ ...inputStyle, width: '100%' }}>
                    <option value="labor">Labor</option>
                    <option value="material">Material</option>
                  </select>
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input type="number" min="1" step="1" value={l.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value })}
                    style={{ ...inputStyle, width: '100%', textAlign: 'right' }} />
                </td>
                <td style={{ padding: '4px 6px' }}>
                  <input type="number" step="0.01" value={l.unitPrice}
                    onChange={(e) => setLine(i, { unitPrice: e.target.value })}
                    style={{ ...inputStyle, width: '100%', textAlign: 'right' }} />
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                  <input type="checkbox" checked={!!l.taxable} onChange={(e) => setLine(i, { taxable: e.target.checked })} />
                </td>
                <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                  <button onClick={() => removeLine(i)} title="Remove" disabled={lines.length <= 1} style={{
                    border: 'none', background: 'transparent', color: 'var(--text-3)',
                    cursor: lines.length <= 1 ? 'default' : 'pointer', fontSize: 15, lineHeight: 1,
                    opacity: lines.length <= 1 ? 0.4 : 1 }}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button onClick={addLine} style={{ marginTop: 10, height: 30, padding: '0 12px', borderRadius: 7,
          cursor: 'pointer', border: '1px solid var(--border-1)', background: 'var(--bg-surface)',
          color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>+ Add line</button>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <div style={{ width: 300, borderTop: '1px solid var(--border-1)', paddingTop: 10 }}>
            {isMSR && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 6 }}>
                MSR: taxable prices are tax-inclusive; tax divided back out at {TAX_RATE}.
              </div>
            )}
            {totalRow('Taxable subtotal', fmt(totals.taxableSubtotal))}
            {totalRow('Tax (7.25%)', fmt(totals.tax))}
            {totals.nonTaxableSubtotal > 0 && totalRow('Non-taxable', fmt(totals.nonTaxableSubtotal))}
            {totalRow('Grand total', fmt(totals.grandTotal), true)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Module launcher (slice 3) ─────────────────────────────────────────────────
// Full-screen overlay picker. Switches the top-level module (Work Orders /
// Invoices / Service Items). Ports the FullScreenLanding overlay style.
// Module catalog — single source of truth. Grouped into categories that drive
// both the launcher layout (two titled rows) and the nav-arrow order (flat).
// To add or reorder modules, edit this list. Everything else derives.
// MODULE_GROUPS / MODULES / MODULE_ORDER now live in nav.jsx (imported above).
// In-pane tab pills for the Work Orders module header. change11 reduced
// the model to Active / Complete / Trash. Sent is hidden here — it lives
// in the Invoices module. Invoiced and Paid are retired (QuickBooks).
// ── Invoices module (slice 3) ─────────────────────────────────────────────────
// change11: Billing-queue view shows tab='sent' WOs only. Row click opens the
// invoice editor for that WO. Shows recorded invoice # + grand total when present.
export function InvoicesModule({ sentOrders, allOrders, onNavigateWO, selectedId, onOpenInvoice, onWoAction }) {
  const fmt = (n) => '$' + money(n).toFixed(2);
  const [query, setQuery] = React.useState('');
  // change11: status filter dropped (only 'sent' exists now). Aging filter
  // retained for throughput review.
  const [agingFilter, setAgingFilter] = React.useState(null);     // null | '0-30' | '31-60' | '60+'
  const selRef = React.useRef(null);
  React.useEffect(() => {
    if (selRef.current) selRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedId]);
  // search-ux Part 4: WOs matching the query that are NOT in the Sent queue
  // (Active/Complete/Trash). Shown under the list, click navigates via onNavigateWO.
  const otherMatches = React.useMemo(
    () => findOtherViewMatches(allOrders, query, ['sent']),
    [allOrders, query]
  );
  const searchRef = React.useRef(null);
  useTypeToSearch({ setValue: setQuery, inputRef: searchRef });
  const q = query.trim().toLowerCase();
  const matches = (o) => {
    if (!q) return true;
    const inv = o.invoice;
    return (
      orderNumberMatches(o, q) ||
      String(o.address || '').toLowerCase().includes(q) ||
      String(o.city || '').toLowerCase().includes(q) ||
      String(o.pm || '').toLowerCase().includes(q) ||
      String(o.tech || '').toLowerCase().includes(q) ||
      String((inv && inv.number) || '').toLowerCase().includes(q)
    );
  };
  const daysSince = (iso) => {
    if (!iso) return 0;
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y) return 0;
    const ms = Date.now() - new Date(y, (m || 1) - 1, d || 1).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  };
  // change11: aging is days since 'sent to billing queue' history entry.
  // Falls back to dateCreated if the entry is missing (pre-change11 WOs).
  const ageOf = (o) => {
    const h = Array.isArray(o.history) ? o.history : [];
    const entry = [...h].reverse().find(e => /sent to billing/i.test(String(e.action || '')));
    const baseIso = entry && entry.ts ? new Date(entry.ts).toISOString().slice(0, 10) : (o.dateCreated || '');
    return daysSince(baseIso);
  };
  const inAgingBucket = (days, bucket) => {
    if (!bucket) return true;
    if (bucket === '0-30')  return days <= 30;
    if (bucket === '31-60') return days >= 31 && days <= 60;
    if (bucket === '60+')   return days > 60;
    return true;
  };
  const filtered = sentOrders.filter(o => matches(o) && inAgingBucket(ageOf(o), agingFilter));
  const aging = React.useMemo(() => {
    let a = 0, b = 0, c = 0;
    for (const o of sentOrders) {
      const d = ageOf(o);
      if (d <= 30) a++; else if (d <= 60) b++; else c++;
    }
    return { '0-30': a, '31-60': b, '60+': c };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentOrders]);
  // change11: bid totals tile = sum of bidAmount across all sent WOs (used
  // for throughput tracking). Parses '$NNN.NN' or bare numerics.
  const parseBid = (raw) => {
    if (raw == null) return 0;
    const m = String(raw).replace(/,/g, '').match(/(-?\d+(?:\.\d{1,2})?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const bidTotal = React.useMemo(
    () => sentOrders.reduce((s, o) => s + parseBid(o.bidAmount), 0),
    [sentOrders]
  );
  return (
    <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '10px 18px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Invoices
          </div>
          <div style={{
            flex: '1 1 200px', minWidth: 140, maxWidth: 360, marginLeft: 12,
            height: 30, border: '1px solid var(--border-1)', borderRadius: 8,
            background: 'var(--bg-canvas)', padding: '0 10px',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search WO, invoice, address..."
              style={{
                flex: 1, border: 'none', outline: 'none',
                background: 'transparent', color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 13, minWidth: 0,
              }}
            />
            {query && (
              <span onClick={() => setQuery('')} style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-3)' }}>{'✕'}</span>
            )}
          </div>
          <div style={{ flex: 1 }} />
          <HeaderChips />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        {/* change11: sidebar simplified. Status filter dropped (only Sent
            exists). Bid total tile sums bidAmount across all sent WOs. */}
        <aside style={{
          width: 200, flexShrink: 0,
          borderRight: '1px solid var(--border-1)', background: 'var(--bg-surface)',
          padding: '12px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto',
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Bid totals
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, fontFamily: "'Bricolage Grotesque', sans-serif", letterSpacing: '-0.01em' }}>
              {fmt(bidTotal)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
              {sentOrders.length} sent WO{sentOrders.length === 1 ? '' : 's'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Aging
            </div>
            {[
              { id: null,    label: 'All ages' },
              { id: '0-30',  label: '0-30 days' },
              { id: '31-60', label: '31-60 days' },
              { id: '60+',   label: '60+ days' },
            ].map(b => (
              <button key={b.id || 'any'} onClick={() => setAgingFilter(b.id)} style={{
                width: '100%', height: 28, padding: '0 10px', marginBottom: 4,
                border: '1px solid ' + (agingFilter === b.id ? 'var(--accent)' : 'var(--border-1)'),
                background: agingFilter === b.id ? 'var(--bg-row-sel)' : 'transparent',
                color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12,
                fontWeight: agingFilter === b.id ? 600 : 400, borderRadius: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer',
              }}>
                <span>{b.label}</span>
                {b.id != null && <span style={{ color: 'var(--text-3)' }}>{aging[b.id]}</span>}
              </button>
            ))}
          </div>
        </aside>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 18px 18px' }}>
          <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--text-3)', fontWeight: 600 }}>
            Sent to invoice <span>· {filtered.length}</span>
          </div>
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 6px', color: 'var(--text-3)', fontSize: 13 }}>None.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-3)', fontWeight: 600, width: 90 }}>WO</th>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-3)', fontWeight: 600 }}>Address</th>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-3)', fontWeight: 600, width: 70 }}>Client</th>
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-3)', fontWeight: 600, width: 120 }}>Invoice #</th>
                  <th style={{ textAlign: 'right', padding: '6px', color: 'var(--text-3)', fontWeight: 600, width: 110 }}>Total</th>
                  <th style={{ width: 96 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map(o => {
                  const inv = o.invoice;
                  const isSel = o.id === selectedId;
                  // change11: row total resolution. Recorded invoice wins.
                  // Else bidAmount. Else red "No Bid!" warning.
                  let totalCell;
                  if (inv) {
                    totalCell = <span>{fmt(computeInvoiceTotals(inv, o.pm).grandTotal)}</span>;
                  } else if (o.bidAmount && String(o.bidAmount).trim()) {
                    const raw = String(o.bidAmount).trim();
                    totalCell = <span style={{ color: 'var(--text-2)' }}>{raw.startsWith('$') ? raw : '$' + raw}</span>;
                  } else {
                    totalCell = <span style={{ color: 'var(--flag-emergency)', fontWeight: 600 }}>No Bid!</span>;
                  }
                  return (
                    <tr key={o.id} ref={isSel ? selRef : undefined} onClick={() => onOpenInvoice(o.id)} style={{
                      borderTop: '1px solid var(--border-1)', cursor: 'pointer',
                      background: isSel ? 'var(--bg-row-sel)' : 'transparent',
                      boxShadow: isSel ? 'inset 3px 0 0 var(--accent)' : 'none',
                    }}>
                      <td style={{ padding: '8px 6px', fontVariantNumeric: 'tabular-nums' }}>{o.id}</td>
                      <td style={{ padding: '8px 6px' }}>{o.address || ''}{o.city ? ', ' + o.city : ''}</td>
                      <td style={{ padding: '8px 6px' }}>{o.pm || ''}</td>
                      <td style={{ padding: '8px 6px', color: inv ? 'var(--text-1)' : 'var(--text-3)' }}>
                        {inv && inv.number ? inv.number : 'not invoiced'}
                      </td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>{totalCell}</td>
                      <td style={{ padding: '8px 6px', textAlign: 'right' }}>
                        {/* Reuse the staged `reopen` (sent -> Complete). From the
                            Complete tab the existing "Reopen -> Active" finishes
                            the revert. stopPropagation so the row's open-invoice
                            click does not also fire. */}
                        <button
                          onClick={(e) => { e.stopPropagation(); onWoAction && onWoAction(o.id, 'reopen'); }}
                          title="Move back to the Complete tab (then Reopen → Active there if needed)"
                          style={{
                            height: 24, padding: '0 8px', borderRadius: 6, cursor: 'pointer',
                            border: '1px solid var(--border-2)', background: 'var(--bg-surface)',
                            color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                          }}
                        >Reopen</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {otherMatches.length > 0 && (
            <OtherTabMatches matches={otherMatches} onNavigate={onNavigateWO} />
          )}
        </div>
      </div>
    </div>
  );
}
