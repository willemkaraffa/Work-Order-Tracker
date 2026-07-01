import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_PMS, DEFAULT_TYPES, DEFAULT_TECHS, DEFAULT_PHASES, DEFAULT_STATUSES, DENSITY_MAP, densityFor,
  MIGRATION_VERSION, APP_VERSION, DEFAULT_STATUS_COLORS, LOCKED_STATUSES, SYSTEM_TAGS,
  SYSTEM_TAG_LABELS, isCompletionStatusName, EDITABLE_THEME_VARS, DEFAULT_MORE_INFO_COLOR,
  statusColor, TYPE_COLORS, DEFAULT_MAP_MARKER_COLORS, normalizeHex, hexToRgba,
} from './constants.js';
import {
  phaseFor, phaseForOrder, phaseStyle, daysSince, ageLevelFor, ageLevelForDays,
  ageDaysFor, migrateOrders, migrateSettingsForChange11,
  applyMarkComplete, applyReopen, applySendToInvoice, reconcileChange11, wasVisited,
  clearsScheduleOnSet,
} from './orders-logic.js';
// Re-export so existing consumers (detail.jsx, data.js) keep importing it from here.
export { DEFAULT_STATUSES };
import {
  PhasesContext, usePhases, StatusColorsContext, useStatusColors,
  ToastContext, useToast, PMsContext, usePMs,
} from './contexts.js';
import {
  Dot, PMChip, TypeIcon, FlagGlyph, StatusPill, ActionBtn, FilterChip,
  InlineEdit, SettingTitle, SettingRow, Seg, miniBtnStyle, ReorderBtns, swapAt,
} from './primitives.jsx';
import { formatPhone, haversineKm, roadKm, composeNotes } from './utils.js';
import { MODULE_GROUPS, MODULES, MODULE_ORDER, ModuleNavContext, NavWing, RAIL as NAV_RAIL } from './nav.jsx';
import { MapsModule, MapInset } from './maps.jsx';
import { ItineraryModule, DayTimeline } from './itinerary.jsx';
import { DetailPane } from './detail.jsx';
import { ListPane } from './listpane.jsx';
import { SettingsDrawer } from './settings.jsx';
import { ServiceLibrary, InvoiceEditor, InvoicesModule } from './invoices.jsx';
import { useWorkOrders } from './data.js';


/* ============================================================
   Trade Tracker — Phase 1 visual shell (mock sample data).
   Real data wiring lands in Phase 2.
   ============================================================ */

/* ---------- tokens ---------- */
// Catppuccin Latte palette port. Hex values verbatim from catppuccin/catppuccin.
// https://catppuccin.com/palette/ -- Latte column.
export const TT_LIGHT = {
  // Surface hierarchy: base is brightest (cards), mantle is the page
  // background that recedes, crust is the deepest band for phase headers.
  '--bg-canvas':     '#e6e9ef',  // Latte: mantle  -- recessed page bg
  '--bg-surface':    '#eff1f5',  // Latte: base    -- card / row surface
  '--bg-surface-2':  '#dce0e8',  // Latte: crust   -- phase header band

  // Interactive states
  '--bg-hover':      '#d4d8e1',  // between crust and surface1
  '--bg-row-sel':    '#bdc7f0',  // tinted with Latte blue, selected row
  '--accent-soft':   '#dce5fb',  // soft blue wash backgrounds

  // Borders use Latte surface scale
  '--border-1':      '#ccd0da',  // Latte: surface0
  '--border-2':      '#bcc0cc',  // Latte: surface1

  // Text uses Latte text/subtext/overlay scale
  '--text-1':        '#4c4f69',  // Latte: text
  '--text-2':        '#6c6f85',  // Latte: subtext0
  '--text-3':        '#9ca0b0',  // Latte: overlay0

  // Accents map straight to Latte named colors
  '--accent':        '#1e66f5',  // Latte: blue
  '--accent-fg':     '#ffffff',

  // Flags map to Latte semantic colors
  '--flag-emergency':'#d20f39',  // Latte: red
  '--flag-warranty': '#1e66f5',  // Latte: blue

  // Phase fg = Latte named color, phase bg = tinted soft wash.
  // Hue rationale matches the design-notes default phase map (Thread 3).
  '--p-intake':      '#5c5f77',  // Latte: subtext1   (neutral gray)
  '--p-intake-bg':   '#dce0e8',  // Latte: crust
  '--p-await':       '#df8e1d',  // Latte: yellow
  '--p-await-bg':    '#f5e3c2',  // tinted yellow
  '--p-approved':    '#40a02b',  // Latte: green
  '--p-approved-bg': '#cde5c4',  // tinted green
  '--p-progress':    '#1e66f5',  // Latte: blue
  '--p-progress-bg': '#c8d7fb',  // tinted blue
  '--p-wrap':        '#8839ef',  // Latte: mauve
  '--p-wrap-bg':     '#dccaf6',  // tinted mauve
  '--p-done':        '#179299',  // Latte: teal
  '--p-done-bg':     '#c3e0e2',  // tinted teal
  '--p-billing':     '#209fb5',  // Latte: sapphire
  '--p-billing-bg':  '#c5e2ea',  // tinted sapphire

  // PM chip color seeds. PM editor overrides per-PM via hex; these are
  // the LEGACY var-based fallbacks. New per-PM colors come from the data
  // layer (Phase 9). Keep the vars defined so old chip code does not
  // crash on themes that still reference them.
  '--pm-amh':        '#40a02b',  // Latte: green
  '--pm-amh-bg':     '#cde5c4',
  '--pm-msr':        '#8839ef',  // Latte: mauve
  '--pm-msr-bg':     '#dccaf6',
  '--pm-rkt':        '#fe640b',  // Latte: peach
  '--pm-rkt-bg':     '#fbd7bd',
};

export const TT_DARK = {
  '--bg-canvas':     '#1c1c1e',
  '--bg-surface':    '#272729',
  '--bg-surface-2':  '#323236',
  '--bg-hover':      '#2e2e31',
  '--bg-row-sel':    'oklch(30% 0.05 240)',
  '--border-1':      '#3c3c40',
  '--border-2':      '#4a4a4f',
  '--text-1':        '#f0f0f0',
  '--text-2':        '#a8a8a8',
  '--text-3':        '#6e6e6e',
  '--accent':        'oklch(68% 0.11 240)',
  '--accent-soft':   'oklch(28% 0.06 240)',
  '--accent-fg':     '#0c0c0c',
  '--flag-emergency':'oklch(70% 0.15 25)',
  '--flag-warranty': 'oklch(70% 0.12 240)',
  '--p-intake':      'oklch(75% 0.02 0)',
  '--p-intake-bg':   'oklch(22% 0.01 0)',
  '--p-await':       'oklch(78% 0.11 70)',
  '--p-await-bg':    'oklch(25% 0.06 70)',
  '--p-approved':    'oklch(75% 0.12 145)',
  '--p-approved-bg': 'oklch(24% 0.06 145)',
  '--p-progress':    'oklch(76% 0.11 240)',
  '--p-progress-bg': 'oklch(24% 0.06 240)',
  '--p-wrap':        'oklch(76% 0.11 290)',
  '--p-wrap-bg':     'oklch(24% 0.06 290)',
  '--p-done':        'oklch(70% 0.04 145)',
  '--p-done-bg':     'oklch(22% 0.02 145)',
  '--p-billing':     'oklch(75% 0.10 200)',
  '--p-billing-bg':  'oklch(24% 0.05 200)',
  '--pm-amh':        'oklch(75% 0.12 145)',
  '--pm-amh-bg':     'oklch(26% 0.06 145)',
  '--pm-msr':        'oklch(76% 0.11 310)',
  '--pm-msr-bg':     'oklch(26% 0.06 310)',
  '--pm-rkt':        'oklch(78% 0.11 50)',
  '--pm-rkt-bg':     'oklch(26% 0.06 50)',
};

// Default statuses (legacy set) and phases. Both are configurable via Settings → Workflow
// once that UI lands; persisted under `wo_data.statuses` and `wo_data.phases`.
// change11: 'Cancelled' is hardcoded on Trash entry (softDelete) and
// 'Complete - Pending Approval' is hardcoded on Complete entry (markComplete /
// auto-flip from a Job Complete status). Both are managed automatically — they
// surface only on trash/complete WOs and are restored to the pre-flip status
// (prevStatus) on Restore/Reopen.
// DEFAULT_STATUSES moved to ./constants.js (re-exported at top for consumers).

// Constants + pure helpers moved to ./constants.js (imported at top).

// React contexts/hooks moved to ./contexts.js; shared UI atoms (Dot, PMChip,
// TypeIcon, FlagGlyph, StatusPill, ActionBtn, FilterChip, InlineEdit,
// SettingTitle, SettingRow, Seg, miniBtnStyle, ReorderBtns, swapAt) moved to
// ./primitives.jsx. Both imported at top.

export function FilterDropdown({ label, value, options, onChange }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const t = setTimeout(() => document.addEventListener('click', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const active = !!value;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          height: 26, padding: '0 10px',
          border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border-2)'),
          borderRadius: 999,
          background: active ? 'var(--accent-soft)' : 'var(--bg-surface)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 13, color: 'var(--text-1)',
          cursor: 'pointer',
        }}
      >
        {label}{value ? ': ' + value : ''} {'▾'}
        {active && (
          <span
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            style={{ color: 'var(--text-3)', marginLeft: 2, lineHeight: 1 }}
          >{'✕'}</span>
        )}
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 30, left: 0,
          minWidth: 160, maxHeight: 320, overflowY: 'auto',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
          padding: '4px 0', zIndex: 60,
        }}>
          <MenuItem onClick={() => { onChange(''); setOpen(false); }}>All {label.toLowerCase()}</MenuItem>
          <MenuDivider />
          {options.map(o => (
            <MenuItem key={o} onClick={() => { onChange(o); setOpen(false); }}>{o}</MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

export function SortDropdown({ sort, onChange }) {
  const [open, setOpen] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const t = setTimeout(() => document.addEventListener('click', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const cleared = !sort.key;
  const label = cleared ? 'Phase order' : (SORT_DEFS.find(s => s.key === sort.key) || SORT_DEFS[0]).label;
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div onClick={() => setOpen(o => !o)} style={{
        height: 24, padding: '0 8px',
        border: '1px solid var(--border-2)', borderRadius: 6,
        background: 'var(--bg-surface)',
        display: 'inline-flex', alignItems: 'center', gap: 4,
        fontSize: 13, color: 'var(--text-1)', cursor: 'pointer',
      }}>{label}</div>
      {open && (
        <div style={{
          position: 'absolute', top: 28, right: 0,
          minWidth: 160, background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
          padding: '4px 0', zIndex: 60,
        }}>
          <MenuItem onClick={() => { onChange({ key: '', dir: sort.dir }); setOpen(false); }}>
            {cleared ? '* ' : '  '}Phase order (default)
          </MenuItem>
          <MenuDivider />
          {SORT_DEFS.map(s => (
            <MenuItem key={s.key} onClick={() => { onChange({ key: s.key, dir: s.key === 'status' ? 'asc' : sort.dir }); setOpen(false); }}>
              {s.key === sort.key ? '* ' : '  '}{s.label}
            </MenuItem>
          ))}
        </div>
      )}
    </div>
  );
}

export function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

export function GambleMark({ size = 22 }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: 'block', flexShrink: 0 }}>
      <path d="M 78 30 A 32 32 0 1 0 78 70 L 78 54 L 58 54" stroke="#F4C81E" strokeWidth="14" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M 38 12 C 38 12 24 32 24 44 C 24 52 30 58 38 58 C 46 58 52 52 52 44 C 52 32 38 12 38 12 Z" fill="#3FA0DC"/>
    </svg>
  );
}

// Render the GambleMark vector into a PNG ArrayBuffer at a given
// pixel size. Used to push a runtime tray icon to main process.
// Drawing is via an inline SVG -> Image -> canvas pipeline; works in
// Chromium (Electron renderer) without extra deps.
// IMPORTANT: Keep the path d="..." strings IN SYNC with GambleMark above.
async function renderGambleMarkPng(size = 32) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="' + size + '" height="' + size + '">' +
      '<path d="M 78 30 A 32 32 0 1 0 78 70 L 78 54 L 58 54" stroke="#F4C81E" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M 38 12 C 38 12 24 32 24 44 C 24 52 30 58 38 58 C 46 58 52 52 52 44 C 52 32 38 12 38 12 Z" fill="#3FA0DC"/>' +
    '</svg>';
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, 0, 0, size, size);
    return await new Promise((resolve) => {
      canvas.toBlob(async (b) => {
        if (!b) { resolve(null); return; }
        resolve(await b.arrayBuffer());
      }, 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- data adapters ---------- */
// phaseFor / phaseForOrder / phaseStyle / daysSince / ageLevelFor /
// ageLevelForDays / ageDaysFor moved to ./orders-logic.js (imported at top).

export function typeLetter(type) {
  const t = String(type || '').toLowerCase();
  const hasP = /plumb/.test(t);
  const hasH = /hvac|heat|cool|furnace/.test(t);
  if (hasP && hasH) return 'PH';     // dual job (Plumbing + HVAC)
  if (hasP)         return 'P';
  if (hasH)         return 'H';
  if (/electric/.test(t)) return 'E';
  return (type || '?').slice(0, 1).toUpperCase();
}

// Some legacy WOs have city baked into o.address ("412 Hillcrest Dr, Durham, NC")
// AND a separate o.city. Strip the city suffix if present so we don't double-print.
export function splitAddress(o) {
  const full = String(o.address || '').trim();
  const city = String(o.city || '').trim();
  if (city) {
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(',\\s*' + escaped + '(?:,\\s*[A-Za-z]{2})?\\s*$', 'i');
    return { addr: full.replace(re, '').trim().replace(/,\s*$/, ''), city };
  }
  // No explicit city: try to parse trailing ", City, ST" out of the address
  const m = full.match(/^(.*?),\s*([^,]+?)(?:,\s*[A-Za-z]{2})?\s*$/);
  if (m) return { addr: m[1].trim(), city: m[2].trim() };
  return { addr: full, city: '' };
}

function toDisplayRow(o) {
  const { addr, city } = splitAddress(o);
  const flags = [];
  if (o.emergency) flags.push('emergency');
  if (o.warranty)  flags.push('warranty');
  if (o.returnPending) flags.push('returnPending');
  const ageDays = ageDaysFor(o);
  return {
    wo: o.id,
    addr,
    city,
    flags,
    pm: String(o.pm || '').toUpperCase(),
    type: typeLetter(o.type),
    tech: o.tech || '',
    ageDays,
    age: ageDays == null ? null : ageDays + 'd',
    ageLevel: ageLevelForDays(ageDays),
    status: o.status || 'Open',
    tab: o.tab || 'active',
    scheduled: !!(o.schedule && o.schedule.date),
    schedDate: o.schedule ? o.schedule.date : null,
    schedStart: o.schedule ? o.schedule.start : null,
    createdTs: o.dateCreated ? new Date(String(o.dateCreated)+'T00:00:00').getTime() : 0,
    lastNoteTs: (Array.isArray(o.noteCards) ? o.noteCards : []).reduce((m, c) => Math.max(m, c.ts || 0), 0),
  };
}

function groupByPhase(orders, phases) {
  const list = Array.isArray(phases) && phases.length ? phases : DEFAULT_PHASES;
  const buckets = {};
  for (const o of orders) {
    const name = phaseForOrder(o, list);
    (buckets[name] = buckets[name] || []).push(toDisplayRow(o));
  }
  const groups = [];
  for (const p of list) {
    if (buckets[p.name] && buckets[p.name].length) {
      // Default within-phase ordering (priority, highest first):
      //   1) status position in the phase's status list (Settings -> Workflow)
      //   2) city, alphabetical (A-Z) -- groups same-city WOs together
      //   3) days open (days-in-stage), oldest first (within a city)
      //   4) tie-break: newest first by createdTs
      // A user-applied sort (sortRows) or filter overrides this downstream.
      const orderMap = new Map((p.statuses || []).map((s, i) => [s, i]));
      const rows = [...buckets[p.name]].sort((a, b) => {
        const ai = orderMap.has(a.status) ? orderMap.get(a.status) : Infinity;
        const bi = orderMap.has(b.status) ? orderMap.get(b.status) : Infinity;
        if (ai !== bi) return ai - bi;
        const c = String(a.city || '').localeCompare(String(b.city || ''));
        if (c !== 0) return c;
        const ad = (b.ageDays ?? -1) - (a.ageDays ?? -1);
        if (ad !== 0) return ad;
        return (b.createdTs || 0) - (a.createdTs || 0);
      });
      groups.push({ phase: p.name, count: rows.length, rows, dot: p.fg });
    }
  }
  // Catch any unrecognized bucket names
  for (const name of Object.keys(buckets)) {
    if (!list.find(p => p.name === name)) {
      groups.push({ phase: name, count: buckets[name].length, rows: buckets[name], dot: 'var(--text-2)' });
    }
  }
  return groups;
}

export function sortRows(rows, sort, phaseStatuses) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const k = sort.key;
  return [...rows].sort((a, b) => {
    if (k === 'age')  return (((a.ageDays ?? -1) - (b.ageDays ?? -1)) * dir);
    if (k === 'wo') {
      const ai = parseInt(String(a.wo).replace(/[^0-9]/g, ''), 10) || 0;
      const bi = parseInt(String(b.wo).replace(/[^0-9]/g, ''), 10) || 0;
      return (ai - bi) * dir;
    }
    if (k === 'status') {
      // Ascending in settings/phase order (Open -> Closed) by default; dir flips it.
      // Matches phase-grouping sort (:659) and Itinerary unscheduled pool (:5587)
      // so all status-based sorts across the app agree on direction.
      const orderMap = new Map((phaseStatuses || []).map((s, i) => [s, i]));
      const ai = orderMap.has(a.status) ? orderMap.get(a.status) : Infinity;
      const bi = orderMap.has(b.status) ? orderMap.get(b.status) : Infinity;
      if (ai !== bi) return (ai - bi) * dir;
      return ((b.createdTs || 0) - (a.createdTs || 0)) * dir;
    }
    if (k === 'lastNote') return ((a.lastNoteTs || 0) - (b.lastNoteTs || 0)) * dir;
    return ((a.createdTs || 0) - (b.createdTs || 0)) * dir;
  });
}

// "Days in stage" = days since the most recent history entry containing 'status',
// fallback to dateCreated. Used for the detail pane and several alert rules.
function daysInStage(o) {
  const h = Array.isArray(o.history) ? o.history : [];
  for (let i = h.length - 1; i >= 0; i--) {
    const a = String(h[i].action || '').toLowerCase();
    if (a.includes('status')) {
      return Math.floor((Date.now() - h[i].ts) / 86400000);
    }
  }
  return daysSince(o.dateCreated);
}

function daysSinceAnyActivity(o) {
  const h = Array.isArray(o.history) ? o.history : [];
  const last = h.length ? h[h.length - 1].ts : null;
  if (last) return Math.floor((Date.now() - last) / 86400000);
  return daysSince(o.dateCreated);
}

function fmtCreated(d) {
  if (!d) return '—';
  const date = new Date(String(d) + 'T00:00:00');
  if (isNaN(date.getTime())) return String(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtHistTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const m = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const h = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${m} ${h}:${mn}`;
}

function fmtNoteTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const m = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let h = d.getHours();
  const mn = String(d.getMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${m} · ${h}:${mn} ${ap}`;
}

function todayIso() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Mechanism ported from legacy nextId(): scan numeric portion of existing ids, +1, zero-padded.
export function nextWOId(orders, customId) {
  if (customId && customId.trim()) return customId.trim();
  const nums = (orders || []).map(o => parseInt(String(o.id || '').replace(/[^0-9]/g, ''), 10) || 0);
  return 'WO-' + (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
}

// Mechanism ported from legacy formatPhone().
// formatPhone moved to ./utils.js (imported at top).

export function toDetailData(o) {
  if (!o) return null;
  const { addr, city } = splitAddress(o);
  const flags = [];
  if (o.emergency) flags.push('emergency');
  if (o.warranty)  flags.push('warranty');
  if (o.returnPending) flags.push('returnPending');
  const tab = o.tab || 'active';
  let nextAction = null;
  if (!o.deleted) {
    // change11: tabs are { active, complete, sent, trash }. Active primary
    // action is Mark Complete; Complete primary is Send to Invoice; Sent
    // primary is Reopen (Invoices module DetailPane).
    if (tab === 'active')        nextAction = 'Mark Complete';
    else if (tab === 'complete') nextAction = 'Send to Invoice';
    else if (tab === 'sent')     nextAction = 'Reopen';
  }
  return {
    wo: o.id,
    addr,
    city,
    flags,
    status: o.status || 'Open',
    daysInStage: daysInStage(o),
    ageDays: ageDaysFor(o),
    pm: String(o.pm || '').toUpperCase(),
    type: typeLetter(o.type),
    typeLabel: o.type || '',
    tech: o.tech || '—',
    created: fmtCreated(o.dateCreated),
    propId: o.propertyId || '—',
    bid: o.bidAmount
      ? (String(o.bidAmount).startsWith('$') ? o.bidAmount : '$' + o.bidAmount)
      : '—',
    phone: o.phone || '—',
    contactName: o.contactName || '',
    contacts: Array.isArray(o.contacts) ? o.contacts : [],
    notes: (() => {
      const cards = Array.isArray(o.noteCards) ? o.noteCards.slice() : [];
      // Stable sort: pinned first, then newest ts first.
      cards.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
      const list = cards.map(n => ({
        id: n.id, type: n.type || 'Note',
        time: fmtNoteTime(n.ts), body: n.body || '',
        pinned: !!n.pinned, edited: !!n.edited,
      }));
      return list;
    })(),
    activity: (Array.isArray(o.history) ? o.history : [])
      .slice().reverse()
      .map(h => fmtHistTime(h.ts) + ' — ' + (h.action || '') + (h.detail ? ': ' + h.detail : '')),
    nextAction,
    tab: o.tab || 'active',
    schedule: o.schedule || null,
    raw: o,
  };
}

// Defaults match the seven categories listed in Settings → Alerts.
// These become persisted/configurable in a later pass.
// Slice 2 (#3): overdue-schedule indicator. A scheduled WO whose start time is
// more than thresholdMinutes in the past gets its schedule text and map marker
// border recolored. OVERDUE_CFG is a render-time snapshot assigned by App each
// render (no React.memo anywhere, so every consumer re-renders on settings
// change); the Maps marker effect additionally takes overdueCfg/overdueTick as
// props because markers are built inside a useEffect, not during render.
export const DEFAULT_OVERDUE_CFG = { thresholdMinutes: 60, textColor: '#ef4444', borderColor: '#ef4444' };
export let OVERDUE_CFG = DEFAULT_OVERDUE_CFG;
export function isOverdueSched(date, start) {
  if (!date) return false;
  const t = new Date(date + 'T' + (start || '00:00') + ':00').getTime();
  return isFinite(t) && Date.now() - t > OVERDUE_CFG.thresholdMinutes * 60000;
}

// haversineKm + roadKm (+ ROAD_FACTOR) moved to ./utils.js (imported at top).

// Routing tunables. weights apply to the composite "Suggested" score; the map
// turns a tech's low/med/high job-type preference into a numeric multiplier.
export const DEFAULT_ROUTING_WEIGHTS = { dist: 1, city: 0.5, unfilledCity: 0.3, type: 0.4 };
const ROUTE_WEIGHT_MAP = { low: 0.33, med: 0.66, high: 1 };

// Pure scorer. Given the anchor WO (the one being scheduled), the chosen tech,
// the candidate pool, a geo lookup, techJobTypes + weights, returns ranked
// arrays for the two tabs plus a skipped count (candidates with no geocode).
//   anchorGeo = { lat, lon } | null ; geoOf(id) -> { lat, lon } | null
//   scheduledIds = Set of WO ids already on the itinerary (excluded)
function scoreCandidates({ anchor, anchorGeo, candidates, geoOf, tech, techJobTypes, weights, scheduledIds, cityCounts }) {
  if (!anchorGeo) return { suggested: [], closeBy: [], skipped: 0, noAnchor: true };
  const w = { ...DEFAULT_ROUTING_WEIGHTS, ...(weights || {}) };
  const jt = (techJobTypes && techJobTypes[tech]) || {};
  let skipped = 0;
  const rows = [];
  for (const c of candidates) {
    if (!c || c.id === anchor.id) continue;
    if (scheduledIds && scheduledIds.has(c.id)) continue;
    const g = geoOf(c.id);
    if (!g || g.lat == null) { skipped++; continue; }
    const km = roadKm(anchorGeo.lat, anchorGeo.lon, g.lat, g.lon);
    const sameCity = !!(c.city && anchor.city && String(c.city).toLowerCase() === String(anchor.city).toLowerCase());
    const cityUnfilled = sameCity && cityCounts && (cityCounts[String(c.city).toLowerCase()] || 0) > 1;
    const cell = jt[c.type];
    const typeScore = (cell && cell.selected) ? (ROUTE_WEIGHT_MAP[cell.weight] || ROUTE_WEIGHT_MAP.med) : 0;
    const score =
        w.dist * (1 / Math.max(km, 0.1))
      + w.city * (sameCity ? 1 : 0)
      + w.unfilledCity * (cityUnfilled ? 1 : 0)
      + w.type * typeScore;
    rows.push({ id: c.id, km, score, selectable: !!(cell && cell.selected) });
  }
  const suggested = rows.filter(r => r.selectable).slice().sort((a, b) => b.score - a.score);
  const closeBy = rows.slice().sort((a, b) => a.km - b.km);
  return { suggested, closeBy, skipped, noAnchor: false };
}

export const DEFAULT_ALERT_THRESHOLDS = {
  emergencyUnscheduled:        1,
  stale:                       14,
  bidOutNoResponse:            7,
  partsPastEta:                10,
  approvedUnscheduled:         3,
  readyToClose:                5,
  approvedCompleteNotInvoiced: 3,
};

function computeAlerts(orders, thresholds) {
  const t = thresholds || DEFAULT_ALERT_THRESHOLDS;
  const out = [];
  for (const o of orders) {
    if (o.deleted) continue;
    if ((o.tab || 'active') !== 'active') continue;
    const s = String(o.status || '').toLowerCase().trim();
    const ageStage = daysInStage(o);
    const ageActivity = daysSinceAnyActivity(o);
    const { addr, city } = splitAddress(o);
    const fullAddr = addr + (city ? ', ' + city : '');
    let entry = null;
    if (o.emergency && (s === 'open' || s === '') && ageStage >= t.emergencyUnscheduled) {
      entry = { kind: 'emergency', blurb: `Emergency, still in Open — needs dispatch · ${ageStage} days in stage` };
    } else if (s.startsWith('bid submitted') && ageStage >= t.bidOutNoResponse) {
      entry = { kind: 'stale', blurb: `Bid out ${ageStage} days, no response from ${o.pm || 'Client'}` };
    } else if (s.startsWith('parts pending') && ageStage >= t.partsPastEta) {
      entry = { kind: 'parts', blurb: `Parts pending ${ageStage} days — vendor delay?` };
    } else if (s.startsWith('bid approved - return') && ageStage >= t.approvedUnscheduled) {
      entry = { kind: 'parts', blurb: `Approved (return) ${ageStage} days — needs scheduling` };
    } else if (s.startsWith('pending-complete') && ageStage >= t.readyToClose) {
      entry = { kind: 'closing', blurb: `Pending-complete ${ageStage} days — ready to invoice` };
    } else if (s.startsWith('bid approved - complete') && ageStage >= t.approvedCompleteNotInvoiced) {
      entry = { kind: 'closing', blurb: `Approved-complete ${ageStage} days — not yet invoiced` };
    } else if (ageActivity >= t.stale) {
      entry = { kind: 'stale', blurb: `No activity in ${ageActivity} days` };
    }
    if (entry) out.push({ ...entry, wo: o.id, addr: fullAddr });
  }
  return out;
}

// useWorkOrders (data layer) carved out to ./data.js.

/* ---------- modal + form primitives ---------- */

export function Modal({ open, onClose, title, children, width = 560 }) {
  // Intentionally NO backdrop-click or Escape close: modals hold entered data
  // (imports, edits) and must close only via X / Cancel / Create-Done so an
  // accidental outside click can't discard the user's work.
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 400,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width, maxWidth: '94vw', maxHeight: '90vh',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-1)',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          color: 'var(--text-1)',
        }}
      >
        <div style={{
          padding: '16px 22px',
          borderBottom: '1px solid var(--border-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 18, padding: 4,
          }}>{'✕'}</button>
        </div>
        <div style={{ padding: '18px 22px', overflow: 'auto', minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <div style={{ fontSize: 12, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

// Per-WO command center overlay. Replaces the old inline DetailPane column: the
// WO list now spans full width and selecting a WO opens this. Large centered
// panel = the existing DetailPane (left, its own header doubles as the sub-module
// header) + a right rail for the map/itinerary insets (added in later slices).
// Esc and the X button close; backdrop click does NOT (DetailPane holds an
// unsaved note composer/draft). Mounted only when exactly one WO is selected, so
// the later Leaflet inset has exactly one live instance. `detail`/`rightRail` are
// passed as elements so this shell stays presentational.
function CommandCenter({ onClose, topBar, detail, rightRail }) {
  // Esc closes. Arrow-key prev/next is owned by ListPane's window-level handler
  // (it holds the visible order and stays mounted under the overlay), which
  // restacks selectedWO; duplicating it here would double-step. The top bar's
  // prev/next buttons cover pointer users.
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 1100, maxWidth: '94vw', height: '80vh', maxHeight: '90vh',
        background: 'var(--bg-canvas)', border: '1px solid var(--border-1)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative',
      }}>
        {topBar}
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: '1.6 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {detail}
          </div>
          <div style={{
            flex: '1 1 0', minWidth: 320, maxWidth: 380,
            borderLeft: '1px solid var(--border-1)', background: 'var(--bg-surface)',
            display: 'flex', flexDirection: 'column', overflowY: 'auto',
            // Contain the Leaflet inset's internal panes (z 200-700) so they stop
            // escaping into the modal stacking context and covering the top bar's
            // Nearby/Recent dropdowns (prior z-index bump on the bar alone failed).
            isolation: 'isolate',
          }}>
            {rightRail}
          </div>
        </div>
        <button onClick={onClose} title="Close (Esc)" style={{
          position: 'absolute', top: 8, right: 10, zIndex: 30,
          width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border-2)',
          background: 'var(--bg-surface)', color: 'var(--text-2)', cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 16, lineHeight: 1,
        }}>{'✕'}</button>
      </div>
    </div>
  );
}

// Settings shown as a large centered popup (N4) instead of the cramped right
// column, so tabs get room and don't cut off. Wraps the existing SettingsDrawer
// (a full-height section). Esc or the drawer's own Close button exits. Nested
// editors (PMsEditor etc.) are their own z-400 overlays rendered inside -> paint
// above this one.
function SettingsOverlay({ onClose, children }) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 400,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 1120, maxWidth: '95vw', height: '85vh', maxHeight: '92vh',
        background: 'var(--bg-canvas)', border: '1px solid var(--border-1)',
        borderRadius: 12, boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        overflow: 'hidden', display: 'flex',
      }}>
        {children}
      </div>
    </div>
  );
}

const ccBtnStyle = (accent) => ({
  height: 24, padding: '0 8px', border: '1px solid var(--border-2)', borderRadius: 6,
  background: 'var(--bg-surface-2)', color: accent || 'var(--text-1)', fontFamily: 'inherit',
  fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
});

// Small dropdown of WO ids (siblings / nearby / recents) for the command-center
// top bar. Hidden when empty. Picking an id swaps the overlay to that WO.
function CCDropdown({ label, items, onPick }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  if (!items || !items.length) return null;
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={ccBtnStyle()}>{label} ({items.length}) ▾</button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 200,
          maxHeight: 300, overflowY: 'auto', background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)', padding: '4px 0', zIndex: 1000,
        }}>
          {items.map(it => (
            <div key={it.id} onClick={() => { setOpen(false); onPick(it.id); }}
              style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{it.primary || it.id}</span>
              {it.sub && <span style={{ color: 'var(--text-3)' }}>{it.sub}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Command-center Folder action dropdown (#5). Same look as CCDropdown but fires
// WO folder actions instead of swapping WOs: create the root folder (+bid sheet),
// create a dated revisit subfolder, or open the existing folder.
function FolderMenu({ onAction }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const item = (label, action) => (
    <div onClick={() => { setOpen(false); onAction && onAction(action); }}
      style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--text-1)' }}>{label}</div>
  );
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={ccBtnStyle()}>Folder ▾</button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4, minWidth: 200,
          background: 'var(--bg-surface)', border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)', padding: '4px 0', zIndex: 1000,
        }}>
          {item('Create folder', 'createFolder')}
          {item('Create dated subfolder', 'createSubfolder')}
          {item('View folder', 'openFolder')}
        </div>
      )}
    </div>
  );
}

// Horizontal workflow-phase stepper. Highlights the phase holding the WO's
// status; phases before it read as done (accent connector), after as pending.
function PhaseStepper({ phases, current }) {
  if (!phases || !phases.length) return null;
  const idx = phases.findIndex(p => p.name === current);
  return (
    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
      {phases.map((p, i) => {
        const cur = i === idx;
        const reached = idx >= 0 && i <= idx;
        return (
          <React.Fragment key={p.name}>
            {i > 0 && <span style={{ width: 12, height: 2, flexShrink: 0, background: reached ? 'var(--accent)' : 'var(--border-2)' }} />}
            <span title={p.name} style={{
              fontSize: 11, fontWeight: cur ? 700 : 500, padding: '2px 6px', borderRadius: 999,
              color: cur ? 'var(--accent)' : (idx >= 0 && i < idx) ? 'var(--text-2)' : 'var(--text-3)',
              border: '1px solid ' + (cur ? 'var(--accent)' : 'transparent'),
              whiteSpace: 'nowrap',
            }}>{p.name}</span>
          </React.Fragment>
        );
      })}
    </div>
  );
}

// Command-center top bar: prev/next + position, phase stepper, sibling/nearby/
// recent jump dropdowns, and promoted actions (Edit / Folder / Capture).
function CCTopBar({ index, total, onPrev, onNext, phases, phaseName, siblings, nearby, recents, onPick, onEdit, onAction, canCapture, woId }) {
  const navBtn = (disabled, on, glyph) => (
    <button disabled={disabled} onClick={on} style={{
      width: 26, height: 24, border: '1px solid var(--border-2)', borderRadius: 6,
      background: 'var(--bg-surface-2)', color: disabled ? 'var(--text-3)' : 'var(--text-1)',
      cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12, lineHeight: 1,
      opacity: disabled ? 0.5 : 1,
    }}>{glyph}</button>
  );
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 44px 8px 14px', borderBottom: '1px solid var(--border-1)',
      background: 'var(--bg-surface)', flexShrink: 0,
      position: 'relative', zIndex: 20, // own stacking layer above the Leaflet inset
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {navBtn(index <= 0, onPrev, '◀')}
        {navBtn(index < 0 || index >= total - 1, onNext, '▶')}
        {index >= 0 && <span style={{ fontSize: 12, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{index + 1} / {total}</span>}
      </div>
      <PhaseStepper phases={phases} current={phaseName} />
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <CCDropdown label="Siblings" items={siblings} onPick={onPick} />
        <CCDropdown label="Nearby" items={nearby} onPick={onPick} />
        <CCDropdown label="Recent" items={recents} onPick={onPick} />
        {onEdit && <button onClick={() => onEdit(woId)} style={ccBtnStyle()}>Edit</button>}
        <button onClick={() => onAction && onAction('invoice')} style={ccBtnStyle()}>Invoice</button>
        <FolderMenu onAction={onAction} />
        {canCapture && <button onClick={() => onAction && onAction('capture')} style={ccBtnStyle('var(--accent)')}>Capture</button>}
      </div>
    </div>
  );
}

// Ctrl/Cmd+K quick-jump palette. Fuzzy match on WO#, address, city; Enter or
// click opens the command center for the match. Distinct from the header search
// (which filters the list in place) -- this jumps without changing the list.
function QuickJump({ open, orders, onClose, onPick }) {
  const [q, setQ] = React.useState('');
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    setQ('');
    const t = setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 0);
    return () => clearTimeout(t);
  }, [open]);
  if (!open) return null;
  const query = q.trim().toLowerCase();
  const results = query ? (orders || []).filter(o => !o.deleted).filter(o => {
    const { addr, city } = splitAddress(o);
    return String(o.id).toLowerCase().includes(query)
      || (addr || '').toLowerCase().includes(query)
      || (city || '').toLowerCase().includes(query);
  }).slice(0, 8) : [];
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 500,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 520, maxWidth: '92vw', background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)', borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)', overflow: 'hidden',
      }}>
        <input
          ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            else if (e.key === 'Enter' && results[0]) onPick(results[0].id);
          }}
          placeholder="Jump to work order — number, address, city"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '14px 16px',
            border: 'none', borderBottom: '1px solid var(--border-1)',
            background: 'transparent', color: 'var(--text-1)', fontFamily: 'inherit',
            fontSize: 15, outline: 'none',
          }}
        />
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {results.map(o => {
            const { addr, city } = splitAddress(o);
            return (
              <div key={o.id} onClick={() => onPick(o.id)} style={{
                padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border-2)',
                display: 'flex', gap: 10, alignItems: 'baseline',
              }}>
                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{o.id}</span>
                <span style={{ color: 'var(--text-2)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {addr}{city ? ', ' + city : ''}
                </span>
              </div>
            );
          })}
          {query && results.length === 0 && (
            <div style={{ padding: '14px 16px', color: 'var(--text-3)', fontSize: 13 }}>No matches.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// Text-input modal. Replaces window.prompt(), which Electron does not support.
// state = { title, initial?, placeholder?, submitLabel?, onSubmit(value) } | null
function NamePromptModal({ state, onClose }) {
  const [value, setValue] = React.useState('');
  const inputRef = React.useRef(null);
  React.useEffect(() => { setValue(state ? (state.initial || '') : ''); }, [state]);
  // Explicit focus — autoFocus on a Modal-mounted child can be cleared in the
  // same React-18 commit, leaving the field visually focused but unresponsive.
  React.useEffect(() => {
    if (state && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [state]);
  if (!state) return null;
  const submit = () => {
    const v = value.trim();
    if (!v) return;
    state.onSubmit(v);
    onClose();
  };
  return (
    <Modal open={!!state} onClose={onClose} title={state.title} width={420}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={state.placeholder || ''}
        style={fieldInputStyle}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={onClose} style={{
          fontFamily: 'inherit', fontSize: 13, padding: '6px 12px',
          background: 'var(--bg-surface-2)', color: 'var(--text-2)',
          border: '1px solid var(--border-2)', borderRadius: 6, cursor: 'pointer',
        }}>Cancel</button>
        <button onClick={submit} style={{
          fontFamily: 'inherit', fontSize: 13, padding: '6px 12px',
          background: 'var(--accent)', color: 'var(--accent-fg)',
          border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
        }}>{state.submitLabel || 'Save'}</button>
      </div>
    </Modal>
  );
}

// App-wide inline rename field. Fixes the chronic "uneditable field" bug: a
// conditionally-rendered input could receive a spurious blur right after mount
// (React-18 focus timing), which fired onBlur -> commit -> close before the user
// typed a character, so the field looked uneditable. Owning the value locally
// keeps the cursor stable across parent re-renders; we focus+select on mount and
// SWALLOW a blur that lands on nothing within the mount race window (refocus
// instead of closing). Commit on Enter or a genuine blur; cancel on Escape.
// Used by every inline editor (phases, statuses, PMs, types, techs, ...).
// InlineEdit moved to ./primitives.jsx (imported at top).

const fieldInputStyle = {
  width: '100%',
  padding: '7px 9px',
  border: '1px solid var(--border-2)',
  borderRadius: 6,
  background: 'var(--bg-surface-2)',
  color: 'var(--text-1)',
  fontFamily: 'inherit', fontSize: 13,
  outline: 'none',
};

function WOForm({ initial, mode, onCancel, onSubmit, data }) {
  const pms      = data?.pms      || DEFAULT_PMS;
  // 'Other' is not an allowed job type — filter it from legacy data lists.
  const types    = (data?.types || DEFAULT_TYPES).filter(t => String(t).toLowerCase() !== 'other');
  const techs    = data?.techs    || DEFAULT_TECHS;
  const statuses = data?.statuses || DEFAULT_STATUSES;

  const seedContacts = () => {
    if (Array.isArray(initial?.contacts) && initial.contacts.length) {
      return initial.contacts.map(c => ({ role: c.role || '', name: c.name || '', phone: c.phone || '' }));
    }
    return [{
      role: initial?.contactName || initial?.phone ? 'PRIMARY CONTACT' : '',
      name: initial?.contactName || '',
      phone: initial?.phone || '',
    }];
  };

  const [form, setForm] = React.useState(() => ({
    id:           initial?.id || '',
    pm:           initial?.pm || pms[0]?.name || '',
    type:         initial?.type || types[0] || '',
    address:      initial?.address || '',
    city:         initial?.city || '',
    contacts:     seedContacts(),
    tech:         initial?.tech || '',
    status:       initial?.status || statuses[0] || 'Open',
    notes:        initial?.notes || '',
    dateCreated:  initial?.dateCreated || todayIso(),
    propertyId:   initial?.propertyId || '',
    bidAmount:    initial?.bidAmount || '',
    emergency:    !!initial?.emergency,
    warranty:     !!initial?.warranty,
    returnPending: !!initial?.returnPending,
  }));

  const set = (k) => (e) => {
    const v = e && e.target && (e.target.type === 'checkbox') ? e.target.checked : (e?.target?.value ?? e);
    setForm(f => ({ ...f, [k]: v }));
  };

  const updateContact = (i, key, val) => {
    setForm(f => ({ ...f, contacts: f.contacts.map((c, idx) => idx === i ? { ...c, [key]: val } : c) }));
  };
  const addContact = () => {
    setForm(f => ({ ...f, contacts: [...f.contacts, { role: '', name: '', phone: '' }] }));
  };
  const removeContact = (i) => {
    setForm(f => ({ ...f, contacts: f.contacts.filter((_, idx) => idx !== i) }));
  };
  const movePrimary = (i) => {
    setForm(f => {
      if (i <= 0 || i >= f.contacts.length) return f;
      const next = f.contacts.slice();
      const [picked] = next.splice(i, 1);
      // Promoted row becomes PRIMARY CONTACT if it had no explicit role.
      if (!picked.role) picked.role = 'PRIMARY CONTACT';
      next.unshift(picked);
      return { ...f, contacts: next };
    });
  };

  const submit = (e) => {
    e.preventDefault();
    const cleaned = form.contacts
      .map(c => ({ role: c.role.trim(), name: c.name.trim(), phone: formatPhone(c.phone) }))
      .filter(c => c.name || c.phone);
    const primary = cleaned[0] || { role: '', name: '', phone: '' };
    onSubmit({
      ...form,
      contacts:    cleaned,
      contactName: primary.name,
      phone:       primary.phone,
    });
  };

  return (
    <form onSubmit={submit}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <FormField label="WO #" span={1}>
          <input
            style={fieldInputStyle}
            value={form.id}
            placeholder={mode === 'add' ? 'Auto-generated if blank' : ''}
            onChange={set('id')}
          />
        </FormField>
        <FormField label="Property ID" span={1}>
          <input style={fieldInputStyle} value={form.propertyId} onChange={set('propertyId')} />
        </FormField>

        <FormField label="Client" span={1}>
          <select style={fieldInputStyle} value={form.pm} onChange={set('pm')}>
            {pms.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </FormField>
        <FormField label="Type" span={1}>
          <select style={fieldInputStyle} value={form.type} onChange={set('type')}>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </FormField>

        <FormField label="Address" span={2}>
          <input style={fieldInputStyle} value={form.address} onChange={set('address')} required />
        </FormField>

        <FormField label="City" span={1}>
          <input style={fieldInputStyle} value={form.city} onChange={set('city')} />
        </FormField>
        <FormField label={'Contacts (' + form.contacts.length + ')'} span={2}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {form.contacts.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 130px auto', gap: 6, alignItems: 'center' }}>
                <input
                  style={fieldInputStyle}
                  value={c.role}
                  onChange={(e) => updateContact(i, 'role', e.target.value)}
                  placeholder={i === 0 ? 'PRIMARY CONTACT' : 'Role (optional)'}
                />
                <input
                  style={fieldInputStyle}
                  value={c.name}
                  onChange={(e) => updateContact(i, 'name', e.target.value)}
                  placeholder="Contact name"
                />
                <input
                  style={fieldInputStyle}
                  value={c.phone}
                  onChange={(e) => updateContact(i, 'phone', e.target.value)}
                  onBlur={(e) => updateContact(i, 'phone', formatPhone(e.target.value))}
                  placeholder="(919) 555-0100"
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  {i > 0 && (
                    <button type="button" onClick={() => movePrimary(i)} title="Make primary"
                      style={{ ...miniBtnStyle, padding: '0 7px' }}>{'★'}</button>
                  )}
                  {form.contacts.length > 1 && (
                    <button type="button" onClick={() => removeContact(i)} title="Remove contact"
                      style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px' }}>{'✕'}</button>
                  )}
                </div>
              </div>
            ))}
            <div>
              <button type="button" onClick={addContact} style={{ ...miniBtnStyle, padding: '2px 10px', fontSize: 12 }}>+ Add contact</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>First row is the primary contact. Phone formats on blur.</div>
          </div>
        </FormField>

        <FormField label="Tech" span={1}>
          <input
            list="tt-techs"
            style={fieldInputStyle}
            value={form.tech}
            onChange={set('tech')}
            placeholder="Unassigned"
          />
          <datalist id="tt-techs">{techs.map(t => <option key={t} value={t} />)}</datalist>
        </FormField>
        <FormField label="Status" span={1}>
          <select style={fieldInputStyle} value={form.status} onChange={set('status')}>
            {statuses.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </FormField>

        <FormField label="Date created" span={1}>
          <input type="date" style={fieldInputStyle} value={form.dateCreated} onChange={set('dateCreated')} />
        </FormField>
        <FormField label="Bid amount" span={1}>
          <input style={fieldInputStyle} value={form.bidAmount} onChange={set('bidAmount')} placeholder="$0.00" />
        </FormField>

        <FormField label="Flags" span={2}>
          <div style={{ display: 'flex', gap: 18, fontSize: 13 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.emergency} onChange={set('emergency')} />
              Emergency
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.warranty} onChange={set('warranty')} />
              Warranty
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }} title="Visited, bid not entered; needs a return before re-booking">
              <input type="checkbox" checked={form.returnPending} onChange={set('returnPending')} />
              Return pending
            </label>
          </div>
        </FormField>

        <FormField label="More Information" span={2}>
          <textarea
            rows={3}
            style={{ ...fieldInputStyle, resize: 'vertical', minHeight: 60 }}
            value={form.notes}
            onChange={set('notes')}
          />
        </FormField>
      </div>

      <div style={{
        display: 'flex', justifyContent: 'flex-end', gap: 8,
        marginTop: 16, paddingTop: 14,
        borderTop: '1px solid var(--border-1)',
      }}>
        <ActionBtn onClick={onCancel}>Cancel</ActionBtn>
        <button type="submit" style={{
          height: 30, padding: '0 14px',
          border: '1px solid var(--accent)',
          background: 'var(--accent)', color: 'var(--accent-fg)',
          borderRadius: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>{mode === 'add' ? 'Create' : 'Save'}</button>
      </div>
    </form>
  );
}

export function MenuItem({ onClick, danger, disabled, children }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '7px 12px',
        fontSize: 13,
        color: disabled ? 'var(--text-3)' : danger ? 'var(--flag-emergency)' : 'var(--text-1)',
        background: (hover && !disabled) ? 'var(--bg-hover)' : 'transparent',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        userSelect: 'none',
      }}
    >{children}</div>
  );
}

export function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />;
}

export function MenuCaption({ children }) {
  return (
    <div style={{
      padding: '4px 12px', fontSize: 11, color: 'var(--text-3)',
      textTransform: 'uppercase', letterSpacing: '0.04em',
    }}>{children}</div>
  );
}

// Shared WO right-click menu. Rendered by ListPane (row right-click) and
// DetailPane (pane right-click). Hover-to-open submenus open to the right of
// their parent row (leaflet style), with 150ms open delay and a small close
// delay that lets the pointer cross into the submenu. Layout order:
//   Edit details / Invoice / View details
//   ---
//   Set status / PM / type / tech  (submenus)
//   ---
//   Schedule actions / Add to inbox
//   ---
//   Mark (submenu: Warranty / Emergency with flag icons)
//   ---
//   Send to Trash (bottom, danger)
export function WOContextMenu({
  ctxMenu, ctxRow, bulkCount, source,
  statuses, types, techs, pms, inboxes,
  isInboxView, inboxId,
  onWoAction, onBulkSetStatus,
  onAddToInbox, onAddToNewInbox, onRemoveFromInbox,
  onSelectWO,
  onClose,
}) {
  const [activeSub, setActiveSub] = React.useState(null); // { key, rect }
  const openTimer = React.useRef(null);
  const closeTimer = React.useRef(null);
  const inSubmenu = React.useRef(false);
  const menuRef = React.useRef(null);
  const [menuPos, setMenuPos] = React.useState({ top: ctxMenu.y, left: ctxMenu.x, ready: false });
  React.useLayoutEffect(() => {
    if (!menuRef.current) return;
    const pad = 8;
    const r = menuRef.current.getBoundingClientRect();
    let top = ctxMenu.y;
    let left = ctxMenu.x;
    if (top + r.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - r.height - pad);
    }
    if (left + r.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - r.width - pad);
    }
    setMenuPos({ top, left, ready: true });
  }, [ctxMenu.x, ctxMenu.y]);

  const cancelTimers = () => {
    if (openTimer.current)  { clearTimeout(openTimer.current);  openTimer.current  = null; }
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const scheduleOpen = (key, el) => {
    cancelTimers();
    const rect = el.getBoundingClientRect();
    if (activeSub && activeSub.key === key) return;
    openTimer.current = setTimeout(() => setActiveSub({ key, rect }), 150);
  };
  const scheduleClose = () => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => {
      if (!inSubmenu.current) setActiveSub(null);
    }, 200);
  };
  const enterSubmenu = () => { inSubmenu.current = true; cancelTimers(); };
  const leaveSubmenu = () => { inSubmenu.current = false; scheduleClose(); };
  React.useEffect(() => () => cancelTimers(), []);

  const bulk = bulkCount > 1;
  const woId = ctxMenu.woId;
  const tab = ctxMenu.tab;
  const isEmergency = !!ctxRow?.emergency || ctxRow?.flags?.includes('emergency');
  const isWarranty  = !!ctxRow?.warranty  || ctxRow?.flags?.includes('warranty');
  const bulkInboxTarget = (ids) => bulk ? Array.from(ids || []) : woId;

  // change11: primary action per tab. Active=Mark Complete, Complete=Send to
  // Invoice, Sent=Reopen (safety net). No labels on trash.
  const invoiceLabel =
    tab === 'active'   ? 'Mark Complete'  :
    tab === 'complete' ? 'Send to Invoice':
    tab === 'sent'     ? 'Reopen'         : null;
  const invoiceKind =
    tab === 'active'   ? 'markComplete'  :
    tab === 'complete' ? 'sendToInvoice' :
    tab === 'sent'     ? 'reopen'        : null;

  // In the WO command-center modal (source 'detail') the field-editing items
  // (Edit details, the Mark/Invoice action, and the Set status/PM/type/tech
  // submenus) are deprecated: the modal owns those via its primary button and
  // the coming inline editing. Keep them for the list + maps menus.
  const inWoModal       = source === 'detail';
  const showEditDetails = !bulk && tab !== 'trash' && !inWoModal;
  const showInvoice     = !bulk && invoiceLabel && !inWoModal;
  const showViewDetails = source === 'list' && !bulk;
  const showSchedule    = tab === 'active' && !bulk;
  const showMark        = tab === 'active' && !bulk;
  const showCapture     = !bulk && ctxRow?.pm === 'AMH' && window.scraper && window.scraper.captureWO;
  const showRemoveInbox = isInboxView && inboxId && !bulk;

  // Folder-exists drives the "Go to folder" gray-out. null = unknown (fail-open,
  // stays enabled); the open handler still guards a missing folder with a toast.
  // address is normalized: itinerary passes the full order (address), list rows
  // carry addr. Re-checks per WO when the menu opens.
  const [folderExists, setFolderExists] = React.useState(null);
  React.useEffect(() => {
    if (bulk || tab === 'trash' || !window.woFolder || !window.woFolder.exists) { setFolderExists(null); return; }
    let alive = true;
    window.woFolder.exists({ pm: ctxRow?.pm, id: woId, address: ctxRow?.address || ctxRow?.addr })
      .then(r => { if (alive) setFolderExists(!!(r && r.exists)); })
      .catch(() => { if (alive) setFolderExists(null); });
    return () => { alive = false; };
  }, [woId, bulk, tab]);

  // Build submenu item list lazily.
  const buildSub = (key) => {
    // v4.0.1: hide LOCKED_STATUSES from the Set status submenu — they are
    // managed automatically by Mark Complete / Send to Trash, so exposing
    // them as a manual choice is misleading.
    if (key === 'status') return (statuses || DEFAULT_STATUSES).filter(s => !LOCKED_STATUSES.has(s)).map(s => ({
      label: s, onClick: () => {
        if (bulk) onBulkSetStatus && onBulkSetStatus(s);
        else onWoAction && onWoAction(woId, 'setStatus', s);
      },
    }));
    if (key === 'pm') return (pms || []).map(p => ({
      label: p.name, onClick: () => onWoAction && onWoAction(woId, 'setPm', p.name),
    }));
    if (key === 'type') return (types || []).map(t => ({
      label: t, onClick: () => onWoAction && onWoAction(woId, 'setType', t),
    }));
    if (key === 'tech') return [
      { label: 'Unassigned', onClick: () => onWoAction && onWoAction(woId, 'setTech', '') },
      ...(techs || []).map(t => ({
        label: t, onClick: () => onWoAction && onWoAction(woId, 'setTech', t),
      })),
    ];
    if (key === 'inbox') {
      const items = (inboxes || []).map(b => ({
        label: b.name || 'Untitled inbox',
        onClick: () => onAddToInbox && onAddToInbox(b.id, bulk ? Array.from(ctxMenu.bulkIds || []) : woId),
      }));
      if (!items.length) items.push({ caption: 'No inboxes yet' });
      items.push({ divider: true });
      items.push({
        label: 'New inbox...',
        onClick: () => onAddToNewInbox && onAddToNewInbox(bulk ? Array.from(ctxMenu.bulkIds || []) : woId),
      });
      return items;
    }
    if (key === 'folder') return [
      { label: 'Create folder', onClick: () => onWoAction && onWoAction(woId, 'createFolder') },
      { label: 'Create dated subfolder', onClick: () => onWoAction && onWoAction(woId, 'createSubfolder') },
      { label: 'Go to folder', disabled: folderExists === false, onClick: () => onWoAction && onWoAction(woId, 'openFolder') },
    ];
    if (key === 'mark') return [
      {
        label: isWarranty ? 'Clear Warranty' : 'Warranty',
        icon: <FlagGlyph kind="warranty" />,
        onClick: () => onWoAction && onWoAction(woId, 'toggleWarranty'),
      },
      {
        label: isEmergency ? 'Clear Emergency' : 'Emergency',
        icon: <FlagGlyph kind="emergency" />,
        onClick: () => onWoAction && onWoAction(woId, 'toggleEmergency'),
      },
    ];
    return [];
  };

  // Render submenu-parent rows as raw <div> JSX (not as a component) so React
  // keeps the DOM node identity across renders. Wrapping this in an inline
  // component caused unmount/remount on every state change, which fired a
  // spurious mouseleave mid-hover and prevented the submenu from opening.
  const parentRow = (subKey, label) => (
    <div
      key={subKey}
      onMouseEnter={(e) => scheduleOpen(subKey, e.currentTarget)}
      onMouseLeave={scheduleClose}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '7px 12px', fontSize: 13,
        background: activeSub && activeSub.key === subKey ? 'var(--bg-row-sel)' : 'transparent',
        color: 'var(--text-1)',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <span>{label}</span>
      <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{'›'}</span>
    </div>
  );

  const subItems = activeSub ? buildSub(activeSub.key) : null;
  const subMenuRef = React.useRef(null);
  // Pre-measure position: horizontal flip if it would overflow right edge;
  // vertical anchor at parent-row top. Used to paint the submenu (hidden)
  // so the layoutEffect below can measure its real height and produce the
  // clamped position. Computed every render activeSub is truthy.
  const initialSubPos = React.useMemo(() => {
    if (!activeSub) return null;
    const subW = 220;
    const pad = 8;
    const r = activeSub.rect;
    let left = r.right + 4;
    if (left + subW > window.innerWidth - pad) left = r.left - subW - 4;
    if (left < pad) left = pad;
    let top = r.top - 4;
    return { top: Math.max(pad, top), left };
  }, [activeSub]);
  // clampedPos is set ONLY after the layoutEffect measures the mounted
  // submenu. Until then the submenu paints with visibility:hidden at the
  // initialSubPos guess. Previous two-step subPos useState pattern raced
  // useEffect against useLayoutEffect and left the submenu permanently
  // hidden because the layoutEffect ran before subMenuRef was attached.
  const [clampedPos, setClampedPos] = React.useState(null);
  React.useEffect(() => { if (!activeSub) setClampedPos(null); }, [activeSub]);
  React.useLayoutEffect(() => {
    if (!activeSub || !subMenuRef.current || !initialSubPos) return;
    const pad = 8;
    const rect = subMenuRef.current.getBoundingClientRect();
    let top  = initialSubPos.top;
    let left = initialSubPos.left;
    if (top + rect.height > window.innerHeight - pad) {
      top = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (left + rect.width > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    setClampedPos({ top, left });
  }, [activeSub, initialSubPos]);
  const subPos = clampedPos || initialSubPos;
  const subReady = !!clampedPos;

  return (
    <>
      <div
        ref={menuRef}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={cancelTimers}
        onMouseLeave={scheduleClose}
        style={{
          position: 'fixed', top: menuPos.top, left: menuPos.left,
          minWidth: 220, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
          padding: '4px 0', zIndex: 200,
          visibility: menuPos.ready ? 'visible' : 'hidden',
        }}
      >
        {bulk && <MenuCaption>{bulkCount + ' selected'}</MenuCaption>}

        {showEditDetails && (
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, 'editDetails'); onClose(); }}>Edit details</MenuItem>
        )}
        {showInvoice && (
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, invoiceKind); onClose(); }}>{invoiceLabel}</MenuItem>
        )}
        {showViewDetails && (
          <MenuItem onClick={() => { onSelectWO && onSelectWO(woId); onClose(); }}>View details</MenuItem>
        )}

        {(showEditDetails || showInvoice || showViewDetails) && <MenuDivider />}

        {!inWoModal && parentRow('status', bulk ? 'Set status (' + bulkCount + ')' : 'Set status')}
        {!inWoModal && !bulk && parentRow('pm', 'Set PM')}
        {!inWoModal && !bulk && parentRow('type', 'Set type')}
        {!inWoModal && !bulk && parentRow('tech', 'Set tech')}

        {(showSchedule || tab !== 'trash') && <MenuDivider />}

        {showSchedule && ctxRow?.scheduled && (
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, 'jumpToSchedule'); onClose(); }}>Jump to schedule</MenuItem>
        )}
        {showSchedule && (
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, 'openScheduleForm'); onClose(); }}>{ctxRow?.scheduled ? 'Reschedule' : 'Add to schedule'}</MenuItem>
        )}
        {tab !== 'trash' && parentRow('inbox', bulk ? 'Add to inbox (' + bulkCount + ')' : 'Add to inbox')}
        {!bulk && source !== 'maps' && (
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, 'jumpToMap'); onClose(); }}>Jump to Map</MenuItem>
        )}
        {!bulk && (
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, 'regeocode'); onClose(); }}>Re-geocode address</MenuItem>
        )}
        {showRemoveInbox && (
          <MenuItem onClick={() => { onRemoveFromInbox && onRemoveFromInbox(inboxId, woId); onClose(); }}>Remove from this inbox</MenuItem>
        )}
        {showCapture && (
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, 'capture'); onClose(); }}>Capture from portal</MenuItem>
        )}
        {!bulk && tab !== 'trash' && parentRow('folder', 'Folder')}

        {tab === 'complete' && (<>
          <MenuDivider />
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, 'reopen'); onClose(); }}>Reopen → Active</MenuItem>
        </>)}
        {tab === 'sent' && (<>
          <MenuDivider />
          <MenuItem onClick={() => { onWoAction && onWoAction(woId, 'reopen'); onClose(); }}>Reopen → Complete</MenuItem>
        </>)}

        {showMark && (<>
          <MenuDivider />
          {parentRow('mark', 'Mark')}
        </>)}

        {tab !== 'trash' && (<>
          <MenuDivider />
          <MenuItem danger onClick={() => { onWoAction && onWoAction(woId, 'softDelete'); onClose(); }}>Send to Trash</MenuItem>
        </>)}
      </div>

      {activeSub && subItems && subPos && (
        <div
          ref={subMenuRef}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={enterSubmenu}
          onMouseLeave={leaveSubmenu}
          style={{
            position: 'fixed', top: subPos.top, left: subPos.left,
            minWidth: 200, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-2)', borderRadius: 8,
            boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
            padding: '4px 0', zIndex: 201,
            visibility: subReady ? 'visible' : 'hidden',
          }}
        >
          {subItems.map((it, i) => {
            if (it.divider)  return <MenuDivider key={'d' + i} />;
            if (it.caption)  return <MenuCaption key={'c' + i}>{it.caption}</MenuCaption>;
            return (
              <div
                key={'i' + i}
                onClick={it.disabled ? undefined : () => { it.onClick && it.onClick(); onClose(); }}
                onMouseEnter={(e) => { if (!it.disabled) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', fontSize: 13,
                  color: it.disabled ? 'var(--text-3)' : 'var(--text-1)',
                  cursor: it.disabled ? 'default' : 'pointer',
                  opacity: it.disabled ? 0.5 : 1,
                  userSelect: 'none',
                }}
              >
                {it.icon}
                <span>{it.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------- sidebar ---------- */
// change10 slice 3.4: slim sidebar. View list, brand, add WO, tools, modules,
// settings, attention — all migrated to the module header chip cluster
// (HeaderChips). Sidebar now hosts only the LIST-style elements that need
// persistent vertical space: Saved views (presets) and Inboxes. Rendered only
// on the Work Orders module; non-WO modules collapse the column to 0 (see App).
function ClientSBRow({ label, color, selected, onClick }) {
  return (
    <div onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
      background: selected ? 'var(--bg-row-sel)' : 'transparent',
      color: selected ? 'var(--text-1)' : 'var(--text-2)',
      fontWeight: selected ? 600 : 400,
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, flexShrink: 0,
        background: color || 'var(--text-3)' }} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

function Sidebar({ activeView, onSelectView, clients, presets, inboxes, onRenamePreset, onDeletePreset, onRenameInbox, onDeleteInbox, onAddInbox }) {
  const av = activeView || '';
  const onClient = av.startsWith('cl:');
  return (
    <aside style={{
      width: 200, flexShrink: 0, boxSizing: 'border-box',
      borderRight: '1px solid var(--border-1)',
      background: 'var(--bg-surface)',
      padding: '12px 12px',
      display: 'flex', flexDirection: 'column', gap: 2,
      fontSize: 14,
      minHeight: 0,
      overflowY: 'auto',
    }}>
      {/* Clients: Gmail-style inbox per client (o.pm). "All" = no client filter. */}
      <div style={{ marginBottom: 4, padding: '0 10px', fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.02em' }}>
        Clients
      </div>
      <ClientSBRow label="All" color="var(--accent)" selected={!onClient} onClick={() => onSelectView('active')} />
      {(clients || []).map(c => (
        <ClientSBRow
          key={c.name}
          label={c.fullName && c.fullName !== c.name ? c.name + ' · ' + c.fullName : c.name}
          color={c.color}
          selected={av === 'cl:' + c.name}
          onClick={() => onSelectView('cl:' + c.name)}
        />
      ))}

      <div style={{ marginTop: 16 }} />
      {presets.length > 0 && (
        <div style={{ marginBottom: 4, padding: '0 10px', fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.02em' }}>
          Saved views
        </div>
      )}
      {presets.map(p => (
        <PresetSBRow
          key={p.id}
          preset={p}
          selected={activeView === 'sv:' + p.id}
          onClick={() => onSelectView('sv:' + p.id)}
          onRename={onRenamePreset}
          onDelete={onDeletePreset}
        />
      ))}

      <div style={{
        marginTop: presets.length > 0 ? 16 : 0,
        marginBottom: 4, padding: '0 10px',
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, color: 'var(--text-3)', fontWeight: 600, letterSpacing: '0.02em',
      }}>
        <span>Inboxes</span>
        {onAddInbox && (
          <button onClick={onAddInbox} title="New inbox" style={{
            marginLeft: 'auto', height: 20, width: 20, padding: 0,
            border: '1px solid var(--border-1)', borderRadius: 4,
            background: 'transparent', color: 'var(--text-2)',
            fontFamily: 'inherit', fontSize: 14, lineHeight: 1, cursor: 'pointer',
          }}>+</button>
        )}
      </div>
      {(inboxes || []).map(b => (
        <InboxSBRow
          key={b.id}
          inbox={b}
          selected={activeView === 'ib:' + b.id}
          onClick={() => onSelectView('ib:' + b.id)}
          onRename={onRenameInbox}
          onDelete={onDeleteInbox}
        />
      ))}
      {(!inboxes || inboxes.length === 0) && (
        <div style={{ padding: '4px 10px', fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
          No inboxes. Click + to create one.
        </div>
      )}
    </aside>
  );
}

// SidebarLauncherButton removed: the fold-out NavWing (nav.jsx) replaces the
// per-sidebar Modules launcher.

// Shared collapse state for a sidebar section. Persists in sessionStorage
// keyed by sectionKey so collapses survive view switches within a session
// but reset on app reload. Returns [open, toggle].
export function useCollapsedSection(sectionKey, defaultOpen = true) {
  const storageKey = 'sb_collapse:' + sectionKey;
  const [open, setOpen] = React.useState(() => {
    try {
      const v = sessionStorage.getItem(storageKey);
      return v === null ? defaultOpen : v === '1';
    } catch (_) { return defaultOpen; }
  });
  const toggle = React.useCallback(() => setOpen(o => {
    const next = !o;
    try { sessionStorage.setItem(storageKey, next ? '1' : '0'); } catch (_) {}
    return next;
  }), [storageKey]);
  return [open, toggle];
}

// Collapsible section header for sidebar lists. `extras` slot lets the
// header host inline controls (e.g. an add button) that must not toggle
// the section — those controls call e.stopPropagation in their own
// onClick. For sections whose body spans multiple sibling DOM blocks,
// use useCollapsedSection directly instead.
export function CollapsibleSection({ title, sectionKey, defaultOpen = true, headerStyle, extras, children }) {
  const [open, toggle] = useCollapsedSection(sectionKey, defaultOpen);
  return (
    <React.Fragment>
      <div onClick={toggle} style={{
        cursor: 'pointer', userSelect: 'none',
        display: 'flex', alignItems: 'center', gap: 4,
        ...(headerStyle || {}),
      }}>
        <span style={{
          fontSize: 9, color: 'var(--text-3)', width: 10, display: 'inline-block',
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms',
        }}>{'▾'}</span>
        <span style={{ flex: 1 }}>{title}</span>
        {extras}
      </div>
      {open && children}
    </React.Fragment>
  );
}

// change11: SBRow component removed. Sidebar no longer renders view-list rows
// (view pills moved to WO module header in change10 slice 3). PresetSBRow +
// InboxSBRow are self-contained and remain.

function PresetSBRow({ preset, selected, onClick, onRename, onDelete }) {
  const [hover, setHover] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const wrapRef = React.useRef(null);
  React.useEffect(() => {
    if (!menu) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(false); };
    const t = setTimeout(() => document.addEventListener('click', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menu]);
  return (
    <div ref={wrapRef}
         onMouseEnter={() => setHover(true)}
         onMouseLeave={() => setHover(false)}
         style={{ position: 'relative' }}>
      <div onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 6,
        background: selected ? 'var(--bg-row-sel)' : (hover ? 'var(--bg-hover)' : 'transparent'),
        color: 'var(--text-1)',
        fontWeight: selected ? 600 : 400,
        fontSize: 14, cursor: 'pointer', userSelect: 'none',
      }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preset.name || 'Untitled view'}
        </span>
        {hover && (
          <span onClick={(e) => { e.stopPropagation(); setMenu(true); }}
                style={{ color: 'var(--text-3)', fontSize: 13, cursor: 'pointer' }}>
            {'...'}
          </span>
        )}
      </div>
      {menu && (
        <div style={{
          position: 'absolute', top: 32, right: 4,
          minWidth: 140, background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
          padding: '4px 0', zIndex: 70,
        }}>
          <MenuItem onClick={() => { setMenu(false); onRename(preset.id); }}>Rename</MenuItem>
          <MenuDivider />
          <MenuItem danger onClick={() => { setMenu(false); onDelete(preset.id); }}>Delete</MenuItem>
        </div>
      )}
    </div>
  );
}

function InboxSBRow({ inbox, selected, onClick, onRename, onDelete }) {
  const [hover, setHover] = React.useState(false);
  const [menu, setMenu] = React.useState(false);
  const wrapRef = React.useRef(null);
  const count = Array.isArray(inbox.woIds) ? inbox.woIds.length : 0;
  React.useEffect(() => {
    if (!menu) return;
    const onDoc = (e) => { if (!wrapRef.current?.contains(e.target)) setMenu(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenu(false); };
    const t = setTimeout(() => document.addEventListener('click', onDoc), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menu]);
  return (
    <div ref={wrapRef}
         onMouseEnter={() => setHover(true)}
         onMouseLeave={() => setHover(false)}
         style={{ position: 'relative' }}>
      <div onClick={onClick} style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 10px', borderRadius: 6,
        background: selected ? 'var(--bg-row-sel)' : (hover ? 'var(--bg-hover)' : 'transparent'),
        color: 'var(--text-1)',
        fontWeight: selected ? 600 : 400,
        fontSize: 14, cursor: 'pointer', userSelect: 'none',
      }}>
        <span style={{ color: 'var(--text-3)', fontSize: 13 }}>{'☰'}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {inbox.name || 'Untitled inbox'}
        </span>
        {hover ? (
          <span onClick={(e) => { e.stopPropagation(); setMenu(true); }}
                style={{ color: 'var(--text-3)', fontSize: 13, cursor: 'pointer' }}>
            {'...'}
          </span>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
        )}
      </div>
      {menu && (
        <div style={{
          position: 'absolute', top: 32, right: 4,
          minWidth: 140, background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)', borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
          padding: '4px 0', zIndex: 70,
        }}>
          <MenuItem onClick={() => { setMenu(false); onRename(inbox.id); }}>Rename</MenuItem>
          <MenuDivider />
          <MenuItem danger onClick={() => { setMenu(false); onDelete(inbox.id); }}>Delete</MenuItem>
        </div>
      )}
    </div>
  );
}

/* ---------- list pane ---------- */
const TT_GROUPS = [
  { phase: 'Awaiting PM', count: 3, rows: [
    { wo: 'WO-247',  flags: ['emergency'], addr: '412 Hillcrest Dr', city: 'Durham',  pm: 'AMH', type: 'P', tech: 'Daniel', age: '21d', ageLevel: 3, status: 'Bid submitted' },
    { wo: 'WO-1083',                       addr: '88 Oakwood Ln',    city: 'Raleigh', pm: 'MSR', type: 'H', tech: 'Carlos', age: '14d', ageLevel: 2, status: 'Bid submitted' },
    { wo: 'WO-92',   flags: ['warranty'],  addr: '5 Magnolia Ct',    city: 'Cary',    pm: 'AMH', type: 'E', tech: 'Daniel', age: '7d',  ageLevel: 0, status: 'Bid submitted' },
  ]},
  { phase: 'In progress', count: 2, rows: [
    { wo: 'WO-301',  addr: '1207 Pine St', city: 'Durham', pm: 'MSR', type: 'P', tech: 'Tyrese', age: '11d', ageLevel: 1, status: 'Parts pending' },
    { wo: 'WO-419',  addr: '33 Birch Way', city: 'Apex',   pm: 'AMH', type: 'H', tech: 'Daniel', age: '4d',  ageLevel: 0, status: 'Parts pending' },
  ]},
  { phase: 'Approved', count: 1, rows: [
    { wo: 'WO-188',  addr: '14 Cedar Pt',  city: 'Chapel Hill', pm: 'RKT', type: 'P', tech: 'Carlos', age: '2d', ageLevel: 0, status: 'Bid approved' },
  ]},
];

const TT_GROUPS_SENT = [
  { phase: 'Billing', count: 4, rows: [
    { wo: 'WO-209', addr: '8 Maple Rdg',   city: 'Durham',      pm: 'AMH', type: 'P', tech: 'Daniel', age: '3d', ageLevel: 0, status: 'Sent to invoice' },
    { wo: 'WO-77',  addr: '210 Front St',  city: 'Raleigh',     pm: 'MSR', type: 'H', tech: 'Carlos', age: '5d', ageLevel: 0, status: 'Sent to invoice' },
    { wo: 'WO-150', addr: '4422 Beacon Dr',city: 'Cary',        pm: 'RKT', type: 'P', tech: 'Tyrese', age: '8d', ageLevel: 1, status: 'Sent to invoice' },
    { wo: 'WO-15',  addr: '1 Greenway Ct', city: 'Chapel Hill', pm: 'AMH', type: 'E', tech: 'Daniel', age: '12d',ageLevel: 1, status: 'Sent to invoice' },
  ]},
];

const TT_GROUPS_INVOICED = [
  { phase: 'Billing', count: 7, rows: [
    { wo: 'WO-201', addr: '34 Hawthorne Pl', city: 'Durham', pm: 'AMH', type: 'P', tech: 'Daniel', age: '6d',  ageLevel: 0, status: 'Invoiced' },
    { wo: 'WO-180', addr: '92 Carlton Ln',   city: 'Apex',   pm: 'MSR', type: 'H', tech: 'Carlos', age: '9d',  ageLevel: 1, status: 'Invoiced' },
    { wo: 'WO-166', addr: '11 Forsythe Ave', city: 'Raleigh',pm: 'RKT', type: 'P', tech: 'Tyrese', age: '14d', ageLevel: 2, status: 'Invoiced' },
    { wo: 'WO-122', addr: '76 Sandwood Dr',  city: 'Cary',   pm: 'AMH', type: 'E', tech: 'Daniel', age: '18d', ageLevel: 2, status: 'Invoiced' },
    { wo: 'WO-99',  addr: '305 Aldridge St', city: 'Durham', pm: 'MSR', type: 'H', tech: 'Carlos', age: '23d', ageLevel: 3, status: 'Invoiced' },
    { wo: 'WO-65',  addr: '14 Sumner Ct',    city: 'Cary',   pm: 'AMH', type: 'P', tech: 'Daniel', age: '28d', ageLevel: 3, status: 'Invoiced' },
    { wo: 'WO-40',  addr: '900 Vine St',     city: 'Raleigh',pm: 'RKT', type: 'H', tech: 'Tyrese', age: '34d', ageLevel: 3, status: 'Invoiced' },
  ]},
];

const TT_GROUPS_PAID = [
  { phase: 'Done', count: 3, rows: [
    { wo: 'WO-50',  addr: '17 Park Ln',     city: 'Durham', pm: 'AMH', type: 'P', tech: 'Daniel', age: '40d', ageLevel: 0, status: 'Closed' },
    { wo: 'WO-22',  addr: '6 Sage Hollow',  city: 'Cary',   pm: 'MSR', type: 'H', tech: 'Carlos', age: '55d', ageLevel: 0, status: 'Closed' },
    { wo: 'WO-9',   addr: '301 Beaver St',  city: 'Apex',   pm: 'RKT', type: 'E', tech: 'Tyrese', age: '72d', ageLevel: 0, status: 'Closed' },
  ]},
];

export const TT_VIEW_DATA = {
  active:   { title: 'Active',          total: 23, groups: TT_GROUPS },
  sent:     { title: 'Sent to invoice', total: 4,  groups: TT_GROUPS_SENT },
  invoiced: { title: 'Invoiced',        total: 7,  groups: TT_GROUPS_INVOICED },
  paid:     { title: 'Paid',            total: 3,  groups: TT_GROUPS_PAID, hideAge: true },
  trash:    { title: 'Trash',           total: 0,  groups: [] },
  'sv-daniel': { title: "Daniel's daily route", total: 5, groups: TT_GROUPS.map(g => ({...g, rows: g.rows.filter(r => r.tech === 'Daniel')})).filter(g => g.rows.length) },
  'sv-amh':    { title: 'AMH high priority',     total: 4, groups: TT_GROUPS.map(g => ({...g, rows: g.rows.filter(r => r.pm === 'AMH')})).filter(g => g.rows.length) },
  'sv-await':  { title: 'Awaiting PM response',  total: 3, groups: [TT_GROUPS[0]] },
};

// Work Orders module header. Spans the full module width (cols 2-4 in the
// app grid) so it lines up with the other modules' headers. Hosts the module
// nav chevrons, the Bricolage title, the view-tab pills (Active/Sent/Invoiced/
// Paid/Trash, hidden in preset/inbox views which don't fit the tab model), the
// subtitle, and the search box. Filter chips, count chips, and sort live in
// the ListPane's smaller top strip below.
function WorkOrdersHeader({ query, setQuery, view, onSelectView, isPresetView, isInboxView, headerRight }) {
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div style={{ flexShrink: 0, padding: '14px 18px 10px', borderBottom: '1px solid var(--border-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div>
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Work Orders
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
            Track and manage work orders
          </div>
        </div>
        {!(isPresetView || isInboxView) && (
          <div style={{ display: 'flex', gap: 4, marginLeft: 8, flexWrap: 'wrap' }}>
            {WO_TAB_VIEWS.map(t => {
              const active = view === t.id;
              return (
                <button key={t.id} onClick={() => onSelectView && onSelectView(t.id)} style={{
                  height: 26, padding: '0 10px', borderRadius: 999,
                  border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border-1)'),
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? 'var(--accent-fg)' : 'var(--text-2)',
                  fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 500,
                  cursor: 'pointer', lineHeight: 1,
                }}>{t.label}</button>
              );
            })}
          </div>
        )}
        <div style={{
          flex: '1 1 200px', minWidth: 140, maxWidth: 320, marginLeft: 12,
          height: 30, border: '1px solid var(--border-2)', borderRadius: 8,
          background: 'var(--bg-surface)', padding: '0 10px',
          display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
        }}>
          <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{'⌕'}</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isPresetView ? (isInboxView ? 'Search fixed in inbox' : 'Search fixed in preset') : 'Search WO, address, tech...'}
            disabled={isPresetView}
            title={isPresetView ? 'Switch back to a base view to edit the search query.' : ''}
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent', color: 'var(--text-1)',
              fontFamily: 'inherit', fontSize: 13,
              opacity: isPresetView ? 0.55 : 1,
              cursor: isPresetView ? 'not-allowed' : 'text', minWidth: 0,
            }}
          />
          {query
            ? <span onClick={() => setQuery('')} style={{ cursor: 'pointer', fontSize: 11, color: 'var(--text-3)' }}>{'✕'}</span>
            : <span style={{ fontSize: 11, color: 'var(--text-3)' }}>/</span>}
        </div>
        <div style={{ flex: 1 }} />
        {headerRight}
        <HeaderChips />
      </div>
    </div>
  );
}

// ListPane + PhaseHeader + ListRow carved out to ./listpane.jsx.

/* ---------- detail pane ---------- */
const TT_WOS = {
  'WO-247': {
    wo: 'WO-247', addr: '412 Hillcrest Dr', city: 'Durham, NC',
    flags: ['emergency'], status: 'Bid submitted',
    daysInStage: 21,
    pm: 'AMH', type: 'P', typeLabel: 'Plumbing', tech: 'Daniel',
    created: 'Apr 22, 2026', propId: 'HC-4412', bid: '$1,840', phone: '(919) 555-0148',
    notes: [
      { type: 'Customer call', time: 'Apr 24 · 2:14 PM', pinned: true, body:
        'Spoke with Karen at the property. Wants the work done before May 1. Confirmed access via lockbox code 4421.' },
      { type: 'Note', time: 'Apr 23 · 9:02 AM', edited: true, body:
        'Bid resubmitted with revised parts cost; old bid was missing the manifold replacement line item.' },
    ],
    activity: [
      'Apr 24 14:14 — pinned by user',
      'Apr 23 09:02 — note edited',
      'Apr 22 11:30 — status changed: Open → Bid submitted',
      'Apr 22 09:18 — WO created',
    ],
    nextAction: 'Send to Invoice',
  },
};

// Phone display with multi-contact support. Shows the primary contact's name
// next to the primary phone; if secondary contacts exist (Household block had
// more than one entry), a "+N" chip reveals their names + numbers on hover.
// DetailPane + note/phone/overflow cluster carved out to ./detail.jsx.

/* ---------- (retired) right-pane Attention/Landing view ----------
   Removed: the attention tri-pane is replaced by the header bell notifications
   dropdown. The Overview module keeps its own FSAlertCard summary. */
/* ---------- settings drawer ---------- */
// TT_SECTIONS carved out to ./settings.jsx.

// Default Maps view center/zoom. Intentionally null in source so this
// repo carries no operator-specific location. User configures in
// Settings -> Maps (or via "Set default view" button in the module).
// Fallback when null: US-wide view (lat 39.83, lon -98.58, zoom 4).
const DEFAULT_MAPS_VIEW = null;

// US state two-letter codes paired with full names. Used to canonicalize
// state comparisons so Nominatim returning "North Carolina" still
// matches a configured home state of "NC".
export const US_STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  // US territories
  AS: 'American Samoa', GU: 'Guam', MP: 'Northern Mariana Islands',
  PR: 'Puerto Rico', UM: 'U.S. Minor Outlying Islands', VI: 'U.S. Virgin Islands',
};
function stateCanon(s) {
  if (!s) return '';
  const t = String(s).trim();
  if (!t) return '';
  const up = t.toUpperCase();
  if (US_STATE_NAMES[up]) return up;                          // already a code
  for (const [code, name] of Object.entries(US_STATE_NAMES)) {
    if (name.toUpperCase() === up) return code;               // full name -> code
  }
  return up.slice(0, 2);                                       // fallback (foreign)
}
function stateMatches(a, b) {
  const ca = stateCanon(a);
  const cb = stateCanon(b);
  return !!(ca && cb && ca === cb);
}

// SettingsDrawer + CredentialsSection .. ApiKeysSection carved out to ./settings.jsx.
const SORT_DEFS = [
  { key: 'created',  label: 'Created' },
  { key: 'age',      label: 'Age' },
  { key: 'wo',       label: 'WO #' },
  { key: 'status',   label: 'Status (reverse)' },
  { key: 'lastNote', label: 'Last Note' },
];

// AlertsSection .. AboutSection carved out to ./settings.jsx.
/* ---------- Fullscreen launch landing ---------- */
// ---- Overview module helpers ----
// change11: 8-week buckets. Two series:
//   dispatched - WO entered the system (creation = dispatch in this workflow).
//                Sourced from o.dateCreated. One count per WO per bucket
//                regardless of how many schedule events fired.
//   completed  - WO moved to tab='complete'. Sourced from history action
//                containing 'marked complete' or 'auto-flipped to complete'.
//                One count per WO per bucket; if a WO was reopened and
//                re-completed in the same week, it counts once for that week.
// Created was dropped (functionally identical to dispatched in this shop).
// Defensive parsing: tolerate missing entries and varied action strings.
function overviewWeekBuckets() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dow = (start.getDay() + 6) % 7; // 0 = Monday
  start.setDate(start.getDate() - dow);
  const buckets = [];
  for (let i = 7; i >= 0; i--) {
    const wStart = new Date(start);
    wStart.setDate(start.getDate() - i * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 7);
    buckets.push({
      startMs: wStart.getTime(),
      endMs:   wEnd.getTime(),
      label:   (wStart.getMonth() + 1) + '/' + wStart.getDate(),
      dispatched: 0, completed: 0,
    });
  }
  return buckets;
}
function overviewThroughput(orders) {
  const buckets = overviewWeekBuckets();
  const inBucket = (ts) => {
    for (let i = 0; i < buckets.length; i++) {
      if (ts >= buckets[i].startMs && ts < buckets[i].endMs) return buckets[i];
    }
    return null;
  };
  for (const o of (orders || [])) {
    if (!o) continue;
    // Dispatched: count once per WO based on dateCreated.
    if (o.dateCreated) {
      const ts = new Date(o.dateCreated + 'T00:00:00').getTime();
      const b = inBucket(ts);
      if (b) b.dispatched++;
    }
    // Completed: count once per WO per bucket on the first matching history
    // entry that lands in that bucket. Re-completion in same week dedupes.
    const hist = Array.isArray(o.history) ? o.history : [];
    const completedBucketSeen = new Set();
    for (const h of hist) {
      if (!h || !h.ts) continue;
      const a = String(h.action || '').toLowerCase();
      if (!(a.includes('marked complete') || a.includes('auto-flipped to complete'))) continue;
      const b = inBucket(h.ts);
      if (!b || completedBucketSeen.has(b)) continue;
      completedBucketSeen.add(b);
      b.completed++;
    }
  }
  return buckets;
}
function overviewTechUtilization(orders, techs) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  const m = {};
  for (const t of (techs || [])) m[t] = 0;
  for (const o of (orders || [])) {
    if (!o.schedule || !o.schedule.date || !o.tech) continue;
    const d = new Date(o.schedule.date + 'T00:00:00');
    if (d >= start && d < end) m[o.tech] = (m[o.tech] || 0) + 1;
  }
  return m;
}
function overviewTabCounts(orders) {
  // change11: invoiced/paid retired; complete added.
  const c = { active: 0, complete: 0, sent: 0 };
  for (const o of (orders || [])) {
    if (o.deleted) continue;
    const t = o.tab || 'active';
    if (t in c) c[t]++;
  }
  return c;
}

// Overview module. Fullscreen home screen. Replaces the previous
// FullScreenLanding overlay. Not in MODULE_ORDER (no prev/next nav).
// Sidebar collapsed in App when active. Reached via home chevron on any
// non-overview module header, or as the default at app launch.
function OverviewModule({ orders, techs, alerts, modules, lastModule, onContinue, onPickModule, onSelectAlert, loading }) {
  const counts = React.useMemo(() => overviewTabCounts(orders), [orders]);
  const buckets = React.useMemo(() => overviewThroughput(orders), [orders]);
  const techUtil = React.useMemo(() => overviewTechUtilization(orders, techs), [orders, techs]);
  const maxBar = Math.max(1, ...buckets.map(b => Math.max(b.dispatched, b.completed)));
  const continueLabel = lastModule && lastModule !== 'overview'
    ? ('Continue to ' + (MODULES.find(m => m.id === lastModule)?.title || 'Work Orders'))
    : 'Continue to Work Orders';
  // Staggered fade-in (port of the FullScreenLanding mechanism: rAF flag +
  // CSS transitions on opacity/transform). Avoids the abrupt pop-in.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const fade = (delayMs) => ({
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(8px)',
    transition: 'opacity 600ms ease ' + delayMs + 'ms, transform 600ms ease ' + delayMs + 'ms',
  });
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-canvas)', color: 'var(--text-1)',
      display: 'grid', gridTemplateColumns: '280px 1fr',
      gridTemplateRows: '1fr auto',
      overflow: 'hidden',
    }}>
      {/* Left brand + counts + quick-jump */}
      <aside style={{
        gridRow: '1 / 3',
        borderRight: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        padding: '32px 24px',
        display: 'flex', flexDirection: 'column', gap: 24,
        minHeight: 0, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, ...fade(0) }}>
          <GambleMark size={48} />
          <div style={{
            fontFamily: "'Bricolage Grotesque', sans-serif",
            fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em', lineHeight: 1,
          }}>Trade Tracker</div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em' }}>
            by Gamble · Plumbing · Heating · Air
          </div>
        </div>
        <div style={fade(160)}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Work order counts
          </div>
          {[
            { key: 'active',   label: 'Active' },
            { key: 'complete', label: 'Complete' },
            { key: 'sent',     label: 'Sent to invoice' },
          ].map(row => (
            <div key={row.key} style={{
              display: 'flex', justifyContent: 'space-between',
              padding: '6px 0', fontSize: 14,
              borderBottom: '1px solid var(--border-1)',
            }}>
              <span style={{ color: 'var(--text-2)' }}>{row.label}</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{counts[row.key]}</span>
            </div>
          ))}
        </div>
        <div style={fade(280)}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Jump to module
          </div>
          {(modules || []).map(m => (
            <button
              key={m.id}
              onClick={() => onPickModule && onPickModule(m.id)}
              style={{
                width: '100%', textAlign: 'left',
                padding: '8px 10px', marginBottom: 4,
                background: 'transparent', border: '1px solid var(--border-1)',
                borderRadius: 6, color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-row-sel)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ color: 'var(--text-3)' }}>{m.glyph}</span>
              <span>{m.title}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <main style={{
        gridRow: '1 / 2',
        minHeight: 0, overflowY: 'auto',
        padding: '40px 48px',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, ...fade(80) }}>
          <div>
            <div style={{
              fontFamily: "'Bricolage Grotesque', sans-serif",
              fontWeight: 700, fontSize: 32, letterSpacing: '-0.02em',
            }}>Welcome back</div>
            <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
              {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>

        {/* Throughput */}
        <section style={{
          marginTop: 28,
          border: '1px solid var(--border-1)', borderRadius: 10,
          background: 'var(--bg-surface)', padding: '18px 20px',
          ...fade(220),
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Throughput · last 8 weeks</div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-2)' }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--accent)', borderRadius: 2, marginRight: 4 }}></span>Dispatched</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'oklch(68% 0.12 280)', borderRadius: 2, marginRight: 4 }}></span>Completed</span>
            </div>
          </div>
          <svg viewBox="0 0 640 180" width="100%" height="180" style={{ display: 'block' }} preserveAspectRatio="none">
            {buckets.map((b, i) => {
              const w = 640 / buckets.length;
              const x = i * w;
              const groupW = w - 16;
              const barW = groupW / 2 - 2;
              const yBase = 150;
              const scale = 130 / maxBar;
              const series = [
                { v: b.dispatched, fill: 'var(--accent)' },
                { v: b.completed,  fill: 'oklch(68% 0.12 280)' },
              ];
              return (
                <g key={i}>
                  {series.map((s, k) => {
                    const h = s.v * scale;
                    return <rect key={k}
                      x={x + 8 + k * (barW + 2)} y={yBase - h}
                      width={barW} height={Math.max(0, h)}
                      fill={s.fill} rx={2} />;
                  })}
                  <text x={x + w / 2} y={170}
                    textAnchor="middle"
                    fontSize={11}
                    fill="var(--text-3)"
                    fontFamily="inherit">
                    {b.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </section>

        {/* Tech utilization */}
        <section style={{
          marginTop: 20,
          border: '1px solid var(--border-1)', borderRadius: 10,
          background: 'var(--bg-surface)', padding: '18px 20px',
          ...fade(340),
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>Tech utilization · this week</div>
          {(techs || []).length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-3)' }}>No technicians configured.</div>
          )}
          {(techs || []).map(t => {
            const v = techUtil[t] || 0;
            const max = Math.max(1, ...Object.values(techUtil));
            const pct = (v / max) * 100;
            return (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <div style={{ width: 90, fontSize: 13, color: 'var(--text-2)' }}>{t}</div>
                <div style={{ flex: 1, height: 10, background: 'var(--bg-surface-2)', borderRadius: 5, overflow: 'hidden' }}>
                  <div style={{ width: pct + '%', height: '100%', background: 'var(--accent)' }} />
                </div>
                <div style={{ width: 30, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              </div>
            );
          })}
        </section>

        {/* Alerts */}
        <section style={{ marginTop: 20, ...fade(460) }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Needs your attention</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{(alerts || []).length} items</div>
          </div>
          {(alerts || []).slice(0, 6).map((a, i) => (
            <FSAlertCard key={a.wo || ('idx-' + i)} {...a} onClick={() => onSelectAlert && onSelectAlert(a.wo)} />
          ))}
          {(alerts || []).length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '10px 0' }}>
              {loading ? 'Loading work orders...' : 'Nothing flagged today.'}
            </div>
          )}
        </section>
      </main>

      {/* Continue button (center-bottom of main column) */}
      <div style={{
        gridRow: '2 / 3', gridColumn: '2 / 3',
        padding: '16px 48px 28px',
        borderTop: '1px solid var(--border-1)',
        background: 'var(--bg-canvas)',
        display: 'flex', justifyContent: 'center',
        ...fade(600),
      }}>
        <button onClick={onContinue} style={{
          height: 44, padding: '0 22px',
          background: 'var(--accent)', color: 'var(--accent-fg)',
          border: 'none', borderRadius: 10,
          fontFamily: 'inherit', fontSize: 15, fontWeight: 600,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        }}>
          {continueLabel}
          <span style={{ fontSize: 18 }}>{'→'}</span>
        </button>
      </div>
    </div>
  );
}

function FSAlertCard({ kind, wo, addr, blurb, onClick }) {
  const color =
    kind === 'emergency' ? 'var(--flag-emergency)' :
    kind === 'stale'     ? 'oklch(60% 0.13 50)' :
    kind === 'parts'     ? 'oklch(60% 0.13 280)' :
                           'oklch(58% 0.12 145)';
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', gap: 12,
        padding: '13px 16px', marginBottom: 8,
        border: '1px solid var(--border-1)', borderRadius: 10,
        background: hover ? 'var(--bg-surface-2)' : 'var(--bg-surface)',
        cursor: 'pointer',
        transition: 'background 120ms ease, transform 120ms ease',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: 4, background: color,
        flexShrink: 0, marginTop: 8,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{wo}</span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{addr}</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 2 }}>{blurb}</div>
      </div>
      <span style={{ color: 'var(--text-3)', fontSize: 16, alignSelf: 'center' }}>{'→'}</span>
    </div>
  );
}

/* ---------- App shell ---------- */
export function BulkBar({ count, actions, onClear }) {
  if (!count) return null;
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 30,
      background: 'var(--accent)', color: 'var(--accent-fg)',
      padding: '10px 20px',
      display: 'flex', alignItems: 'center', gap: 10,
      borderBottom: '1px solid rgba(255,255,255,0.15)',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
        {count} selected
      </span>
      {actions.map((a, i) => (
        <button key={i} onClick={a.run} style={{
          height: 28, padding: '0 12px',
          background: a.danger ? 'oklch(55% 0.16 25)' : a.primary ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
          color: '#fff',
          border: a.danger ? '1px solid oklch(65% 0.16 25)' : '1px solid rgba(255,255,255,0.3)',
          borderRadius: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>{a.label}</button>
      ))}
      <button onClick={onClear} style={{
        height: 28, padding: '0 10px',
        background: 'transparent', color: 'rgba(255,255,255,0.7)',
        border: '1px solid rgba(255,255,255,0.25)',
        borderRadius: 6, fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
      }}>Clear</button>
    </div>
  );
}

// Human-readable update status for the Settings > About row.
export function updateStatusText(state) {
  if (!state || state.status === 'none') return 'You are up to date.';
  const v = state.version ? ' v' + state.version : '';
  switch (state.status) {
    case 'checking':    return 'Checking for updates...';
    case 'available':   return 'Update available' + v + '. Downloading...';
    case 'downloading': return 'Downloading update' + (typeof state.percent === 'number' ? ' ' + state.percent + '%' : '') + '...';
    case 'ready':       return 'Update ready' + v + '. Restart to install.';
    case 'error':       return 'Update check failed' + (state.error ? ': ' + state.error : '') + '.';
    default:            return '';
  }
}

function UpdateBanner({ state, onInstall }) {
  if (!state) return null;
  // Status vocabulary must match main.js update-status emissions:
  // 'available' -> 'downloading' (with percent) -> 'ready'. Keep the banner up
  // through the whole sequence so it does not flash and vanish mid-download.
  const { status, version, percent } = state;
  if (status !== 'available' && status !== 'downloading' && status !== 'ready') return null;
  const isReady = status === 'ready';
  let label;
  if (isReady) label = 'Update ready' + (version ? ' v' + version : '') + '. Restart to install.';
  else if (status === 'downloading') label = 'Downloading update' + (typeof percent === 'number' ? ' ' + percent + '%' : '') + '...';
  else label = 'Update available' + (version ? ' v' + version : '') + '. Downloading...';
  return (
    <div style={{
      flexShrink: 0,
      background: 'var(--accent)', color: 'var(--accent-fg)',
      padding: '8px 20px',
      display: 'flex', alignItems: 'center', gap: 12,
      fontSize: 13, fontWeight: 500,
    }}>
      <span style={{ flex: 1 }}>{label}</span>
      {isReady && onInstall && (
        <button onClick={onInstall} style={{
          height: 26, padding: '0 12px',
          background: 'rgba(255,255,255,0.25)',
          color: '#fff', border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 6, fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>Restart now</button>
      )}
    </div>
  );
}

// In-flow top strip shown while a portal capture is in flight (pushes the app
// header down rather than overlaying it). status = { label, done?, total? }.
// When total is known (MSR per-WO loop) it shows a "done / total" counter + a
// determinate bar; otherwise an indeterminate animated bar (AMH is one atomic
// API call with no per-WO step).
function CaptureBanner({ status }) {
  if (!status) return null;
  const { label, done, total } = status;
  const hasCount = typeof total === 'number' && total > 0;
  const pct = hasCount ? Math.min(100, Math.round(((done || 0) / total) * 100)) : 0;
  return (
    <div style={{
      // In-flow strip in the top banner column (under UpdateBanner). It no longer
      // needs to be fixed/overlaid: capture results now land in the notification
      // bell instead of auto-popping a modal over the banner, so nothing paints
      // over it. In-flow = it pushes content down instead of covering the header.
      flexShrink: 0,
      background: 'var(--accent, #6a92c4)', color: 'var(--accent-fg, #fff)',
      fontSize: 13, fontWeight: 500,
    }}>
      <div style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1 }}>{label}</span>
        {hasCount && <span style={{ fontVariantNumeric: 'tabular-nums' }}>{(done || 0)} / {total}</span>}
      </div>
      <div style={{ height: 3, background: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
        {hasCount
          ? <div style={{ height: '100%', width: pct + '%', background: '#fff', transition: 'width .2s ease' }} />
          : <div className="wo-capture-bar" style={{ height: '100%', width: '40%', background: '#fff' }} />}
      </div>
    </div>
  );
}

function MigrationDialog({ onApply, onSkip, backupBeforeApply, setBackupBeforeApply }) {
  const backup = backupBeforeApply !== undefined ? backupBeforeApply : true;
  const setBackup = setBackupBeforeApply || (() => {});
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        width: 640, maxHeight: '90vh',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
        borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GambleMark size={26} />
            <div style={{ fontSize: 17, fontWeight: 700 }}>Trade Tracker billing rework</div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 8 }}>
            Invoiced and Paid tabs are retiring (QuickBooks tracks those now). A new Complete tab
            replaces the in-list "Wrapping up / Done / Billing" phases for tech-done WOs awaiting
            invoicing. Review the changes below, then apply.
          </div>
        </div>
        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
          <MigChange title="Tabs reorganized" detail={
            <div>
              <MigPair from="Invoiced + Paid" to="Sent to invoice" note="moved into the Invoices module" />
              <MigPair from="Pending-Complete / Closed WOs" to="Complete tab" note="new top-level bucket" />
              <MigPair from="Active" to="Active" note="only active workflow phases now" />
              <MigPair from="Trash" to="Trash" note="hardcodes a Cancelled status on every trashed WO" />
            </div>
          } />
          <MigChange title="Workflow phases" detail={
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              The per-phase "complete" toggle is removed. All phases are active workflow.
              "Bid Approved - Complete" moves to the end of "In progress" (it is not job-complete yet).
              Existing phase configuration is preserved otherwise.
            </div>
          } />
          <MigChange title="Cancelled status" detail={
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              A new default status, hardcoded on Trash entry and cleared on Restore.
              Color is a muted gray (#6b7280).
            </div>
          } />
          <MigChange title="Send to Invoice" detail={
            <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
              Only available from the Complete tab. Active WOs cannot be sent until they are marked Complete.
              "Mark Invoiced" and "Mark Paid" actions are removed everywhere.
            </div>
          } />
        </div>
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border-1)',
          background: 'var(--bg-surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
            Back up workbook first (recommended)
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionBtn onClick={onSkip}>Not now</ActionBtn>
            <ActionBtn primary onClick={onApply}>Apply migration</ActionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function MigChange({ title, detail }) {
  return (
    <div style={{
      padding: '12px 14px', marginBottom: 10,
      border: '1px solid var(--border-1)', borderRadius: 8,
      background: 'var(--bg-canvas)',
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {detail}
    </div>
  );
}

function MigPair({ from, to, note }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 8,
      fontSize: 13, color: 'var(--text-2)', padding: '4px 0',
    }}>
      <span style={{ color: 'var(--text-3)' }}>{from}</span>
      <span style={{ color: 'var(--text-3)' }}>{'>'}</span>
      <span style={{ color: 'var(--text-1)', fontWeight: 500 }}>{to}</span>
      {note && <span style={{ color: 'var(--text-3)' }}>{' ' + note}</span>}
    </div>
  );
}

function ToastHost({ toasts }) {
  return (
    <div style={{
      position: 'fixed', bottom: 18, right: 18, zIndex: 99999,
      display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none',
    }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: 'var(--bg-surface-2)',
          color: t.kind === 'err' ? 'var(--flag-emergency)' : 'var(--text-1)',
          border: '1px solid ' + (t.kind === 'err' ? 'var(--flag-emergency)' : 'var(--border-2)'),
          borderRadius: 8, padding: '8px 12px', fontSize: 13,
          boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
          pointerEvents: 'auto', maxWidth: 360,
        }}>{t.msg}</div>
      ))}
    </div>
  );
}

// Phase-11 migration: archive priority field into a note card, and backfill
// stable ids onto existing note cards. (o.notes is the "More Information" field
// as of change8 and is no longer folded into the note stream.) Idempotent --
// safe to run more than once.
// migrateOrders / migrateSettingsForChange11 moved to ./orders-logic.js (imported at top).

// ── Service-item Library module ──────────────────────────────────────────────
// Generic source-of-truth library. Tabs are SOURCE-scoped (General / AMH), not
// PM agreements. Persists to storage key 'service_library' independent of wo_data.
// xlsx seed/import/export delegated to window.library (main process, exceljs).
export const LIBRARY_TABS = ['General', 'AMH'];
export function emptyLibrary() { return { General: [], AMH: [] }; }

// Invoice tax model (TAX_RATE/money/computeInvoiceTotals) carved out to ./invoices.jsx.

// Slice 2 (#6): seed/import/export actions over the service_library file.
// Extracted so both the (Settings) Service Library tab and any other caller
// share one implementation (rule B3 - no reimplementation). lib + persist are
// owned by the caller; this hook only runs the window.library bridge calls.
function useLibraryTools(lib, persist, toast) {
  const [busy, setBusy] = React.useState(false);
  const needLib = React.useCallback(() => {
    if (!window.library) { toast('Library tools unavailable - fully restart the app (not just reload)', 'err'); return false; }
    return true;
  }, [toast]);
  const replaceTab = (tabName, newItems, label) => {
    const cur = (lib && lib[tabName]) || [];
    if (cur.length && !window.confirm(`Replace all ${cur.length} ${tabName} items with ${newItems.length} from ${label}?`)) return false;
    persist({ ...(lib || emptyLibrary()), [tabName]: newItems });
    return true;
  };
  const seedGeneral = async () => {
    if (!needLib()) return;
    setBusy(true);
    try {
      const r = await window.library.seedGeneral('');
      if (!r || !r.ok) { toast((r && r.error) || 'Seed failed', 'err'); return; }
      if (replaceTab('General', r.items, 'workbook')) toast(`General seeded: ${r.items.length} items`);
    } catch (e) { toast(String(e.message || e), 'err'); }
    finally { setBusy(false); }
  };
  const seedAmh = async () => {
    if (!needLib()) return;
    setBusy(true);
    try {
      let r = await window.library.seedAmh('');
      if (!r || !r.ok) {
        const pick = await window.library.chooseFile();
        if (!pick || !pick.ok) return;
        r = await window.library.seedAmh(pick.path);
      }
      if (!r || !r.ok) { toast((r && r.error) || 'AMH seed failed', 'err'); return; }
      if (replaceTab('AMH', r.items, 'AMH pricing')) toast(`AMH seeded: ${r.items.length} items`);
    } catch (e) { toast(String(e.message || e), 'err'); }
    finally { setBusy(false); }
  };
  const importBackup = async () => {
    if (!needLib()) return;
    setBusy(true);
    try {
      const pick = await window.library.chooseFile();
      if (!pick || !pick.ok) return;
      const r = await window.library.importRoundtrip(pick.path);
      if (!r || !r.ok) { toast((r && r.error) || 'Import failed', 'err'); return; }
      const next = { ...emptyLibrary() };
      for (const k of Object.keys(r.tabs)) if (LIBRARY_TABS.includes(k)) next[k] = r.tabs[k];
      if (!window.confirm('Replace the current library with the imported file?')) return;
      persist(next);
      toast('Library imported');
    } catch (e) { toast(String(e.message || e), 'err'); }
    finally { setBusy(false); }
  };
  const exportBackup = async () => {
    if (!needLib()) return;
    setBusy(true);
    try {
      const r = await window.library.export(lib || emptyLibrary());
      if (r && r.ok) toast('Exported: ' + r.path);
      else if (r && !r.canceled) toast((r && r.error) || 'Export failed', 'err');
    } catch (e) { toast(String(e.message || e), 'err'); }
    finally { setBusy(false); }
  };
  return { busy, seedGeneral, seedAmh, importBackup, exportBackup };
}

// Loads + persists the service_library file. Shared by ServiceLibrary (module)
// and LibraryToolsSection (settings) so both read/write the same store.
export function useServiceLibraryStore() {
  const [lib, setLib] = React.useState(null); // null = loading
  React.useEffect(() => {
    let live = true;
    (async () => {
      try {
        const r = window.storage && await window.storage.get('service_library');
        const v = r && r.value;
        if (live) setLib(v && typeof v === 'object' ? { ...emptyLibrary(), ...v } : emptyLibrary());
      } catch { if (live) setLib(emptyLibrary()); }
    })();
    return () => { live = false; };
  }, []);
  const persist = React.useCallback((next) => {
    setLib(next);
    if (window.storage && window.storage.set) window.storage.set('service_library', next).catch(() => {});
  }, []);
  return [lib, persist];
}

export function SimpleListEditor({ title, items, setItems, onClose, singular }) {
  const [editingIdx, setEditingIdx] = React.useState(null);
  const [newName, setNewName] = React.useState('');

  const commitRename = (idx, val) => {
    const trimmed = (val || '').trim();
    if (trimmed) setItems(items.map((v, i) => i === idx ? trimmed : v));
    setEditingIdx(null);
  };

  const deleteItem = (idx) => {
    if (!window.confirm('Remove "' + items[idx] + '"?')) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const addItem = () => {
    const n = newName.trim();
    if (!n || items.includes(n)) return;
    setItems([...items, n]);
    setNewName('');
  };

  const moveItem = (idx, delta) => setItems(swapAt(items, idx, idx + delta));

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 400, maxHeight: '75vh',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
        borderRadius: 12, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        color: 'var(--text-1)',
      }}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Manage {title}</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 18, padding: 4,
          }}>{'✕'}</button>
        </div>
        <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>
          {items.map((v, idx) => (
            <div key={v} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: '1px solid var(--border-1)',
            }}>
              <ReorderBtns
                onUp={() => moveItem(idx, -1)} onDown={() => moveItem(idx, 1)}
                disableUp={idx === 0} disableDown={idx === items.length - 1}
              />
              {editingIdx === idx
                ? <InlineEdit
                    value={v}
                    onCommit={(val) => commitRename(idx, val)}
                    onCancel={() => setEditingIdx(null)}
                    style={{
                      flex: 1, fontSize: 14,
                      background: 'var(--bg-canvas)', border: '1px solid var(--accent)',
                      borderRadius: 4, padding: '3px 8px', color: 'var(--text-1)', fontFamily: 'inherit',
                    }}
                  />
                : <span
                    onDoubleClick={() => setEditingIdx(idx)}
                    title="Double-click to rename"
                    style={{ flex: 1, fontSize: 14, cursor: 'text' }}
                  >{v}</span>
              }
              <button onClick={() => setEditingIdx(idx)} title="Rename" style={{ ...miniBtnStyle, padding: '0 7px' }}>{'✎'}</button>
              <button
                onClick={() => deleteItem(idx)}
                style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px' }}
              >{'✕'}</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addItem(); }}
              placeholder={'New ' + (singular || title.toLowerCase().replace(/s$/, ''))}
              style={{
                flex: 1, padding: '7px 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-canvas)', color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 13,
              }}
            />
            <ActionBtn primary onClick={addItem}>Add</ActionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

// Settings > Service Library: data tools (seed/import/export) + sub-category
// management, moved off the module header to declutter it.
export function LibraryToolsSection({ subCats, setSubCats, toast }) {
  const [lib, persist] = useServiceLibraryStore();
  const { busy, seedGeneral, seedAmh, importBackup, exportBackup } = useLibraryTools(lib, persist, toast);
  const [subCatsOpen, setSubCatsOpen] = React.useState(false);
  const counts = LIBRARY_TABS.map(t => t + ': ' + (((lib && lib[t]) || []).length)).join(' · ');
  const tool = (label, onClick, primary) => (
    <button onClick={onClick} disabled={busy || lib === null} style={{
      height: 34, padding: '0 14px', borderRadius: 7, cursor: (busy || lib === null) ? 'default' : 'pointer',
      border: primary ? 'none' : '1px solid var(--border-2)',
      background: primary ? 'var(--accent)' : 'var(--bg-surface)',
      color: primary ? 'var(--accent-fg)' : 'var(--text-1)',
      fontFamily: 'inherit', fontSize: 13, fontWeight: 600, opacity: (busy || lib === null) ? 0.6 : 1,
    }}>{label}</button>
  );
  return (
    <div>
      <SettingTitle sub="Seed, back up, and organize the Service Library catalogs.">Service Library</SettingTitle>
      <SettingRow label="Seed catalogs" hint="Replace a catalog's items from the source workbook.">
        <div style={{ display: 'flex', gap: 8 }}>
          {tool('Seed General', seedGeneral)}
          {tool('Seed AMH', seedAmh)}
        </div>
      </SettingRow>
      <SettingRow label="Backup" hint={'Round-trip xlsx. ' + (lib === null ? '' : counts)}>
        <div style={{ display: 'flex', gap: 8 }}>
          {tool('Import...', importBackup)}
          {tool('Export...', exportBackup, true)}
        </div>
      </SettingRow>
      <SettingRow label="Sub-categories" hint="Internal grouping for service items. Never exported to CSV/xlsx.">
        {tool('Manage (' + (subCats || []).length + ')...', () => setSubCatsOpen(true))}
      </SettingRow>
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

// AddServiceItemModal + ServiceLibrary + InvoiceEditor + InvoicesModule carved out to ./invoices.jsx.
const WO_TAB_VIEWS = [
  { id: 'active',   label: 'Active' },
  { id: 'complete', label: 'Complete' },
  { id: 'trash',    label: 'Trash' },
];

// Per-module nav arrows. Lives at the top of every module header so it never
// covers content (the old full-height side rails did, and crowded the WO
// detail pane). Provided via context so every module can render the chevrons
// without prop-drilling currentModule + handlers through every component.
// Slice 4 adds a home `«` chevron pointing back to the Overview module.
// ModuleNavContext now lives in nav.jsx (imported above).
// App-wide header actions context. Powers HeaderChips on every module header
// (Add WO, attention badge, kebab menu for Export/New inbox/Modules/Settings).
// Lifted out of Sidebar in change10 slice 3.5.
const HeaderActionsContext = React.createContext({
  onAddWO: () => {}, notifications: [], onNotifClick: () => {}, onDismissNotif: () => {},
  onExportCsv: () => {}, onAddInbox: () => {}, onOpenSettings: () => {},
});
// Notification dot color by kind.
function notifDot(kind) {
  switch (kind) {
    case 'emergency': case 'overdue': return 'var(--flag-emergency)';
    case 'stale':   return 'oklch(60% 0.13 50)';
    case 'parts':   return 'oklch(60% 0.13 280)';
    case 'capture': return 'var(--accent)';
    case 'update':  return 'oklch(65% 0.15 150)';
    default:        return 'var(--text-3)';
  }
}

export function HeaderChips() {
  const a = React.useContext(HeaderActionsContext);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [bellOpen, setBellOpen] = React.useState(false);
  React.useEffect(() => {
    if (!bellOpen) return;
    const close = () => setBellOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') setBellOpen(false); };
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [bellOpen]);
  React.useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => { clearTimeout(t); document.removeEventListener('click', close); };
  }, [menuOpen]);
  const chipBtn = {
    height: 28, padding: '0 10px', borderRadius: 8,
    border: '1px solid var(--border-1)', background: 'var(--bg-surface)',
    color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, lineHeight: 1,
  };
  const iconBtn = {
    height: 28, width: 28, padding: 0, borderRadius: 8,
    border: '1px solid var(--border-1)', background: 'var(--bg-surface)',
    color: 'var(--text-2)', fontFamily: 'inherit', fontSize: 14,
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
  };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button onClick={a.onAddWO} style={{
        ...chipBtn,
        background: 'var(--accent)', color: 'var(--accent-fg)', borderColor: 'var(--accent)', fontWeight: 600,
      }} title="Add work order">
        <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> Add WO
      </button>
      <div style={{ position: 'relative' }}>
        <button onClick={(e) => { e.stopPropagation(); setBellOpen(o => !o); }} style={{
          ...iconBtn, position: 'relative',
          ...(a.notifications.length ? { borderColor: 'var(--flag-emergency)', color: 'var(--flag-emergency)' } : null),
        }} title="Notifications">
          {'◉'}
          {a.notifications.length > 0 && (
            <span style={{
              position: 'absolute', top: -5, right: -5, minWidth: 16, height: 16, padding: '0 4px',
              borderRadius: 8, background: 'var(--flag-emergency)', color: '#fff',
              fontSize: 10, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
            }}>{a.notifications.length}</span>
          )}
        </button>
        {bellOpen && (
          <div onClick={(e) => e.stopPropagation()} style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 6,
            width: 340, maxHeight: 420, overflowY: 'auto',
            background: 'var(--bg-surface)', border: '1px solid var(--border-2)',
            borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.5)', padding: '6px 0', zIndex: 60,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 14px 8px' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                Notifications
              </span>
              {a.notifications.length > 0 && a.onMarkAllRead && (
                <span onClick={(e) => { e.stopPropagation(); a.onMarkAllRead(); }}
                  title="Mark all read" style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}>Mark all read</span>
              )}
            </div>
            {a.notifications.length === 0 ? (
              <div style={{ padding: '14px', fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>Nothing to report.</div>
            ) : a.notifications.map(n => (
              <div key={n.id}
                onClick={() => { setBellOpen(false); a.onNotifClick(n); }}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 12px 8px 14px', cursor: 'pointer', borderTop: '1px solid var(--border-1)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ width: 7, height: 7, borderRadius: 4, marginTop: 5, flexShrink: 0, background: notifDot(n.kind) }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                  {n.sub && <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 1 }}>{n.sub}</div>}
                </div>
                {n.id.startsWith('ev-') && a.onDismissNotif && (
                  <span onClick={(e) => { e.stopPropagation(); a.onDismissNotif(n.id); }}
                    title="Dismiss" style={{ color: 'var(--text-3)', cursor: 'pointer', padding: '0 4px', fontSize: 14, lineHeight: 1 }}>{'×'}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <button onClick={a.onOpenSettings} style={iconBtn} title="Settings">{'⚙'}</button>
      <div style={{ position: 'relative' }}>
        <button onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o); }} style={iconBtn} title="More">{'⋯'}</button>
        {menuOpen && (
          <div style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 4,
            minWidth: 180, background: 'var(--bg-surface)',
            border: '1px solid var(--border-2)', borderRadius: 8,
            boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
            padding: '4px 0', zIndex: 60,
          }}>
            <MenuItem onClick={() => { setMenuOpen(false); a.onExportCsv && a.onExportCsv(); }}>Export view CSV</MenuItem>
            <MenuItem onClick={() => { setMenuOpen(false); a.onAddInbox && a.onAddInbox(); }}>New inbox...</MenuItem>
          </div>
        )}
      </div>
    </div>
  );
}
// ModuleNavChevrons removed: the fold-out NavWing (nav.jsx) replaces the
// per-module-header prev/next/home arrows.
// Placeholder for the Maps module. Full implementation lands in change10 slice 7
// (Google Maps Embed API). Renders an empty module shell that matches the other
// modules' header style so layout/nav still work while the feature is being built.
// Maps module (change10 slice 7, Leaflet+OSM pivot). Uses Leaflet.js
// (CDN in <head>) rendering OpenStreetMap tiles. Geocoding via OSM's
// Nominatim service (free, 1 req/sec usage policy, attribution required).
// No API key. No signup. No billing.
//
// All visible WOs are plotted at once. The geocache lives in
// settings.geocache so cold loads after the first session are instant; the
// queue worker only hits Nominatim for new or previously-failed addresses.
// Accuracy is "good enough to eyeball" - techs route on their phones.
// MapsModule carved out to ./maps.jsx (imported at top).

// ModuleLauncher removed: the fold-out NavWing (nav.jsx) replaces the
// fullscreen module-picker overlay.

// ── Itinerary module ──────────────────────────────────────────────────────────
// Daily, single-tech timeline. Pick a tech + day; drag active WOs from the
// unscheduled pool onto 30-min slots (8:00 AM - 6:00 PM). Drag a scheduled
// block to another slot to change its start time. Click a block for a popover
// to move it to a different day/tech or unschedule. End times are intentionally
// not modeled (job length varies). schedule lives on the WO as {date,start};
// tech is order.tech (kept in sync by setSchedule).
const ITIN_START_MIN = 8 * 60;   // 8:00 AM
const ITIN_END_MIN   = 18 * 60;  // 6:00 PM
const ITIN_STEP_MIN  = 30;
export function itinSlots() {
  const out = [];
  for (let m = ITIN_START_MIN; m < ITIN_END_MIN; m += ITIN_STEP_MIN) {
    out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  }
  return out;
}
export function itinFmtTime(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return hhmm || '';
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
export function itinTodayStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
export function itinShiftDay(dateStr, delta) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, mo - 1, d + delta, 12);
  const p = (n) => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}
export function itinDayLabel(dateStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, mo - 1, d, 12);
  return dt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
// MM/DD (American) from 'YYYY-MM-DD'.
export function itinDayMonth(dateStr) {
  const [y, mo, d] = String(dateStr || '').split('-').map(Number);
  if (!d) return '';
  return String(mo).padStart(2, '0') + '/' + String(d).padStart(2, '0');
}
// "MM/DD h:mm AM" for a {date,start} schedule, or '' if unscheduled.
export function fmtSchedule(dateStr, start) {
  if (!dateStr) return '';
  return itinDayMonth(dateStr) + ' ' + itinFmtTime(start);
}
// Snap an arbitrary 'HH:MM' to the nearest valid timeline slot string.
export function itinSnapSlot(start) {
  const all = itinSlots();
  if (all.includes(start)) return start;
  const [h, m] = String(start || '').split(':').map(Number);
  if (Number.isNaN(h)) return all[0];
  let mins = h * 60 + (m || 0);
  mins = Math.max(ITIN_START_MIN, Math.min(ITIN_END_MIN - ITIN_STEP_MIN, mins));
  const snapped = Math.round(mins / ITIN_STEP_MIN) * ITIN_STEP_MIN;
  return String(Math.floor(snapped / 60)).padStart(2, '0') + ':' + String(snapped % 60).padStart(2, '0');
}

// ItineraryModule carved out to ./itinerary.jsx (imported at top).

export const navBtnStyle = {
  padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-1)',
  background: 'var(--bg-surface)', color: 'var(--text-1)', fontSize: 13, cursor: 'pointer',
};

// Scheduling form launched from the WO context menu. Assign a technician + a
// timeframe (day + 30-min start). Prefills from any existing schedule.
function ScheduleModal({ order, techs, onSubmit, onUnschedule, onClose, activeOrders, geocache, techJobTypes, routingWeights, onPick }) {
  const slots = React.useMemo(() => itinSlots(), []);
  const [tech, setTech] = React.useState(order.tech || techs[0] || '');
  const [date, setDate] = React.useState((order.schedule && order.schedule.date) || itinTodayStr());
  const [start, setStart] = React.useState((order.schedule && order.schedule.start) || slots[0]);
  const [routeTab, setRouteTab] = React.useState('suggested'); // 'suggested' | 'closeby'
  const { addr, city } = splitAddress(order);
  const fld = {
    display: 'block', marginTop: 4, width: '100%', padding: '8px', borderRadius: 8,
    border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 14,
  };
  const lbl = { fontSize: 12, color: 'var(--text-3)' };

  // Slice 5 (#10): nearby suggestions relative to THIS WO (the anchor). Memoized
  // on the inputs; anchor is a single WO so only O(N) distances per recompute.
  const byId = React.useMemo(() => new Map((activeOrders || []).map(o => [o.id, o])), [activeOrders]);
  const routing = React.useMemo(() => {
    if (!onPick) return null; // routing not wired
    const gc = geocache || {};
    const anchorGeo = gc[order.id] && gc[order.id].lat != null ? gc[order.id] : null;
    const scheduledIds = new Set((activeOrders || []).filter(o => o.schedule && o.schedule.date).map(o => o.id));
    const cityCounts = {};
    for (const o of (activeOrders || [])) {
      if (scheduledIds.has(o.id)) continue;
      const ck = String(o.city || '').toLowerCase();
      if (ck) cityCounts[ck] = (cityCounts[ck] || 0) + 1;
    }
    return scoreCandidates({
      anchor: order, anchorGeo, candidates: activeOrders || [],
      geoOf: (id) => (gc[id] && gc[id].lat != null ? gc[id] : null),
      tech, techJobTypes: techJobTypes || {}, weights: routingWeights,
      scheduledIds, cityCounts,
    });
  }, [onPick, order, activeOrders, geocache, tech, techJobTypes, routingWeights]);

  const routeRows = routing ? (routeTab === 'suggested' ? routing.suggested : routing.closeBy) : [];

  return (
    <Modal open onClose={onClose} title={'Schedule ' + order.id} width={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{addr || '(no address)'}{city ? ', ' + city : ''}</div>
        {routing && (
          <div style={{ border: '1px solid var(--border-1)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border-1)' }}>
              {[['suggested', 'Suggested'], ['closeby', 'Close By']].map(([id, label]) => (
                <button key={id} onClick={() => setRouteTab(id)} style={{
                  flex: 1, height: 30, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                  background: routeTab === id ? 'var(--bg-row-sel)' : 'var(--bg-surface)',
                  color: routeTab === id ? 'var(--text-1)' : 'var(--text-3)',
                  borderBottom: routeTab === id ? '2px solid var(--accent)' : '2px solid transparent',
                }}>{label}</button>
              ))}
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {routing.noAnchor ? (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>No map location for this WO — can't suggest nearby. Re-geocode it in Maps.</div>
              ) : routeRows.length === 0 ? (
                <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-3)' }}>
                  {routeTab === 'suggested' ? 'No unscheduled WOs match this tech’s job types nearby.' : 'No other unscheduled WOs with a location.'}
                </div>
              ) : routeRows.slice(0, 30).map(r => {
                const o = byId.get(r.id); if (!o) return null;
                const a = splitAddress(o);
                return (
                  <button key={r.id} onClick={() => onPick(r.id)} title="Open this WO to set its time" style={{
                    display: 'flex', width: '100%', alignItems: 'baseline', gap: 8, padding: '6px 12px',
                    border: 'none', borderTop: '1px solid var(--border-1)', background: 'transparent',
                    color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, textAlign: 'left',
                  }}>
                    <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{o.id}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-2)' }}>
                      {a.addr || '(no address)'}{a.city ? ', ' + a.city : ''}
                    </span>
                    <span style={{ flexShrink: 0, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{r.km.toFixed(1)} km</span>
                  </button>
                );
              })}
            </div>
            {!routing.noAnchor && routing.skipped > 0 && (
              <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-3)', borderTop: '1px solid var(--border-1)' }}>
                {routing.skipped} skipped (no location)
              </div>
            )}
          </div>
        )}
        <label style={lbl}>Technician
          <select value={tech} onChange={(e) => setTech(e.target.value)} style={fld}>
            {!techs.includes(tech) && tech === '' && <option value="">(none)</option>}
            {techs.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={lbl}>Day
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={fld} />
        </label>
        <label style={lbl}>Start time
          <select value={start} onChange={(e) => setStart(e.target.value)} style={fld}>
            {slots.map(s => <option key={s} value={s}>{itinFmtTime(s)}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          {order.schedule && <ActionBtn onClick={onUnschedule}>Unschedule</ActionBtn>}
          <ActionBtn onClick={onClose}>Cancel</ActionBtn>
          <ActionBtn primary onClick={() => onSubmit(tech, { date, start })}>Save</ActionBtn>
        </div>
      </div>
    </Modal>
  );
}

// Shown when sending a WO to invoice with no bid recorded. User may enter the
// bid now, or skip and send anyway (enter it later in the invoice editor).
function BidPromptModal({ order, onEnter, onSkip, onClose, verb = 'send' }) {
  const [amount, setAmount] = React.useState('');
  const inputRef = React.useRef(null);
  // Explicit focus (autoFocus inside a freshly-mounted Modal can be cleared in
  // the same React-18 commit, leaving the field unresponsive).
  React.useEffect(() => { if (inputRef.current) inputRef.current.focus(); }, []);
  const { addr, city } = splitAddress(order);
  const fld = {
    display: 'block', marginTop: 4, width: '100%', padding: '8px', borderRadius: 8,
    border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 14,
  };
  return (
    <Modal open onClose={onClose} title={'No bid on ' + order.id} width={420}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {addr || '(no address)'}{city ? ', ' + city : ''} has no bid amount. Enter it now or skip and add it later.
        </div>
        <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Bid amount
          <input ref={inputRef} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="$0.00"
            onKeyDown={(e) => { if (e.key === 'Enter' && amount.trim()) onEnter(amount.trim()); }} style={fld} />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <ActionBtn onClick={onClose}>Cancel</ActionBtn>
          <ActionBtn onClick={onSkip}>Skip & {verb}</ActionBtn>
          <ActionBtn primary disabled={!amount.trim()} onClick={() => amount.trim() && onEnter(amount.trim())}>Save bid & {verb}</ActionBtn>
        </div>
      </div>
    </Modal>
  );
}

// Post-import review modal. Lists each WO that was just imported or updated
// so the user can spot scraper errors before the batch disappears into the
// active list. Inline flag toggles for Emergency / Warranty. Click a row to
// jump to its detail in the WO module.
function ImportInspectModal({ state, orders, onClose, onWoAction, onSelectWO }) {
  if (!state) return null;
  const warnByNum = state.warnByNum || {};
  const items = (state.batch || []).map(b => {
    const o = orders.find(x => x.id === b.id);
    const key = o ? String(o.woId || '').replace(/^WO-/i, '').trim() : '';
    return { ...b, o, warnings: warnByNum[key] || [] };
  }).filter(x => x.o);
  const newCount = items.filter(x => x.isNew).length;
  const updatedCount = items.length - newCount;
  const issueCount = items.filter(x => x.warnings.length).length;
  // AMH passes the true modified total (clean updates aren't listed as rows);
  // other importers fall back to the row-derived count.
  const modifiedCount = state.modifiedCount != null ? state.modifiedCount : updatedCount;
  return (
    <Modal open onClose={onClose} title={'Imported ' + items.length + ' work order' + (items.length === 1 ? '' : 's')} width={820}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {newCount > 0 && (newCount + ' new')}
          {newCount > 0 && modifiedCount > 0 && ' · '}
          {modifiedCount > 0 && (modifiedCount + ' modified')}
          {state.dupSkipped ? ' · ' + state.dupSkipped + ' duplicate(s) skipped' : ''}
          {issueCount > 0 && (<span style={{ color: 'var(--flag-emergency)' }}>{' · ' + issueCount + ' with issue'}</span>)}
          . Review before they merge into the active list.
        </div>
        <div style={{
          border: '1px solid var(--border-1)', borderRadius: 8,
          maxHeight: '60vh', overflowY: 'auto',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-surface)', color: 'var(--text-3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>WO #</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>Address</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>Client</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>Type</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>Tech</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid var(--border-1)' }}>Flags</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid var(--border-1)' }}>Edit</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>State</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ id, isNew, o, warnings }) => {
                const { addr, city } = splitAddress(o);
                return (
                  <tr key={id} style={{ borderBottom: '1px solid var(--border-1)' }}>
                    <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      <span onClick={() => { onSelectWO && onSelectWO(id); onClose(); }} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
                        {id}
                      </span>
                    </td>
                    <td style={{ padding: '8px 10px', color: 'var(--text-1)' }}>
                      {addr || <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>(no address)</span>}
                      {city && <span style={{ color: 'var(--text-2)' }}>{', ' + city}</span>}
                      {warnings.length > 0 && (
                        <div style={{ fontSize: 11, color: 'var(--flag-emergency)', marginTop: 2 }}>
                          {'Issue: ' + warnings.join('; ')}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{o.pm || '-'}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{o.type || '-'}</td>
                    <td style={{ padding: '8px 10px', color: 'var(--text-2)' }}>{o.tech || <span style={{ color: 'var(--text-3)' }}>-</span>}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <button
                        onClick={() => onWoAction && onWoAction(id, 'toggleEmergency')}
                        title={o.emergency ? 'Clear emergency' : 'Mark emergency'}
                        style={{
                          height: 24, padding: '0 8px', marginRight: 4,
                          border: '1px solid ' + (o.emergency ? 'var(--flag-emergency)' : 'var(--border-2)'),
                          background: o.emergency ? 'var(--flag-emergency)' : 'transparent',
                          color: o.emergency ? '#fff' : 'var(--text-2)',
                          borderRadius: 4, fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}
                      >Emerg</button>
                      <button
                        onClick={() => onWoAction && onWoAction(id, 'toggleWarranty')}
                        title={o.warranty ? 'Clear warranty' : 'Mark warranty'}
                        style={{
                          height: 24, padding: '0 8px',
                          border: '1px solid ' + (o.warranty ? 'var(--flag-warranty)' : 'var(--border-2)'),
                          background: o.warranty ? 'var(--flag-warranty)' : 'transparent',
                          color: o.warranty ? '#fff' : 'var(--text-2)',
                          borderRadius: 4, fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}
                      >War</button>
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                      <button
                        onClick={() => onWoAction && onWoAction(id, 'editDetails')}
                        title="Edit fields (fix scraper mistakes)"
                        style={{
                          height: 24, padding: '0 10px',
                          border: '1px solid var(--border-2)',
                          background: 'transparent',
                          color: 'var(--text-1)',
                          borderRadius: 4, fontFamily: 'inherit', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                        }}
                      >Edit</button>
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: 11, color: isNew ? 'var(--accent)' : 'var(--text-3)' }}>
                      {isNew ? 'NEW' : 'updated'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            height: 36, padding: '0 16px',
            background: 'var(--accent)', color: 'var(--accent-fg)',
            border: 'none', borderRadius: 8,
            fontFamily: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>Done</button>
        </div>
      </div>
    </Modal>
  );
}

function App() {
  const [selectedWO, setSelectedWO] = React.useState(null);
  // coOpen separates "command center is open" from "row is highlighted in the
  // list". Needed for the keyboard contract: arrow keys walk/highlight the list
  // (selectedWO) without popping the overlay; Enter/click opens (coOpen). While
  // open, arrows restack the overlay to the newly highlighted WO. Closing keeps
  // the highlight so arrow-walking continues. selectedWO alone can't encode both.
  const [coOpen, setCoOpen] = React.useState(false);
  // Ordered list of WO ids currently visible in the list pane (post
  // filter/sort/group/collapse). Reported up by ListPane so the overlay's
  // prev/next walk the exact same order the user sees -- no recompute/drift.
  const [visibleOrder, setVisibleOrder] = React.useState([]);
  const [quickJumpOpen, setQuickJumpOpen] = React.useState(false);
  const [recentWOs, setRecentWOs] = React.useState([]);
  const pushRecent = React.useCallback((id) => {
    if (!id) return;
    setRecentWOs(prev => [id, ...prev.filter(x => x !== id)].slice(0, 5));
  }, []);
  // Open the command center for a WO (click / Enter / external jump). highlightWO
  // only moves the list selection (arrow keys) -- it restacks an already-open
  // overlay but never opens a closed one.
  const openWO = React.useCallback((id) => { if (!id) return; setSelectedWO(id); pushRecent(id); setCoOpen(true); }, [pushRecent]);
  const highlightWO = React.useCallback((id) => { if (!id) return; setSelectedWO(id); pushRecent(id); }, [pushRecent]);
  // Ctrl/Cmd+K toggles the quick-jump palette anywhere in the app.
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setQuickJumpOpen(o => !o); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const [currentView, setCurrentView] = React.useState('active');
  // Slice 5 (change10): top-level module + launcher overlay + invoice editor.
  // Default to the Overview module on app launch. Page reload resets to
  // overview by design; Continue button on Overview navigates to the
  // user's last-used non-overview module (persisted in settings.lastModule).
  const [currentModule, setCurrentModule] = React.useState('overview');
  // Launch session: Continue button on first Overview view always targets
  // Work Orders regardless of persisted lastModule. Flips to false the first
  // time the user leaves Overview; subsequent returns honor lastModule.
  const [launchPhase, setLaunchPhase] = React.useState(true);
  React.useEffect(() => {
    if (launchPhase && currentModule !== 'overview') setLaunchPhase(false);
  }, [currentModule, launchPhase]);
  // Itinerary focus request from the WO context menu (jump/add to schedule).
  // { tech, date, highlightId, ts } — ts forces the module to re-apply.
  const [itinFocus, setItinFocus] = React.useState(null);
  // Itinerary tech selection lifted to App so it persists across module navigation
  // within a session. Page reload resets to 'ALL' (default) by design.
  const [itinTech, setItinTech] = React.useState('ALL');
  // WO id whose scheduling form (assign tech + timeframe) is open, or null.
  const [scheduleTarget, setScheduleTarget] = React.useState(null);
  // WO id awaiting a bid-entry decision before sending to invoice, or null.
  const [bidPrompt, setBidPrompt] = React.useState(null);
  const [invoiceEditorWO, setInvoiceEditorWO] = React.useState(null);
  const [editorLibrary, setEditorLibrary] = React.useState({ General: [], AMH: [] });

  const [data, updateOrder, batchUpdate, updateSettings, addOrder, deleteOrderHard,
         addPreset, updatePreset, deletePreset, deleteOrdersHard, upsertOrders, updateData,
         addInbox, renameInbox, deleteInbox, addToInbox, removeFromInbox, reorderInbox] = useWorkOrders();
  const loading = data === null;
  const orders  = data?.orders  || [];
  // Auto-switch Itinerary tech when entering Itinerary with a scheduled
  // selected WO whose tech differs from the current Itinerary tech. Sticks
  // otherwise. Fires only on the transition INTO Itinerary, not while there.
  const prevModuleRef = React.useRef(currentModule);
  React.useEffect(() => {
    const prev = prevModuleRef.current;
    prevModuleRef.current = currentModule;
    if (currentModule !== 'itinerary' || prev === 'itinerary') return;
    if (!selectedWO) return;
    const o = orders.find(x => x.id === selectedWO);
    if (!o || !o.schedule || !o.tech) return;
    if (o.tech === itinTech) return;
    setItinFocus({ tech: o.tech, date: o.schedule.date, highlightId: selectedWO, ts: Date.now() });
  }, [currentModule, selectedWO, orders, itinTech]);
  const presets = data?.presets || [];
  const inboxes = data?.inboxes || [];
  const phases  = Array.isArray(data?.phases) ? data.phases : DEFAULT_PHASES;
  const statusColors = data?.statusColors || DEFAULT_STATUS_COLORS;
  const statuses = data?.statuses || DEFAULT_STATUSES;
  const settings = data?.settings || {};
  const lastModule = settings.lastModule || 'work-orders';
  const [pendingSettingsSection, setPendingSettingsSection] = React.useState(null);
  // Maps selected WO lifted to App so context-menu "Jump to Map" from any
  // module can pre-select a WO before navigating to Maps. Resets on reload.
  const [mapsSelected, setMapsSelected] = React.useState(null);
  // Lifted so the maps job-type filter persists across module switches (resets on
  // reload, like itinTech). { 'P'|'H'|'PH': true } = hidden.
  const [mapsHiddenTypes, setMapsHiddenTypes] = React.useState({});
  // Shared route stops (ordered WO ids), lifted from MapsModule so Itinerary
  // can read/write the same route. Session-local; does not persist.
  const [routeStops, setRouteStops] = React.useState([]);
  // Import inspect modal: shown after extension import to let user review
  // newly-imported WOs before they vanish into the active list. Cleared
  // when user clicks Done.
  const [importInspect, setImportInspect] = React.useState(null);
  // mapsDefaultView is always derived from the Settings office address (written
  // by saveHome). The per-point "Set this point as default view" override was
  // deprecated — the default is always the office.
  const mapsDefaultView = settings.mapsDefaultView || DEFAULT_MAPS_VIEW;
  const mapsHomeState = settings.mapsHomeState || '';
  const mapsHomeZip = settings.mapsHomeZip || '';
  const mapsHomeAddress = settings.mapsHomeAddress || '';
  const mapsHomeCity = settings.mapsHomeCity || '';
  const locationIqKey = settings.locationIqKey || '';
  const setLocationIqKey = React.useCallback((k) => updateSettings({ locationIqKey: (k || '').trim() }), [updateSettings]);
  const mapMarkerColors = settings.mapMarkerColors || null;
  const setMapMarkerColors = React.useCallback((v) => updateSettings({ mapMarkerColors: v }), [updateSettings]);
  const mapTypeColors = settings.mapTypeColors || null;
  const setMapTypeColors = React.useCallback((v) => updateSettings({ mapTypeColors: v }), [updateSettings]);
  // toastRef trampoline: saveHome is declared above the toast callback in
  // this component. The ref is wired later so the function can call back
  // into toast without a temporal-dead-zone error.
  const toastRef = React.useRef(null);
  // Toast system. Declared here (above saveHome and every hook that lists
  // `toast` in its dependency array) so esbuild's preserved `const` does not
  // hit a temporal-dead-zone error at render. (Babel's old `env` preset
  // rewrote this to `var`, hiding the ordering bug.)
  const [toasts, setToasts] = React.useState([]);
  const toast = React.useCallback((msg, kind = '') => {
    const id = Date.now() + Math.random();
    setToasts(ts => [...ts, { id, msg, kind }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 4500);
  }, []);
  React.useEffect(() => { toastRef.current = toast; }, [toast]);
  // saveHome geocodes the combined home fields (zip required; address +
  // state optional) and writes both the raw fields and the derived
  // mapsDefaultView in one call so the map can always center on Home.
  const saveHome = React.useCallback(({ zip, addr, city, state }) => {
    const z = String(zip || '').trim();
    const a = String(addr || '').trim();
    const c = String(city || '').trim();
    const s = String(state || '').trim().toUpperCase().slice(0, 2);
    const tt = (m, k) => { if (toastRef.current) toastRef.current(m, k); };
    if (!/^\d{5}$/.test(z)) { tt('Zipcode must be 5 digits', 'err'); return; }
    updateSettings({ mapsHomeZip: z, mapsHomeAddress: a, mapsHomeCity: c, mapsHomeState: s });

    const writeResult = (lat, lon) => {
      // One level wider than typical block/neighborhood to give context
      // without being disorienting. User can zoom in manually.
      const zoom = a ? 13 : 10;
      updateSettings({ mapsDefaultView: { lat: +lat.toFixed(5), lon: +lon.toFixed(5), zoom } });
      tt('Home view updated');
    };
    const parseOne = (arr) => {
      if (!Array.isArray(arr) || !arr.length) return null;
      const lat = parseFloat(arr[0].lat), lon = parseFloat(arr[0].lon);
      if (!isFinite(lat) || !isFinite(lon)) return null;
      return { lat, lon };
    };

    // Pass 1: structured. Pass 2: free-text q= fallback (handles highway
    // notations like "US-70 W" that the structured street parser drops).
    const p1 = new URLSearchParams();
    p1.set('format', 'json'); p1.set('limit', '1'); p1.set('country', 'US'); p1.set('countrycodes', 'us');
    if (a) p1.set('street', a);
    if (c) p1.set('city', c);
    if (s) p1.set('state', s);
    p1.set('postalcode', z);

    const p2 = new URLSearchParams();
    p2.set('format', 'json'); p2.set('limit', '1'); p2.set('countrycodes', 'us');
    const q = [a, c, s, z].filter(Boolean).join(', ');
    p2.set('q', q);

    fetch('https://nominatim.openstreetmap.org/search?' + p1.toString(), { headers: { 'Accept-Language': 'en' } })
      .then(r => r.json())
      .then(arr => {
        const hit = parseOne(arr);
        if (hit) { writeResult(hit.lat, hit.lon); return; }
        // Fallback after a 1.1s pause to respect Nominatim usage policy.
        return new Promise(res => setTimeout(res, 1100))
          .then(() => fetch('https://nominatim.openstreetmap.org/search?' + p2.toString(), { headers: { 'Accept-Language': 'en' } }))
          .then(r => r.json())
          .then(arr2 => {
            const hit2 = parseOne(arr2);
            if (hit2) writeResult(hit2.lat, hit2.lon);
            else tt('Home lookup failed - try a nearby intersection or the city + zip alone', 'err');
          });
      })
      .catch(() => tt('Home lookup failed', 'err'));
  }, [updateSettings]);
  // Maps geocache: persistent per-WO {lat, lon} or {error:true} stored in
  // settings.geocache so the Maps module loads instantly on cold start and
  // Nominatim only gets called once per address. Uses updateSettings, which
  // reads dataRef.current synchronously inside the hook, so back-to-back
  // calls in the same tick still merge correctly (no stale-closure race).
  const geocache = settings.geocache || {};
  const setGeocacheEntry = React.useCallback((id, value) => {
    updateSettings((cur) => ({ geocache: { ...((cur && cur.geocache) || {}), [id]: value } }));
  }, [updateSettings]);
  // geocacheClearTick increments on every bulk clear. The geocoder worker
  // effect lists it as a dep so a Clear-cache action restarts the queue
  // even though `activeOrders` itself did not change. Per-entry writes
  // (single regeocode, successful Nominatim hits) do not bump the tick,
  // so the worker is not constantly cancelled and restarted.
  const [geocacheClearTick, setGeocacheClearTick] = React.useState(0);
  const clearGeocache = React.useCallback(() => {
    updateSettings({ geocache: {} });
    setGeocacheClearTick(t => t + 1);
  }, [updateSettings]);
  const geocacheCount = React.useMemo(() => Object.keys(geocache).length, [geocache]);
  // Persist the last-used non-overview module so the Overview Continue button
  // returns the user to wherever they were working.
  React.useEffect(() => {
    if (currentModule && currentModule !== 'overview' && currentModule !== lastModule) {
      updateSettings({ lastModule: currentModule });
    }
  }, [currentModule, lastModule, updateSettings]);
  const theme = (settings && settings.theme) || 'dark';
  const setTheme = React.useCallback((t) => updateSettings({ theme: t }), [updateSettings]);
  const density = (settings && settings.density) || 'balanced';
  const setDensity = React.useCallback((d) => updateSettings({ density: d }), [updateSettings]);
  const alertThresholds = (settings && settings.alertThresholds) || DEFAULT_ALERT_THRESHOLDS;
  const setAlertThresholds = React.useCallback((th) => updateSettings({ alertThresholds: th }), [updateSettings]);
  // Slice 2 (#3): overdue-schedule config. Memoized on settings.overdue so the
  // Maps marker effect (which takes it as a dep) does not rebuild markers on
  // unrelated App re-renders. OVERDUE_CFG global feeds render-time consumers.
  const overdueCfg = React.useMemo(() => ({ ...DEFAULT_OVERDUE_CFG, ...((settings && settings.overdue) || {}) }), [settings && settings.overdue]);
  OVERDUE_CFG = overdueCfg;
  const setOverdueCfg = React.useCallback((v) => updateSettings({ overdue: v }), [updateSettings]);
  // Minute tick so overdue indicators flip live as the clock passes thresholds.
  const [overdueTick, setOverdueTick] = React.useState(0);
  React.useEffect(() => {
    const t = setInterval(() => setOverdueTick(x => x + 1), 60000);
    return () => clearInterval(t);
  }, []);
  // Slice 2 (#6): Service Library sub-categories. Internal organization only —
  // never written to the xlsx export (exportLibrary whitelists fields).
  const librarySubCats = (settings && Array.isArray(settings.librarySubCats)) ? settings.librarySubCats : [];
  const setLibrarySubCats = React.useCallback((v) => updateSettings({ librarySubCats: v }), [updateSettings]);
  // Slice 3 (#8): Tech Job Types. The WO's existing `type` field IS the trade
  // (no separate tradeList/tradeTag — that duplicated settings.types + wo.type +
  // mapTypeColors). techJobTypes is the only new state: keyed by tech NAME, then
  // by type NAME. Routing (slice 5) reads techJobTypes[tech][wo.type].{selected,weight}.
  const techJobTypes = (settings && settings.techJobTypes && typeof settings.techJobTypes === 'object') ? settings.techJobTypes : {};
  const setTechJobTypes = React.useCallback((v) => updateSettings({ techJobTypes: v }), [updateSettings]);
  // Slice 5 (#10): per-tech route color + tunable routing weights.
  const techColors = (settings && settings.techColors && typeof settings.techColors === 'object') ? settings.techColors : {};
  const setTechColors = React.useCallback((v) => updateSettings({ techColors: v }), [updateSettings]);
  const routingWeights = React.useMemo(() => ({ ...DEFAULT_ROUTING_WEIGHTS, ...((settings && settings.routingWeights) || {}) }), [settings && settings.routingWeights]);
  const setRoutingWeights = React.useCallback((v) => updateSettings({ routingWeights: v }), [updateSettings]);
  const setPhases = React.useCallback((p) => updateData({ phases: p }), [updateData]);
  const setStatuses = React.useCallback((s) => updateData({ statuses: s }), [updateData]);
  const setStatusColors = React.useCallback((sc) => updateData({ statusColors: sc }), [updateData]);
  // Slice 4 (#9): status -> system-tag map. See SYSTEM_TAGS.
  const statusTags = (settings && settings.statusTags && typeof settings.statusTags === 'object') ? settings.statusTags : {};
  const setStatusTags = React.useCallback((v) => updateSettings({ statusTags: v }), [updateSettings]);
  const moreInfoColor = (typeof data?.moreInfoColor === 'string' && data.moreInfoColor) || DEFAULT_MORE_INFO_COLOR;
  const setMoreInfoColor = React.useCallback((c) => updateData({ moreInfoColor: c }), [updateData]);
  // change10 queue #5: per-variable CSS custom-theme overrides. Stored in
  // settings.customTheme as { '--var-name': '#hex', ... }. Merged over the
  // base theme at themeVars assignment. Empty object = no overrides.
  const customTheme = (settings && settings.customTheme) || {};
  const setCustomTheme = React.useCallback((v) => updateSettings({ customTheme: v && typeof v === 'object' ? v : {} }), [updateSettings]);
  const pms   = (data?.pms   && data.pms.length)   ? data.pms   : DEFAULT_PMS.slice();
  const setPms   = React.useCallback((v) => updateData({ pms: v }),   [updateData]);
  // B2: renaming a Client CODE cascades to every WO's o.pm so no WO orphans
  // (requirement #2). Atomic single write of pms + orders. NOTE: AMH/MSR codes
  // are re-emitted by the scraper, so renaming those codes orphans FUTURE imports
  // -- the editor steers users to edit the full name, not the code, for those.
  const renameClientCode = React.useCallback((oldCode, newCode) => {
    const o = (oldCode || '').trim(), n = (newCode || '').trim();
    if (!n || o === n) return;
    const nextPms    = pms.map(p => p.name === o ? { ...p, name: n } : p);
    const nextOrders = orders.map(w => w.pm === o ? { ...w, pm: n } : w);
    updateData({ pms: nextPms, orders: nextOrders });
  }, [pms, orders, updateData]);
  const types = ((data?.types && data.types.length) ? data.types : DEFAULT_TYPES.slice())
    .filter(t => String(t).toLowerCase() !== 'other');
  const setTypes = React.useCallback((v) => updateData({ types: v }), [updateData]);
  const techs = (data?.techs && data.techs.length) ? data.techs : DEFAULT_TECHS.slice();
  const setTechs = React.useCallback((v) => updateData({ techs: v }), [updateData]);
  const trayEnabled = settings.trayEnabled !== false;
  const setTrayEnabled = React.useCallback((v) => updateSettings({ trayEnabled: v !== 'off' }), [updateSettings]);
  const trayBadgeSource = settings.trayBadgeSource || 'attention';
  const setTrayBadgeSource = React.useCallback((v) => updateSettings({ trayBadgeSource: v }), [updateSettings]);
  const resetSettings = React.useCallback(() => {
    const ok = window.confirm(
      'Reset all settings to defaults? Your work orders will NOT be affected. Continue?'
    );
    if (!ok) return;
    // Preserve migrationApplied so the migration dialog does not re-fire.
    const preserved = { migrationApplied: settings.migrationApplied || MIGRATION_VERSION };
    updateSettings({
      theme: 'dark',
      density: 'balanced',
      alertThresholds: DEFAULT_ALERT_THRESHOLDS,
      overdue: DEFAULT_OVERDUE_CFG,
      trayEnabled: true,
      trayBadgeSource: 'attention',
      viewSorts: {},
      ...preserved,
    });
  }, [settings, updateSettings]);
  const restorePreMigrationBackup = React.useCallback(async () => {
    if (!window.storage || !window.storage.get || !window.storage.set) {
      toast('Storage unavailable', 'err');
      return;
    }
    let snap;
    try {
      const r = await window.storage.get('wo_data_pre_migration_backup');
      if (!r || !r.value) {
        toast('No pre-migration backup found', 'err');
        return;
      }
      snap = r.value;
    } catch {
      toast('Could not read backup', 'err');
      return;
    }
    const ok = window.confirm(
      'Restore pre-migration backup? This REPLACES your current work order data with the snapshot taken just before the migration. Cannot be undone (the current data will be lost). Continue?'
    );
    if (!ok) return;
    try {
      await window.storage.set('wo_data', snap);
      toast('Backup restored. Reloading...');
      // Hard-reload to re-hydrate App state from the restored snapshot.
      setTimeout(() => location.reload(), 600);
    } catch {
      toast('Restore failed', 'err');
    }
  }, [toast]);
  const needsMigration = !loading && settings && settings.migrationApplied !== MIGRATION_VERSION;
  const [backupBeforeApply, setBackupBeforeApply] = React.useState(true);
  // NOTE: backup is automatic via main.js rotateBackups() on every writeStore.
  // No toast() here -- `toast` is declared further down; dialog dismissal is
  // the user-visible signal that the migration applied.
  const applyMigration = React.useCallback(async () => {
    // Phase 14 (change8) + change11: one-off wo_data snapshot for explicit
    // migration rollback. Each migration version writes to its own backup key
    // so an earlier rollback target is not overwritten by a later upgrade.
    if (backupBeforeApply && window.storage && window.storage.get && window.storage.set) {
      try {
        const r = await window.storage.get('wo_data');
        if (r && r.value) {
          await window.storage.set('wo_data_pre_migration_backup', r.value);
          await window.storage.set('wo_data_pre_change11_backup', r.value);
        }
      } catch { /* swallow -- migration proceeds regardless */ }
    }
    // change11: pass stored phases so migrateOrders can detect WOs in
    // complete-marked phases and flip them to tab='complete'.
    const storedPhases = (data && data.phases) || DEFAULT_PHASES;
    const migratedOrders = migrateOrders(orders, storedPhases);
    const settingsPatch = migrateSettingsForChange11(data || {});
    updateData({
      orders: migratedOrders,
      ...settingsPatch,
      settings: { ...settings, migrationApplied: MIGRATION_VERSION },
    });
  }, [orders, settings, data, updateData, backupBeforeApply]);
  const skipMigration  = React.useCallback(() => { updateSettings({ migrationApplied: MIGRATION_VERSION }); }, [updateSettings]);

  // change11 self-healing reconciler (v3). Runs once when settings.change11Reconciled_v3 !== '1'.
  // Re-examined the premise after two failed reconciler passes:
  //
  //  The original migrateOrders never actually ran for many users because the
  //  installed tray-app intercepted the dev npm start at that moment, so its
  //  pre-change11 migrateOrders set migrationApplied='3.0' WITHOUT flipping
  //  any tabs. By the time the new code finally loaded, migrationApplied was
  //  already '3.0' and the dialog never reappeared. Reconcilers ran but only
  //  handled active->complete, not paid/invoiced->sent.
  //
  //  Plus: user's actual completion statuses are CUSTOM — "Job Complete -
  //  Enter Bid", "Bid Submitted - Job Complete" — not 'Pending-Complete' or
  //  'Closed'. The user's phases use custom ids (ph_*) so legacy id detection
  //  also misses. The reliable signal is "status string contains 'Job
  //  Complete'" (case-insensitive). The legacy signals are kept as fallbacks
  //  for any older datasets that DO have them.
  React.useEffect(() => {
    if (loading || !settings) return;
    if (settings.change11Reconciled_v6 === '1') return;
    const storedPhases = (data && Array.isArray(data.phases)) ? data.phases : DEFAULT_PHASES;
    // Pure core in ./orders-logic.js (passes 0-4 + counters). Side effects
    // (settings patch, write, toast) stay here.
    const {
      orders: finalOrders, flipped, promotedFromInvoiced, hardcodedComplete,
      hardcodedCancelled, revertedFromComplete, expiredCleared,
    } = reconcileChange11(orders, storedPhases);
    const patch = migrateSettingsForChange11(data || {});
    const phasesChanged   = JSON.stringify(patch.phases)   !== JSON.stringify(storedPhases);
    const statusesChanged = JSON.stringify(patch.statuses) !== JSON.stringify((data && data.statuses) || []);
    const colorsChanged   = patch.statusColors && JSON.stringify(patch.statusColors) !== JSON.stringify((data && data.statusColors) || {});
    const touched = (flipped > 0) || (promotedFromInvoiced > 0) || (hardcodedComplete > 0) || (hardcodedCancelled > 0) || (expiredCleared > 0) || (revertedFromComplete > 0);
    const wrote = {};
    if (touched) wrote.orders = finalOrders;
    if (phasesChanged) wrote.phases = patch.phases;
    if (statusesChanged) wrote.statuses = patch.statuses;
    if (colorsChanged) wrote.statusColors = patch.statusColors;
    wrote.settings = { ...settings, change11Reconciled_v6: '1' };
    updateData(wrote);
    if (toast && touched) {
      const parts = [];
      if (flipped) parts.push(flipped + ' moved to Complete');
      if (revertedFromComplete) parts.push(revertedFromComplete + ' restored to Active (narrower completion rule)');
      if (promotedFromInvoiced) parts.push(promotedFromInvoiced + ' moved to Sent');
      if (hardcodedComplete) parts.push(hardcodedComplete + ' Complete status set');
      if (hardcodedCancelled) parts.push(hardcodedCancelled + ' Cancelled status set');
      if (expiredCleared) parts.push(expiredCleared + ' expired schedule' + (expiredCleared === 1 ? '' : 's') + ' cleared');
      toast('change11 reconcile: ' + parts.join(', '));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Standalone auto-unschedule for subsequent loads (after the change11
  // reconciler ran once). The first-load pass is handled INSIDE the reconciler
  // to avoid a race over the same orders write. This effect waits until the
  // reconciler's gate is set, then takes over on every load + orders mutation.
  // Idempotent: writes only when something was cleared, so it terminates.
  React.useEffect(() => {
    if (loading || !Array.isArray(orders)) return;
    if (!(settings && settings.change11Reconciled_v6 === '1')) return;
    const today = itinTodayStr();
    let cleared = 0;
    const next = orders.map(o => {
      if (!o || !o.schedule || !o.schedule.date) return o;
      if (o.schedule.date >= today) return o;
      cleared++;
      const clone = { ...o };
      const wasDate = clone.schedule.date;
      delete clone.schedule;
      clone.history = [...(Array.isArray(o.history) ? o.history : []),
        { ts: Date.now(), action: 'auto-unscheduled (expired)', detail: 'was ' + wasDate }];
      return clone;
    });
    if (cleared > 0) {
      updateData({ orders: next });
      if (toast) toast('Cleared ' + cleared + ' expired schedule' + (cleared === 1 ? '' : 's'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, orders, settings && settings.change11Reconciled_v6]);

  const viewSorts = (settings && settings.viewSorts) || {};
  const currentSort = viewSorts[currentView] || { key: 'created', dir: 'desc' };
  const setSort = React.useCallback((s) => {
    updateSettings({ viewSorts: { ...viewSorts, [currentView]: s } });
  }, [viewSorts, currentView, updateSettings]);
  const [query, setQuery] = React.useState('');
  const [filters, setFilters] = React.useState({ pm: '', type: '', status: '', tech: '' });

  // Modal state
  const [modal, setModal] = React.useState(null); // null | 'add' | { kind: 'edit', id }
  const [namePrompt, setNamePrompt] = React.useState(null); // text-input modal state
  const editTarget = (modal && modal.kind === 'edit') ? orders.find(o => o.id === modal.id) : null;

  // Toast system moved up (TDZ fix): toast/toastRef now sit just below the
  // toastRef declaration near saveHome.

  // Update banner state
  const [updateState, setUpdateState] = React.useState(null);
  const [captureStatus, setCaptureStatus] = React.useState(null);
  const msrBannerTimer = React.useRef(null);
  // New MSR WO numbers found on a portal list page but not yet in the tracker.
  const [newMsrWos, setNewMsrWos] = React.useState(null);
  // Notification events (capture/scraper results). Session-only; alerts + overdue
  // are derived live (see `notifications` memo), these are the non-derivable events.
  const [notifEvents, setNotifEvents] = React.useState([]);
  // Read-state for the bell: id -> readAt(ms). Clicking (or Mark all read) marks
  // a notification read so it drops off the counter. DERIVED notifs (overdue/
  // alert) re-activate once the re-nag window elapses (overdue-threshold setting)
  // so a stale WO is never lost; capture events are removed outright on click.
  const [notifReads, setNotifReads] = React.useState({});
  const pushNotif = React.useCallback((ev) => {
    setNotifEvents(prev => [{ id: 'ev-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), ts: Date.now(), ...ev }, ...prev].slice(0, 30));
  }, []);
  const dismissNotif = React.useCallback((id) => setNotifEvents(prev => prev.filter(n => n.id !== id)), []);
  const ordersRef = React.useRef([]);
  // Keep the latest orders reachable from the one-time onFoundWos listener.
  React.useEffect(() => { ordersRef.current = orders; }, [orders]);

  // Phase 16: paint the tray icon with the Gamble brand. Renderer
  // rasterizes GambleMark, ships the PNG to main, main does
  // tray.setImage. Runs once per app launch. If anything fails the
  // tray keeps the fallback assets/icon.png from ensureTray() and
  // no toast is raised -- this is cosmetic, not functional.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.tray || !window.tray.setIcon) return;
      try {
        // 32 px is the upper bound the Windows tray will use; macOS
        // takes 22 logical px at 2x. 64 covers HiDPI on both.
        const buf32  = await renderGambleMarkPng(32);
        const buf64  = await renderGambleMarkPng(64);
        const buf256 = await renderGambleMarkPng(256);
        if (cancelled) return;
        if (buf32 && buf64 && buf256) {
          window.tray.setIcon({ x1: buf32, x2: buf64, xWin: buf256 });
        }
      } catch (e) {
        // Swallow: cosmetic upgrade, fallback icon remains.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Bulk selection
  const [selectedIds, setSelectedIds] = React.useState(new Set());
  const lastClickedIdxRef = React.useRef(null);

  const clearSelection = React.useCallback(() => {
    setSelectedIds(new Set());
    lastClickedIdxRef.current = null;
  }, []);

  React.useEffect(() => { clearSelection(); }, [currentView]);

  // One-time bridge listeners
  React.useEffect(() => {
    if (window.extensionBridge && window.extensionBridge.onImport) {
      window.extensionBridge.onImport((incoming) => {
        // An import arriving clears the in-flight MSR capture banner.
        if (msrBannerTimer.current) { clearTimeout(msrBannerTimer.current); msrBannerTimer.current = null; }
        setCaptureStatus(null);
        const { dupSkipped, trashedSkipped, trashedWos, batch } = upsertOrders(incoming);
        // Existing WOs are updated SILENTLY (in place, no modal); only genuinely
        // new WOs are surfaced in the import-review modal.
        const arr = Array.isArray(batch) ? batch : [];
        const newBatch = arr.filter(b => b.isNew);
        const updated = arr.length - newBatch.length;
        const parts = [];
        if (newBatch.length) parts.push(`${newBatch.length} new`);
        if (updated)         parts.push(`${updated} updated`);
        if (dupSkipped)      parts.push(`${dupSkipped} skipped`);
        // round5 A4 / #13: tell the user which cancelled/trashed WOs were rejected.
        if (trashedSkipped)  parts.push(`${trashedSkipped} rejected (in Trash${trashedWos && trashedWos.length ? ': ' + trashedWos.join(', ') : ''})`);
        if (parts.length) toast('Import: ' + parts.join(' · '));
        if (newBatch.length) {
          // Notification instead of an auto-popping modal (no work interruption);
          // clicking the item opens the import-review modal on demand.
          pushNotif({ kind: 'capture', captureType: 'import', title: newBatch.length + ' new WO' + (newBatch.length === 1 ? '' : 's') + ' captured',
            sub: 'Click to review and add', payload: { batch: newBatch, ts: Date.now(), dupSkipped } });
        }
        if (window.extensionBridge.acknowledge) window.extensionBridge.acknowledge();
      });
    }
    if (window.extensionBridge && window.extensionBridge.onFoundWos) {
      // Extension scanned an MSR list page; diff its WO numbers against the
      // tracker and surface the ones not yet added.
      window.extensionBridge.onFoundWos((items) => {
        // Results arrived: clear the in-flight scan banner (mirror onImport).
        if (msrBannerTimer.current) { clearTimeout(msrBannerTimer.current); msrBannerTimer.current = null; }
        setCaptureStatus(null);
        const arr = Array.isArray(items) ? items : [];
        const normNum = s => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
        // Split known (active) from trashed (deleted). Trashed WOs were
        // intentionally cancelled — a scan must NOT resurface them as "new"
        // (same class as the AMH captureAllAMH deleted-skip; ref v4.5.0).
        const known = new Set();
        const trashed = new Set();
        for (const o of ordersRef.current) {
          const n = normNum(o.woId) || normNum(o.id);
          if (!n) continue;
          if (o.deleted) trashed.add(n); else known.add(n);
        }
        const seen = new Set();
        const fresh = [];
        let trashedSkipped = 0;
        for (const it of arr) {
          const n = normNum(it.num);
          if (!n || known.has(n) || seen.has(n)) continue;
          seen.add(n);
          if (trashed.has(n)) { trashedSkipped++; continue; }
          fresh.push({ num: it.num, url: it.url });
        }
        // Notification instead of auto-popping the modal; click opens the list.
        pushNotif({ kind: 'capture', captureType: 'msr', title: fresh.length ? (fresh.length + ' new MSR WO' + (fresh.length === 1 ? '' : 's')) : 'MSR scan: no new WOs',
          sub: fresh.length ? 'Click to review' : (arr.length + ' scanned, all in tracker'), payload: { items: fresh, scanned: arr.length } });
        toast(fresh.length ? (fresh.length + ' new MSR WO(s) found' + (trashedSkipped ? ', ' + trashedSkipped + ' cancelled skipped' : ''))
                           : (trashedSkipped ? trashedSkipped + ' cancelled skipped; no new MSR WOs' : 'No new MSR WOs on this list'));
      });
    }
    if (window.updater && window.updater.onStatus) {
      window.updater.onStatus((d) => {
        // Toast the two meaningful, rare transitions so the user gets popup
        // feedback even if the in-flow banner isn't noticed. (available/ready
        // only ever fire in a packaged build with a real newer release.) The
        // Settings "Check for updates" button already toasts checking/failure.
        const tt = toastRef.current;
        if (tt && d && d.status === 'available') tt('Update available' + (d.version ? ' v' + d.version : '') + ' — downloading…');
        if (tt && d && d.status === 'ready')     tt('Update ready' + (d.version ? ' v' + d.version : '') + ' — restart to install');
        // Sticky: once a real update is in flight (available/downloading/ready),
        // ignore a later transient 'none'/'error' so the banner can't flash away
        // mid-update. A fresh 'checking' or real status still overrides.
        setUpdateState(prev => {
          const inFlight = prev && (prev.status === 'available' || prev.status === 'downloading' || prev.status === 'ready');
          if (inFlight && d && (d.status === 'none' || d.status === 'error')) return prev;
          return d;
        });
      });
    }
  }, []);

  const checkForUpdates = React.useCallback(async () => {
    if (!window.updater || !window.updater.check) { toast('Updater unavailable', 'err'); return; }
    toast('Checking for updates...');
    try {
      const r = await window.updater.check();
      if (r && r.ok === false) toast('Update check failed: ' + (r.error || 'unknown'), 'err');
    } catch (e) { toast('Update check failed', 'err'); }
  }, [toast]);

  // Partitions
  // change11: tab model is { active, complete, sent, trash }. Invoiced + Paid
  // retired (migrated to 'sent' via migrateOrders).
  const activeOrders   = React.useMemo(() => orders.filter(o => !o.deleted && (o.tab || 'active') === 'active'),  [orders]);
  const completeOrders = React.useMemo(() => orders.filter(o => !o.deleted && o.tab === 'complete'),              [orders]);
  // Maps + Itinerary share the active-only universe (Complete + Sent + Trash
  // already drop out of scheduling per change11). No phase-complete filter
  // needed now that the deprecated `complete:true` phase flag is gone.
  const mapOrders = activeOrders;
  // App-level Nominatim geocoder. Runs whenever activeOrders changes (app
  // startup, after import). Walks the active list and geocodes any address
  // not in the cache at 1.1s spacing. Progress is exposed via state so the
  // Maps module (or any future surface) can show the progress bar without
  // running its own worker.
  //
  // Accuracy strategy (per user "maximum effort" request):
  //   1. Structured query (street/city/state/country) instead of free q=.
  //   2. countrycodes=us forces US results.
  //   3. viewbox derived from settings.mapsDefaultView (lat/lon +/- 2 deg)
  //      with bounded=1 to REQUIRE results inside the box. If user did not
  //      configure a default view we cannot bound; results may stray.
  //   4. Optional state qualifier (settings.mapsHomeState) keeps street
  //      matches in the correct US state when the viewbox is loose.
  //   5. addressdetails=1 lets us cross-check the returned state. If it
  //      does not match mapsHomeState, mark the entry suspect (still
  //      cached, but markers render in orange and tooltips warn).
  //   6. Distance from default view > 250km flagged suspect too.
  //   7. If bounded search returns nothing, fall back to ONE unbounded
  //      attempt; that result is automatically suspect unless distance +
  //      state both pass.
  const [geocodeProgress, setGeocodeProgress] = React.useState(null);
  const geocacheRef = React.useRef(geocache);
  React.useEffect(() => { geocacheRef.current = geocache; }, [geocache]);
  const settingsRef = React.useRef(settings);
  React.useEffect(() => { settingsRef.current = settings; }, [settings]);
  React.useEffect(() => {
    if (loading) return;
    const list = activeOrders;
    if (!list.length) { setGeocodeProgress(null); return; }
    let cancelled = false;

    // haversineKm hoisted to module scope (Slice 5).

    // Parse street / city / state / zip from a WO. Pulls trailing
    // ", ST 12345" out of the address itself so cross-state WOs do not
    // get forced into the home state.
    const parseWO = (wo) => {
      const { addr: rawAddr, city: rawCity } = splitAddress(wo);
      let street = String(rawAddr || '').trim();
      let city = String(rawCity || '').trim();
      let state = '';
      let zip = '';
      // Trailing ", ST 12345" or ", ST"
      const m1 = street.match(/,\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\s*$/i);
      const m2 = !m1 && street.match(/,\s*([A-Z]{2})\s*$/i);
      const m3 = !m1 && !m2 && street.match(/\b(\d{5})(?:-\d{4})?\s*$/);
      if (m1)      { state = m1[1].toUpperCase(); zip = m1[2]; street = street.slice(0, m1.index).trim(); }
      else if (m2) { state = m2[1].toUpperCase();              street = street.slice(0, m2.index).trim(); }
      else if (m3) { zip   = m3[1];                            street = street.slice(0, m3.index).trim(); }
      // Explicit o.zip field overrides if address didn't include one.
      // Supports the future scraper rework where zip is captured into a
      // dedicated field instead of stuffed into the address string.
      if (!zip && wo.zip) {
        const z = String(wo.zip).match(/\d{5}/);
        if (z) zip = z[0];
      }
      // Sometimes the city slipped into the street if splitAddress had
      // nothing to anchor on. Try to peel a trailing ", City" off the
      // street if city is empty.
      if (!city) {
        const m4 = street.match(/,\s*([^,]+)\s*$/);
        if (m4) { city = m4[1].trim(); street = street.slice(0, m4.index).trim(); }
      }
      // Clean stray trailing commas.
      street = street.replace(/,+\s*$/, '').trim();
      return { street, city, state, zip };
    };

    const buildUrl = (wo, opts) => {
      const s = settingsRef.current || {};
      const parsed = parseWO(wo);
      const home = s.mapsHomeState || '';
      const state = parsed.state || home;
      if (opts && opts.provider === 'census-structured') {
        // US Census Geocoder structured. Free, no key, residential-grade
        // US coverage. Returns {result:{addressMatches:[{coordinates:{x,y}}]}}.
        const p = new URLSearchParams();
        p.set('street', parsed.street);
        if (parsed.city) p.set('city', parsed.city);
        if (state) p.set('state', state);
        if (parsed.zip) p.set('zip', parsed.zip);
        p.set('benchmark', 'Public_AR_Current');
        p.set('format', 'json');
        return 'https://geocoding.geo.census.gov/geocoder/locations/address?' + p.toString();
      }
      if (opts && opts.provider === 'census-oneline') {
        // Census one-line. More forgiving of formatting.
        const p = new URLSearchParams();
        const one = [parsed.street, parsed.city, state, parsed.zip].filter(Boolean).join(', ');
        p.set('address', one);
        p.set('benchmark', 'Public_AR_Current');
        p.set('format', 'json');
        return 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' + p.toString();
      }
      if (opts && opts.provider === 'locationiq') {
        // LocationIQ Forward Geocoding (key required). Same response shape
        // as Nominatim, so evaluate() handles it as 'nominatim' kind.
        const key = s.locationIqKey || '';
        const p = new URLSearchParams();
        p.set('key', key);
        p.set('format', 'json');
        p.set('limit', '1');
        p.set('addressdetails', '1');
        p.set('countrycodes', 'us');
        if (opts.mode === 'free') {
          const q = [parsed.street, parsed.city, state, parsed.zip].filter(Boolean).join(', ');
          p.set('q', q);
        } else {
          if (parsed.street) p.set('street', parsed.street);
          if (parsed.city)   p.set('city', parsed.city);
          if (state)         p.set('state', state);
          if (parsed.zip)    p.set('postalcode', parsed.zip);
        }
        return 'https://us1.locationiq.com/v1/search?' + p.toString();
      }
      if (opts && opts.provider === 'photon') {
        // Photon (Komoot): free, no key, fuzzy matching on OSM data. Often
        // resolves residential streets that Nominatim misses.
        const p = new URLSearchParams();
        p.set('q', [parsed.street, parsed.city, state, parsed.zip].filter(Boolean).join(', '));
        p.set('limit', '1');
        const view = s.mapsDefaultView;
        if (view && isFinite(view.lat) && isFinite(view.lon)) {
          p.set('lat', String(view.lat));
          p.set('lon', String(view.lon));
        }
        return 'https://photon.komoot.io/api/?' + p.toString();
      }
      // Nominatim fallback.
      const params = new URLSearchParams();
      params.set('format', 'json');
      params.set('limit', '1');
      params.set('addressdetails', '1');
      params.set('countrycodes', 'us');
      if (opts && opts.mode === 'free') {
        const q = [parsed.street, parsed.city, state, parsed.zip].filter(Boolean).join(', ');
        params.set('q', q);
      } else {
        params.set('street', parsed.street);
        if (parsed.city) params.set('city', parsed.city);
        if (state) params.set('state', state);
        if (parsed.zip) params.set('postalcode', parsed.zip);
      }
      const view = s.mapsDefaultView;
      if (view && isFinite(view.lat) && isFinite(view.lon)) {
        const dLat = 3.0, dLon = 3.0;
        params.set('viewbox', [view.lon - dLon, view.lat + dLat, view.lon + dLon, view.lat - dLat].join(','));
        if (opts && opts.bounded) params.set('bounded', '1');
      }
      return 'https://nominatim.openstreetmap.org/search?' + params.toString();
    };

    // Normalizes any provider response and validates against the WO's
    // expected state + city + home distance. Returns null on no match.
    const normCity = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const evaluate = (data, providerKind, expectedCity) => {
      let lat, lon, returnedStateRaw = '', returnedCity = '';
      if (providerKind === 'census') {
        const matches = data && data.result && data.result.addressMatches;
        if (!Array.isArray(matches) || !matches.length) return null;
        const c = matches[0].coordinates || {};
        lat = parseFloat(c.y); lon = parseFloat(c.x);
        const addr = matches[0].addressComponents || {};
        returnedStateRaw = addr.state || '';
        returnedCity = addr.city || '';
      } else if (providerKind === 'photon') {
        const feats = data && data.features;
        if (!Array.isArray(feats) || !feats.length) return null;
        const coords = feats[0].geometry && feats[0].geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return null;
        lon = parseFloat(coords[0]); lat = parseFloat(coords[1]);
        const props = feats[0].properties || {};
        returnedStateRaw = props.state || '';
        returnedCity = props.city || '';
      } else {
        if (!Array.isArray(data) || !data.length) return null;
        const hit = data[0];
        lat = parseFloat(hit.lat); lon = parseFloat(hit.lon);
        const a = hit.address || {};
        returnedStateRaw = (a.state_code || a.state || '').toString();
        returnedCity = a.city || a.town || a.village || a.hamlet || a.municipality || '';
      }
      if (!isFinite(lat) || !isFinite(lon)) return null;
      const s = settingsRef.current || {};
      const home = (s.mapsHomeState || '').toUpperCase();
      const view = s.mapsDefaultView;
      let suspect = false;
      const reasons = [];
      if (home && returnedStateRaw && !stateMatches(home, returnedStateRaw)) {
        suspect = true; reasons.push('state ' + returnedStateRaw + ' != home ' + home);
      }
      // City mismatch no longer fires the suspect flag on its own (scraper
      // can produce wrong cities, which then mismatch a correctly-located
      // result). Recorded as a note so it still surfaces in the popup.
      let cityNote = '';
      if (expectedCity && returnedCity) {
        const a = normCity(expectedCity);
        const b = normCity(returnedCity);
        if (a && b && a !== b && !a.includes(b) && !b.includes(a)) {
          cityNote = 'returned ' + returnedCity + ', WO says ' + expectedCity;
          reasons.push('city: ' + cityNote);
        }
      }
      if (view && isFinite(view.lat) && isFinite(view.lon)) {
        const km = haversineKm(view.lat, view.lon, lat, lon);
        // 100km radius covers a typical metro service area. Anything farther
        // is almost certainly a geocoder error.
        if (km > 100) { suspect = true; reasons.push('distance ' + Math.round(km) + 'km'); }
      }
      return { lat, lon, suspect, reasons, returnedCity, returnedStateRaw };
    };

    (async () => {
      while (!cancelled) {
        const cache = geocacheRef.current || {};
        const nextWO = list.find(o => !cache[o.id]);
        if (!nextWO) { setGeocodeProgress(null); break; }
        const cached = list.reduce((n, o) => (cache[o.id] ? n + 1 : n), 0);
        setGeocodeProgress({ done: cached, total: list.length });
        const { addr } = splitAddress(nextWO);
        if (!addr) {
          setGeocacheEntry(nextWO.id, { error: true });
        } else {
          // Three-pass strategy. Each pass is followed by the 1.1s pace
          // delay so we never exceed Nominatim's 1 req/sec policy. evaluate()
          // alone decides suspect status - structured-fallback or free-text
          // results are NOT auto-suspect; if they're in the right state +
          // within range, they're trusted.
          const tryPass = async (opts, label) => {
            const url = buildUrl(nextWO, opts);
            const kind = opts.provider && opts.provider.startsWith('census') ? 'census'
                       : opts.provider === 'photon' ? 'photon'
                       : 'nominatim'; // locationiq + nominatim share response shape
            const expectedCity = splitAddress(nextWO).city || '';
            try {
              const r = await fetch(url, { headers: { 'Accept-Language': 'en' } });
              if (!r.ok) {
                console.log('[geocode]', nextWO.id, label, 'HTTP', r.status, url);
                return null;
              }
              const data = await r.json();
              const result = evaluate(data, kind, expectedCity);
              console.log('[geocode]', nextWO.id, label,
                result ? (result.suspect ? 'SUSPECT ' + result.reasons.join('|') : 'ok') : 'NO_RESULT',
                url);
              return result;
            } catch (e) {
              console.log('[geocode]', nextWO.id, label, 'EXCEPTION', e.message, url);
              return null;
            }
          };
          // LocationIQ first (best US residential coverage), then OSM /
          // Census fallbacks. City-bounded viewbox was tried and hurt
          // accuracy (LocationIQ's city-name centroid sometimes lands
          // outside town limits) - reverted in favor of trusting the
          // structured city/state filter plus the post-fetch city
          // validation in evaluate().
          let result = null;
          const hasLiq = !!(settingsRef.current && settingsRef.current.locationIqKey);
          if (hasLiq) {
            result = await tryPass({ provider: 'locationiq' }, 'liq-struct');
            if (!cancelled && !result) {
              await new Promise(r => setTimeout(r, 1100));
              if (!cancelled) result = await tryPass({ provider: 'locationiq', mode: 'free' }, 'liq-free');
            }
            if (!cancelled && !result) await new Promise(r => setTimeout(r, 1100));
          }
          if (!cancelled && !result) result = await tryPass({ provider: 'census-structured' }, 'census-struct');
          if (!cancelled && !result) {
            await new Promise(r => setTimeout(r, 1100));
            if (!cancelled) result = await tryPass({ provider: 'census-oneline' }, 'census-oneline');
          }
          if (!cancelled && !result) {
            await new Promise(r => setTimeout(r, 1100));
            if (!cancelled) result = await tryPass({ provider: 'photon' }, 'photon');
          }
          if (!cancelled && !result) {
            await new Promise(r => setTimeout(r, 1100));
            if (!cancelled) result = await tryPass({ bounded: true }, 'nom-struct-bounded');
          }
          if (!cancelled && !result) {
            await new Promise(r => setTimeout(r, 1100));
            if (!cancelled) result = await tryPass({ bounded: false }, 'nom-struct-open');
          }
          if (!cancelled && !result) {
            await new Promise(r => setTimeout(r, 1100));
            if (!cancelled) result = await tryPass({ mode: 'free' }, 'nom-free');
          }
          if (cancelled) break;
          if (result) {
            setGeocacheEntry(nextWO.id, {
              lat: result.lat, lon: result.lon,
              suspect: !!result.suspect,
              reasons: result.reasons,
              returnedCity: result.returnedCity || '',
              returnedState: result.returnedStateRaw || '',
            });
          } else {
            setGeocacheEntry(nextWO.id, { error: true });
          }
        }
        if (!cancelled) await new Promise(r => setTimeout(r, 1100));
      }
    })();
    return () => { cancelled = true; };
  }, [activeOrders, loading, setGeocacheEntry, geocacheClearTick]);
  const sentOrders     = React.useMemo(() => orders.filter(o => !o.deleted && o.tab === 'sent'),                 [orders]);
  const trashOrders    = React.useMemo(() => orders.filter(o => o.deleted),                                      [orders]);
  const alerts       = React.useMemo(() => loading ? [] : computeAlerts(orders, alertThresholds),              [orders, loading, alertThresholds]);

  // Unified notification list for the header bell dropdown. Derived (live):
  // schedule-overdue + the stale/emergency/parts alerts + an app-update item.
  // Session events (capture results) appended. Replaces the old attention view.
  const notifications = React.useMemo(() => {
    const out = [];
    if (!loading) {
      for (const o of orders) {
        if (o.deleted || (o.tab && o.tab !== 'active')) continue;
        // 'onsite'-tagged status = tech actively working the job: schedule is
        // immune to overdue (no overdue notification). 'visited' still clears
        // the schedule elsewhere; onsite keeps it but silences the nag.
        if (statusTags[o.status] === 'onsite') continue;
        if (o.schedule && o.schedule.date && isOverdueSched(o.schedule.date, o.schedule.start)) {
          out.push({ id: 'overdue-' + o.id, kind: 'overdue', title: 'Overdue · ' + o.id,
            sub: fmtSchedule(o.schedule.date, o.schedule.start) + (o.tech ? ' · ' + o.tech : ''), wo: o.id });
        }
      }
    }
    for (const a of alerts) out.push({ id: 'alert-' + (a.wo || a.kind), kind: a.kind, title: (a.wo || a.kind), sub: a.blurb, wo: a.wo });
    // Status vocab must match main.js update-status: available -> downloading -> ready.
    // ('downloaded' is never emitted; using it dropped the notif mid-download and
    // never surfaced the ready-to-install item.)
    if (updateState && (updateState.status === 'available' || updateState.status === 'downloading' || updateState.status === 'ready')) {
      out.push({ id: 'update', kind: 'update', title: 'App update available', sub: updateState.status === 'ready' ? 'Ready to install' : 'Downloading…', update: true });
    }
    for (const e of notifEvents) out.push(e);
    // Drop notifs the user has marked read. Updates always show; derived notifs
    // (overdue/alert) re-surface once the re-nag window (overdue-threshold
    // minutes) elapses so nothing is permanently lost.
    const now = Date.now();
    const renagMs = (overdueCfg.thresholdMinutes || 60) * 60000;
    return out.filter(n => {
      if (n.update) return true;
      const readAt = notifReads[n.id];
      return !readAt || (now - readAt) >= renagMs;
    });
  }, [orders, alerts, notifEvents, updateState, overdueTick, loading, statusTags, notifReads, overdueCfg]);
  // Click a notification: WO items open the command center; capture items open
  // their review modal; the update item installs.
  const onNotifClick = React.useCallback((n) => {
    if (!n) return;
    // Mark read so it drops off the counter. Capture events are removed outright
    // (their payload is a point-in-time snapshot — avoid acting on stale data).
    if (n.id) setNotifReads(r => ({ ...r, [n.id]: Date.now() }));
    if (String(n.id).startsWith('ev-')) dismissNotif(n.id);
    if (n.wo) { setCurrentModule('work-orders'); setCurrentView('active'); openWO(n.wo); }
    else if (n.captureType === 'import' && n.payload) setImportInspect(n.payload);
    else if (n.captureType === 'msr' && n.payload) setNewMsrWos(n.payload);
    else if (n.update) { if (window.updater && window.updater.install) window.updater.install(); }
  }, [openWO, dismissNotif]);
  // Mark all currently-shown notifications read (counter -> 0). Capture events
  // are cleared entirely; derived notifs re-surface after the re-nag window.
  const markAllNotifsRead = React.useCallback(() => {
    const now = Date.now();
    setNotifReads(r => {
      const next = { ...r };
      for (const n of notifications) next[n.id] = now;
      return next;
    });
    setNotifEvents([]);
  }, [notifications]);

  // Push tray state whenever relevant values change.
  React.useEffect(() => {
    if (!window.tray || !window.tray.setState) return;
    const recents = recentWOs
      .map(id => orders.find(o => o.id === id))
      .filter(Boolean)
      .map(o => ({ id: o.id, address: o.address || '' }));
    const attentionCount = alerts.length;
    const activeCount = orders.filter(o => (o.tab || 'active') === 'active' && !o.deleted).length;
    window.tray.setState({
      enabled: trayEnabled,
      badgeSource: trayBadgeSource,
      attentionCount,
      activeCount,
      recents,
    });
  }, [trayEnabled, trayBadgeSource, recentWOs, orders, alerts]);

  // React to tray click actions (add, open, select WO).
  React.useEffect(() => {
    if (!window.tray || !window.tray.onAction) return;
    window.tray.onAction((payload) => {
      if (!payload) return;
      if (payload.kind === 'add')    setModal('add');
      if (payload.kind === 'open')   setCurrentView('active');
      if (payload.kind === 'select' && payload.wo) {
        setSelectedWO(payload.wo);
        pushRecent(payload.wo);
        setCurrentView('active');
      }
    });
  }, []);

  // change11: bulk Send to Trash mirrors the single-WO softDelete semantics —
  // hardcodes status='Cancelled', saves prevStatus, unschedules, sets tab.
  const bulkSendToTrash = React.useCallback(() => {
    const ts = Date.now();
    batchUpdate(
      o => selectedIds.has(o.id),
      cur => {
        const next = {
          ...cur,
          deleted: true,
          tab: 'trash',
          prevStatus: cur.prevStatus || cur.status || 'Open',
          status: 'Cancelled',
        };
        if (next.schedule) delete next.schedule;
        next.history = [...(cur.history || []),
          { ts, action: 'sent to Trash (bulk)', detail: 'status: ' + (cur.status || '') + ' → Cancelled' }];
        return next;
      }
    );
    toast(selectedIds.size + ' sent to Trash');
    clearSelection();
  }, [selectedIds, batchUpdate, toast, clearSelection]);

  // change11: bulk Restore mirrors the single-WO restore semantics — reverts
  // the hardcoded Cancelled status to prevStatus, clears prevStatus, sets
  // tab='active'. Leaves prevStatus='Open' fallback for WOs trashed before
  // change11 (no prevStatus saved).
  const bulkRestore = React.useCallback(() => {
    const ts = Date.now();
    batchUpdate(
      o => selectedIds.has(o.id),
      cur => {
        const restored = cur.prevStatus || 'Open';
        const next = { ...cur, deleted: false, status: restored, tab: 'active' };
        delete next.prevStatus;
        next.history = [...(cur.history || []),
          { ts, action: 'restored (bulk)', detail: 'status: Cancelled → ' + restored }];
        return next;
      }
    );
    toast(selectedIds.size + ' restored');
    clearSelection();
  }, [selectedIds, batchUpdate, toast, clearSelection]);

  const bulkHardDelete = React.useCallback(() => {
    deleteOrdersHard(Array.from(selectedIds));
    toast(selectedIds.size + ' deleted permanently');
    clearSelection();
  }, [selectedIds, deleteOrdersHard, toast, clearSelection]);

  // change11: bulk send-to-invoice only applies to Complete tab. Filters
  // selection accordingly. Also auto-unschedules each moved WO.
  const bulkSendToInvoice = React.useCallback(() => {
    const ts = Date.now();
    const targets = orders.filter(o => selectedIds.has(o.id) && o.tab === 'complete');
    if (!targets.length) { toast('No Complete-tab WOs selected', 'err'); return; }
    const missing = targets.filter(o => !o.bidAmount);
    if (missing.length) { toast(missing.length + ' WO(s) missing bid amount - add before invoicing', 'err'); return; }
    batchUpdate(
      o => selectedIds.has(o.id) && o.tab === 'complete',
      cur => {
        const next = { ...cur, tab: 'sent' };
        if (next.schedule) delete next.schedule;
        next.history = [...(cur.history || []), { ts, action: 'sent to billing queue (bulk)', detail: '' }];
        return next;
      }
    );
    toast(targets.length + ' sent to invoice');
    clearSelection();
  }, [selectedIds, orders, batchUpdate, toast, clearSelection]);

  // change11: NEW bulk Mark Complete (Active → Complete).
  const bulkMarkComplete = React.useCallback(() => {
    const ts = Date.now();
    const targets = orders.filter(o => selectedIds.has(o.id) && (o.tab || 'active') === 'active');
    if (!targets.length) { toast('No active WOs selected', 'err'); return; }
    batchUpdate(
      o => selectedIds.has(o.id) && (o.tab || 'active') === 'active',
      cur => {
        const next = { ...cur, tab: 'complete' };
        if (next.schedule) delete next.schedule;
        next.history = [...(cur.history || []), { ts, action: 'marked complete (bulk)', detail: '' }];
        return next;
      }
    );
    toast(targets.length + ' marked complete');
    clearSelection();
  }, [selectedIds, orders, batchUpdate, toast, clearSelection]);

  // change11: bulk Set Status mirrors the single-WO auto-flip. If the target
  // status is a completion status (Pending-Complete, Closed, or contains
  // 'Job Complete'), Active WOs flip to Complete with status hardcoded and
  // prevStatus saved. Non-completion statuses just write straight through.
  const bulkSetStatus = React.useCallback((status) => {
    const ts = Date.now();
    const ids = selectedIds;
    const isCompletion = isCompletionStatusName(status);
    batchUpdate(
      o => ids.has(o.id),
      cur => {
        const onActive = (cur.tab || 'active') === 'active';
        if (isCompletion && onActive) {
          const next = {
            ...cur,
            tab: 'complete',
            prevStatus: cur.prevStatus || status,
            status: 'Complete - Pending Approval',
          };
          if (next.schedule) delete next.schedule;
          next.history = [...(cur.history || []),
            { ts, action: 'status', detail: (cur.status || '') + ' → ' + status },
            { ts, action: 'auto-flipped to Complete', detail: 'bulk trigger status=' + status }];
          return next;
        }
        const next = { ...cur, status,
          history: [...(cur.history || []), { ts, action: 'status', detail: (cur.status || '') + ' → ' + status }] };
        // `visited` tag OR "Job Complete" status clears the schedule (mirrors the
        // single-WO path; round5 A1 / #8).
        if (clearsScheduleOnSet(status, statusTags) && next.schedule) delete next.schedule;
        return next;
      }
    );
    toast(ids.size + ' set to ' + status);
    clearSelection();
  }, [selectedIds, batchUpdate, toast, clearSelection, statusTags]);

  const VIEW_BUILDERS = {
    active:   () => ({ title: 'Active',   total: activeOrders.length,   groups: groupByPhase(activeOrders, phases) }),
    complete: () => ({ title: 'Complete', total: completeOrders.length, groups: groupByPhase(completeOrders, phases) }),
    trash:    () => ({ title: 'Trash',    total: trashOrders.length,    groups: groupByPhase(trashOrders, phases) }),
  };

  const activePresetId = (typeof currentView === 'string' && currentView.startsWith('sv:')) ? currentView.slice(3) : null;
  const activePreset = activePresetId ? (presets.find(p => p.id === activePresetId) || null) : null;
  const activeInboxId = (typeof currentView === 'string' && currentView.startsWith('ib:')) ? currentView.slice(3) : null;
  const activeInbox = activeInboxId ? (inboxes.find(b => b.id === activeInboxId) || null) : null;
  // Client inbox (Gmail-style sidebar): 'cl:<name>' pins the active view to that
  // client (o.pm) while leaving the other pills (type/status/tech) and search
  // editable -- so it is NOT treated as a locked preset.
  const activeClient = (typeof currentView === 'string' && currentView.startsWith('cl:')) ? currentView.slice(3) : null;
  const effectiveQuery   = (activePreset || activeInbox) ? (activePreset ? (activePreset.query || '') : '') : query;
  const effectiveFilters = activeClient
    ? { ...filters, pm: activeClient }
    : ((activePreset || activeInbox) ? (activePreset ? (activePreset.filters || { pm: '', type: '', status: '', tech: '' }) : { pm: '', type: '', status: '', tech: '' }) : filters);
  const effectiveSort    = activeInbox ? { key: '', dir: 'asc' } : (activePreset ? (activePreset.sort || currentSort) : currentSort);

  let viewData;
  if (loading) {
    viewData = { title: '...', total: 0, groups: [], loading: true };
  } else if (activeInbox) {
    // Curated, manually-ordered list: resolve woIds against live (non-trashed)
    // orders, preserve the inbox's order, drop ids that no longer resolve.
    const byId = new Map(orders.filter(o => !o.deleted).map(o => [o.id, o]));
    const rows = (activeInbox.woIds || []).map(id => byId.get(id)).filter(Boolean).map(toDisplayRow);
    viewData = {
      title: activeInbox.name || 'Inbox',
      total: rows.length,
      groups: rows.length ? [{ phase: activeInbox.name || 'Inbox', count: rows.length, rows, dot: 'var(--text-2)' }] : [],
      inbox: true, inboxId: activeInbox.id, inboxWoIds: activeInbox.woIds || [],
    };
  } else if (activePreset) {
    viewData = { ...VIEW_BUILDERS.active(), title: activePreset.name || 'Saved view' };
  } else if (activeClient) {
    viewData = { ...VIEW_BUILDERS.active(), title: activeClient };
  } else if (VIEW_BUILDERS[currentView]) {
    viewData = VIEW_BUILDERS[currentView]();
  } else {
    viewData = VIEW_BUILDERS.active();
  }

  // change11: bulk actions refreshed. Active = Mark Complete + Trash.
  // Complete = Send to Invoice + Trash. Sent (Invoices module) and trash
  // unchanged. Mark Invoiced + Mark Paid retired.
  const bulkActions = React.useMemo(() => {
    if (currentView === 'trash') return [
      { label: 'Restore', run: bulkRestore },
      { label: 'Delete permanently', danger: true, run: bulkHardDelete },
    ];
    if (currentView === 'active') return [
      { label: 'Mark Complete', primary: true, run: bulkMarkComplete },
      { label: 'Send to Trash', danger: true, run: bulkSendToTrash },
    ];
    if (currentView === 'complete') return [
      { label: 'Send to Invoice', primary: true, run: bulkSendToInvoice },
      { label: 'Send to Trash', danger: true, run: bulkSendToTrash },
    ];
    return [{ label: 'Send to Trash', danger: true, run: bulkSendToTrash }];
  }, [currentView, bulkSendToInvoice, bulkMarkComplete, bulkSendToTrash, bulkRestore, bulkHardDelete]);

  const handleCheck = React.useCallback((woId, isShift) => {
    const allIds = (viewData.groups || []).flatMap(g =>
      (g.rows || []).map(r => r.wo)
    );
    setSelectedIds(prev => {
      const next = new Set(prev);
      const idx = allIds.indexOf(woId);
      if (isShift && lastClickedIdxRef.current != null) {
        const lo = Math.min(lastClickedIdxRef.current, idx);
        const hi = Math.max(lastClickedIdxRef.current, idx);
        for (let i = lo; i <= hi; i++) {
          if (next.has(allIds[i])) next.delete(allIds[i]);
          else next.add(allIds[i]);
        }
      } else {
        if (next.has(woId)) next.delete(woId);
        else next.add(woId);
      }
      lastClickedIdxRef.current = idx;
      return next;
    });
  }, [viewData]);


  const selectedRecord = React.useMemo(
    () => selectedWO ? orders.find(o => o.id === selectedWO) : null,
    [orders, selectedWO]
  );
  const detailData = toDetailData(selectedRecord);

  // change11: sendToInvoice is only valid from tab='complete'. Auto-unschedule
  // and emit a clear history entry. Active WOs cannot be invoiced anymore — the
  // detail-pane primary action on Active is "Mark Complete" instead.
  const doSendToInvoice = React.useCallback((id) => {
    updateOrder(id, applySendToInvoice);
  }, [updateOrder]);

  // Sending with no bid no longer hard-blocks: prompt to enter a bid now or
  // skip and enter it later. (BidPromptModal handles the choice.) Caller is
  // expected to ensure the WO is in tab='complete'; the detail-pane button
  // is gated there, but the woAction dispatch also defends in case of stale UI.
  const sendToInvoice = React.useCallback((id) => {
    const o = orders.find(x => x.id === id);
    if (!o) return;
    if (o.tab !== 'complete') {
      toast('Send to invoice is only available from the Complete tab', 'err');
      return;
    }
    if (!o.bidAmount || !String(o.bidAmount).trim()) { setBidPrompt({ id, mode: 'sent' }); return; }
    doSendToInvoice(id);
  }, [orders, doSendToInvoice, toast]);

  // change11: Active → Complete. Hardcoded status='Complete - Pending Approval'
  // (mirrors Trash's hardcoded Cancelled). Saves prior status into prevStatus
  // so Reopen can revert. Auto-unschedule (Complete WOs leave the itinerary).
  const doMarkComplete = React.useCallback((id) => {
    updateOrder(id, applyMarkComplete);
  }, [updateOrder]);

  // Slice 2 (#5): Mark Complete reuses the Send-to-Invoice bid prompt — if the
  // WO has no bid amount, ask for it (or skip) before flipping to tab='complete'.
  const markComplete = React.useCallback((id) => {
    const o = orders.find(x => x.id === id);
    if (!o) return;
    if (!o.bidAmount || !String(o.bidAmount).trim()) { setBidPrompt({ id, mode: 'complete' }); return; }
    doMarkComplete(id);
  }, [orders, doMarkComplete]);

  // change11: Safety-net reverse. From sent → complete, from complete → active.
  // Used by Invoices module DetailPane and Complete-tab context menu.
  // - complete → active: restore prevStatus, clear the hardcoded Pending Approval.
  // - sent → complete: re-hardcode 'Complete - Pending Approval' (keep prevStatus).
  const reopen = React.useCallback((id) => {
    updateOrder(id, applyReopen);
  }, [updateOrder]);

  // Invoice editor (slice 3). Reads the service library fresh from storage so
  // edits made in the Service Items module are reflected in the line-item
  // autocomplete. saveInvoice persists the invoice on the WO record.
  const openInvoiceEditor = React.useCallback(async (id) => {
    let lib = { General: [], AMH: [] };
    try {
      const r = window.storage && await window.storage.get('service_library');
      const v = r && r.value;
      if (v && typeof v === 'object') lib = { General: [], AMH: [], ...v };
    } catch { /* keep empty library */ }
    setEditorLibrary(lib);
    setInvoiceEditorWO(id);
  }, []);

  const saveInvoice = React.useCallback((id, invoice, errMsg) => {
    if (!invoice) { if (errMsg) toast(errMsg, 'err'); return; }
    // Authoritative duplicate-number guard (editor also blocks, this is the backstop).
    const wanted = String(invoice.number || '').trim().toLowerCase();
    const dup = orders.some(o => o.id !== id && !o.deleted && o.invoice
      && String(o.invoice.number || '').trim().toLowerCase() === wanted);
    if (dup) { toast(`Invoice # ${invoice.number} is already used by another work order`, 'err'); return; }
    updateOrder(id, cur => ({
      ...cur,
      invoice,
      history: [...(Array.isArray(cur.history) ? cur.history : []),
                { ts: Date.now(), action: 'invoice saved', detail: invoice.number || '' }],
    }));
    setInvoiceEditorWO(null);
    toast('Invoice saved');
  }, [orders, updateOrder, toast]);

  // Clear a stuck editor target if its WO disappears (e.g. deleted elsewhere).
  React.useEffect(() => {
    if (invoiceEditorWO != null && !orders.some(o => o.id === invoiceEditorWO)) {
      setInvoiceEditorWO(null);
    }
  }, [invoiceEditorWO, orders]);

  // Itinerary module. schedule = { date:'YYYY-MM-DD', start:'HH:MM' } stored on
  // the WO. Pass schedule=null to unschedule. tech (when given) is synced into
  // order.tech so the list view + itinerary stay one source of truth.
  const setSchedule = React.useCallback((id, schedule, tech) => {
    updateOrder(id, o => {
      const next = { ...o };
      if (schedule === null) delete next.schedule;
      else next.schedule = schedule;
      if (tech) next.tech = tech;
      const hist = Array.isArray(o.history) ? o.history : [];
      // G: auto-status on schedule. First trip -> the `schedule`-tagged status;
      // a return trip -> the `returnschedule`-tagged status. Only if such a
      // status is configured and differs from the current one. "Return trip" is
      // gated on the WO having actually been VISITED before (wasVisited), not
      // merely scheduled before — a WO the tech never showed up to and is now
      // re-scheduled is still a first trip (round5 A2 / #12a).
      let statusNote = '';
      if (schedule !== null) {
        const visitedBefore = wasVisited(o, statusTags);
        const wantTag = visitedBefore ? 'returnschedule' : 'schedule';
        const target = Object.keys(statusTags).find(s => statusTags[s] === wantTag);
        if (target && o.status !== target) { next.status = target; statusNote = ' · status → ' + target; }
      }
      const detail = schedule
        ? (schedule.date + ' ' + schedule.start + ((tech || o.tech) ? ' · ' + (tech || o.tech) : '') + statusNote)
        : '';
      next.history = [...hist,
        { ts: Date.now(), action: schedule === null ? 'unscheduled' : 'scheduled', detail }];
      return next;
    });
  }, [updateOrder, statusTags]);

  // Commit the staged draft route to a tech's day (the "Send to Itinerary"
  // action in the Maps route panel). Route order -> sequential timeline slots.
  // Overwrites the day: any of that tech's existing scheduled WOs on that date
  // that are NOT in the route are unscheduled (returned to the pool). Note:
  // scheduling never changes a WO's status in this app, so unscheduling already
  // leaves the overridden WOs at their real prior status (no prevStatus dance).
  const sendRouteToItinerary = React.useCallback((tech, date) => {
    if (!routeStops.length || !tech || !date) return;
    const slots = itinSlots();
    const inRouteSet = new Set(routeStops);
    const occupied = orders.filter(o => !o.deleted && o.tech === tech
      && o.schedule && o.schedule.date === date && !inRouteSet.has(o.id));
    if (occupied.length && !window.confirm(
      tech + ' already has ' + occupied.length + ' job(s) scheduled on ' + date +
      '. Overwrite the day? Those ' + occupied.length + ' will be returned to the unscheduled pool.')) return;
    occupied.forEach(o => setSchedule(o.id, null));
    routeStops.forEach((id, i) => setSchedule(id, { date, start: slots[Math.min(i, slots.length - 1)] }, tech));
    setRouteStops([]);
    toast('Sent ' + routeStops.length + ' stop' + (routeStops.length === 1 ? '' : 's') + ' to ' + tech);
    setItinFocus({ tech, date, ts: Date.now() });
    setCurrentModule('itinerary');
  }, [routeStops, orders, setSchedule, toast]);

  // Sidebar WO-view selection always returns to the Work Orders module.
  const selectView = React.useCallback((v) => {
    setCurrentModule('work-orders');
    setCurrentView(v);
  }, []);

  // MODULE_GROUPS/MODULES/MODULE_ORDER live in nav.jsx (imported at top).

  // Single source for "navigate the Itinerary to a WO": scheduled -> snap to its
  // tech+day and highlight; unscheduled -> highlight its place in the pool (the
  // module opens the pool and scrolls to it). Shared by switchModule (WO module
  // entry) and the Maps 'jumpItinerary' action so every entry point behaves the
  // same.
  const focusItinerary = React.useCallback((woId) => {
    const o = orders.find(x => x.id === woId);
    if (!o) return;
    if (o.schedule && o.schedule.date) {
      setItinFocus({ tech: o.tech || '', date: o.schedule.date, highlightId: woId, ts: Date.now() });
    } else {
      setItinFocus({ highlightId: woId, ts: Date.now() });
    }
  }, [orders]);

  // Module entry side-effects: itinerary auto-snaps to selectedWO's schedule
  // (if any); invoices highlights selectedWO row via selectedId prop.
  const switchModule = React.useCallback((m) => {
    if (m === 'itinerary' && selectedWO) focusItinerary(selectedWO);
    // Maps: auto-select the active WO's marker on entry (mirror jumpToMap).
    if (m === 'maps' && selectedWO) setMapsSelected(selectedWO);
    setCurrentModule(m);
  }, [selectedWO, focusItinerary]);

  // NavWing switches modules via switchModule directly (see ModuleNavContext
  // provider below). The old pickModule/goPrevModule/goNextModule helpers and
  // the launcher overlay were removed with the wing rework.

  // v2.6.0 parity: export the full visible row set with all tracker columns,
  // not just the 9 display fields. viewData.groups carries the filtered/sorted
  // row order; we look the original order up by id so phone/bid/dateCreated/notes
  // round-trip into the CSV. Phase is taken from the group label.
  const exportViewCsv = React.useCallback(() => {
    if (!window.electronExport || !window.electronExport.saveCsv) {
      toast('CSV export unavailable', 'err');
      return;
    }
    const groups = viewData.groups || [];
    const orderById = new Map((orders || []).map(o => [o.id, o]));
    const rows = [];
    for (const g of groups) {
      for (const r of (g.rows || [])) {
        const o = orderById.get(r.wo);
        if (!o) continue;
        rows.push({ o, phase: g.phase || '' });
      }
    }
    if (!rows.length) { toast('Nothing to export', 'err'); return; }
    const cols = [
      ['WO#',          o => o.id],
      ['Property ID',  o => o.propertyId || ''],
      ['Client',       o => o.pm || ''],
      ['Type',         o => o.type || ''],
      ['Address',      o => o.address || ''],
      ['City',         o => o.city || ''],
      ['Phone',        o => o.phone || ''],
      ['Tech',         o => o.tech || ''],
      ['Status',       o => o.status || ''],
      ['Priority',     o => o.priority || ''],
      ['Bid Amount',   o => o.bidAmount || ''],
      ['Date Created', o => o.dateCreated || ''],
      ['Tab',          o => o.tab || 'active'],
      ['Phase',        (_o, phase) => phase],
      ['More Information', o => o.notes || ''],
      ['Portal Link',  o => o.portalLink || ''],
    ];
    const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const header = cols.map(c => c[0]).join(',');
    const body = rows.map(({ o, phase }) =>
      cols.map(c => esc(c[1](o, phase))).join(',')
    );
    window.electronExport.saveCsv([header, ...body].join('\n'));
  }, [viewData, orders, toast]);

  // change11: bulkMarkInvoiced retired.

  const onSaveView = React.useCallback(() => {
    setNamePrompt({ title: 'Save view', placeholder: 'View name', submitLabel: 'Save', onSubmit: (name) => {
      const id = addPreset({ name, query, filters, sort: currentSort });
      if (id) { setCurrentView('sv:' + id); toast('View saved'); }
    }});
  }, [addPreset, query, filters, currentSort, toast]);
  const onRenamePreset = React.useCallback((id) => {
    const p = presets.find(x => x.id === id);
    setNamePrompt({ title: 'Rename view', initial: p?.name || '', onSubmit: (name) => {
      updatePreset(id, { name });
      toast('View renamed');
    }});
  }, [presets, updatePreset, toast]);
  const onDeletePreset = React.useCallback((id) => {
    if (!window.confirm('Delete this saved view?')) return;
    deletePreset(id);
    if (currentView === 'sv:' + id) setCurrentView('active');
    toast('View deleted');
  }, [deletePreset, currentView, toast]);

  const onAddInbox = React.useCallback(() => {
    setNamePrompt({ title: 'New inbox', placeholder: 'Inbox name', submitLabel: 'Create', onSubmit: (name) => {
      const id = addInbox(name);
      if (id) { setCurrentView('ib:' + id); toast('Inbox created'); }
    }});
  }, [addInbox, toast]);
  const onRenameInbox = React.useCallback((id) => {
    const b = inboxes.find(x => x.id === id);
    setNamePrompt({ title: 'Rename inbox', initial: b?.name || '', onSubmit: (name) => {
      renameInbox(id, name);
      toast('Inbox renamed');
    }});
  }, [inboxes, renameInbox, toast]);
  const onDeleteInbox = React.useCallback((id) => {
    if (!window.confirm('Delete this inbox? (Work orders are not deleted.)')) return;
    deleteInbox(id);
    if (currentView === 'ib:' + id) setCurrentView('active');
    toast('Inbox deleted');
  }, [deleteInbox, currentView, toast]);
  const onAddToInbox = React.useCallback((inboxId, woId) => {
    addToInbox(inboxId, woId);
    const n = Array.isArray(woId) ? woId.length : 1;
    toast(n > 1 ? (n + ' added to inbox') : 'Added to inbox');
  }, [addToInbox, toast]);
  // Create a new inbox then drop the given WO ids into it (from the list menu).
  const onAddToNewInbox = React.useCallback((woIds) => {
    setNamePrompt({ title: 'New inbox', placeholder: 'Inbox name', submitLabel: 'Create & add', onSubmit: (name) => {
      const id = addInbox(name);
      if (id) {
        addToInbox(id, woIds);
        const n = Array.isArray(woIds) ? woIds.length : 1;
        toast(n > 1 ? (n + ' added to new inbox') : 'Added to new inbox');
      }
    }});
  }, [addInbox, addToInbox, toast]);

  const handleAddWO = React.useCallback(() => { setModal('add'); }, []);

  const submitAdd = React.useCallback((form) => {
    const id = addOrder({
      pm: form.pm, type: form.type, address: form.address, city: form.city,
      phone: form.phone, tech: form.tech, status: form.status, notes: form.notes,
      dateCreated: form.dateCreated, propertyId: form.propertyId, bidAmount: form.bidAmount,
      emergency: !!form.emergency, warranty: !!form.warranty, returnPending: !!form.returnPending,
      contactName: form.contactName || '',
      contacts: Array.isArray(form.contacts) ? form.contacts : [],
      id: form.id,
    });
    setModal(null);
    if (id) { setSelectedWO(id); pushRecent(id); setCurrentView('active'); }
    toast('Work order created');
  }, [addOrder, toast]);

  const submitEdit = React.useCallback((id, form) => {
    updateOrder(id, cur => ({
      ...cur,
      pm: form.pm, type: form.type, address: form.address, city: form.city,
      phone: form.phone, tech: form.tech, status: form.status, notes: form.notes,
      dateCreated: form.dateCreated, propertyId: form.propertyId, bidAmount: form.bidAmount,
      emergency: !!form.emergency, warranty: !!form.warranty, returnPending: !!form.returnPending,
      contactName: form.contactName || '',
      contacts: Array.isArray(form.contacts) ? form.contacts : [],
      history: [...(Array.isArray(cur.history) ? cur.history : []),
                { ts: Date.now(), action: 'edited', detail: '' }],
    }));
    setModal(null);
    toast('Work order updated');
  }, [updateOrder, toast]);

  const addNote = React.useCallback((id, { type, body }) => {
    updateOrder(id, cur => {
      const cards = Array.isArray(cur.noteCards) ? cur.noteCards : [];
      const note = { id: 'n_' + Date.now().toString(36), ts: Date.now(), type, body, pinned: false, edited: false };
      return {
        ...cur,
        noteCards: [...cards, note],
        history: [...(Array.isArray(cur.history) ? cur.history : []),
                  { ts: Date.now(), action: 'note added', detail: type }],
      };
    });
  }, [updateOrder]);

  const editNote = React.useCallback((id, noteId, newBody) => {
    updateOrder(id, cur => {
      const cards = Array.isArray(cur.noteCards) ? cur.noteCards : [];
      return {
        ...cur,
        noteCards: cards.map(c => c.id === noteId ? { ...c, body: newBody, edited: true } : c),
        history: [...(Array.isArray(cur.history) ? cur.history : []),
                  { ts: Date.now(), action: 'note edited', detail: '' }],
      };
    });
  }, [updateOrder]);

  const setMisc = React.useCallback((id, text) => {
    updateOrder(id, cur => ({
      ...cur, notes: text,
      history: [...(Array.isArray(cur.history) ? cur.history : []),
                { ts: Date.now(), action: 'more info edited', detail: '' }],
    }));
  }, [updateOrder]);

  // B3: change a WO's Client (o.pm = code) inline from the command-center header.
  const setClient = React.useCallback((id, code) => {
    updateOrder(id, cur => ({
      ...cur, pm: code,
      history: [...(Array.isArray(cur.history) ? cur.history : []),
                { ts: Date.now(), action: 'client set to ' + code, detail: '' }],
    }));
  }, [updateOrder]);

  const deleteNote = React.useCallback((id, noteId) => {
    updateOrder(id, cur => {
      const cards = Array.isArray(cur.noteCards) ? cur.noteCards : [];
      return {
        ...cur,
        noteCards: cards.filter(c => c.id !== noteId),
        history: [...(Array.isArray(cur.history) ? cur.history : []),
                  { ts: Date.now(), action: 'note deleted', detail: '' }],
      };
    });
  }, [updateOrder]);

  const togglePinNote = React.useCallback((id, noteId) => {
    updateOrder(id, cur => {
      const cards = Array.isArray(cur.noteCards) ? cur.noteCards : [];
      const target = cards.find(c => c.id === noteId);
      const willPin = target && !target.pinned;
      return {
        ...cur,
        noteCards: cards.map(c => c.id === noteId ? { ...c, pinned: !c.pinned } : c),
        history: [...(Array.isArray(cur.history) ? cur.history : []),
                  { ts: Date.now(), action: willPin ? 'note pinned' : 'note unpinned', detail: '' }],
      };
    });
  }, [updateOrder]);

  // Merge a capture result ({ ok, wo, warnings }) into the record IN PLACE.
  // Returns the warnings array, or null when the result was not ok. Shared by
  // single (captureOrder) + batch (captureAllAMH) so the merge stays identical.
  const applyCapture = React.useCallback((id, res) => {
    if (!res || !res.ok) return null;
    const s = res.wo || {};
    updateOrder(id, cur => {
      const patch = { ...cur };
      // User-editable fields: FILL ONLY — keep the user's value, fill only when
      // blank, so a re-capture never overwrites data the user entered/corrected.
      const fill = (k, v) => { if (!patch[k] && v) patch[k] = v; };
      fill('address', s.address);
      fill('city', s.city);
      if (!patch.phone && s.phone) patch.phone = formatPhone(s.phone);
      fill('type', s.type);
      fill('propertyId', s.propertyId);
      fill('portalLink', s.portalLink);
      fill('contactName', s.contactName);
      if ((!Array.isArray(patch.contacts) || !patch.contacts.length) && Array.isArray(s.contacts) && s.contacts.length) patch.contacts = s.contacts;
      // Portal-owned fields: always refresh from the portal.
      if (s.bidAmount) patch.bidAmount = s.bidAmount;
      if (Array.isArray(s.bidItems) && s.bidItems.length) patch.bidItems = s.bidItems;
      // More Information: portal notes merged at top, user's own text preserved
      // below; re-capture adds only new portal paragraphs (composeNotes).
      const composed = composeNotes(cur.notes, cur.portalNotes, s.notes);
      patch.notes = composed.notes;
      patch.portalNotes = composed.portalNotes;
      const hist = [...(cur.history || []), { ts: Date.now(), action: 'captured from portal', detail: s.woId ? 'WO# ' + s.woId : '' }];
      // change11: AMH sub-status "Pending Validation" = vendor submitted bid
      // for AMH approval. Auto-advance from active → complete (tech-done,
      // awaiting PM approval). Sets the hardcoded Complete - Pending
      // Approval status and saves prevStatus. Does NOT backslide WOs already
      // on complete/sent/trash.
      const curTab = cur.tab || 'active';
      if (/pending\s*validation/i.test(String(s.subStatus || '')) && curTab === 'active') {
        patch.tab = 'complete';
        patch.prevStatus = cur.prevStatus || cur.status || 'Open';
        patch.status = 'Complete - Pending Approval';
        if (patch.schedule) delete patch.schedule;
        hist.push({ ts: Date.now(), action: 'auto-flipped to Complete', detail: 'auto: Pending Validation' });
      }
      patch.history = hist;
      return patch;
    });
    return Array.isArray(res.warnings) ? res.warnings : [];
  }, [updateOrder]);

  // In-app portal capture: runs scrape_amh.py (headless Edge token+API) for
  // THIS record and merges the scraped fields in place. Re-capture updates,
  // never spawning a duplicate. Returns a promise so callers can show progress.
  const captureOrder = React.useCallback((id) => {
    const src = orders.find(o => o.id === id);
    if (!src) return Promise.resolve();
    const pm = String(src.pm || '').toUpperCase();
    if (pm === 'MSR') {
      // MSR capture happens on the portal page itself: open the WO in Chrome and
      // use the extension's on-page "Capture WO" button (reliable; off-screen
      // scraping is not).
      toast('Open this WO in Chrome and use the extension’s on-page Capture button.');
      return Promise.resolve();
    }
    if (pm !== 'AMH') { toast('In-app capture supports AMH work orders only'); return Promise.resolve(); }
    if (!window.scraper || !window.scraper.captureWO) { toast('Capture is only available in the desktop app'); return Promise.resolve(); }
    setCaptureStatus({ label: 'Capturing ' + id + ' from ' + pm + '…' });
    return window.scraper.captureWO(src).then(res => {
      if (!res || !res.ok) { toast('Capture failed: ' + ((res && res.error) || 'unknown error')); return; }
      const warnings = applyCapture(id, res) || [];
      if (warnings.length) {
        toast('Captured ' + id + ' (warnings: ' + warnings.join(' / ') + ')', 'warn');
      } else {
        toast('Captured ' + id);
      }
    }).catch(e => toast('Capture error: ' + e.message))
      .finally(() => setCaptureStatus(null));
  }, [orders, applyCapture, toast]);

  // Create the OneDrive folder tree (+ MSR bid sheet) for a WO and open it.
  const createFolder = React.useCallback((id) => {
    const src = orders.find(o => o.id === id);
    if (!src) return Promise.resolve();
    if (!window.woFolder || !window.woFolder.create) { toast('Folder creation is only available in the desktop app'); return Promise.resolve(); }
    return window.woFolder.create(src).then(res => {
      if (!res || !res.ok) { toast('Folder failed: ' + ((res && res.error) || 'unknown error')); return; }
      if (res.xlsxSkip) { toast('Folder created; bid sheet skipped: ' + res.xlsxSkip, 'warn'); return; }
      toast(res.xlsx ? 'Folder + bid sheet created' : 'Folder created');
    }).catch(e => toast('Folder error: ' + e.message));
  }, [orders, toast]);

  // Create a dated subfolder under the WO root (revisit filing) and open it.
  // mkdir is recursive in main, so the root is created too if absent.
  const createWoSubfolder = React.useCallback((id) => {
    const src = orders.find(o => o.id === id);
    if (!src) return Promise.resolve();
    if (!window.woFolder || !window.woFolder.subfolder) { toast('Folder creation is only available in the desktop app'); return Promise.resolve(); }
    return window.woFolder.subfolder(src).then(res => {
      if (!res || !res.ok) { toast('Subfolder failed: ' + ((res && res.error) || 'unknown error')); return; }
      toast('Dated subfolder created');
    }).catch(e => toast('Folder error: ' + e.message));
  }, [orders, toast]);

  // Open the WO root folder in Explorer (no create). Missing folder -> toast.
  const openWoFolder = React.useCallback((id) => {
    const src = orders.find(o => o.id === id);
    if (!src) return Promise.resolve();
    if (!window.woFolder || !window.woFolder.open) { toast('Folder access is only available in the desktop app'); return Promise.resolve(); }
    return window.woFolder.open(src).then(res => {
      if (res && res.ok) return;
      if (res && res.missing) { toast('No folder yet — use Create folder', 'warn'); return; }
      toast('Open failed: ' + ((res && res.error) || 'unknown error'));
    }).catch(e => toast('Folder error: ' + e.message));
  }, [orders, toast]);

  // Batch capture: every "All Open" (non-Completed) AMH WO from the portal in
  // ONE Edge login. The scraper returns all open portal WOs keyed by number;
  // known WOs are updated in place (applyCapture), and any WO not yet in the app
  // is imported via upsertOrders (dedup/stableId) and surfaced in the new-WO
  // review modal once the whole batch is done.
  const captureAllAMH = React.useCallback(() => {
    if (!window.scraper || !window.scraper.captureAllAMH) { toast('Capture is only available in the desktop app'); return Promise.resolve(); }
    const numOf = o => String(o.woId || o.id || '').replace(/^WO-/i, '').trim();
    const existing = new Map();
    const trashed  = new Set();   // AMH WOs cancelled in-app: portal may still list them open; skip, don't re-import
    for (const o of orders) {
      if (String(o.pm || '').toUpperCase() !== 'AMH') continue;
      const n = numOf(o); if (!n) continue;
      if (o.deleted) trashed.add(n);
      else existing.set(n, o.id);
    }
    setCaptureStatus({ label: 'Capturing all open AMH work orders…' });
    return window.scraper.captureAllAMH().then(resp => {
      if (!resp || !resp.ok) { toast('Batch capture failed: ' + ((resp && resp.error) || 'unknown error')); return; }
      let updated = 0, warned = 0, fail = 0, trashedSkipped = 0;
      const newIncoming = [];
      const updatedBatch = [];          // existing WOs refreshed (for the modal)
      const warnByNum = {};             // WO# -> warning strings (new + updated)
      for (const [num, res] of Object.entries(resp.results || {})) {
        const key = String(num).replace(/^WO-/i, '').trim();
        if (res && Array.isArray(res.warnings) && res.warnings.length) warnByNum[key] = res.warnings;
        if (existing.has(key)) {
          const id = existing.get(key);
          const w = applyCapture(id, res);
          // Only WOs that came back WITH a warning go in the review modal; clean
          // updates are silent (counted only). w === null means capture failed.
          if (w === null) fail++; else { updated++; if (w.length) { warned++; updatedBatch.push({ id, isNew: false }); } }
        } else if (trashed.has(key)) {
          // Cancelled in-app but still on the portal's open list -> skip so it
          // doesn't resurrect as a "new" WO in the review modal.
          trashedSkipped++;
        } else if (res && res.ok && res.wo) {
          const s = res.wo;
          // status omitted -> new WOs default to 'Open' (raw portal statuses
          // like "Unscheduled"/"Posted" are not app statuses; matches single-
          // capture leaving status to the user's workflow).
          newIncoming.push({
            woId: s.woId, pm: 'AMH', type: s.type, address: s.address, city: s.city,
            phone: s.phone, notes: s.notes, propertyId: s.propertyId,
            portalLink: s.portalLink, bidItems: s.bidItems, bidAmount: s.bidAmount,
            contactName: s.contactName, contacts: s.contacts,
          });
        } else { fail++; }
      }
      let added = 0, newBatch = [], dupSkipped = 0;
      if (newIncoming.length) {
        const r = upsertOrders(newIncoming);
        added = r.imported || 0;
        dupSkipped = r.dupSkipped || 0;
        newBatch = Array.isArray(r.batch) ? r.batch : [];
      }
      // Surface new AND updated WOs (plus any warnings) in the review modal so
      // WOs flagged "with issue" can be examined, not just counted in the toast.
      const batch = [...newBatch, ...updatedBatch];
      // Notification instead of an auto-popping modal so the scrape doesn't
      // interrupt; click the item to open the review modal.
      if (batch.length) pushNotif({ kind: 'capture', captureType: 'import',
        title: 'AMH capture · ' + added + ' new, ' + updated + ' updated',
        sub: 'Click to review' + (warned ? (' · ' + warned + ' warnings') : ''),
        payload: { batch, ts: Date.now(), dupSkipped, warnByNum, modifiedCount: updated } });
      toast('Captured ' + updated + ' updated, ' + added + ' new'
        + (warned ? (', ' + warned + ' with warnings') : '')
        + (trashedSkipped ? (', ' + trashedSkipped + ' cancelled skipped') : '')
        + (fail ? (', ' + fail + ' failed') : ''));
    }).catch(e => toast('Batch capture error: ' + e.message))
      .finally(() => setCaptureStatus(null));
  }, [orders, applyCapture, upsertOrders, toast]);

  // Find new MSR WOs: MSR batch capture was dropped (Salesforce lazy-render made
  // off-screen scraping unreliable). Instead, ask the extension to scan the open
  // MSR list page for WO numbers; results arrive via onFoundWos, which diffs them
  // against the tracker and lists the ones not yet added (the user captures each
  // with the extension's on-page button). Requires Chrome + the extension + an
  // MSR list tab open.
  const findNewMsr = React.useCallback(() => {
    if (!window.extensionBridge || !window.extensionBridge.requestFindNewMsr) {
      toast('This needs the desktop app + Chrome extension'); return;
    }
    // In-flight banner: the scan is async (extension polls, scans, POSTs back),
    // so show progress until results arrive via onFoundWos (which clears it) or
    // the 2-min safety timeout fires.
    setCaptureStatus({ label: 'Scanning the open MSR list for new work orders…' });
    if (msrBannerTimer.current) clearTimeout(msrBannerTimer.current);
    msrBannerTimer.current = setTimeout(() => setCaptureStatus(null), 2 * 60 * 1000);
    window.extensionBridge.requestFindNewMsr()
      .then(() => toast('Scanning the open MSR list for new WOs — keep Chrome + the extension open.'))
      .catch(e => { setCaptureStatus(null); toast('Request failed: ' + e.message); });
  }, [toast]);

  // Explicit-id action handler shared by context menu and detail pane.
  const woAction = React.useCallback((id, kind, payload) => {
    if (!id) return;
    const histEntry = (action, detail) => ({ ts: Date.now(), action, detail: detail || '' });
    switch (kind) {
      case 'setStatus':
        // change11: auto-flip tab to 'complete' when the new status indicates
        // job-complete (Pending-Complete, Closed, or any status string that
        // contains "Job Complete" — covers user-customized statuses like
        // "Bid Submitted - Job Complete"). When flipping, save the chosen
        // status into prevStatus and HARDCODE status to 'Complete - Pending
        // Approval' so the Complete tab reads uniformly. Reopen restores it.
        updateOrder(id, cur => {
          const isCompletion = isCompletionStatusName(payload);
          if ((cur.tab || 'active') === 'active' && isCompletion) {
            const next = {
              ...cur,
              tab: 'complete',
              prevStatus: cur.prevStatus || payload,
              status: 'Complete - Pending Approval',
            };
            if (next.schedule) delete next.schedule;
            next.history = [...(cur.history || []),
              histEntry('status', (cur.status || '') + ' → ' + payload),
              histEntry('auto-flipped to Complete', 'trigger status=' + payload)];
            return next;
          }
          const next = { ...cur, status: payload };
          // `visited` tag OR a "Job Complete" status clears the schedule (tech
          // finished at the site). Same data effect as completion, but the WO
          // stays on its tab (round5 A1 / #8 — batched "Job Complete - Enter Bid"
          // is not a completion status yet still means the visit is done).
          if (clearsScheduleOnSet(payload, statusTags) && next.schedule) delete next.schedule;
          next.history = [...(cur.history || []), histEntry('status', (cur.status || '') + ' → ' + payload)];
          return next;
        });
        toast('Status: ' + payload);
        // Slice 4 (#9): `schedule` tag opens the Schedule modal on this single
        // WO. Single interactive path only (bulkSetStatus never routes here),
        // so a bulk status change cannot pop the modal N times.
        if (statusTags[payload] === 'schedule') setScheduleTarget(id);
        break;
      case 'markComplete':
        markComplete(id);
        toast('Marked Complete');
        break;
      case 'reopen':
        reopen(id);
        toast('Reopened');
        break;
      case 'backToActive':
        // change11: legacy alias for Active reopen. Kept so old menu paths
        // still route, but new UI uses 'reopen'.
        reopen(id);
        toast('Moved to Active');
        break;
      case 'softDelete':
        // change11: hardcode status='Cancelled' on Trash entry. Preserve the
        // prior status in prevStatus so Restore can revert. Auto-unschedule.
        updateOrder(id, cur => {
          const next = {
            ...cur,
            deleted: true,
            tab: 'trash',
            prevStatus: cur.prevStatus || cur.status || 'Open',
            status: 'Cancelled',
          };
          if (next.schedule) delete next.schedule;
          next.history = [...(cur.history || []), histEntry('sent to Trash', 'status: ' + (cur.status || '') + ' → Cancelled')];
          return next;
        });
        toast('Sent to Trash');
        break;
      case 'setPm':
        updateOrder(id, cur => ({
          ...cur, pm: payload,
          history: [...(cur.history || []), histEntry('pm', (cur.pm || '') + ' → ' + payload)],
        }));
        toast('PM: ' + payload);
        break;
      case 'setType':
        updateOrder(id, cur => ({
          ...cur, type: payload,
          history: [...(cur.history || []), histEntry('type', (cur.type || '') + ' → ' + payload)],
        }));
        toast('Type: ' + payload);
        break;
      case 'setTech':
        updateOrder(id, cur => ({
          ...cur, tech: payload,
          history: [...(cur.history || []), histEntry('tech', (cur.tech || '') + ' → ' + (payload || 'Unassigned'))],
        }));
        toast('Tech: ' + (payload || 'Unassigned'));
        break;
      case 'toggleEmergency':
        updateOrder(id, cur => ({
          ...cur, emergency: !cur.emergency,
          history: [...(cur.history || []), histEntry(cur.emergency ? 'emergency: cleared' : 'emergency: set')],
        }));
        break;
      case 'toggleWarranty':
        updateOrder(id, cur => ({
          ...cur, warranty: !cur.warranty,
          history: [...(cur.history || []), histEntry(cur.warranty ? 'warranty: cleared' : 'warranty: set')],
        }));
        break;
      case 'toggleReturnPending':
        updateOrder(id, cur => ({
          ...cur, returnPending: !cur.returnPending,
          history: [...(cur.history || []), histEntry(cur.returnPending ? 'return pending: cleared' : 'return pending: set')],
        }));
        break;
      case 'capture':
        captureOrder(id);
        break;
      case 'createFolder':
        createFolder(id);
        break;
      case 'createSubfolder':
        createWoSubfolder(id);
        break;
      case 'openFolder':
        openWoFolder(id);
        break;
      case 'jumpToSchedule': {
        const o = orders.find(x => x.id === id);
        if (o && o.schedule) {
          setItinFocus({ tech: o.tech || '', date: o.schedule.date, highlightId: id, ts: Date.now() });
          setCurrentModule('itinerary');
        } else { toast('Not scheduled yet'); }
        break;
      }
      case 'openScheduleForm':
        setScheduleTarget(id);
        break;
      case 'editDetails':
        setModal({ kind: 'edit', id });
        break;
      case 'jumpToMap':
        setMapsSelected(id);
        setCurrentModule('maps');
        break;
      case 'jumpItinerary':
        // Same navigation as entering Itinerary from the WO module: scheduled ->
        // snap to slot + highlight; unscheduled -> scroll to its pool position.
        focusItinerary(id);
        setCurrentModule('itinerary');
        break;
      case 'regeocode': {
        // Drop the cache entry so the App-level worker picks the WO up
        // again on its next pass. Bump the clear tick so the worker
        // restarts even if it was idle.
        updateSettings((cur) => {
          const c = (cur && cur.geocache) || {};
          if (!(id in c)) return {};
          const next = { ...c };
          delete next[id];
          return { geocache: next };
        });
        setGeocacheClearTick(t => t + 1);
        toast('Re-geocoding ' + id + '...');
        break;
      }
      case 'dismissSuspect': {
        // User confirms the geocoded location is correct despite the
        // suspect flag (e.g. WO city is wrong but pin is right).
        updateSettings((cur) => {
          const c = (cur && cur.geocache) || {};
          const entry = c[id];
          if (!entry || !entry.suspect) return {};
          return { geocache: { ...c, [id]: { ...entry, suspect: false } } };
        });
        toast('Suspect flag dismissed for ' + id);
        break;
      }
      case 'sendToInvoice':
        sendToInvoice(id);
        break;
      // change11: markInvoiced + markPaid retired (QuickBooks tracks those).
      default: break;
    }
  }, [updateOrder, captureOrder, createFolder, createWoSubfolder, openWoFolder, toast, orders, sendToInvoice, markComplete, reopen, updateSettings, statusTags, setScheduleTarget, focusItinerary]);

  // ⋯ menu actions on the detail pane.
  const detailAction = React.useCallback((kind, payload) => {
    const id = selectedWO;
    if (!id) return;
    // Delegate shared cases to woAction.
    if (kind === 'setStatus' || kind === 'setType' || kind === 'setTech' ||
        kind === 'backToActive' || kind === 'softDelete' ||
        kind === 'toggleEmergency' || kind === 'toggleWarranty' ||
        kind === 'markComplete' || kind === 'reopen' || kind === 'createFolder' || kind === 'openFolder') {
      woAction(id, kind, payload);
      return;
    }
    const histEntry = (action, detail) => ({ ts: Date.now(), action, detail: detail || '' });
    switch (kind) {
      // change11: markPaid + backToInvoiced + backToSent retired.
      case 'restore': {
        // change11: also revert the hardcoded Cancelled back to the prior status.
        updateOrder(id, cur => {
          const restored = cur.prevStatus || 'Open';
          const next = { ...cur, deleted: false, status: restored };
          delete next.prevStatus;
          // tab returns to 'active' by default; the user can re-flip via the
          // standard workflow if it should land in Complete.
          next.tab = 'active';
          next.history = [...(cur.history || []), histEntry('restored from Trash', 'status: Cancelled → ' + restored)];
          return next;
        });
        toast('Restored');
        break;
      }
      case 'hardDelete': {
        if (!window.confirm('Permanently delete this work order? This cannot be undone.')) return;
        deleteOrderHard(id);
        setSelectedWO(null);
        toast('Deleted permanently');
        break;
      }
      case 'duplicate': {
        const src = orders.find(o => o.id === id);
        if (!src) return;
        const { id: _drop, history: _h, ...rest } = src;
        const newId = addOrder({ ...rest, status: src.status, dateCreated: todayIso() });
        if (newId) { setSelectedWO(newId); pushRecent(newId); toast('Duplicated → ' + newId); }
        break;
      }
      case 'capture':
        return captureOrder(id);
      case 'invoice':
        // #3: start/edit the invoice for this WO from the command center. The
        // editor loads the service library fresh and autocompletes line items.
        return openInvoiceEditor(id);
      default: break;
    }
  }, [selectedWO, woAction, captureOrder, openInvoiceEditor, orders, updateOrder, deleteOrderHard, addOrder, toast]);

  // change10 queue #5: customTheme overrides merge over the base theme.
  // Only entries with hex values overwrite. The picker UI is scoped to a
  // safe subset of vars (surfaces, text, accent) so semantic colors (flags,
  // ages, phases) remain consistent regardless of user customization.
  const themeVars = { ...(theme === 'light' ? TT_LIGHT : TT_DARK), ...(customTheme || {}) };
  // Apply theme tokens at :root so Modal/Toast (rendered outside the themed container)
  // can resolve var(--bg-surface) etc. Ports the legacy applyTheme() mechanism.
  React.useEffect(() => {
    const root = document.documentElement;
    Object.entries(themeVars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  }, [theme, themeVars]);

  // Attention view retired: notifications now live in the header bell dropdown.
  // rightPane only carries the Settings popup content.
  let rightPane;
  if (currentView === 'settings') {
    rightPane = <SettingsDrawer
      toast={toast}
      theme={theme}
      setTheme={setTheme}
      density={density}
      setDensity={setDensity}
      alertThresholds={alertThresholds}
      setAlertThresholds={setAlertThresholds}
      overdueCfg={overdueCfg}
      setOverdueCfg={setOverdueCfg}
      librarySubCats={librarySubCats}
      setLibrarySubCats={setLibrarySubCats}
      techJobTypes={techJobTypes}
      setTechJobTypes={setTechJobTypes}
      techColors={techColors}
      setTechColors={setTechColors}
      routingWeights={routingWeights}
      setRoutingWeights={setRoutingWeights}
      statusTags={statusTags}
      setStatusTags={setStatusTags}
      onClose={() => { setCurrentView('active'); setPendingSettingsSection(null); }}
      phases={phases}
      setPhases={setPhases}
      statuses={statuses}
      setStatuses={setStatuses}
      statusColors={statusColors}
      setStatusColors={setStatusColors}
      moreInfoColor={moreInfoColor}
      setMoreInfoColor={setMoreInfoColor}
      customTheme={customTheme}
      setCustomTheme={setCustomTheme}
      mapsHomeState={mapsHomeState}
      mapsHomeZip={mapsHomeZip}
      mapsHomeAddress={mapsHomeAddress}
      mapsHomeCity={mapsHomeCity}
      saveHome={saveHome}
      onClearGeocache={clearGeocache}
      geocacheCount={geocacheCount}
      locationIqKey={locationIqKey}
      setLocationIqKey={setLocationIqKey}
      mapMarkerColors={mapMarkerColors}
      setMapMarkerColors={setMapMarkerColors}
      mapTypeColors={mapTypeColors}
      setMapTypeColors={setMapTypeColors}
      initialSection={pendingSettingsSection || 'appearance'}
      pms={pms}
      setPms={setPms}
      onRenameClientCode={renameClientCode}
      types={types}
      setTypes={setTypes}
      techs={techs}
      setTechs={setTechs}
      trayEnabled={trayEnabled}
      setTrayEnabled={setTrayEnabled}
      trayBadgeSource={trayBadgeSource}
      setTrayBadgeSource={setTrayBadgeSource}
      onResetSettings={resetSettings}
      onRestoreBackup={restorePreMigrationBackup}
      updateState={updateState}
      onCheckUpdate={checkForUpdates}
      onInstallUpdate={() => window.updater && window.updater.install && window.updater.install()}
    />;
  }
  // The WO module has no right column anymore (DetailPane -> CommandCenter overlay,
  // Settings -> popup, Attention -> header bell). Settings renders as a centered popup.
  const settingsOverlay = (currentView === 'settings') ? (
    <SettingsOverlay onClose={() => { setCurrentView('active'); setPendingSettingsSection(null); }}>
      {rightPane}
    </SettingsOverlay>
  ) : null;
  // Command center never co-exists with the Settings popup.
  const showCommandCenter = currentModule === 'work-orders' && currentView !== 'settings' && coOpen && !!detailData;
  // Command-center nav aids (computed only while open). Siblings = same
  // normalized address; nearby = same city AND trade set intersects (dual
  // 'PH' matches both P and H). prev/next walk the list's visible order.
  const ccTradeSet = (t) => t === 'PH' ? ['P', 'H'] : [t];
  const ccAids = showCommandCenter && selectedRecord ? (() => {
    const me = selectedRecord;
    const myAddr = (splitAddress(me).addr || '').toLowerCase();
    const myCity = (splitAddress(me).city || '').toLowerCase();
    const mySet = ccTradeSet(typeLetter(me.type));
    // Nav-aid row: primary = street address (people don't recognize WO#s at a
    // glance), sub = city ONLY (was o.tech on nearby, which leaked tech names).
    const mkItem = (o) => ({ id: o.id, primary: splitAddress(o).addr || o.id, sub: splitAddress(o).city || '' });
    const siblings = (myAddr ? orders.filter(o => !o.deleted && o.id !== me.id && (splitAddress(o).addr || '').toLowerCase() === myAddr) : [])
      .map(mkItem);
    // Nearby + Recent: open/un-completed WOs ONLY (active tab). Completed/sent/
    // trashed WOs are not actionable jump targets from the modal.
    const nearby = (myCity ? orders.filter(o => !o.deleted && o.id !== me.id
        && (o.tab || 'active') === 'active'
        && (splitAddress(o).city || '').toLowerCase() === myCity
        && ccTradeSet(typeLetter(o.type)).some(t => mySet.includes(t))) : [])
      .map(mkItem);
    const recents = recentWOs.filter(id => id !== me.id)
      .map(id => orders.find(o => o.id === id)).filter(Boolean)
      .filter(o => !o.deleted && (o.tab || 'active') === 'active').map(mkItem);
    const idx = visibleOrder.indexOf(me.id);
    const phaseName = (phases.find(p => (p.statuses || []).includes(me.status)) || {}).name || null;
    const canCapture = me.pm === 'AMH' && !!(window.scraper && window.scraper.captureWO);
    return { siblings, nearby, recents, idx, phaseName, canCapture };
  })() : null;
  const ccGoRel = (delta) => {
    const i = visibleOrder.indexOf(selectedWO);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= visibleOrder.length) return;
    openWO(visibleOrder[j]);
  };
  const commandCenter = showCommandCenter ? (
    <CommandCenter
      onClose={() => setCoOpen(false)}
      topBar={ccAids ? (
        <CCTopBar
          index={ccAids.idx}
          total={visibleOrder.length}
          onPrev={() => ccGoRel(-1)}
          onNext={() => ccGoRel(1)}
          phases={phases}
          phaseName={ccAids.phaseName}
          siblings={ccAids.siblings}
          nearby={ccAids.nearby}
          recents={ccAids.recents}
          onPick={openWO}
          onEdit={(id) => setModal({ kind: 'edit', id })}
          onAction={detailAction}
          canCapture={ccAids.canCapture}
          woId={selectedWO}
        />
      ) : null}
      rightRail={<>
        <MapInset
          wo={selectedRecord}
          geocache={geocache}
          statusColors={statusColors}
          statusTags={statusTags}
          mapMarkerColors={settings.mapMarkerColors}
          mapTypeColors={settings.mapTypeColors}
          overdueCfg={overdueCfg}
          onOpenMaps={(id) => { setMapsSelected(id); setSelectedWO(null); setCurrentView('active'); setCurrentModule('maps'); }}
        />
        <DayTimeline
          wo={selectedRecord}
          activeOrders={activeOrders}
          statusColors={statusColors}
          statusTags={statusTags}
          onOpenItinerary={(id) => { focusItinerary(id); setSelectedWO(null); setCurrentModule('itinerary'); }}
        />
      </>}
      detail={<DetailPane
        data={detailData}
        onSendToInvoice={sendToInvoice}
        onMarkComplete={markComplete}
        onReopen={reopen}
        onAddNote={addNote}
        onEditNote={editNote}
        onDeleteNote={deleteNote}
        onPinNote={togglePinNote}
        onSetMisc={setMisc}
        onSetClient={setClient}
        onEdit={(id) => setModal({ kind: 'edit', id })}
        onEditInvoice={openInvoiceEditor}
        onAction={detailAction}
        statuses={statuses}
        moreInfoColor={moreInfoColor}
        types={types}
        techs={techs}
        pms={pms}
        inboxes={inboxes}
        onWoAction={woAction}
        onAddToInbox={onAddToInbox}
        onAddToNewInbox={onAddToNewInbox}
        onRemoveFromInbox={removeFromInbox}
      />}
    />
  ) : null;

  return (
    <PMsContext.Provider value={pms}>
    <PhasesContext.Provider value={phases}>
     <StatusColorsContext.Provider value={statusColors}>
      <ToastContext.Provider value={toast}>
       <ModuleNavContext.Provider value={{ currentModule, onPick: switchModule, onHome: () => setCurrentModule('overview') }}>
        <HeaderActionsContext.Provider value={{
          onAddWO: handleAddWO,
          notifications,
          onNotifClick,
          onDismissNotif: dismissNotif,
          onMarkAllRead: markAllNotifsRead,
          onExportCsv: exportViewCsv,
          onAddInbox: onAddInbox,
          onOpenSettings: () => { setCurrentModule('work-orders'); setCurrentView('settings'); },
        }}>
        {/* Banners are in-flow at the very top and push the module content
            (incl. the WO header + its buttons) down instead of overlaying it. */}
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <UpdateBanner
          state={updateState}
          onInstall={() => window.updater && window.updater.install && window.updater.install()}
        />
        <CaptureBanner status={captureStatus} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {currentModule === 'overview' && (
          <div style={{ ...themeVars, color: 'var(--text-1)' }}>
            <OverviewModule
              orders={orders}
              techs={techs}
              alerts={alerts}
              modules={MODULES}
              lastModule={launchPhase ? 'work-orders' : lastModule}
              loading={loading}
              onContinue={() => setCurrentModule(launchPhase ? 'work-orders' : (lastModule && lastModule !== 'overview' ? lastModule : 'work-orders'))}
              onPickModule={(id) => setCurrentModule(id)}
              onSelectAlert={(wo) => {
                setSelectedWO(wo); pushRecent(wo);
                setCurrentView('active');
                setCurrentModule('work-orders');
              }}
            />
          </div>
        )}
        {currentModule !== 'overview' && (
        <div style={{
          ...themeVars,
          // Reserve the collapsed NavWing rail (NAV_RAIL) so content sits beside
          // it; tooltips float over content on hover.
          position: 'fixed', top: 0, right: 0, bottom: 0, left: NAV_RAIL,
          background: 'var(--bg-canvas)',
          color: 'var(--text-1)',
          display: 'grid',
          // Sidebar column always 0: every module (incl. WO since the
          // header-uniformity rework) renders its own sidebar below its
          // full-width header, matching the Maps/Invoices/Itinerary shell.
          gridTemplateColumns: '0 1fr 1.2fr',
          gridTemplateRows: 'minmax(0, 1fr)',
          overflow: 'hidden',
        }}>
          <NavWing />
          <div />
          {currentModule === 'service-items' ? (
            <ServiceLibrary toast={toast} subCats={librarySubCats} setSubCats={setLibrarySubCats} />
          ) : currentModule === 'maps' ? (
            <MapsModule
              activeOrders={mapOrders}
              geocache={geocache}
              defaultView={mapsDefaultView}
              selected={mapsSelected}
              setSelected={setMapsSelected}
              routeStops={routeStops}
              setRouteStops={setRouteStops}
              techs={techs}
              onSendRoute={sendRouteToItinerary}
              progress={geocodeProgress}
              onOpenWO={(id) => { setCurrentModule('work-orders'); setCurrentView('active'); openWO(id); }}
              onWoAction={woAction}
              mapsHomeState={mapsHomeState}
              mapsHomeAddress={mapsHomeAddress}
              mapsHomeCity={mapsHomeCity}
              locationIqKey={locationIqKey}
              mapMarkerColors={settings.mapMarkerColors}
              mapTypeColors={settings.mapTypeColors}
              overdueCfg={overdueCfg}
              overdueTick={overdueTick}
              statusTags={statusTags}
              statusColors={statusColors}
              techColors={techColors}
              statuses={statuses}
              hiddenTypes={mapsHiddenTypes}
              setHiddenTypes={setMapsHiddenTypes}
            />
          ) : currentModule === 'invoices' ? (
            <InvoicesModule
              sentOrders={sentOrders}
              selectedId={selectedWO}
              onOpenInvoice={openInvoiceEditor}
              onWoAction={woAction}
            />
          ) : currentModule === 'itinerary' ? (
            <ItineraryModule
              activeOrders={activeOrders}
              techs={techs}
              phases={phases}
              statusColors={statusColors}
              statusTags={statusTags}
              focus={itinFocus}
              tech={itinTech}
              setTech={setItinTech}
              onClearFocus={() => setItinFocus(null)}
              onSetSchedule={setSchedule}
              onOpenWO={(id) => { setCurrentModule('work-orders'); setCurrentView('active'); openWO(id); }}
              statuses={statuses}
              types={types}
              pms={pms}
              inboxes={inboxes}
              onWoAction={woAction}
              onAddToInbox={onAddToInbox}
              onAddToNewInbox={onAddToNewInbox}
              onRemoveFromInbox={removeFromInbox}
            />
          ) : (
          <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
            <WorkOrdersHeader
              query={effectiveQuery}
              setQuery={(activePreset || activeInbox) ? (() => {}) : setQuery}
              view={currentView}
              onSelectView={selectView}
              isPresetView={!!activePreset || !!activeInbox}
              isInboxView={!!activeInbox}
              headerRight={(
                <div style={{ display: 'flex', gap: 6 }}>
                  {(window.scraper && window.scraper.captureAllAMH) && (
                    <button onClick={captureAllAMH} title="Capture all active AMH work orders from the portal" style={{
                      height: 26, padding: '0 12px', borderRadius: 999,
                      border: '1px solid var(--border-1)', background: 'transparent',
                      color: 'var(--text-2)', fontFamily: 'inherit', fontSize: 12,
                      fontWeight: 600, cursor: 'pointer', lineHeight: 1,
                    }}>Capture all AMH</button>
                  )}
                  {(window.extensionBridge && window.extensionBridge.requestFindNewMsr) && (
                    <button onClick={findNewMsr} title="Scan the open MSR list page for work orders not yet in the tracker (Chrome + extension must be open)" style={{
                      height: 26, padding: '0 12px', borderRadius: 999,
                      border: '1px solid var(--border-1)', background: 'transparent',
                      color: 'var(--text-2)', fontFamily: 'inherit', fontSize: 12,
                      fontWeight: 600, cursor: 'pointer', lineHeight: 1,
                    }}>Find new MSR WOs</button>
                  )}
                </div>
              )}
            />
            <div style={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0 }}>
              <Sidebar
                activeView={currentView}
                clients={pms}
                presets={presets}
                inboxes={inboxes}
                onSelectView={selectView}
                onRenamePreset={onRenamePreset}
                onDeletePreset={onDeletePreset}
                onAddInbox={onAddInbox}
                onRenameInbox={onRenameInbox}
                onDeleteInbox={onDeleteInbox}
              />
              <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <ListPane
                  view={currentView}
                  data={viewData}
                  phases={phases}
                  density={density}
                  sort={effectiveSort}
                  setSort={(activePreset || activeInbox) ? (() => {}) : setSort}
                  query={effectiveQuery}
                  setQuery={(activePreset || activeInbox) ? (() => {}) : setQuery}
                  filters={effectiveFilters}
                  setFilters={(activePreset || activeInbox) ? (() => {}) : setFilters}
                  isPresetView={!!activePreset || !!activeInbox}
                  isInboxView={!!activeInbox}
                  onSaveView={onSaveView}
                  selectedWO={currentView === 'settings' ? null : selectedWO}
                  onSelectWO={(wo) => {
                    openWO(wo);
                    if (currentView === 'settings') setCurrentView('active');
                  }}
                  onHighlightWO={(wo) => {
                    highlightWO(wo);
                    if (currentView === 'settings') setCurrentView('active');
                  }}
                  onVisibleRows={setVisibleOrder}
                  bulkActions={bulkActions}
                  selectedIds={selectedIds}
                  onCheck={handleCheck}
                  onClearSelection={clearSelection}
                  statuses={statuses}
                  types={types}
                  techs={techs}
                  inboxes={inboxes}
                  onWoAction={woAction}
                  onBulkSetStatus={bulkSetStatus}
                  onAddToNewInbox={onAddToNewInbox}
                  onAddToInbox={onAddToInbox}
                  onRemoveFromInbox={removeFromInbox}
                  onReorderInbox={reorderInbox}
                  onSelectView={selectView}
                  alerts={alerts}
                />
              </div>
            </div>
          </div>
          )}
        </div>
        )}
        </div>{/* end module content (flex:1) */}
        </div>{/* end top-strip flex column */}
        {commandCenter}
        {settingsOverlay}
        <QuickJump
          open={quickJumpOpen}
          orders={orders}
          onClose={() => setQuickJumpOpen(false)}
          onPick={(id) => { setQuickJumpOpen(false); setCurrentModule('work-orders'); setCurrentView('active'); openWO(id); }}
        />

        {/* ImportInspectModal rendered before add/edit modals so when its
            per-row Edit button triggers the edit modal, the edit modal mounts
            later in DOM order and paints on top at the same z-index. */}
        <ImportInspectModal
          state={importInspect}
          orders={orders}
          onClose={() => setImportInspect(null)}
          onWoAction={woAction}
          onSelectWO={(wo) => {
            setSelectedWO(wo); pushRecent(wo);
            setCurrentView('active');
            setCurrentModule('work-orders');
          }}
        />

        {newMsrWos && (
          <Modal open onClose={() => setNewMsrWos(null)}
            title={'New MSR work orders (' + newMsrWos.items.length + ')'} width={460}>
            {newMsrWos.items.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                All {newMsrWos.scanned} work orders on this list are already in the tracker.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>
                  {newMsrWos.items.length} of {newMsrWos.scanned} scanned work orders aren’t in the tracker.
                  Open each and use the extension’s on-page Capture button to add it.
                </div>
                {newMsrWos.items.map(it => (
                  <div key={it.num} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-1)',
                  }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{it.num}</span>
                    {it.url && (
                      <button onClick={() => window.shell && window.shell.openExternal && window.shell.openExternal(it.url)}
                        style={{
                          height: 24, padding: '0 12px', borderRadius: 6,
                          border: '1px solid var(--border-2)', background: 'transparent',
                          color: 'var(--accent)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}>Open</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Modal>
        )}

        <Modal open={modal === 'add'} onClose={() => setModal(null)} title="Add work order" width={620}>
          <WOForm
            mode="add"
            initial={null}
            data={data}
            onCancel={() => setModal(null)}
            onSubmit={submitAdd}
          />
        </Modal>
        <NamePromptModal state={namePrompt} onClose={() => setNamePrompt(null)} />
        <Modal
          open={!!editTarget}
          onClose={() => setModal(null)}
          title={editTarget ? ('Edit ' + editTarget.id) : 'Edit work order'}
          width={620}
        >
          <WOForm
            mode="edit"
            initial={editTarget}
            data={data}
            onCancel={() => setModal(null)}
            onSubmit={(form) => submitEdit(editTarget.id, form)}
          />
        </Modal>

        {scheduleTarget != null && (() => {
          const o = orders.find(x => x.id === scheduleTarget);
          if (!o) return null;
          return (
            <ScheduleModal
              order={o}
              techs={techs}
              activeOrders={activeOrders}
              geocache={geocache}
              techJobTypes={techJobTypes}
              routingWeights={routingWeights}
              onPick={(id) => setScheduleTarget(id)}
              onSubmit={(tech, sched) => { setSchedule(scheduleTarget, sched, tech); setScheduleTarget(null); toast('Scheduled ' + scheduleTarget); }}
              onUnschedule={() => { setSchedule(scheduleTarget, null); setScheduleTarget(null); toast('Unscheduled ' + scheduleTarget); }}
              onClose={() => setScheduleTarget(null)}
            />
          );
        })()}
        {bidPrompt != null && (() => {
          const o = orders.find(x => x.id === bidPrompt.id);
          if (!o) return null;
          // Slice 2 (#5): same modal serves Send-to-Invoice and Mark Complete;
          // mode picks the finishing action and wording.
          const completing = bidPrompt.mode === 'complete';
          const finish = completing ? doMarkComplete : doSendToInvoice;
          return (
            <BidPromptModal
              order={o}
              verb={completing ? 'complete' : 'send'}
              onEnter={(amount) => {
                updateOrder(bidPrompt.id, cur => ({ ...cur, bidAmount: amount }));
                finish(bidPrompt.id);
                setBidPrompt(null);
                toast(completing ? 'Bid saved · marked complete' : 'Bid saved · sent to invoice');
              }}
              onSkip={() => { finish(bidPrompt.id); setBidPrompt(null); toast(completing ? 'Marked complete (no bid)' : 'Sent to invoice (no bid)'); }}
              onClose={() => setBidPrompt(null)}
            />
          );
        })()}
        {invoiceEditorWO != null && (() => {
          const wo = orders.find(o => o.id === invoiceEditorWO);
          if (!wo) return null;
          const existingNumbers = orders
            .filter(o => o.id !== invoiceEditorWO && !o.deleted && o.invoice && o.invoice.number)
            .map(o => o.invoice.number);
          return (
            <InvoiceEditor
              order={wo}
              library={editorLibrary}
              existingNumbers={existingNumbers}
              onSave={(invoice, errMsg) => saveInvoice(invoiceEditorWO, invoice, errMsg)}
              onClose={() => setInvoiceEditorWO(null)}
            />
          );
        })()}
        {needsMigration && <MigrationDialog onApply={applyMigration} onSkip={skipMigration} backupBeforeApply={backupBeforeApply} setBackupBeforeApply={setBackupBeforeApply} />}
        {/* Module navigation is the fold-out NavWing (nav.jsx), mounted once
            inside the non-overview shell above. */}
        <ToastHost toasts={toasts} />
        </HeaderActionsContext.Provider>
       </ModuleNavContext.Provider>
      </ToastContext.Provider>
     </StatusColorsContext.Provider>
    </PhasesContext.Provider>
    </PMsContext.Provider>
  );
}

createRoot(document.getElementById('root')).render(<App />);

