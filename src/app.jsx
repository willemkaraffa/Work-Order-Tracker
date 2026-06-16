import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_PMS, DEFAULT_TYPES, DEFAULT_TECHS, DEFAULT_PHASES, DENSITY_MAP, densityFor,
  MIGRATION_VERSION, APP_VERSION, DEFAULT_STATUS_COLORS, LOCKED_STATUSES, SYSTEM_TAGS,
  SYSTEM_TAG_LABELS, isCompletionStatusName, EDITABLE_THEME_VARS, DEFAULT_MORE_INFO_COLOR,
  statusColor, TYPE_COLORS, DEFAULT_MAP_MARKER_COLORS, normalizeHex, hexToRgba,
} from './constants.js';
import {
  PhasesContext, usePhases, StatusColorsContext, useStatusColors,
  ToastContext, useToast, PMsContext, usePMs,
} from './contexts.js';
import {
  Dot, PMChip, TypeIcon, FlagGlyph, StatusPill, ActionBtn, FilterChip,
  InlineEdit, SettingTitle, SettingRow, Seg, miniBtnStyle, ReorderBtns, swapAt,
} from './primitives.jsx';
import { formatPhone, haversineKm, roadKm } from './utils.js';


/* ============================================================
   Trade Tracker — Phase 1 visual shell (mock sample data).
   Real data wiring lands in Phase 2.
   ============================================================ */

/* ---------- tokens ---------- */
// Catppuccin Latte palette port. Hex values verbatim from catppuccin/catppuccin.
// https://catppuccin.com/palette/ -- Latte column.
const TT_LIGHT = {
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

  // Age-warning tints derived from Latte red
  '--age-1':         '#f4d4d8',  // very light red wash
  '--age-2':         '#eeb6bc',  // mid red wash
  '--age-3':         '#e58a93',  // saturated red wash

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

const TT_DARK = {
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
  '--age-1':         'oklch(19% 0.025 25)',
  '--age-2':         'oklch(23% 0.055 25)',
  '--age-3':         'oklch(28% 0.085 25)',
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
const DEFAULT_STATUSES = [
  'Open',
  'Bid Submitted',
  'Bid Approved - Return',
  'Parts Pending',
  'Bid Approved - Complete',
  'Pending-Complete',
  'Closed',
  'Complete - Pending Approval',
  'Cancelled',
];

// Constants + pure helpers moved to ./constants.js (imported at top).

// React contexts/hooks moved to ./contexts.js; shared UI atoms (Dot, PMChip,
// TypeIcon, FlagGlyph, StatusPill, ActionBtn, FilterChip, InlineEdit,
// SettingTitle, SettingRow, Seg, miniBtnStyle, ReorderBtns, swapAt) moved to
// ./primitives.jsx. Both imported at top.

function FilterDropdown({ label, value, options, onChange }) {
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

function SortDropdown({ sort, onChange }) {
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

function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function GambleMark({ size = 22 }) {
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

// Configurable phase mapping. `phases` arg comes from wo_data.phases (defaults if absent).
// Lookup is exact-first, then case-insensitive, then a legacy heuristic so old data still buckets.
function phaseFor(status, phases) {
  const list = Array.isArray(phases) && phases.length ? phases : DEFAULT_PHASES;
  const s = String(status || '').trim();
  if (!s) return list[0]?.name || 'Intake';
  for (const p of list) if ((p.statuses || []).includes(s)) return p.name;
  const sl = s.toLowerCase();
  for (const p of list) for (const ps of (p.statuses || [])) {
    if (String(ps).toLowerCase() === sl) return p.name;
  }
  // legacy heuristic fallback
  if (sl === 'open')                          return 'Intake';
  if (sl.startsWith('bid submitted'))         return 'Awaiting PM';
  if (sl.startsWith('bid approved'))          return 'Approved';
  if (sl.startsWith('parts pending'))         return 'In progress';
  if (sl.startsWith('pending-complete') ||
      sl === 'pending complete')              return 'Wrapping up';
  if (sl === 'closed')                        return 'Done';
  return list[0]?.name || 'Intake';
}

// change11:
// - sent goes under "Billing"
// - complete goes under "Complete" (matches the user-facing tab name)
// - trash/deleted WOs go under a single "Cancelled" bucket regardless of their
//   stored status. (Their status is hardcoded to 'Cancelled' on softDelete; the
//   phase bucket name matches so the Trash view reads as one flat list.)
// Active (and any unhandled) WOs use phaseFor on the status.
function phaseForOrder(o, phases) {
  if (o.deleted || o.tab === 'trash') return 'Cancelled';
  if (o.tab === 'sent')     return 'Billing';
  if (o.tab === 'complete') return 'Complete';
  return phaseFor(o.status, phases);
}

function phaseStyle(status, phases) {
  const list = Array.isArray(phases) && phases.length ? phases : DEFAULT_PHASES;
  const name = phaseFor(status, list);
  const p = list.find(x => x.name === name);
  if (p) return { phase: name, fg: p.fg, bg: p.bg, dot: p.fg };
  return { phase: name, fg: 'var(--text-2)', bg: 'var(--bg-surface-2)', dot: 'var(--text-2)' };
}

function daysSince(d) {
  if (!d) return 0;
  const t = new Date(String(d) + 'T00:00:00').getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

function ageLevelFor(d) {
  const n = daysSince(d);
  return ageLevelForDays(n);
}

function ageLevelForDays(n) {
  if (n == null) return 0;
  if (n >= 30) return 3;
  if (n >= 15) return 2;
  if (n >= 8)  return 1;
  return 0;
}

// Age in days, scoped to the current tab.
// - paid:      null (no age, no tint — WO is finalized)
// - sent:      days since the most recent 'sent to billing queue' history entry.
// change11:
// - complete:  days since the most recent 'marked complete' history entry.
//              Surfaces aging color coding on the Complete tab (not yet paid).
// - sent:      days since the most recent 'sent to billing' entry — used
//              ONLY by the Invoices module's aging buckets, not by ageDaysFor
//              directly (sent rows do not display an age in the WO list).
// - other:     days since dateCreated (legacy behavior).
function ageDaysFor(o) {
  const tab = o.tab || 'active';
  if (tab === 'sent') return null;
  if (tab === 'complete') {
    const h = Array.isArray(o.history) ? o.history : [];
    for (let i = h.length - 1; i >= 0; i--) {
      const a = String(h[i].action || '').toLowerCase();
      if (a.includes('marked complete') || a.includes('auto-flipped to complete')) {
        return Math.floor((Date.now() - h[i].ts) / 86400000);
      }
    }
    // Fallback: WO was on tab='complete' without a marked/auto-flipped entry
    // (e.g. imported pre-change11). Use dateCreated so the aging tint is not
    // misleadingly fresh.
    return daysSince(o.dateCreated);
  }
  return daysSince(o.dateCreated);
}

function typeLetter(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'plumbing')   return 'P';
  if (t === 'hvac')       return 'H';
  if (t === 'electrical') return 'E';
  return (type || '?').slice(0, 1).toUpperCase();
}

// Some legacy WOs have city baked into o.address ("412 Hillcrest Dr, Durham, NC")
// AND a separate o.city. Strip the city suffix if present so we don't double-print.
function splitAddress(o) {
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

function sortRows(rows, sort, phaseStatuses) {
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
function nextWOId(orders, customId) {
  if (customId && customId.trim()) return customId.trim();
  const nums = (orders || []).map(o => parseInt(String(o.id || '').replace(/[^0-9]/g, ''), 10) || 0);
  return 'WO-' + (Math.max(0, ...nums) + 1).toString().padStart(3, '0');
}

// Mechanism ported from legacy formatPhone().
// formatPhone moved to ./utils.js (imported at top).

function toDetailData(o) {
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
const DEFAULT_OVERDUE_CFG = { thresholdMinutes: 60, textColor: '#ef4444', borderColor: '#ef4444' };
let OVERDUE_CFG = DEFAULT_OVERDUE_CFG;
function isOverdueSched(date, start) {
  if (!date) return false;
  const t = new Date(date + 'T' + (start || '00:00') + ':00').getTime();
  return isFinite(t) && Date.now() - t > OVERDUE_CFG.thresholdMinutes * 60000;
}

// haversineKm + roadKm (+ ROAD_FACTOR) moved to ./utils.js (imported at top).

// Routing tunables. weights apply to the composite "Suggested" score; the map
// turns a tech's low/med/high job-type preference into a numeric multiplier.
const DEFAULT_ROUTING_WEIGHTS = { dist: 1, city: 0.5, unfilledCity: 0.3, type: 0.4 };
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

const DEFAULT_ALERT_THRESHOLDS = {
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
      entry = { kind: 'stale', blurb: `Bid out ${ageStage} days, no response from ${o.pm || 'PM'}` };
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

// Returns [data, updateOrder]; data is null while loading.
// data is the full wo_data envelope { orders, presets, pms, settings, ... }.
function useWorkOrders() {
  const [data, setData] = React.useState(null);
  const dataRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const fresh = () => ({
        orders: [], presets: [], inboxes: [],
        statuses: DEFAULT_STATUSES.slice(),
        phases: DEFAULT_PHASES.map(p => ({ ...p })),
        statusColors: { ...DEFAULT_STATUS_COLORS },
        moreInfoColor: DEFAULT_MORE_INFO_COLOR,
        pms:   DEFAULT_PMS.slice(),
        types: DEFAULT_TYPES.slice(),
        techs: DEFAULT_TECHS.slice(),
        settings: {},
      });
      if (!window.storage || !window.storage.get) {
        const empty = fresh();
        if (!cancelled) { setData(empty); dataRef.current = empty; }
        return;
      }
      try {
        const r = await window.storage.get('wo_data');
        if (cancelled) return;
        let parsed = fresh();
        if (r && r.value) {
          try {
            const p = JSON.parse(r.value);
            parsed = p && typeof p === 'object' ? p : fresh();
          } catch { parsed = fresh(); }
        }
        if (!Array.isArray(parsed.orders))   parsed.orders   = [];
        if (!Array.isArray(parsed.presets))  parsed.presets  = [];
        if (!Array.isArray(parsed.inboxes))  parsed.inboxes  = [];
        if (!Array.isArray(parsed.statuses) || !parsed.statuses.length) parsed.statuses = DEFAULT_STATUSES.slice();
        if (!Array.isArray(parsed.phases))   parsed.phases   = DEFAULT_PHASES.map(p => ({ ...p }));
        // change11: do NOT strip the legacy `complete` flag here — the
        // reconciler and migrateOrders both consume it to decide which active
        // WOs flip to tab='complete'. The flag is removed only AFTER those
        // consumers run (inside migrateSettingsForChange11).
        if (!parsed.statusColors || typeof parsed.statusColors !== 'object') parsed.statusColors = {};
        parsed.statusColors = { ...DEFAULT_STATUS_COLORS, ...parsed.statusColors };
        if (typeof parsed.moreInfoColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(parsed.moreInfoColor)) {
          parsed.moreInfoColor = DEFAULT_MORE_INFO_COLOR;
        }
        if (!parsed.settings || typeof parsed.settings !== 'object') parsed.settings = {};
        if (!parsed.settings.viewSorts || typeof parsed.settings.viewSorts !== 'object') parsed.settings.viewSorts = {};
        if (!Array.isArray(parsed.pms)   || !parsed.pms.length)   parsed.pms   = DEFAULT_PMS.slice();
        if (!Array.isArray(parsed.types) || !parsed.types.length) parsed.types = DEFAULT_TYPES.slice();
        if (!Array.isArray(parsed.techs) || !parsed.techs.length) parsed.techs = DEFAULT_TECHS.slice();
        setData(parsed);
        dataRef.current = parsed;
      } catch {
        const empty = fresh();
        if (!cancelled) { setData(empty); dataRef.current = empty; }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateOrder = React.useCallback((id, mutator) => {
    const cur = dataRef.current;
    if (!cur) return;
    const orders = cur.orders.map(o => o.id === id ? mutator(o) : o);
    // v2.6.0 parity: editing a WO and typing a new tech name into the field
    // should add it to the techs list so future dropdowns include it.
    const edited = orders.find(o => o.id === id);
    let techs = cur.techs;
    if (edited && edited.tech && !techs.includes(edited.tech)) {
      techs = [...techs, edited.tech];
    }
    const next = { ...cur, orders, techs };
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
  }, []);

  // Patch top-level settings object (e.g. density, theme).
  const updateSettings = React.useCallback((patchOrFn) => {
    const cur = dataRef.current;
    if (!cur) return;
    const curSettings = cur.settings || {};
    const patch = typeof patchOrFn === 'function' ? patchOrFn(curSettings) : patchOrFn;
    const next = { ...cur, settings: { ...curSettings, ...patch } };
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
  }, []);

  // Apply mutator to every order matching predicate, single render + single save.
  const batchUpdate = React.useCallback((predicate, mutator) => {
    const cur = dataRef.current;
    if (!cur) return;
    const orders = cur.orders.map(o => predicate(o) ? mutator(o) : o);
    // v2.6.0 parity: bulk-edit can assign a new tech name; ensure it lands in techs.
    const techsSet = new Set(cur.techs || []);
    let techsChanged = false;
    for (const o of orders) {
      if (o.tech && !techsSet.has(o.tech)) { techsSet.add(o.tech); techsChanged = true; }
    }
    const next = { ...cur, orders };
    if (techsChanged) next.techs = Array.from(techsSet);
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
  }, []);

  // Append a new order. Returns the assigned id.
  const addOrder = React.useCallback((record) => {
    const cur = dataRef.current;
    if (!cur) return null;
    const id = nextWOId(cur.orders, record.id);
    // change11: auto-flip new WOs that already carry a completion status into
    // tab='complete' with hardcoded Pending Approval. Mirrors the import path.
    const recStatus = record.status || 'Open';
    const recIsCompletion = isCompletionStatusName(recStatus);
    const o = {
      ...record,
      id,
      deleted: false,
      tab: recIsCompletion ? 'complete' : (record.tab || 'active'),
      status: recIsCompletion ? 'Complete - Pending Approval' : recStatus,
      ...(recIsCompletion ? { prevStatus: recStatus } : {}),
      history: recIsCompletion
        ? [{ ts: Date.now(), action: 'created', detail: '' },
           { ts: Date.now(), action: 'auto-flipped to Complete', detail: 'status=' + recStatus + ' → Complete - Pending Approval' }]
        : [{ ts: Date.now(), action: 'created', detail: '' }],
    };
    const techs = (record.tech && !cur.techs.includes(record.tech)) ? [...cur.techs, record.tech] : cur.techs;
    const next = { ...cur, orders: [...cur.orders, o], techs };
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
    return id;
  }, []);

  // Permanent delete (used by trash → "Delete permanently").
  const deleteOrderHard = React.useCallback((id) => {
    const cur = dataRef.current;
    if (!cur) return;
    const orders = cur.orders.filter(o => o.id !== id);
    const next = { ...cur, orders };
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
  }, []);

  const addPreset = React.useCallback((preset) => {
    const cur = dataRef.current;
    if (!cur) return null;
    const id = 'pv_' + Date.now().toString(36);
    const next = { ...cur, presets: [...(cur.presets || []), { id, ...preset }] };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    return id;
  }, []);

  const updatePreset = React.useCallback((id, patch) => {
    const cur = dataRef.current;
    if (!cur) return;
    const presets = (cur.presets || []).map(p => p.id === id ? { ...p, ...patch } : p);
    const next = { ...cur, presets };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  }, []);

  const deletePreset = React.useCallback((id) => {
    const cur = dataRef.current;
    if (!cur) return;
    const presets = (cur.presets || []).filter(p => p.id !== id);
    const next = { ...cur, presets };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  }, []);

  // --- Custom inboxes (manual-membership, ordered WO lists) ---
  const persistInboxes = (cur, inboxes) => {
    const next = { ...cur, inboxes };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  };
  const addInbox = React.useCallback((name) => {
    const cur = dataRef.current;
    if (!cur) return null;
    const id = 'ib_' + Date.now().toString(36);
    persistInboxes(cur, [...(cur.inboxes || []), { id, name, woIds: [] }]);
    return id;
  }, []);
  const renameInbox = React.useCallback((id, name) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).map(b => b.id === id ? { ...b, name } : b));
  }, []);
  const deleteInbox = React.useCallback((id) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).filter(b => b.id !== id));
  }, []);
  const addToInbox = React.useCallback((id, woId) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).map(b => {
      if (b.id !== id) return b;
      const have = new Set(b.woIds || []);
      const incoming = (Array.isArray(woId) ? woId : [woId]).filter(w => !have.has(w));
      return { ...b, woIds: [...(b.woIds || []), ...incoming] };
    }));
  }, []);
  const removeFromInbox = React.useCallback((id, woId) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).map(b =>
      b.id === id ? { ...b, woIds: (b.woIds || []).filter(w => w !== woId) } : b));
  }, []);
  const reorderInbox = React.useCallback((id, woIds) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).map(b => b.id === id ? { ...b, woIds } : b));
  }, []);

  const deleteOrdersHard = React.useCallback((ids) => {
    const cur = dataRef.current;
    if (!cur) return;
    const set = new Set(ids);
    const orders = cur.orders.filter(o => !set.has(o.id));
    const next = { ...cur, orders };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  }, []);

  // Mechanism ported from v2.6.0 import handler: extension payload uses
  // sequential WO-### as `inc.id` and the real portal WO# as `inc.woId`.
  // v3.0.0's previous spread-only upsert ignored woId, so MSR/AMH captures
  // landed under WO-### instead of the portal number, and propertyId from a
  // prior AMH spread leaked onto unrelated rows. Behavior here:
  //   id := inc.woId when present and not colliding; else honor matching
  //   inc.id; else mint sequential WO-###. Address/propertyId/phone dedup
  //   silently skips re-captures. Explicit field map prevents stale fields
  //   from one payload contaminating another row.
  const upsertOrders = React.useCallback((incoming) => {
    const cur = dataRef.current;
    if (!cur || !Array.isArray(incoming) || !incoming.length) {
      return { imported: 0, dupSkipped: 0, batch: [] };
    }
    const byId = new Map((cur.orders || []).map(o => [o.id, o]));

    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const digits = (s) => String(s || '').replace(/\D/g, '');
    const findDuplicate = (item) => {
      const addr = norm(item.address);
      const pid  = norm(item.propertyId);
      const ph   = digits(item.phone);
      for (const o of byId.values()) {
        if (o.deleted) continue;
        if (pid && norm(o.propertyId) === pid) return o;
        if (addr && norm(o.address) === addr) return o;
        if (ph && ph.length >= 10 && digits(o.phone) === ph) return o;
      }
      return null;
    };

    const idNum = (o) => parseInt(String(o.id || '').replace(/[^0-9]/g, ''), 10) || 0;
    let nextNum = Math.max(0, ...Array.from(byId.values()).map(idNum)) + 1;
    let imported = 0, dupSkipped = 0;
    const batch = []; // ids of WOs that were created or updated this call
    const techsSet = new Set(cur.techs || []);
    let techsChanged = false;

    for (const inc of incoming) {
      if (!inc) continue;

      const portalWo = String(inc.woId || '').trim();
      let id;
      // stableId = the incoming row carries a real portal WO#. Such rows must NOT
      // be address/phone-deduped: a genuinely new WO# at a known address is a
      // distinct order, not a duplicate. (inc.id is only a local WO-NNN sequence
      // from the extension, so it does NOT count as stable.)
      let stableId = false;
      if (portalWo && byId.has(portalWo))               { id = portalWo; stableId = true; }
      else if (portalWo)                                { id = portalWo; stableId = true; }
      else if (inc.id && byId.has(inc.id))              id = inc.id;
      else {
        const dup = findDuplicate(inc);
        if (dup) { dupSkipped++; continue; }
        id = 'WO-' + String(nextNum++).padStart(3, '0');
      }

      if (byId.has(id)) {
        batch.push({ id, isNew: false });
        const old = byId.get(id);
        // change11: WOs on tab='complete' / 'trash' carry a HARDCODED status
        // (Complete - Pending Approval / Cancelled). A re-import from the
        // scraper must NOT overwrite that with the raw portal status; only
        // active WOs accept status updates from import.
        const hardcoded = old.tab === 'complete' || old.tab === 'trash' || old.deleted;
        byId.set(id, {
          ...old,
          pm:          inc.pm          || old.pm,
          type:        inc.type        || old.type,
          address:     inc.address     || old.address,
          phone:       inc.phone       ? formatPhone(inc.phone) : old.phone,
          tech:        inc.tech        || old.tech,
          status:      hardcoded ? old.status : (inc.status || old.status),
          priority:    inc.priority    || old.priority,
          notes:       inc.notes       || old.notes,
          dateCreated: inc.dateCreated || old.dateCreated,
          propertyId:  inc.propertyId  || old.propertyId,
          city:        inc.city        || old.city,
          portalLink:  inc.portalLink  || old.portalLink,
          bidItems:    (Array.isArray(inc.bidItems) && inc.bidItems.length) ? inc.bidItems : old.bidItems,
          history: [...(old.history || []), { ts: Date.now(), action: 'updated from import', detail: '' }],
        });
      } else {
        // New row. Address/phone/propertyId dedup only for rows WITHOUT a stable
        // portal WO# — a real new WO# at a known address must still import.
        if (!stableId) {
          const dup = findDuplicate(inc);
          if (dup) { dupSkipped++; continue; }
        }
        // change11: detect completion status on import. If the scraper / import
        // sees a status that signals tech-done ('Pending-Complete', 'Closed',
        // or any string containing 'Job Complete'), the new row lands on
        // Complete tab with status hardcoded and prevStatus saved — matches
        // the auto-flip behavior on manual status changes.
        const incStatus = inc.status || 'Open';
        const importIsCompletion = isCompletionStatusName(incStatus);
        const wo = {
          id,
          pm:            inc.pm || '',
          type:          inc.type || 'Other',
          address:       inc.address || '',
          phone:         formatPhone(inc.phone || ''),
          tech:          inc.tech || '',
          status:        importIsCompletion ? 'Complete - Pending Approval' : incStatus,
          ...(importIsCompletion ? { prevStatus: incStatus } : {}),
          priority:      inc.priority || 'Medium',
          notes:         inc.notes || '',
          dateCreated:   inc.dateCreated || new Date().toISOString().slice(0, 10),
          tab:           importIsCompletion ? 'complete' : 'active',
          deleted:       false,
          propertyId:    inc.propertyId || '',
          bidAmount:     inc.bidAmount || '',
          dateOfService: '',
          portalLink:    inc.portalLink || '',
          city:          inc.city || '',
          emergency:     !!inc.emergency,
          warranty:      !!inc.warranty,
          bidItems:      Array.isArray(inc.bidItems) ? inc.bidItems : [],
          history:       importIsCompletion
            ? [{ ts: Date.now(), action: 'imported', detail: '' },
               { ts: Date.now(), action: 'auto-flipped to Complete', detail: 'import status=' + incStatus + ' → Complete - Pending Approval' }]
            : [{ ts: Date.now(), action: 'imported', detail: '' }],
        };
        byId.set(id, wo);
        batch.push({ id, isNew: true });
        if (wo.tech && !techsSet.has(wo.tech)) { techsSet.add(wo.tech); techsChanged = true; }
      }
      imported++;
    }

    const next = { ...cur, orders: Array.from(byId.values()) };
    if (techsChanged) next.techs = Array.from(techsSet);
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    return { imported, dupSkipped, batch };
  }, []);

  const updateData = React.useCallback((patch) => {
    const cur = dataRef.current;
    if (!cur) return;
    const next = { ...cur, ...patch };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  }, []);

  return [data, updateOrder, batchUpdate, updateSettings, addOrder, deleteOrderHard, addPreset, updatePreset, deletePreset, deleteOrdersHard, upsertOrders, updateData,
          addInbox, renameInbox, deleteInbox, addToInbox, removeFromInbox, reorderInbox];
}

/* ---------- modal + form primitives ---------- */

function Modal({ open, onClose, title, children, width = 560 }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      onClick={onClose}
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
  const types    = data?.types    || DEFAULT_TYPES;
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

        <FormField label="PM" span={1}>
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

function MenuItem({ onClick, danger, children }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '7px 12px',
        fontSize: 13,
        color: danger ? 'var(--flag-emergency)' : 'var(--text-1)',
        background: hover ? 'var(--bg-hover)' : 'transparent',
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >{children}</div>
  );
}

function MenuDivider() {
  return <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />;
}

function MenuCaption({ children }) {
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
function WOContextMenu({
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

  const showEditDetails = !bulk && tab !== 'trash';
  const showInvoice     = !bulk && invoiceLabel;
  const showViewDetails = source === 'list' && !bulk;
  const showSchedule    = tab === 'active' && !bulk;
  const showMark        = tab === 'active' && !bulk;
  const showCapture     = !bulk && window.scraper && window.scraper.captureWO && ctxRow?.pm === 'AMH';
  const showRemoveInbox = isInboxView && inboxId && !bulk;

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

        {parentRow('status', bulk ? 'Set status (' + bulkCount + ')' : 'Set status')}
        {!bulk && parentRow('pm', 'Set PM')}
        {!bulk && parentRow('type', 'Set type')}
        {!bulk && parentRow('tech', 'Set tech')}

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
                onClick={() => { it.onClick && it.onClick(); onClose(); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '7px 12px', fontSize: 13, color: 'var(--text-1)',
                  cursor: 'pointer', userSelect: 'none',
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
function Sidebar({ activeView, onSelectView, presets, inboxes, onRenamePreset, onDeletePreset, onRenameInbox, onDeleteInbox, onAddInbox }) {
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
      <SidebarLauncherButton />
    </aside>
  );
}

// Module Launcher button shared across every module sidebar. Uses
// HeaderActionsContext.onOpenLauncher and floats to the bottom of the
// containing flex-column sidebar via marginTop: 'auto'.
function SidebarLauncherButton() {
  const a = React.useContext(HeaderActionsContext);
  const [hover, setHover] = React.useState(false);
  if (!a || !a.onOpenLauncher) return null;
  return (
    <button
      onClick={a.onOpenLauncher}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Open module launcher"
      style={{
        marginTop: 'auto',
        marginBottom: 12,
        alignSelf: 'center',
        flexShrink: 0,
        boxSizing: 'border-box',
        width: 176, height: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        padding: '0 14px',
        border: '1.5px solid var(--accent)',
        borderRadius: 8,
        background: hover
          ? 'color-mix(in srgb, var(--accent) 22%, transparent)'
          : 'color-mix(in srgb, var(--accent) 12%, transparent)',
        color: 'var(--text-1)',
        fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
        cursor: 'pointer',
        transition: 'background 120ms ease',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1, color: 'var(--accent)' }}>{'⊞'}</span>
      <span>Modules</span>
    </button>
  );
}

// Shared collapse state for a sidebar section. Persists in sessionStorage
// keyed by sectionKey so collapses survive view switches within a session
// but reset on app reload. Returns [open, toggle].
function useCollapsedSection(sectionKey, defaultOpen = true) {
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
function CollapsibleSection({ title, sectionKey, defaultOpen = true, headerStyle, extras, children }) {
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

const TT_VIEW_DATA = {
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
        <ModuleNavChevrons side="home" />
        <ModuleNavChevrons side="left" />
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
        <ModuleNavChevrons side="right" />
      </div>
    </div>
  );
}

function ListPane({ selectedWO, onSelectWO, view = 'active', data, phases, density, sort, setSort, query, setQuery, filters, setFilters, isPresetView, isInboxView, onSaveView, bulkActions, selectedIds, onCheck, onClearSelection, statuses, onWoAction, onBulkSetStatus, types, techs, inboxes, onAddToNewInbox, onAddToInbox, onRemoveFromInbox, onReorderInbox, onSelectView, alerts = [] }) {
  const pms = usePMs();
  const [collapsed, setCollapsed] = React.useState({});
  // Search input + "/" focus shortcut live in WorkOrdersHeader (module-level
  // strip above the list). No inputRef needed here anymore.
  const scrollRef = React.useRef(null);
  const savedScrollTop = React.useRef(0);
  const [ctxMenu, setCtxMenu] = React.useState(null); // { woId, x, y, tab } | null
  const [ctxSub, setCtxSub] = React.useState(null);   // 'status' | 'pm' | 'type' | 'tech' | null
  // Stable ref so add/removeEventListener match across re-renders; otherwise
  // each WorkOrdersList re-render registers a new listener with the old one
  // never removed (the cleanup uses the new closeCtx ref and silently no-ops).
  const closeCtx = React.useCallback(() => { setCtxMenu(null); setCtxSub(null); }, []);
  const toggle = (p) => setCollapsed(s => ({ ...s, [p]: !s[p] }));
  const setF = (k) => (v) => setFilters(f => ({ ...f, [k]: v }));
  const resolved = data || TT_VIEW_DATA[view] || TT_VIEW_DATA.active;
  // Reorder a stop within a route inbox: swap the row with its adjacent VISIBLE
  // neighbor inside the stored woIds (preserves any stale/unresolved ids).
  const moveInRoute = (rows, ri, dir) => {
    const j = ri + dir;
    if (!resolved.inboxId || !onReorderInbox || j < 0 || j >= rows.length) return;
    const woIds = (resolved.inboxWoIds || []).slice();
    const a = woIds.indexOf(rows[ri].wo);
    const b = woIds.indexOf(rows[j].wo);
    if (a < 0 || b < 0) return;
    onReorderInbox(resolved.inboxId, swapAt(woIds, a, b));
  };
  const groups = resolved.groups || [];

  const q = query.trim().toLowerCase();

  // Filter dropdown options: list values present in current view, ordered by
  // the corresponding Settings -> Workflow list (statuses, types, techs, PMs).
  // Values not in settings (legacy/stale data) appended alphabetically at end.
  const optsFor = (field, ordering) => {
    const set = new Set();
    groups.forEach(g => g.rows.forEach(r => { if (r[field]) set.add(r[field]); }));
    if (!Array.isArray(ordering) || !ordering.length) return Array.from(set).sort();
    const rank = new Map(ordering.map((v, i) => [v, i]));
    return Array.from(set).sort((a, b) => {
      const ai = rank.has(a) ? rank.get(a) : Infinity;
      const bi = rank.has(b) ? rank.get(b) : Infinity;
      if (ai !== bi) return ai - bi;
      return String(a).localeCompare(String(b));
    });
  };
  const pmOptions     = optsFor('pm', (pms || []).map(p => p.name));
  const typeOptions   = optsFor('type', types);
  const statusOptions = optsFor('status', statuses);
  const techOptions   = optsFor('tech', techs);

  const dirDisabled = !sort || !sort.key;

  React.useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTop.current;
  }, [sort && sort.key, sort && sort.dir]);

  // Scroll the selected WO row into view when selectedWO changes (e.g. from
  // overview alert click, attention list click, or external navigation).
  // Uses data-wo-id attribute set on each ListRow root.
  React.useEffect(() => {
    if (!selectedWO || !scrollRef.current) return;
    const el = scrollRef.current.querySelector('[data-wo-id="' + CSS.escape(String(selectedWO)) + '"]');
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [selectedWO]);

  React.useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e) => { if (e.key === 'Escape') closeCtx(); };
    // Capture-phase contextmenu close: fires before ListRow's
    // stopPropagation in bubble, so a right-click on the detail pane or
    // another list row closes this menu first. Without capture, ListRow's
    // bubble-phase stopPropagation hides cross-pane right-clicks from this
    // listener and the menus stack.
    const t = setTimeout(() => {
      document.addEventListener('click', closeCtx);
      document.addEventListener('contextmenu', closeCtx, true);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', closeCtx);
      document.removeEventListener('contextmenu', closeCtx, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu, closeCtx]);

  const matchesFilters = (r) =>
    (!filters.pm     || r.pm     === filters.pm)     &&
    (!filters.type   || r.type   === filters.type)   &&
    (!filters.status || r.status === filters.status) &&
    (!filters.tech   || r.tech   === filters.tech);

  const filteredGroups = (q || filters.pm || filters.type || filters.status || filters.tech)
    ? groups.map(g => ({
        ...g,
        rows: g.rows.filter(r =>
          matchesFilters(r) &&
          (!q ||
            (r.addr  || '').toLowerCase().includes(q) ||
            (r.city  || '').toLowerCase().includes(q) ||
            (r.wo    || '').toLowerCase().includes(q) ||
            (r.tech  || '').toLowerCase().includes(q) ||
            (r.pm    || '').toLowerCase().includes(q) ||
            (r.status|| '').toLowerCase().includes(q))
        ),
      })).filter(g => g.rows.length)
    : groups;

  const sortedGroups = (sort && sort.key)
    ? filteredGroups.map(g => {
        const phaseConfig = (phases || []).find(p => p.name === g.phase);
        const phaseStatuses = (phaseConfig && phaseConfig.statuses) || [];
        return { ...g, rows: sortRows(g.rows, sort, phaseStatuses) };
      })
    : filteredGroups;

  const flatRows = React.useMemo(() => {
    const out = [];
    sortedGroups.forEach(g => {
      if (!collapsed[g.phase]) g.rows.forEach(r => out.push(r.wo));
    });
    return out;
  }, [sortedGroups, collapsed]);

  React.useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (!flatRows.length) return;
      e.preventDefault();
      const idx = selectedWO ? flatRows.indexOf(selectedWO) : -1;
      let next;
      if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % flatRows.length;
      else                       next = idx <= 0 ? flatRows.length - 1 : idx - 1;
      onSelectWO(flatRows[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flatRows, selectedWO, onSelectWO]);

  const visibleCount = sortedGroups.reduce((n, g) => n + g.rows.length, 0);
  const hasActiveFilter = !!(q || filters.pm || filters.type || filters.status || filters.tech);
  // Stat chips shown next to the view title. Each chip counts an alert kind
  // across ALL active WOs (not just the current view); zero-count kinds are
  // dropped so the row stays minimal.
  const alertChips = React.useMemo(() => {
    const by = { emergency: 0, stale: 0, parts: 0 };
    for (const a of (alerts || [])) { if (by[a.kind] !== undefined) by[a.kind]++; }
    const out = [];
    if (by.emergency) out.push({ kind: 'emergency', n: by.emergency, label: 'emergency', color: 'var(--flag-emergency)' });
    if (by.stale)     out.push({ kind: 'stale',     n: by.stale,     label: 'stale',     color: 'oklch(60% 0.13 50)' });
    if (by.parts)     out.push({ kind: 'parts',     n: by.parts,     label: 'parts pending', color: 'oklch(60% 0.13 280)' });
    return out;
  }, [alerts]);

  return (
    <section style={{
      borderRight: '1px solid var(--border-1)',
      display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0,
      background: 'var(--bg-canvas)',
    }}>
      {/* List-pane controls: filters + count/sort row. Title/pills/search live
          in WorkOrdersHeader (module-level strip spanning the full WO width). */}
      <div style={{ padding: '12px 18px 10px', borderBottom: '1px solid var(--border-1)' }}>
        {!isInboxView && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <FilterDropdown label="PM"     value={filters.pm}     options={pmOptions}     onChange={setF('pm')} />
          <FilterDropdown label="Type"   value={filters.type}   options={typeOptions}   onChange={setF('type')} />
          <FilterDropdown label="Status" value={filters.status} options={statusOptions} onChange={setF('status')} />
          <FilterDropdown label="Tech"   value={filters.tech}   options={techOptions}   onChange={setF('tech')} />
          {(filters.pm || filters.type || filters.status || filters.tech) && (
            <span
              onClick={() => setFilters({ pm: '', type: '', status: '', tech: '' })}
              style={{ marginLeft: 4, alignSelf: 'center', fontSize: 12, color: 'var(--text-3)', cursor: 'pointer', textDecoration: 'underline' }}
            >Clear filters</span>
          )}
        </div>
        )}
        <div style={{
          marginTop: isInboxView ? 0 : 10, fontSize: 13, color: 'var(--text-2)',
          fontVariantNumeric: 'tabular-nums',
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>{resolved.title} ({resolved.total})</span>
          {hasActiveFilter && (<>
            <Dot />
            <span>Showing {visibleCount}</span>
          </>)}
          {alertChips.length > 0 && alertChips.map((c) => (
            <React.Fragment key={c.kind}>
              <Dot />
              <span style={{ color: c.color }}>{c.n} {c.label}</span>
            </React.Fragment>
          ))}
          {!isPresetView && hasActiveFilter && (
            <button onClick={onSaveView} style={{
              height: 22, padding: '0 8px',
              border: '1px solid var(--border-2)', borderRadius: 4,
              background: 'var(--bg-surface)', color: 'var(--text-1)',
              fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
            }}>Save view</button>
          )}
          {sort && setSort && !isInboxView && (
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span style={{ color: 'var(--text-3)' }}>Sort:</span>
              <SortDropdown sort={sort} onChange={setSort} />
              <div
                onClick={dirDisabled ? undefined : () => setSort({ key: sort.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
                style={{
                  height: 24, padding: '0 7px',
                  border: '1px solid var(--border-2)', borderRadius: 6,
                  background: 'var(--bg-surface)',
                  display: 'inline-flex', alignItems: 'center',
                  fontSize: 13, userSelect: 'none',
                  cursor: dirDisabled ? 'default' : 'pointer',
                  color: dirDisabled ? 'var(--text-3)' : 'var(--text-1)',
                }}
              >{sort.dir === 'asc' ? '↑' : '↓'}</div>
            </span>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => { savedScrollTop.current = e.currentTarget.scrollTop; }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        <BulkBar count={selectedIds ? selectedIds.size : 0} actions={bulkActions || []} onClear={onClearSelection} />
        {resolved.loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            Loading...
          </div>
        ) : sortedGroups.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
            {isInboxView ? 'This inbox is empty. Right-click a work order and choose "Add to inbox".' :
             hasActiveFilter ? 'No matches.' :
             view === 'trash'    ? 'Trash is empty.' :
             view === 'complete' ? 'No complete work orders to show.' :
                                   'Nothing here.'}
          </div>
        ) : sortedGroups.map((g, gi) => {
          const isOpen = !collapsed[g.phase];
          // Slice 4 (#9): per-phase status display. hidden = header only;
          // single = plain status label; pills (default) = current StatusPill.
          const displayMode = (phases || []).find(p => p.name === g.phase)?.displayMode || 'pills';
          return (
            <React.Fragment key={g.phase}>
              <PhaseHeader
                phase={g.phase}
                count={g.rows.length}
                dot={g.dot}
                open={isOpen}
                first={gi === 0}
                onToggle={() => toggle(g.phase)}
              />
              {isOpen && displayMode !== 'hidden' && g.rows.map((r, ri) => {
                const rowEl = (
                  <ListRow
                    key={r.wo}
                    row={r}
                    view={view}
                    statusMode={displayMode}
                    hideAge={resolved.hideAge}
                    density={density}
                    selected={selectedWO === r.wo}
                    checked={selectedIds ? selectedIds.has(r.wo) : false}
                    onClick={() => onSelectWO(r.wo)}
                    onCheck={(e) => { if (onCheck) onCheck(r.wo, e.shiftKey); }}
                    onContextMenu={(e, woId, tab) => {
                      const estH = tab === 'active' ? 360 : 160;
                      const x = window.innerWidth  - e.clientX < 220 ? e.clientX - 220 : e.clientX;
                      const y = window.innerHeight - e.clientY < estH  ? e.clientY - estH  : e.clientY;
                      setCtxSub(null);
                      setCtxMenu({ woId, x, y, tab });
                    }}
                  />
                );
                if (!isInboxView) return rowEl;
                return (
                  <div key={r.wo} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>{rowEl}</div>
                    <div style={{ flexShrink: 0, paddingRight: 8 }}>
                      <ReorderBtns
                        onUp={() => moveInRoute(g.rows, ri, -1)}
                        onDown={() => moveInRoute(g.rows, ri, 1)}
                        disableUp={ri === 0}
                        disableDown={ri === g.rows.length - 1}
                      />
                    </div>
                  </div>
                );
              })}
            </React.Fragment>
          );
        })}
      </div>
      {ctxMenu && (() => {
        const ctxBulk = selectedIds && selectedIds.size > 1 && selectedIds.has(ctxMenu.woId);
        const ctxRow = groups.flatMap(g => g.rows || []).find(r => r.wo === ctxMenu.woId);
        return (
          <WOContextMenu
            ctxMenu={{ ...ctxMenu, bulkIds: ctxBulk ? Array.from(selectedIds) : null }}
            ctxRow={ctxRow}
            bulkCount={ctxBulk ? selectedIds.size : 1}
            source="list"
            statuses={statuses}
            types={types}
            techs={techs}
            pms={pms}
            inboxes={inboxes}
            isInboxView={isInboxView}
            inboxId={data.inboxId}
            onWoAction={onWoAction}
            onBulkSetStatus={onBulkSetStatus}
            onAddToInbox={onAddToInbox}
            onAddToNewInbox={onAddToNewInbox}
            onRemoveFromInbox={onRemoveFromInbox}
            onSelectWO={onSelectWO}
            onClose={closeCtx}
          />
        );
      })()}
    </section>
  );
}

function PhaseHeader({ phase, count, dot, open, first, onToggle }) {
  const dotColor = dot || 'var(--text-2)';
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '14px 20px 12px',
        background: 'var(--bg-surface-2)',
        borderTop: first ? 'none' : '1px solid var(--border-2)',
        borderBottom: '1px solid var(--border-1)',
        cursor: 'pointer', userSelect: 'none',
      }}
    >
      <span style={{
        display: 'inline-block', width: 12,
        color: 'var(--text-2)', fontSize: 10,
        transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 120ms ease',
      }}>{'▶'}</span>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: dotColor, flexShrink: 0 }} />
      <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-1)' }}>{phase}</span>
      <span style={{
        fontSize: 12, fontWeight: 600, color: 'var(--text-2)',
        background: 'var(--bg-canvas)',
        border: '1px solid var(--border-1)',
        borderRadius: 999, padding: '1px 8px',
        fontVariantNumeric: 'tabular-nums',
      }}>{count}</span>
    </div>
  );
}

function ListRow({ row, selected, onClick, hideAge, view, density, checked, onCheck, onContextMenu, statusMode = 'pills' }) {
  const ageHidden = hideAge || row.age == null;
  const ageBg = ageHidden ? 'transparent' :
    row.ageLevel === 1 ? 'var(--age-1)' :
    row.ageLevel === 2 ? 'var(--age-2)' :
    row.ageLevel === 3 ? 'var(--age-3)' : 'transparent';
  const d = densityFor(density);
  return (
    <div
      data-wo-id={row.wo}
      onClick={(e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.dataset?.role === 'check')) return;
        onClick(e);
      }}
      onContextMenu={onContextMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, row.wo, row.tab); } : undefined}
      style={{
        padding: `${d.rowPadY}px 14px`,
        background: (checked || selected) ? 'var(--bg-row-sel)' : ageBg,
        borderBottom: '1px solid var(--border-2)',
        cursor: 'pointer',
        display: 'flex', gap: 10, alignItems: 'flex-start',
      }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        data-role="check"
        onClick={(e) => { e.stopPropagation(); if (onCheck) onCheck(e); }}
        onChange={() => {}}
        style={{ marginTop: 5, flexShrink: 0, cursor: 'pointer' }}
      />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: d.rowGap }}>
        {/* Headline: address (with city + state continuation), flags right of it, age far right */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontWeight: 700, fontSize: d.line1, color: 'var(--text-1)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            letterSpacing: '-0.005em',
          }}>{row.addr}</span>
          {row.flags?.map((f) => <FlagGlyph key={f} kind={f} />)}
          {(row.city || row.age != null) && (
            <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {row.city && <span style={{ color: 'var(--text-2)', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>{row.city}</span>}
              {row.age != null && (
                <span style={{ fontSize: 13, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{row.age}</span>
              )}
            </div>
          )}
        </div>
        {/* Meta row: status · PM · type · tech | WO# right-aligned.
            change11: Status pill hidden in sent (Invoices module shows it). */}
        <div style={{ fontSize: d.line2, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {view !== 'sent' && statusMode !== 'single' && <>
            <StatusPill status={row.status} size="sm" />
            <Dot />
          </>}
          {view !== 'sent' && statusMode === 'single' && <>
            <span style={{ fontWeight: 600 }}>{row.status}</span>
            <Dot />
          </>}
          <PMChip pm={row.pm} />
          <TypeIcon kind={row.type} />
          {row.tech && <span>{row.tech}</span>}
          {row.scheduled && (
            <span title="Scheduled" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: isOverdueSched(row.schedDate, row.schedStart) ? OVERDUE_CFG.textColor : 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
              ◷ {fmtSchedule(row.schedDate, row.schedStart)}
            </span>
          )}
          <span style={{ marginLeft: 'auto', flexShrink: 0, fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)', fontSize: 13 }}>{row.wo}</span>
        </div>
      </div>
    </div>
  );
}

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
function PhoneField({ data }) {
  const [open, setOpen] = React.useState(false);
  const contacts = Array.isArray(data.contacts) ? data.contacts : [];
  const primary = contacts[0] || (data.phone && data.phone !== '—' ? { name: data.contactName || '', phone: data.phone } : null);
  const others = contacts.slice(1);
  if (!primary || !primary.phone) return <span style={{ color: 'var(--text-3)' }}>—</span>;
  const display = (primary.phone || '').match(/\d/) ? formatPhone(primary.phone) : primary.phone;
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 1, position: 'relative', minWidth: 0 }}>
      {primary.name && <span style={{ color: 'var(--text-2)', fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{primary.name}</span>}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{display}</span>
        {others.length > 0 && (
          <span
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onClick={() => setOpen(o => !o)}
            title={'Secondary contacts: ' + others.map(c => (c.name || '?') + ' ' + (c.phone ? formatPhone(c.phone) : '')).join('; ')}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minWidth: 22, height: 16, padding: '0 5px', borderRadius: 8,
              border: '1px solid var(--accent)', color: 'var(--accent)',
              fontSize: 10, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            }}>+{others.length}</span>
        )}
      </span>
      {open && others.length > 0 && (
        <div
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 80,
            minWidth: 220, background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
            borderRadius: 8, boxShadow: '0 10px 24px rgba(0,0,0,0.35)', padding: '6px 0',
          }}>
          <div style={{ padding: '4px 12px', fontSize: 10, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em' }}>SECONDARY CONTACTS</div>
          {others.map((c, i) => (
            <div key={i} style={{ padding: '6px 12px', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ color: 'var(--text-3)', fontSize: 10, fontWeight: 600 }}>{c.role || 'CONTACT'}</span>
              <span>{c.name || '(no name)'}</span>
              <span style={{ color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>{c.phone ? formatPhone(c.phone) : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function DetailOverflow({ data, onAction, statuses, onEdit, onEditInvoice, canCapture, capturing, onCapture }) {
  const [open, setOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const doEdit    = (e) => { e.stopPropagation(); setOpen(false); onEdit && onEdit(data.wo); };
  const doInvoice = (e) => { e.stopPropagation(); setOpen(false); onEditInvoice && onEditInvoice(data.wo); };
  const doCap     = (e) => { e.stopPropagation(); setOpen(false); onCapture && onCapture(); };
  React.useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setStatusOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const act = (kind, payload) => (e) => {
    if (e) { e.stopPropagation(); }
    setOpen(false); setStatusOpen(false);
    onAction && onAction(kind, payload);
  };

  const tab = data.tab || 'active';
  const isTrash = data.raw?.deleted;

  return (
    <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); setStatusOpen(false); }}
        style={{
          height: 30, padding: '0 12px',
          border: '1px solid var(--border-2)',
          background: 'var(--bg-surface)',
          color: 'var(--text-1)',
          borderRadius: 6,
          fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          cursor: 'pointer',
        }}
      >{'⋯'}</button>
      {open && (
        <div style={{
          position: 'absolute', top: 36, right: 0,
          minWidth: 220, maxHeight: 360, overflowY: 'auto',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-2)',
          borderRadius: 8,
          boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
          padding: '4px 0',
          zIndex: 50,
        }}>
          {!statusOpen ? (<>
            {isTrash ? (<>
              <MenuItem onClick={act('restore')}>Restore</MenuItem>
              <MenuDivider />
              <MenuItem danger onClick={act('hardDelete')}>Delete permanently…</MenuItem>
            </>) : (<>
              <MenuItem onClick={doEdit}>Edit details…</MenuItem>
              {onEditInvoice && <MenuItem onClick={doInvoice}>Edit invoice…</MenuItem>}
              {canCapture && <MenuItem onClick={doCap}>{capturing ? 'Capturing…' : 'Capture from portal'}</MenuItem>}
              <MenuDivider />
              {tab === 'active' && (<>
                <MenuItem onClick={(e) => { e.stopPropagation(); setStatusOpen(true); }}>Change status…</MenuItem>
                <MenuItem onClick={act('markComplete')}>Mark Complete</MenuItem>
                <MenuItem onClick={act('duplicate')}>Duplicate</MenuItem>
                <MenuDivider />
                <MenuItem onClick={act('toggleEmergency')}>{data.raw?.emergency ? 'Clear emergency flag' : 'Mark emergency'}</MenuItem>
                <MenuItem onClick={act('toggleWarranty')}>{data.raw?.warranty ? 'Clear warranty flag' : 'Mark warranty'}</MenuItem>
                <MenuDivider />
                <MenuItem danger onClick={act('softDelete')}>Send to Trash</MenuItem>
              </>)}
              {tab === 'complete' && (<>
                <MenuItem onClick={act('sendToInvoice')}>Send to Invoice</MenuItem>
                <MenuItem onClick={act('reopen')}>Reopen → Active</MenuItem>
                <MenuDivider />
                <MenuItem danger onClick={act('softDelete')}>Send to Trash</MenuItem>
              </>)}
              {tab === 'sent' && (<>
                <MenuItem onClick={act('reopen')}>Reopen → Complete</MenuItem>
                <MenuDivider />
                <MenuItem danger onClick={act('softDelete')}>Send to Trash</MenuItem>
              </>)}
            </>)}
          </>) : (<>
            <MenuCaption>Set status</MenuCaption>
            {(statuses || DEFAULT_STATUSES).filter(s => !LOCKED_STATUSES.has(s)).map(s => (
              <MenuItem key={s} onClick={act('setStatus', s)}>{s}</MenuItem>
            ))}
            <MenuDivider />
            <MenuItem onClick={(e) => { e.stopPropagation(); setStatusOpen(false); }}>← Back</MenuItem>
          </>)}
        </div>
      )}
    </div>
  );
}

function openMaps(addr) {
  if (!addr || !addr.trim()) return;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr.trim());
  if (window.shell && window.shell.openExternal) window.shell.openExternal(url);
  else window.open(url, '_blank');
}

// Multi-stop driving directions. Opens Google Maps in the user's default
// browser with origin -> ordered waypoints -> destination. No API key needed;
// uses Google's public /maps/dir URL scheme. Caller supplies the ordered list
// of stop address strings (already formatted with city/state when available).
// `originAddr` is the trip start (typically the user's home/shop from
// settings.mapsHomeAddress). Last stop becomes the destination.
function openMapsRoute(stops, originAddr) {
  const clean = (stops || []).map(s => (s || '').trim()).filter(Boolean);
  if (clean.length === 0) return;
  const destination = clean[clean.length - 1];
  const waypoints = clean.slice(0, -1);
  const origin = (originAddr || '').trim() || (waypoints.shift() || destination);
  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'driving',
  });
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  const url = 'https://www.google.com/maps/dir/?' + params.toString();
  if (window.shell && window.shell.openExternal) window.shell.openExternal(url);
  else window.open(url, '_blank');
}

function DetailPane({ data, onSendToInvoice, onMarkComplete, onReopen, onAddNote, onEditNote, onDeleteNote, onPinNote, onSetMisc, onEdit, onEditInvoice, onAction, statuses, moreInfoColor, types, techs, pms, inboxes, onWoAction, onAddToInbox, onAddToNewInbox, onRemoveFromInbox }) {
  const [ctxMenu, setCtxMenu] = React.useState(null);
  const closeCtx = React.useCallback(() => setCtxMenu(null), []);
  React.useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e) => { if (e.key === 'Escape') closeCtx(); };
    const onClick = () => closeCtx();
    const onCtx = () => closeCtx();
    // Capture-phase contextmenu close: a right-click anywhere else (list
    // row, header, sidebar) closes this detail menu before its element-
    // level handler opens a new menu. Avoids stacked menus across panes.
    const id = setTimeout(() => {
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      document.addEventListener('contextmenu', onCtx, true);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onCtx, true);
    };
  }, [ctxMenu, closeCtx]);
  const handleContextMenu = (e) => {
    if (!data || !data.wo) return;
    const t = e.target;
    const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
    e.preventDefault();
    setCtxMenu({ woId: data.wo, x: e.clientX, y: e.clientY, tab: data.tab });
  };
  const [statusMenuOpen, setStatusMenuOpen] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const statusRef = React.useRef(null);

  const canCapture = !!(window.scraper && window.scraper.captureWO) && data?.pm === 'AMH';
  const doCapture = () => {
    if (capturing) return;
    setCapturing(true);
    Promise.resolve(onAction && onAction('capture')).finally(() => setCapturing(false));
  };

  React.useEffect(() => {
    if (!statusMenuOpen) return;
    const close = () => setStatusMenuOpen(false);
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
  }, [statusMenuOpen]);

  if (!data) {
    return (
      <section style={{
        minWidth: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-canvas)',
        height: '100%',
        alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-3)', fontSize: 14,
      }}>Select a work order.</section>
    );
  }
  const handlePrimary = () => {
    if (data.nextAction === 'Send to Invoice' && onSendToInvoice) onSendToInvoice(data.wo);
    else if (data.nextAction === 'Mark Complete' && onMarkComplete) onMarkComplete(data.wo);
    else if (data.nextAction === 'Reopen'        && onReopen)       onReopen(data.wo);
  };
  return (
    <section
      onContextMenu={handleContextMenu}
      style={{
        minWidth: 0, minHeight: 0,
        display: 'flex', flexDirection: 'column',
        background: 'var(--bg-canvas)',
        height: '100%',
      }}
    >
      {/* change10 slice 3.1: dense DetailPane header. WO# + status + age + flags
          collapse to one row; address shrinks; field grid goes 5-col font-12. */}
      <div style={{
        padding: '12px 20px 10px',
        borderBottom: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums' }}>{data.wo}</div>
          {data.tab === 'active' ? (
              <div
                ref={statusRef}
                style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); setStatusMenuOpen(o => !o); }}
              >
                <StatusPill status={data.status} />
                {statusMenuOpen && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, marginTop: 4,
                    minWidth: 200, background: 'var(--bg-surface)',
                    border: '1px solid var(--border-2)', borderRadius: 8,
                    boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
                    padding: '4px 0', zIndex: 60,
                  }}>
                    <MenuCaption>Set status</MenuCaption>
                    {(statuses || DEFAULT_STATUSES).filter(s => !LOCKED_STATUSES.has(s)).map(s => (
                      <MenuItem key={s} onClick={(e) => {
                        e.stopPropagation();
                        setStatusMenuOpen(false);
                        onAction && onAction('setStatus', s);
                      }}>{s}</MenuItem>
                    ))}
                  </div>
                )}
              </div>
            ) : data.tab === 'sent' ? null : (
              <StatusPill status={data.status} />
            )}
          {data.ageDays != null && data.tab !== 'sent' && (
            <span style={{ fontSize: 12, color: 'var(--text-2)', fontVariantNumeric: 'tabular-nums' }}>
              {data.ageDays}d {data.tab === 'complete' ? 'awaiting invoice' : 'in phase'}
            </span>
          )}
          {data.flags?.map(f => <FlagGlyph key={f} kind={f} />)}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            {data.nextAction && (
              <ActionBtn primary onClick={handlePrimary}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                  {data.nextAction}<span aria-hidden="true">→</span>
                </span>
              </ActionBtn>
            )}
            <DetailOverflow
              data={data}
              onAction={onAction}
              statuses={statuses}
              onEdit={onEdit}
              onEditInvoice={onEditInvoice}
              canCapture={canCapture}
              capturing={capturing}
              onCapture={doCapture}
            />
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.005em', marginTop: 4 }}>
          {data.addr
            ? <span className="addr-link" onClick={() => openMaps(data.addr + (data.city ? ', ' + data.city : ''))} title="Open in Google Maps">{data.addr}</span>
            : null}
          {data.city && <>{' '}<span style={{ color: 'var(--text-2)', fontWeight: 400 }}>· {data.city}</span></>}
        </div>
        <div style={{
          marginTop: 8,
          display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', rowGap: 6, columnGap: 14,
          fontSize: 12,
        }}>
          <Field label="PM" value={<PMChip pm={data.pm} />} />
          <Field label="Type" value={
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <TypeIcon kind={data.type} />{data.typeLabel}
            </span>} />
          <Field label="Tech" value={data.tech} />
          <Field label="Created" value={data.created} />
          <Field label="Prop ID" value={data.propId} />
          <Field label="Bid" value={data.bid} />
          <Field label="Phone" value={<PhoneField data={data} />} />
          <Field label="Flags" value={data.flags?.length ? data.flags.map(f => f[0].toUpperCase() + f.slice(1)).join(', ') : '—'} />
          <Field label="Scheduled" value={data.schedule
            ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: isOverdueSched(data.schedule.date, data.schedule.start) ? OVERDUE_CFG.textColor : 'var(--accent)' }}>◷ {fmtSchedule(data.schedule.date, data.schedule.start)}</span>
            : '—'} />
        </div>
      </div>

      <div style={{
        padding: '18px 28px 0',
        display: 'flex', flexDirection: 'column', gap: 12,
        flex: 1, minHeight: 0, overflowY: 'auto', position: 'relative',
      }}>
        <MoreInfoCard value={data.raw?.notes || ''} color={moreInfoColor} onSave={(text) => onSetMisc && onSetMisc(data.wo, text)} />
        {/* Layout order: More Info → pinned notes (immediate visibility) →
            unpinned notes (scroll body) → NoteComposer (sticky bottom). */}
        {data.notes.filter(n => n.pinned).map(n => (
          <NoteCard
            key={n.id} {...n}
            onEdit={onEditNote && !n.legacy ? (newBody) => onEditNote(data.wo, n.id, newBody) : null}
            onDelete={onDeleteNote && !n.legacy ? () => onDeleteNote(data.wo, n.id) : null}
            onPin={onPinNote && !n.legacy ? () => onPinNote(data.wo, n.id) : null}
          />
        ))}
        {data.notes.filter(n => !n.pinned).map(n => (
          <NoteCard
            key={n.id} {...n}
            onEdit={onEditNote && !n.legacy ? (newBody) => onEditNote(data.wo, n.id, newBody) : null}
            onDelete={onDeleteNote && !n.legacy ? () => onDeleteNote(data.wo, n.id) : null}
            onPin={onPinNote && !n.legacy ? () => onPinNote(data.wo, n.id) : null}
          />
        ))}
        <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', paddingTop: 8, paddingBottom: 18,
          background: 'var(--bg-canvas)', boxShadow: '0 -6px 8px -6px rgba(0,0,0,0.25)' }}>
          <NoteComposer onSave={(note) => onAddNote && onAddNote(data.wo, note)} />
        </div>
      </div>

      <ActivityLogAccordion lines={data.activity || []} />

      {ctxMenu && (
        <WOContextMenu
          ctxMenu={ctxMenu}
          ctxRow={{
            wo: data.wo, tab: data.tab, pm: data.pm,
            emergency: data.flags?.includes('emergency'),
            warranty: data.flags?.includes('warranty'),
            scheduled: !!data.schedule,
            status: data.status,
          }}
          bulkCount={1}
          source="detail"
          statuses={statuses}
          types={types}
          techs={techs}
          pms={pms}
          inboxes={inboxes}
          isInboxView={false}
          inboxId={null}
          onWoAction={onWoAction}
          onBulkSetStatus={null}
          onAddToInbox={onAddToInbox}
          onAddToNewInbox={onAddToNewInbox}
          onRemoveFromInbox={onRemoveFromInbox}
          onSelectWO={null}
          onClose={closeCtx}
        />
      )}
    </section>
  );
}

// Collapsible activity log pinned to the bottom of DetailPane. Default closed
// so the notes area gets the recovered space; click the bar to expand. State
// persists for the session via React state (not settings — keeps slice small).
function ActivityLogAccordion({ lines }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div style={{
      borderTop: '1px solid var(--border-1)',
      background: 'var(--bg-canvas)',
      flexShrink: 0,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', height: 28, padding: '0 20px',
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none',
          color: 'var(--text-2)', fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
          cursor: 'pointer', letterSpacing: '0.02em',
        }}
        title={open ? 'Hide activity log' : 'Show activity log'}
      >
        <span style={{ fontSize: 11 }}>{open ? '▾' : '▸'}</span>
        <span>Activity log</span>
        {lines.length > 0 && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {lines.length}</span>}
      </button>
      {open && (
        <div style={{ padding: '0 20px 12px' }}>
          <div style={{
            border: '1px solid var(--border-1)', borderRadius: 6,
            padding: '8px 12px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12, color: 'var(--text-3)', lineHeight: 1.65,
            maxHeight: 140, overflowY: 'auto',
          }}>
            {lines.map((line, i) => <div key={i}>{line}</div>)}
            {lines.length === 0 && <div>No activity yet.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function NoteComposer({ onSave }) {
  const [open, setOpen] = React.useState(false);
  const [type, setType] = React.useState('Note');
  const [body, setBody] = React.useState('');

  const save = React.useCallback(() => {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (onSave) onSave({ type, body: trimmed });
    setBody('');
    setOpen(false);
  }, [body, type, onSave]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  };

  return (
    <div style={{
      border: '1px solid var(--border-1)', borderRadius: 8,
      background: 'var(--bg-surface)',
      padding: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 600 }}>Add note</span>
        <select value={type} onChange={(e) => setType(e.target.value)} style={{
          fontFamily: 'inherit', fontSize: 12,
          padding: '2px 6px',
          background: 'var(--bg-surface-2)',
          color: 'var(--text-1)',
          border: '1px solid var(--border-2)',
          borderRadius: 4,
        }}>
          <option>Note</option>
          <option>Customer call</option>
          <option>Parts order</option>
          <option>Cost / quote</option>
        </select>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-3)' }}>
          {'↵'} to save · Shift+{'↵'} for newline
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setOpen(true)}
        rows={open || body ? 3 : 1}
        placeholder="Write a note…"
        style={{
          width: '100%', marginTop: 8,
          background: 'transparent', border: 'none', outline: 'none', resize: 'none',
          fontFamily: 'inherit', fontSize: 14,
          color: 'var(--text-1)', lineHeight: 1.5,
        }}
      />
    </div>
  );
}

// Always-present "More Information" (Misc) card. A super-pinned header extension
// bound to o.notes; for details that do not fit the structured header fields.
// Collapsible (closed by default, session state) and uses a user-customizable
// `color` (Settings -> Workflow) to stay visually distinct from pinned notes.
function MoreInfoCard({ value, onSave, color }) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const taRef = React.useRef(null);
  // Resync (and drop any unsaved draft) when the underlying value changes,
  // including switching to a different WO. Collapse back to closed on switch.
  React.useEffect(() => { setDraft(value); setEditing(false); setOpen(false); }, [value]);
  // Explicit focus on edit-mode entry (autoFocus has React-18 timing quirks
  // where focus is lost during the same commit, leaving the field unresponsive).
  React.useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      const n = taRef.current.value.length;
      try { taRef.current.setSelectionRange(n, n); } catch (_) {}
    }
  }, [editing]);

  const save = () => {
    if (draft !== value && onSave) onSave(draft);
    setEditing(false);
  };

  const accent = color || DEFAULT_MORE_INFO_COLOR;
  const softBg = `color-mix(in srgb, ${accent} 14%, transparent)`;
  const preview = (value || '').replace(/\s+/g, ' ').trim();

  return (
    <div style={{
      border: '1px solid var(--border-2)',
      borderLeft: `3px solid ${accent}`,
      background: softBg,
      borderRadius: 8,
      padding: '10px 14px',
    }}>
      <div
        onClick={() => { if (!editing) setOpen(o => !o); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: 'var(--text-2)',
          cursor: editing ? 'default' : 'pointer', userSelect: 'none',
        }}
        title={open ? 'Collapse' : 'Expand'}
      >
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>More Information</span>
        {!open && preview && (
          <span style={{
            color: 'var(--text-3)', fontSize: 12, fontWeight: 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            flex: 1, minWidth: 0,
          }}>· {preview}</span>
        )}
        {!open && !preview && (
          <span style={{ color: 'var(--text-3)', fontSize: 12, fontStyle: 'italic' }}>· empty</span>
        )}
        {open && !editing && (
          <span
            onClick={(e) => { e.stopPropagation(); setEditing(true); }}
            style={{ marginLeft: 'auto', color: 'var(--text-3)', cursor: 'pointer', padding: '0 6px', fontSize: 12 }}
            title="Edit"
          >Edit</span>
        )}
      </div>
      {open && (editing ? (
        <div style={{ marginTop: 6 }}>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Alternate phone, contact names, access details..."
            style={{
              width: '100%', fontFamily: 'inherit', fontSize: 15,
              background: 'transparent', color: 'var(--text-1)',
              border: '1px solid var(--border-2)', borderRadius: 4,
              padding: 6, resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => { setDraft(value); setEditing(false); }} style={{
              fontFamily: 'inherit', fontSize: 12, padding: '4px 10px',
              background: 'var(--bg-surface-2)', color: 'var(--text-2)',
              border: '1px solid var(--border-2)', borderRadius: 4, cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={save} style={{
              fontFamily: 'inherit', fontSize: 12, padding: '4px 10px',
              background: accent, color: 'white',
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}>Save</button>
          </div>
        </div>
      ) : (
        value
          ? <div onClick={() => setEditing(true)} style={{ marginTop: 6, fontSize: 15, lineHeight: 1.5, color: 'var(--text-1)', whiteSpace: 'pre-wrap', cursor: 'text' }}>{value}</div>
          : <div onClick={() => setEditing(true)} style={{ marginTop: 6, fontSize: 14, color: 'var(--text-3)', fontStyle: 'italic', cursor: 'text' }}>Add alternate phone, contact names, access details...</div>
      ))}
    </div>
  );
}

function NoteCard({ id, type, time, body, pinned, edited, legacy, onEdit, onDelete, onPin }) {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editing, setEditing]   = React.useState(false);
  const [draft, setDraft]       = React.useState(body);
  const wrapRef = React.useRef(null);
  const taRef = React.useRef(null);

  React.useEffect(() => { setDraft(body); }, [body]);
  // Explicit focus on edit-mode entry (autoFocus has React-18 timing quirks
  // where focus is lost during the same commit, leaving the field unresponsive).
  React.useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      const n = taRef.current.value.length;
      try { taRef.current.setSelectionRange(n, n); } catch (_) {}
    }
  }, [editing]);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  const saveEdit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== body && onEdit) onEdit(trimmed);
    setEditing(false);
  };

  const showMenu = !legacy && (onEdit || onDelete || onPin);

  const menuItemStyle = { padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--text-1)' };

  return (
    <div ref={wrapRef} style={{
      border: '1px solid var(--border-1)',
      background: pinned ? 'var(--accent-soft)' : 'var(--bg-surface)',
      borderRadius: 8,
      padding: '12px 14px',
      position: 'relative',
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 8,
        fontSize: 13, color: 'var(--text-2)',
      }}>
        {pinned && <span style={{ color: 'var(--accent)' }}>{'📌'}</span>}
        <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>{type}</span>
        <Dot />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</span>
        {edited && <span style={{ color: 'var(--text-3)' }}>· edited</span>}
        {showMenu && (
          <span
            onClick={(e) => { e.stopPropagation(); setMenuOpen(m => !m); }}
            style={{
              marginLeft: 'auto', color: 'var(--text-3)', cursor: 'pointer',
              padding: '0 6px', userSelect: 'none',
            }}
            title="Note actions"
          >{'⋯'}</span>
        )}
      </div>
      {editing ? (
        <div style={{ marginTop: 6 }}>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            style={{
              width: '100%', fontFamily: 'inherit', fontSize: 15,
              background: 'transparent', color: 'var(--text-1)',
              border: '1px solid var(--border-2)', borderRadius: 4,
              padding: 6, resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => { setDraft(body); setEditing(false); }} style={{
              fontFamily: 'inherit', fontSize: 12, padding: '4px 10px',
              background: 'var(--bg-surface-2)', color: 'var(--text-2)',
              border: '1px solid var(--border-2)', borderRadius: 4, cursor: 'pointer',
            }}>Cancel</button>
            <button onClick={saveEdit} style={{
              fontFamily: 'inherit', fontSize: 12, padding: '4px 10px',
              background: 'var(--accent)', color: 'white',
              border: 'none', borderRadius: 4, cursor: 'pointer',
            }}>Save</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 15, lineHeight: 1.5, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>{body}</div>
      )}
      {menuOpen && (
        <div style={{
          position: 'absolute', top: 30, right: 8, zIndex: 20,
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-2)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
          minWidth: 140, padding: '4px 0',
        }}>
          {onEdit && (
            <div onClick={() => { setEditing(true); setMenuOpen(false); }} style={menuItemStyle}>Edit</div>
          )}
          {onPin && (
            <div onClick={() => { onPin(); setMenuOpen(false); }} style={menuItemStyle}>{pinned ? 'Unpin' : 'Pin'}</div>
          )}
          {onDelete && (
            <div onClick={() => {
              if (window.confirm('Delete this note?')) onDelete();
              setMenuOpen(false);
            }} style={{ ...menuItemStyle, color: 'var(--flag-emergency)' }}>Delete</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- landing (right-pane variant) ---------- */
function Landing({ alerts = [], onSelectWO }) {
  return (
    <section style={{ minWidth: 0, minHeight: 0, height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)' }}>
      <div style={{
        padding: '36px 40px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border-1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <GambleMark size={48} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
            <div style={{
              fontFamily: "'Bricolage Grotesque', 'IBM Plex Sans', sans-serif",
              fontWeight: 700, fontSize: 28, letterSpacing: '-0.025em',
            }}>Trade Tracker</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>by Gamble</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 2 }}>Welcome back</div>
        </div>
      </div>

      <div style={{ padding: '24px 40px', flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 600 }}>Needs your attention</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>{alerts.length} {alerts.length === 1 ? 'item' : 'items'}</div>
        </div>
        {alerts.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-3)', padding: '20px 0' }}>
            Nothing flagged. Thresholds are configurable in Settings.
          </div>
        ) : (
          <>
            {alerts.map((a, i) => <AlertCard key={a.wo || ('idx-' + i)} {...a} onClick={() => onSelectWO(a.wo)} />)}
            <div style={{ marginTop: 18, fontSize: 12, color: 'var(--text-3)' }}>
              Thresholds for these alerts are configurable in Settings.
            </div>
          </>
        )}
      </div>

    </section>
  );
}

function AlertCard({ kind, wo, addr, blurb, onClick }) {
  const color =
    kind === 'emergency' ? 'var(--flag-emergency)' :
    kind === 'stale'     ? 'oklch(60% 0.13 50)' :
    kind === 'parts'     ? 'oklch(60% 0.13 280)' :
                           'oklch(58% 0.12 145)';
  return (
    <div onClick={onClick} style={{
      display: 'flex', gap: 12,
      padding: '12px 14px', marginBottom: 8,
      border: '1px solid var(--border-1)', borderRadius: 8,
      background: 'var(--bg-surface)', cursor: 'pointer',
    }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: color, flexShrink: 0, marginTop: 7 }} />
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

/* ---------- settings drawer ---------- */
const TT_SECTIONS = [
  { id: 'appearance',  label: 'Appearance' },
  { id: 'workflow',    label: 'Workflow' },
  { id: 'trades',      label: 'Tech Job Types' },
  { id: 'routing',     label: 'Routing' },
  { id: 'library',     label: 'Service Library' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'apikeys',     label: 'API Keys' },
  { id: 'maps',        label: 'Maps' },
  { id: 'alerts',      label: 'Alerts' },
  { id: 'tray',        label: 'Tray' },
  { id: 'about',       label: 'About' },
];

// Default Maps view center/zoom. Intentionally null in source so this
// repo carries no operator-specific location. User configures in
// Settings -> Maps (or via "Set default view" button in the module).
// Fallback when null: US-wide view (lat 39.83, lon -98.58, zoom 4).
const DEFAULT_MAPS_VIEW = null;

// US state two-letter codes paired with full names. Used to canonicalize
// state comparisons so Nominatim returning "North Carolina" still
// matches a configured home state of "NC".
const US_STATE_NAMES = {
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

function SettingsDrawer({ onClose, toast, theme, setTheme, density, setDensity, alertThresholds, setAlertThresholds, overdueCfg, setOverdueCfg, librarySubCats, setLibrarySubCats, techJobTypes, setTechJobTypes, techColors, setTechColors, routingWeights, setRoutingWeights, statusTags, setStatusTags, phases, setPhases, statuses, setStatuses, statusColors, setStatusColors, moreInfoColor, setMoreInfoColor, customTheme, setCustomTheme, mapsHomeState, mapsHomeZip, mapsHomeAddress, mapsHomeCity, saveHome, onClearGeocache, geocacheCount, locationIqKey, setLocationIqKey, mapMarkerColors, setMapMarkerColors, mapTypeColors, setMapTypeColors, pms, setPms, types, setTypes, techs, setTechs, trayEnabled, setTrayEnabled, trayBadgeSource, setTrayBadgeSource, onResetSettings, onRestoreBackup, updateState, onCheckUpdate, onInstallUpdate, initialSection }) {
  const [section, setSection] = React.useState(initialSection || 'appearance');
  return (
    <section style={{
      minWidth: 0, minHeight: 0, height: '100%',
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gridTemplateRows: '1fr',
      background: 'var(--bg-canvas)',
    }}>
      <nav style={{
        borderRight: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        padding: '20px 12px',
        display: 'flex', flexDirection: 'column', gap: 2,
        minHeight: 0,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
          padding: '0 10px 8px', letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>Settings</div>
        {TT_SECTIONS.map(s => (
          <div
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              padding: '6px 10px', borderRadius: 6,
              fontSize: 14,
              background: section === s.id ? 'var(--bg-row-sel)' : 'transparent',
              color: 'var(--text-1)',
              fontWeight: section === s.id ? 600 : 400,
              cursor: 'pointer',
            }}
          >{s.label}</div>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{
          flexShrink: 0,
          height: 32, padding: '0 12px',
          border: '1px solid var(--border-2)',
          background: 'var(--bg-surface)',
          color: 'var(--text-1)',
          borderRadius: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          cursor: 'pointer',
        }}>Close {'✕'}</button>
      </nav>

      <div style={{ padding: '28px 32px', overflow: 'auto', minHeight: 0 }}>
        {section === 'appearance' && <AppearanceSection theme={theme} setTheme={setTheme} density={density} setDensity={setDensity} moreInfoColor={moreInfoColor} setMoreInfoColor={setMoreInfoColor} customTheme={customTheme} setCustomTheme={setCustomTheme} />}
        {section === 'workflow'   && <WorkflowSection phases={phases} setPhases={setPhases} statuses={statuses} setStatuses={setStatuses} statusColors={statusColors} setStatusColors={setStatusColors} statusTags={statusTags} setStatusTags={setStatusTags} pms={pms} setPms={setPms} />}
        {section === 'trades'     && <TradesSection types={types} setTypes={setTypes} mapTypeColors={mapTypeColors} setMapTypeColors={setMapTypeColors} techJobTypes={techJobTypes} setTechJobTypes={setTechJobTypes} techs={techs} setTechs={setTechs} techColors={techColors} setTechColors={setTechColors} />}
        {section === 'routing'    && <RoutingSection weights={routingWeights} setWeights={setRoutingWeights} />}
        {section === 'library'    && <LibraryToolsSection subCats={librarySubCats} setSubCats={setLibrarySubCats} toast={toast} />}
        {section === 'credentials' && <CredentialsSection />}
        {section === 'apikeys'    && <ApiKeysSection locationIqKey={locationIqKey} setLocationIqKey={setLocationIqKey} />}
        {section === 'maps'       && <MapsSection mapsHomeState={mapsHomeState} mapsHomeZip={mapsHomeZip} mapsHomeAddress={mapsHomeAddress} mapsHomeCity={mapsHomeCity} saveHome={saveHome} onClearGeocache={onClearGeocache} geocacheCount={geocacheCount} mapMarkerColors={mapMarkerColors} setMapMarkerColors={setMapMarkerColors} mapTypeColors={mapTypeColors} setMapTypeColors={setMapTypeColors} types={types} />}
        {section === 'alerts'     && <AlertsSection thresholds={alertThresholds} setThresholds={setAlertThresholds} overdueCfg={overdueCfg} setOverdueCfg={setOverdueCfg} />}
        {section === 'tray'       && <TraySection trayEnabled={trayEnabled} setTrayEnabled={setTrayEnabled} trayBadgeSource={trayBadgeSource} setTrayBadgeSource={setTrayBadgeSource} />}
        {section === 'about'      && <AboutSection onResetSettings={onResetSettings} onRestoreBackup={onRestoreBackup} updateState={updateState} onCheckUpdate={onCheckUpdate} onInstallUpdate={onInstallUpdate} />}
      </div>
    </section>
  );
}

// Portal credentials for in-app capture. AMH only — its login is script-fillable
// in the BrowserWindow. MSR uses the Chrome extension (authenticated Chrome), so
// no credentials are stored here for it. Secrets are encrypted by the main
// process via safeStorage; this UI never persists them in plain wo_data.
function CredentialsSection() {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [stored, setStored] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (window.creds && window.creds.get) {
      window.creds.get('AMH').then(c => {
        if (c && c.username) { setUsername(c.username); setPassword(c.password || ''); setStored(true); }
      }).catch(() => {});
    }
  }, []);

  const save = async () => {
    if (!window.creds || !window.creds.set) { setStatus('Credentials are only available in the desktop app.'); return; }
    if (!username.trim() || !password) { setStatus('Enter both username and password.'); return; }
    const r = await window.creds.set('AMH', username.trim(), password);
    if (r && r.ok) { setStored(true); setStatus('Saved (encrypted).'); }
    else setStatus('Error: ' + ((r && r.error) || 'could not save.'));
  };
  const clear = async () => {
    if (window.creds && window.creds.clear) await window.creds.clear('AMH');
    setUsername(''); setPassword(''); setStored(false); setStatus('Cleared.');
  };

  const fld = {
    width: '100%', maxWidth: 360, padding: '8px 10px', marginTop: 4,
    border: '1px solid var(--border-2)', borderRadius: 6,
    background: 'var(--bg-surface)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 13,
  };
  const lbl = { fontSize: 12, color: 'var(--text-3)', display: 'block', marginTop: 12 };

  return (
    <div>
      <SettingTitle sub="Stored encrypted on this machine (safeStorage). Reserved for future scripted login support.">Credentials</SettingTitle>
      <div style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid var(--border-1)', borderRadius: 6, background: 'var(--bg-surface)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
        AMH portal login is currently interactive: the first time you capture a WO, an AMH sign-in window opens — sign in once and the session is remembered. Stored credentials below are not yet wired into capture; safe to leave blank.
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>AMH portal {stored && <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>· saved</span>}</div>
      <label style={lbl}>Username / email
        <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" style={fld} />
      </label>
      <label style={lbl}>Password
        <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" style={fld} />
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', marginTop: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show password
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <ActionBtn primary onClick={save}>Save</ActionBtn>
        {stored && <ActionBtn onClick={clear}>Clear</ActionBtn>}
      </div>
      {status && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-2)' }}>{status}</div>}
      <div style={{ marginTop: 22, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, maxWidth: 420 }}>
        MSR work orders import through the Chrome extension (your signed-in Chrome) and need no credentials here.
      </div>
    </div>
  );
}

// SettingTitle, SettingRow, Seg moved to ./primitives.jsx (imported at top).

function AppearanceSection({ theme, setTheme, density, setDensity, moreInfoColor, setMoreInfoColor, customTheme, setCustomTheme }) {
  const baseTheme = theme === 'light' ? TT_LIGHT : TT_DARK;
  const ct = customTheme || {};
  const setVar = (key, hex) => setCustomTheme && setCustomTheme({ ...ct, [key]: hex });
  const clearVar = (key) => {
    if (!setCustomTheme) return;
    const next = { ...ct };
    delete next[key];
    setCustomTheme(next);
  };
  const resetAll = () => setCustomTheme && setCustomTheme({});
  const hasAnyOverride = Object.keys(ct).length > 0;
  const isDefaultMoreInfo = !moreInfoColor
    || (typeof moreInfoColor === 'string'
        && moreInfoColor.toLowerCase() === DEFAULT_MORE_INFO_COLOR.toLowerCase());
  const accent = moreInfoColor || DEFAULT_MORE_INFO_COLOR;
  const softBg = `color-mix(in srgb, ${accent} 14%, transparent)`;
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em',
          color: 'var(--text-1)',
        }}>Appearance</div>
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-3)' }}>
          Theme, density, and detail-pane accent colors. Affects the whole app.
        </div>
      </div>

      <AppearanceGroup eyebrow="Theme">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Seg
            equal
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark',  label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
          />
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Dark is the recommended default. System follows your OS appearance setting.
          </div>
        </div>
      </AppearanceGroup>

      <AppearanceGroup eyebrow="Layout density">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Seg
            equal
            value={density}
            onChange={setDensity}
            options={[
              { value: 'compact',  label: 'Compact' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'generous', label: 'Generous' },
            ]}
          />
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Tighter density fits more rows; generous is easier on the eyes.
          </div>
        </div>
      </AppearanceGroup>

      <AppearanceGroup eyebrow="Detail pane accents">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)' }}>
            More Information card color
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -8 }}>
            Accent strip + soft tint on the detail pane's More Information card. Pick something distinct from the blue pinned-note accent.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <input
              type="color"
              value={normalizeHex(accent)}
              onChange={e => setMoreInfoColor && setMoreInfoColor(e.target.value)}
              style={{ width: 36, height: 36, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
            />
            <code style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, color: 'var(--text-2)',
              padding: '4px 8px', background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-2)', borderRadius: 4,
            }}>{normalizeHex(accent).toUpperCase()}</code>
            {!isDefaultMoreInfo && (
              <button
                onClick={() => setMoreInfoColor && setMoreInfoColor(DEFAULT_MORE_INFO_COLOR)}
                style={{
                  fontFamily: 'inherit', fontSize: 12,
                  padding: '5px 12px',
                  background: 'var(--bg-surface-2)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border-2)',
                  borderRadius: 4, cursor: 'pointer',
                }}
              >Reset to default</button>
            )}
          </div>
          <div style={{
            marginTop: 4,
            border: '1px solid var(--border-2)',
            borderLeft: `3px solid ${accent}`,
            background: softBg,
            borderRadius: 8,
            padding: '12px 14px',
            maxWidth: 360,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{'▾'}</span>
              <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>More Information</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
              Preview - matches the detail pane.
            </div>
          </div>
        </div>
      </AppearanceGroup>

      <AppearanceGroup eyebrow="Custom theme">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Override surface, text, and accent colors on top of the base {theme === 'light' ? 'Light' : theme === 'system' ? 'System' : 'Dark'} theme.
            Phase colors live in Settings → Workflow. Borders and semantic tints (age, flags) stay tied to the base.
          </div>
          {EDITABLE_THEME_VARS.map(group => (
            <div key={group.group} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {group.group}
              </div>
              {group.items.map(item => {
                const overridden = item.key in ct;
                const effective = ct[item.key] || baseTheme[item.key] || '#000000';
                const swatch = normalizeHex(effective.startsWith('#') ? effective : '#888888');
                return (
                  <div key={item.key} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 0',
                  }}>
                    <input
                      type="color"
                      value={swatch}
                      onChange={e => setVar(item.key, e.target.value)}
                      style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: overridden ? 600 : 500 }}>
                        {item.label} {overridden && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 4 }}>(custom)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.desc}</div>
                    </div>
                    <code style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 11, color: 'var(--text-2)',
                      padding: '3px 6px', background: 'var(--bg-surface-2)',
                      border: '1px solid var(--border-2)', borderRadius: 4,
                    }}>{swatch.toUpperCase()}</code>
                    {overridden && (
                      <button onClick={() => clearVar(item.key)} title="Reset to base theme" style={{
                        height: 24, padding: '0 8px', border: '1px solid var(--border-1)',
                        borderRadius: 4, background: 'transparent', color: 'var(--text-3)',
                        fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
                      }}>Reset</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {hasAnyOverride && (
            <button onClick={resetAll} style={{
              alignSelf: 'flex-start',
              height: 30, padding: '0 14px',
              border: '1px solid var(--flag-emergency)',
              borderRadius: 6, background: 'transparent', color: 'var(--flag-emergency)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>Reset all custom colors</button>
          )}
        </div>
      </AppearanceGroup>
    </div>
  );
}

// Section block for AppearanceSection. Eyebrow title + divider + padded body.
function AppearanceGroup({ eyebrow, children }) {
  return (
    <div style={{
      padding: '20px 0',
      borderTop: '1px solid var(--border-1)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--text-3)',
        marginBottom: 12,
      }}>{eyebrow}</div>
      <div>{children}</div>
    </div>
  );
}

// miniBtnStyle, ReorderBtns, swapAt moved to ./primitives.jsx (imported at top).

function WorkflowSection({ phases, setPhases, statuses, setStatuses, statusColors, setStatusColors, statusTags, setStatusTags, pms, setPms }) {
  const [statusesOpen, setStatusesOpen] = React.useState(false);
  const [pmsOpen, setPmsOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);
  // Inline editing now uses the shared <InlineEdit> (owns value + focus + the
  // race-safe blur). editingId only marks which row is open.
  const startRename = (p) => setEditingId(p.id || p.name);
  const commitRename = (targetId, val) => {
    const name = (val || '').trim();
    if (name) {
      setPhases(phases.map(p => (p.id || p.name) === targetId ? { ...p, name } : p));
    }
    setEditingId(null);
  };
  const moveUp = (idx) => setPhases(swapAt(phases, idx, idx - 1));
  const moveDown = (idx) => setPhases(swapAt(phases, idx, idx + 1));
  const addPhase = () => {
    const id = 'ph_' + Date.now().toString(36);
    // change11: complete flag dropped from phase shape.
    setPhases([...phases, { id, name: 'New phase', fg: '#6b7280', bg: 'var(--bg-surface-2)', statuses: [] }]);
    // Drop straight into the name editor on the new row so naming a phase does
    // not require hunting for the rename affordance.
    setEditingId(id);
  };
  const setPhaseColor = (targetId, hex) => {
    setPhases(phases.map(p => (p.id || p.name) === targetId ? { ...p, fg: hex } : p));
  };
  // Slice 4 (#9): per-phase status display mode (pills | single | hidden).
  const setDisplayMode = (targetId, mode) => {
    setPhases(phases.map(p => (p.id || p.name) === targetId ? { ...p, displayMode: mode } : p));
  };
  // change11: togglePhaseComplete deprecated.
  const deletePhase = (targetId) => {
    if (!window.confirm('Delete this phase?')) return;
    setPhases(phases.filter(p => (p.id || p.name) !== targetId));
  };

  return (
    <div>
      <SettingTitle sub="Statuses are the raw values stored per WO. Phases group statuses and own the color.">Workflow</SettingTitle>
      <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Phases</div>
      {phases.map((p, idx) => {
        const uid = p.id || p.name;
        return (
          <div key={uid} style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: '8px 10px', marginBottom: 6,
            border: '1px solid var(--border-1)', borderRadius: 6,
            background: 'var(--bg-surface)', minWidth: 0,
          }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
            <ReorderBtns
              onUp={() => moveUp(idx)} onDown={() => moveDown(idx)}
              disableUp={idx === 0} disableDown={idx === phases.length - 1}
            />
            <input
              type="color"
              value={normalizeHex(p.fg)}
              onChange={e => setPhaseColor(uid, e.target.value)}
              title="Phase color"
              style={{ width: 22, height: 22, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent', flexShrink: 0 }}
            />
            {editingId === uid
              ? <InlineEdit
                  value={p.name}
                  onCommit={(val) => commitRename(uid, val)}
                  onCancel={() => setEditingId(null)}
                  style={{
                    fontSize: 14, fontWeight: 600, minWidth: 100, maxWidth: 160,
                    background: 'var(--bg-canvas)', border: '1px solid var(--accent)',
                    borderRadius: 4, padding: '2px 6px', color: 'var(--text-1)', fontFamily: 'inherit',
                  }}
                />
              : <span
                  onDoubleClick={() => startRename(p)}
                  title="Double-click or use ✎ to rename"
                  style={{ fontSize: 14, fontWeight: 600, minWidth: 90, flexShrink: 0, cursor: 'text' }}
                >{p.name}</span>
            }
            <span style={{
              fontSize: 13, color: 'var(--text-2)', flex: 1, minWidth: 60,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {(p.statuses || []).length
                ? p.statuses.join(' · ')
                : <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>tab-derived</span>}
            </span>
            <select
              value={p.displayMode || 'pills'}
              onChange={e => setDisplayMode(uid, e.target.value)}
              title="Status display in the WO list"
              style={{ padding: '3px 6px', fontSize: 12, border: '1px solid var(--border-2)', borderRadius: 4,
                background: 'var(--bg-canvas)', color: 'var(--text-1)', fontFamily: 'inherit', cursor: 'pointer', maxWidth: 90, flexShrink: 0 }}
            >
              <option value="pills">Pills</option>
              <option value="single">Single</option>
              <option value="hidden">Hidden</option>
            </select>
            <button onClick={() => startRename(p)} title="Rename" style={{ ...miniBtnStyle, padding: '0 7px', flexShrink: 0 }}>{'✎'}</button>
            <button
              onClick={() => deletePhase(uid)}
              style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px', flexShrink: 0 }}
            >{'✕'}</button>
           </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <ActionBtn onClick={addPhase}>+ Add phase</ActionBtn>
        <ActionBtn onClick={() => setStatusesOpen(true)}>Manage statuses...</ActionBtn>
        <ActionBtn onClick={() => setPmsOpen(true)}>Manage PMs...</ActionBtn>
      </div>
      {statusesOpen && (
        <StatusesEditor
          statuses={statuses}
          setStatuses={setStatuses}
          statusColors={statusColors}
          setStatusColors={setStatusColors}
          statusTags={statusTags}
          setStatusTags={setStatusTags}
          phases={phases}
          setPhases={setPhases}
          onClose={() => setStatusesOpen(false)}
        />
      )}
      {pmsOpen && (
        <PMsEditor
          pms={pms}
          setPms={setPms}
          onClose={() => setPmsOpen(false)}
        />
      )}
    </div>
  );
}

function StatusesEditor({ statuses, setStatuses, statusColors, setStatusColors, statusTags, setStatusTags, phases, setPhases, onClose }) {
  const [editingIdx, setEditingIdx] = React.useState(null);
  const [newName, setNewName] = React.useState('');
  const [insertAbove, setInsertAbove] = React.useState(''); // '' = append
  // Inline editing via the shared <InlineEdit>; editingIdx marks the open row.

  // Returns the phase id/name that owns this status, or '' if none.
  const phaseOf = (statusName) => {
    if (!phases) return '';
    const ph = phases.find(p => (p.statuses || []).includes(statusName));
    return ph ? (ph.id || ph.name) : '';
  };

  // Assign a status to a phase (remove from all others first). The new entry
  // is re-sorted into the phase's status list by the global statuses index so
  // it lands wherever the user placed it in the global order, instead of
  // always being appended to the end of the phase.
  const assignPhase = (statusName, phaseUid) => {
    if (!phases || !setPhases) return;
    const rank = new Map((statuses || []).map((s, i) => [s, i]));
    setPhases(phases.map(p => {
      const uid = p.id || p.name;
      const cur = (p.statuses || []).filter(s => s !== statusName);
      if (uid === phaseUid) {
        const next = [...cur, statusName].sort(
          (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)
        );
        return { ...p, statuses: next };
      }
      return { ...p, statuses: cur };
    }));
  };

  const commitRename = (idx, val) => {
    const trimmed = (val || '').trim();
    if (LOCKED_STATUSES.has(statuses[idx])) { setEditingIdx(null); return; } // hardcoded; cannot rename
    if (trimmed && trimmed !== statuses[idx]) {
      const oldName = statuses[idx];
      const next = [...statuses];
      next[idx] = trimmed;
      setStatuses(next);
      const sc = { ...statusColors };
      if (sc[oldName] !== undefined) { sc[trimmed] = sc[oldName]; delete sc[oldName]; }
      setStatusColors(sc);
      // Slice 4 (#9): move the system-tag entry with the rename.
      if (statusTags && setStatusTags && statusTags[oldName] !== undefined) {
        const st = { ...statusTags };
        st[trimmed] = st[oldName];
        delete st[oldName];
        setStatusTags(st);
      }
      // Propagate rename into phases.statuses[]
      if (phases && setPhases) {
        setPhases(phases.map(p => ({
          ...p,
          statuses: (p.statuses || []).map(s => s === oldName ? trimmed : s),
        })));
      }
    }
    setEditingIdx(null);
  };

  const deleteStatus = (idx) => {
    const name = statuses[idx];
    if (LOCKED_STATUSES.has(name)) return; // hardcoded by change11; cannot delete
    if (!window.confirm('Remove this status?')) return;
    setStatuses(statuses.filter((_, i) => i !== idx));
    const sc = { ...statusColors };
    delete sc[name];
    setStatusColors(sc);
    // Slice 4 (#9): drop the system-tag entry too.
    if (statusTags && setStatusTags && statusTags[name] !== undefined) {
      const st = { ...statusTags };
      delete st[name];
      setStatusTags(st);
    }
    // Remove from phases.statuses[]
    if (phases && setPhases) {
      setPhases(phases.map(p => ({
        ...p,
        statuses: (p.statuses || []).filter(s => s !== name),
      })));
    }
  };

  const addStatus = () => {
    const n = newName.trim();
    if (!n) return;
    if (statuses.includes(n)) { setNewName(''); return; }
    let next;
    const idx = insertAbove ? statuses.indexOf(insertAbove) : -1;
    if (idx >= 0) next = [...statuses.slice(0, idx), n, ...statuses.slice(idx)];
    else next = [...statuses, n];
    setStatuses(next);
    setNewName('');
    // Keep phase status orders aligned with the new global order so the row
    // sort within phases reflects the insertion immediately (no manual ↑↓).
    if (phases && setPhases) {
      setPhases(phases.map(p => ({
        ...p,
        statuses: next.filter(s => (p.statuses || []).includes(s)),
      })));
    }
  };

  // Per-phase status order auto-derives from the global order: filter each
  // phase's status list against the new global ordering. Keeps phases in
  // sync without a separate UI.
  const syncPhasesToGlobal = (newGlobal) => {
    if (!phases || !setPhases) return;
    setPhases(phases.map(p => ({
      ...p,
      statuses: newGlobal.filter(s => (p.statuses || []).includes(s)),
    })));
  };
  const moveStatus = (idx, delta) => {
    const next = swapAt(statuses, idx, idx + delta);
    if (next === statuses) return;
    setStatuses(next);
    syncPhasesToGlobal(next);
  };

  const setColor = (name, hex) => setStatusColors({ ...statusColors, [name]: hex });

  const selectStyle = {
    padding: '3px 6px', fontSize: 12,
    border: '1px solid var(--border-2)', borderRadius: 4,
    background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', cursor: 'pointer', maxWidth: 130,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: 580, maxHeight: '80vh',
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
          <div style={{ fontSize: 16, fontWeight: 600 }}>Manage statuses</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 18, padding: 4,
          }}>{'✕'}</button>
        </div>
        <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>
          {statuses.map((s, idx) => {
            const locked = LOCKED_STATUSES.has(s);
            return (
            <div key={s} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '8px 0', borderBottom: '1px solid var(--border-1)',
              opacity: locked ? 0.85 : 1,
            }}>
              <ReorderBtns
                onUp={() => moveStatus(idx, -1)} onDown={() => moveStatus(idx, 1)}
                disableUp={idx === 0} disableDown={idx === statuses.length - 1}
              />
              <input
                type="color"
                value={statusColors[s] || '#6b7280'}
                onChange={e => setColor(s, e.target.value)}
                style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
                title="Status color"
              />
              {editingIdx === idx && !locked
                ? <InlineEdit
                    value={s}
                    onCommit={(val) => commitRename(idx, val)}
                    onCancel={() => setEditingIdx(null)}
                    style={{
                      flex: 1, fontSize: 14,
                      background: 'var(--bg-canvas)', border: '1px solid var(--accent)',
                      borderRadius: 4, padding: '3px 8px', color: 'var(--text-1)', fontFamily: 'inherit',
                    }}
                  />
                : <span
                    onDoubleClick={locked ? undefined : () => setEditingIdx(idx)}
                    title={locked ? 'Hardcoded by change11 — cannot rename' : 'Double-click to rename'}
                    style={{ flex: 1, fontSize: 14, cursor: locked ? 'default' : 'text', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    {s}
                    {locked && (
                      <span title="Locked — managed automatically" style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 999,
                        border: '1px solid var(--border-2)', color: 'var(--text-3)',
                        background: 'var(--bg-surface-2)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                      }}>locked</span>
                    )}
                  </span>
              }
              {phases && (
                <select
                  value={phaseOf(s)}
                  onChange={e => assignPhase(s, e.target.value)}
                  style={selectStyle}
                  title="Phase"
                  disabled={locked}
                >
                  <option value="">-- no phase --</option>
                  {phases.map(p => (
                    <option key={p.id || p.name} value={p.id || p.name}>{p.name}</option>
                  ))}
                </select>
              )}
              {setStatusTags && (
                <select
                  value={(statusTags && statusTags[s]) || ''}
                  onChange={e => {
                    const st = { ...(statusTags || {}) };
                    if (e.target.value) st[s] = e.target.value; else delete st[s];
                    setStatusTags(st);
                  }}
                  style={selectStyle}
                  title="System tag (behavior hook)"
                  disabled={locked}
                >
                  <option value="">-- no hook --</option>
                  {SYSTEM_TAGS.map(t => (
                    <option key={t} value={t}>{SYSTEM_TAG_LABELS[t]}</option>
                  ))}
                </select>
              )}
              <button
                onClick={locked ? undefined : () => setEditingIdx(idx)}
                disabled={locked}
                title={locked ? 'Locked' : 'Rename'}
                style={{ ...miniBtnStyle, padding: '0 7px', opacity: locked ? 0.3 : 1, cursor: locked ? 'default' : 'pointer' }}
              >{'✎'}</button>
              <button
                onClick={locked ? undefined : () => deleteStatus(idx)}
                disabled={locked}
                title={locked ? 'Locked' : 'Delete'}
                style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px', opacity: locked ? 0.3 : 1, cursor: locked ? 'default' : 'pointer' }}
              >{'✕'}</button>
            </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addStatus(); }}
              placeholder="New status name"
              style={{
                flex: 1, minWidth: 140, padding: '7px 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-canvas)', color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 13,
              }}
            />
            <select
              value={insertAbove}
              onChange={e => setInsertAbove(e.target.value)}
              title="Insert position"
              style={{ ...selectStyle, maxWidth: 180 }}
            >
              <option value="">Insert at end</option>
              {statuses.map(s => <option key={s} value={s}>Insert above: {s}</option>)}
            </select>
            <ActionBtn primary onClick={addStatus}>Add</ActionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function PMsEditor({ pms, setPms, onClose }) {
  const [editingIdx, setEditingIdx] = React.useState(null);
  const [newName, setNewName] = React.useState('');
  const [newColor, setNewColor] = React.useState('#1a73e8');

  const commitRename = (idx, val) => {
    const trimmed = (val || '').trim();
    if (trimmed) {
      const next = pms.map((p, i) => i === idx ? { ...p, name: trimmed } : p);
      setPms(next);
    }
    setEditingIdx(null);
  };

  const setColor = (idx, hex) => setPms(pms.map((p, i) => i === idx ? { ...p, color: hex } : p));

  const deletePm = (idx) => {
    if (!window.confirm('Remove this PM?')) return;
    setPms(pms.filter((_, i) => i !== idx));
  };

  const addPm = () => {
    const n = newName.trim();
    if (!n) return;
    setPms([...pms, { name: n, color: newColor }]);
    setNewName('');
    setNewColor('#1a73e8');
  };

  const movePm = (idx, delta) => setPms(swapAt(pms, idx, idx + delta));

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{
        width: 460, maxHeight: '80vh',
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
          <div style={{ fontSize: 16, fontWeight: 600 }}>Manage PMs</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 18, padding: 4,
          }}>{'✕'}</button>
        </div>
        <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>
          {pms.map((pm, idx) => (
            <div key={pm.name} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: '1px solid var(--border-1)',
            }}>
              <ReorderBtns
                onUp={() => movePm(idx, -1)} onDown={() => movePm(idx, 1)}
                disableUp={idx === 0} disableDown={idx === pms.length - 1}
              />
              <input
                type="color"
                value={normalizeHex(pm.color)}
                onChange={e => setColor(idx, e.target.value)}
                style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
                title="PM color"
              />
              {editingIdx === idx
                ? <InlineEdit
                    value={pm.name}
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
                  >{pm.name}</span>
              }
              <button onClick={() => setEditingIdx(idx)} title="Rename" style={{ ...miniBtnStyle, padding: '0 7px' }}>{'✎'}</button>
              <button
                onClick={() => deletePm(idx)}
                style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px' }}
              >{'✕'}</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            <input
              type="color"
              value={newColor}
              onChange={e => setNewColor(e.target.value)}
              style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
            />
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addPm(); }}
              placeholder="New PM name"
              style={{
                flex: 1, padding: '7px 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-canvas)', color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 13,
              }}
            />
            <ActionBtn primary onClick={addPm}>Add</ActionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleListEditor({ title, items, setItems, onClose, singular }) {
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
      onClick={onClose}
    >
      <div onClick={e => e.stopPropagation()} style={{
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

const ALERT_DEFS = [
  { key: 'emergencyUnscheduled',        label: 'Emergency unscheduled',          hint: 'WO with emergency flag still in "Open"' },
  { key: 'stale',                       label: 'Stale',                          hint: 'No status change' },
  { key: 'bidOutNoResponse',            label: 'Bid out, no response',           hint: 'Status = Bid submitted, no PM movement' },
  { key: 'partsPastEta',                label: 'Parts past ETA',                 hint: 'Status = Parts pending' },
  { key: 'approvedUnscheduled',         label: 'Approved but unscheduled',       hint: 'Status = Bid approved - Return, no scheduled date' },
  { key: 'readyToClose',                label: 'Ready to close',                 hint: 'Status = Pending-complete' },
  { key: 'approvedCompleteNotInvoiced', label: 'Approved Complete not invoiced', hint: 'Status = Bid approved - Complete, still in Active' },
];

// Diagnostic panel: lets the user paste any address and run the same
// 3-pass chain the worker uses, with full URLs + raw response visible.
// Helps figure out why a specific WO will not geocode.
function TestGeocoder({ mapsHomeState }) {
  const [street, setStreet] = React.useState('');
  const [city, setCity] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [logLines, setLogLines] = React.useState([]);
  const append = (line) => setLogLines(ls => [...ls, line]);
  const run = async () => {
    if (!street.trim() && !city.trim()) return;
    setRunning(true);
    setLogLines([]);
    const state = (mapsHomeState || '').toUpperCase();
    const passes = [
      { label: 'CENSUS STRUCTURED', url: (() => {
          const p = new URLSearchParams();
          p.set('street', street.trim());
          if (city.trim()) p.set('city', city.trim());
          if (state) p.set('state', state);
          p.set('benchmark', 'Public_AR_Current');
          p.set('format', 'json');
          return 'https://geocoding.geo.census.gov/geocoder/locations/address?' + p.toString();
        })()
      },
      { label: 'CENSUS ONELINE', url: (() => {
          const p = new URLSearchParams();
          p.set('address', [street.trim(), city.trim(), state].filter(Boolean).join(', '));
          p.set('benchmark', 'Public_AR_Current');
          p.set('format', 'json');
          return 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' + p.toString();
        })()
      },
      { label: 'PHOTON', url: (() => {
          const p = new URLSearchParams();
          p.set('q', [street.trim(), city.trim(), state].filter(Boolean).join(', '));
          p.set('limit', '1');
          return 'https://photon.komoot.io/api/?' + p.toString();
        })()
      },
      { label: 'NOMINATIM STRUCTURED', url: (() => {
          const p = new URLSearchParams();
          p.set('format', 'json'); p.set('limit', '1'); p.set('addressdetails', '1'); p.set('countrycodes', 'us');
          if (street.trim()) p.set('street', street.trim());
          if (city.trim())   p.set('city', city.trim());
          if (state)         p.set('state', state);
          return 'https://nominatim.openstreetmap.org/search?' + p.toString();
        })()
      },
      { label: 'NOMINATIM FREE', url: (() => {
          const p = new URLSearchParams();
          p.set('format', 'json'); p.set('limit', '1'); p.set('addressdetails', '1'); p.set('countrycodes', 'us');
          p.set('q', [street.trim(), city.trim(), state].filter(Boolean).join(', '));
          return 'https://nominatim.openstreetmap.org/search?' + p.toString();
        })()
      },
    ];
    for (const pass of passes) {
      append('--> ' + pass.label);
      append(pass.url);
      try {
        const r = await fetch(pass.url, { headers: { 'Accept-Language': 'en' } });
        const text = await r.text();
        append('HTTP ' + r.status + '  bytes=' + text.length);
        try {
          const parsed = JSON.parse(text);
          if (pass.label.startsWith('CENSUS')) {
            const matches = parsed && parsed.result && parsed.result.addressMatches;
            append('matches=' + (Array.isArray(matches) ? matches.length : 'none'));
            if (Array.isArray(matches) && matches.length) {
              const m0 = matches[0];
              const c = m0.coordinates || {};
              append('lat=' + c.y + ' lon=' + c.x);
              append('matched=' + (m0.matchedAddress || '').slice(0, 200));
            }
          } else if (pass.label === 'PHOTON') {
            const feats = parsed && parsed.features;
            append('features=' + (Array.isArray(feats) ? feats.length : 'none'));
            if (Array.isArray(feats) && feats.length) {
              const coords = feats[0].geometry && feats[0].geometry.coordinates;
              if (Array.isArray(coords) && coords.length >= 2) {
                append('lat=' + coords[1] + ' lon=' + coords[0]);
              }
              const props = feats[0].properties || {};
              append('name=' + (props.name || ''));
              append('display=' + [props.housenumber, props.street, props.city, props.state, props.postcode].filter(Boolean).join(', '));
            }
          } else {
            append('results=' + (Array.isArray(parsed) ? parsed.length : 'non-array'));
            if (Array.isArray(parsed) && parsed.length) {
              append('lat=' + parsed[0].lat + ' lon=' + parsed[0].lon);
              append('display=' + (parsed[0].display_name || '').slice(0, 200));
            }
          }
        } catch { append('JSON parse failed: ' + text.slice(0, 200)); }
      } catch (e) {
        append('EXCEPTION: ' + e.message);
      }
      append('');
      await new Promise(r => setTimeout(r, 1100));
    }
    setRunning(false);
  };
  const inputStyle = {
    height: 32, padding: '0 10px',
    border: '1px solid var(--border-2)', borderRadius: 6,
    background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box',
  };
  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid var(--border-1)',
      display: 'flex', flexDirection: 'column', gap: 10,
      minWidth: 0,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Test geocoder</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
          Paste any street + city and run both structured and free-text passes against
          Nominatim. Shows exact URLs, HTTP status, response shape, and result address.
          Use to diagnose why a specific WO will not geocode. Uses your saved home
          state as the filter.
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <input
          type="text"
          value={street}
          onChange={e => setStreet(e.target.value)}
          placeholder="Street (e.g. 120 Jethro Circle)"
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 0 }}
        />
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="City (e.g. Smithfield)"
          style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }}
        />
        <button
          onClick={run}
          disabled={running}
          style={{
            height: 32, padding: '0 14px',
            border: 'none', borderRadius: 6,
            background: running ? 'var(--bg-surface-2)' : 'var(--accent)',
            color: running ? 'var(--text-3)' : 'var(--accent-fg)',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            cursor: running ? 'default' : 'pointer',
          }}
        >{running ? 'Running...' : 'Run test'}</button>
      </div>
      {logLines.length > 0 && (
        <pre style={{
          margin: 0, padding: '10px 12px',
          background: 'var(--bg-canvas)',
          border: '1px solid var(--border-2)', borderRadius: 6,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11, color: 'var(--text-2)',
          maxHeight: 280, overflow: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>{logLines.join('\n')}</pre>
      )}
    </div>
  );
}

function MapsSection({ mapsHomeState, mapsHomeZip, mapsHomeAddress, mapsHomeCity, saveHome, onClearGeocache, geocacheCount, mapMarkerColors, setMapMarkerColors, mapTypeColors, setMapTypeColors, types }) {
  const [zip, setZip] = React.useState(mapsHomeZip || '');
  const [addr, setAddr] = React.useState(mapsHomeAddress || '');
  const [city, setCity] = React.useState(mapsHomeCity || '');
  const [state, setState] = React.useState(mapsHomeState || '');
  React.useEffect(() => { setZip(mapsHomeZip || ''); }, [mapsHomeZip]);
  React.useEffect(() => { setAddr(mapsHomeAddress || ''); }, [mapsHomeAddress]);
  React.useEffect(() => { setCity(mapsHomeCity || ''); }, [mapsHomeCity]);
  React.useEffect(() => { setState(mapsHomeState || ''); }, [mapsHomeState]);
  const zipValid = /^\d{5}$/.test(zip.trim());
  const dirty =
    zip.trim() !== (mapsHomeZip || '') ||
    addr.trim() !== (mapsHomeAddress || '') ||
    city.trim() !== (mapsHomeCity || '') ||
    state.trim().toUpperCase() !== (mapsHomeState || '');
  const save = () => { if (zipValid && saveHome) saveHome({ zip: zip.trim(), addr: addr.trim(), city: city.trim(), state: state.trim() }); };
  const inputStyle = {
    height: 32, padding: '0 10px',
    border: '1px solid var(--border-2)', borderRadius: 6,
    background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box',
  };
  return (
    <div>
      <SettingTitle sub="Home address used to center the map and bias geocoding so WO addresses do not land out of region.">Maps</SettingTitle>
      <TestGeocoder mapsHomeState={mapsHomeState} />
      <div style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--border-1)',
        display: 'flex', flexDirection: 'column', gap: 10,
        minWidth: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Home address</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            Full home address - street, city, state, zip. Zipcode is required. The other fields refine the lookup; the Maps module zooms in tighter when a street address is provided. Saving runs the lookup once and stores the resulting center / zoom internally. If the structured lookup fails (e.g. a highway notation like "US-70 W"), a free-text fallback is tried automatically.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <input
            type="text"
            value={addr}
            onChange={e => setAddr(e.target.value)}
            placeholder="Street address (e.g. 1027 US-70 W)"
            style={{ ...inputStyle, flex: '1 1 240px', minWidth: 0 }}
          />
          <input
            type="text"
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder="City"
            style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }}
          />
          <select
            value={state}
            onChange={e => setState(e.target.value)}
            style={{ ...inputStyle, flex: '0 0 200px', fontSize: 13 }}
          >
            <option value="">Select state or territory...</option>
            {Object.entries(US_STATE_NAMES)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([code, name]) => (
                <option key={code} value={code}>{name} ({code})</option>
              ))}
          </select>
          <input
            type="text"
            inputMode="numeric"
            value={zip}
            onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="Zipcode"
            maxLength={5}
            style={{ ...inputStyle, flex: '0 0 100px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14 }}
          />
        </div>
        <div>
          <button
            onClick={save}
            disabled={!zipValid || !dirty}
            style={{
              height: 32, padding: '0 14px',
              border: 'none', borderRadius: 6,
              background: (zipValid && dirty) ? 'var(--accent)' : 'var(--bg-surface-2)',
              color:      (zipValid && dirty) ? 'var(--accent-fg)' : 'var(--text-3)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
              cursor: (zipValid && dirty) ? 'pointer' : 'default',
            }}
          >Save home and recenter</button>
        </div>
      </div>
      <div style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--border-1)',
        display: 'flex', flexDirection: 'column', gap: 10,
        minWidth: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Geocode cache</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            Lat/lon results from Nominatim are cached per WO so the map loads
            instantly. After changing the home state or default view, clear
            the cache so every active WO is re-geocoded with the new bounds.
            Suspect entries (state mismatch or distance &gt; 250km from default
            view) are flagged with an orange marker; right-click the WO and pick
            "Re-geocode address" to retry just that one.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {geocacheCount ? geocacheCount + ' cached' : 'Empty cache'}
          </div>
          {geocacheCount > 0 && (
            <button
              onClick={() => {
                if (!window.confirm('Clear all cached geocodes (' + geocacheCount + ')? Every active WO will be re-geocoded with the current home state and default view.')) return;
                onClearGeocache && onClearGeocache();
              }}
              style={{
                height: 32, padding: '0 12px',
                border: '1px solid var(--flag-emergency)',
                background: 'transparent',
                color: 'var(--flag-emergency)',
                borderRadius: 6, fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
              }}
            >Clear geocode cache</button>
          )}
        </div>
      </div>

      <MarkerColorsSubsection
        mapMarkerColors={mapMarkerColors}
        setMapMarkerColors={setMapMarkerColors}
      />
    </div>
  );
}

function MarkerColorsSubsection({ mapMarkerColors, setMapMarkerColors }) {
  const mc = { ...DEFAULT_MAP_MARKER_COLORS, ...(mapMarkerColors || {}) };
  const updMarker = (key, value) => setMapMarkerColors && setMapMarkerColors({ ...mc, [key]: value });
  const row = (label, color, onChange, onReset) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
      <input
        type="color" value={normalizeHex(color)} onChange={e => onChange(e.target.value)}
        style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
      />
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-1)' }}>{label}</span>
      {onReset && (
        <button onClick={onReset} style={{
          height: 24, padding: '0 8px', border: '1px solid var(--border-2)',
          background: 'var(--bg-surface)', color: 'var(--text-3)',
          borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
        }}>Reset</button>
      )}
    </div>
  );
  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid var(--border-1)',
      display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 0,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Marker colors</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
          Pin fill is the WO status color; the marker border is the job-type
          color (set in Settings &gt; Tech Job Types). Suspect overrides the
          fill; the fallback fills WOs with no status color.
        </div>
      </div>
      <div style={{ marginTop: 6 }}>
        {row('Suspect (geocoder unsure)', mc.suspect, v => updMarker('suspect', v),
          mc.suspect !== DEFAULT_MAP_MARKER_COLORS.suspect ? () => updMarker('suspect', DEFAULT_MAP_MARKER_COLORS.suspect) : null)}
        {row('Unknown status (fallback fill)', mc.fallback, v => updMarker('fallback', v),
          mc.fallback !== DEFAULT_MAP_MARKER_COLORS.fallback ? () => updMarker('fallback', DEFAULT_MAP_MARKER_COLORS.fallback) : null)}
      </div>
    </div>
  );
}

function ApiKeysSection({ locationIqKey, setLocationIqKey }) {
  const [draft, setDraft] = React.useState(locationIqKey || '');
  const [revealed, setRevealed] = React.useState(false);
  React.useEffect(() => { setDraft(locationIqKey || ''); }, [locationIqKey]);
  const dirty = draft !== (locationIqKey || '');
  const save = () => { if (setLocationIqKey) setLocationIqKey(draft.trim()); };
  const clear = () => { setDraft(''); if (setLocationIqKey) setLocationIqKey(''); };
  return (
    <div>
      <SettingTitle sub="Third-party service credentials. Stored locally in your wo_data file; never sent anywhere except the service it identifies.">API Keys</SettingTitle>
      <div style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--border-1)',
        display: 'flex', flexDirection: 'column', gap: 10,
        minWidth: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>LocationIQ API key</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            Optional. When set, the Maps module geocoder tries LocationIQ first (free tier: 5,000 requests/day, no credit card). Better residential coverage than the free Census + Photon + Nominatim cascade.
            {' '}<a href="https://locationiq.com/dashboard/access-tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Get a key at locationiq.com</a>.
            Only the Forward Geocoding (Search) endpoint is used.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <input
            type={revealed ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="pk.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            style={{
              flex: '1 1 220px', minWidth: 0,
              height: 32, padding: '0 10px',
              border: '1px solid var(--border-2)', borderRadius: 6,
              background: 'var(--bg-canvas)', color: 'var(--text-1)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => setRevealed(r => !r)}
            style={{
              height: 32, padding: '0 12px',
              border: '1px solid var(--border-2)', borderRadius: 6,
              background: 'var(--bg-surface)', color: 'var(--text-1)',
              fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', flexShrink: 0,
            }}
          >{revealed ? 'Hide' : 'Show'}</button>
          <button
            onClick={save}
            disabled={!dirty}
            style={{
              height: 32, padding: '0 12px',
              border: 'none', borderRadius: 6,
              background: dirty ? 'var(--accent)' : 'var(--bg-surface-2)',
              color: dirty ? 'var(--accent-fg)' : 'var(--text-3)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
              cursor: dirty ? 'pointer' : 'default', flexShrink: 0,
            }}
          >Save</button>
          {locationIqKey && (
            <button
              onClick={clear}
              style={{
                height: 32, padding: '0 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-surface)', color: 'var(--text-2)',
                fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', flexShrink: 0,
              }}
            >Clear</button>
          )}
        </div>
      </div>
    </div>
  );
}

const SORT_DEFS = [
  { key: 'created',  label: 'Created' },
  { key: 'age',      label: 'Age' },
  { key: 'wo',       label: 'WO #' },
  { key: 'status',   label: 'Status (reverse)' },
  { key: 'lastNote', label: 'Last Note' },
];

function AlertsSection({ thresholds, setThresholds, overdueCfg, setOverdueCfg }) {
  const t = { ...DEFAULT_ALERT_THRESHOLDS, ...(thresholds || {}) };
  const oc = { ...DEFAULT_OVERDUE_CFG, ...(overdueCfg || {}) };
  const colorRow = (label, key) => (
    <SettingRow key={key} label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="color" value={normalizeHex(oc[key])}
          onChange={(e) => setOverdueCfg({ ...oc, [key]: e.target.value })}
          style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
        />
        {oc[key] !== DEFAULT_OVERDUE_CFG[key] && (
          <button onClick={() => setOverdueCfg({ ...oc, [key]: DEFAULT_OVERDUE_CFG[key] })} style={{
            height: 24, padding: '0 8px', border: '1px solid var(--border-2)',
            background: 'var(--bg-surface)', color: 'var(--text-3)',
            borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
          }}>Reset</button>
        )}
      </div>
    </SettingRow>
  );
  return (
    <div>
      <SettingTitle sub="Tune when each alert fires in the Needs Attention surface.">Alerts</SettingTitle>
      {/* Slice 2 (#3): overdue-schedule indicator config. */}
      <div style={{ marginBottom: 4, fontSize: 14, fontWeight: 600 }}>Overdue schedule</div>
      <SettingRow label="Overdue after" hint="Scheduled WO past its start time by this many minutes gets recolored (list, detail, itinerary, map marker border).">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number" min={0} value={oc.thresholdMinutes}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setOverdueCfg({ ...oc, thresholdMinutes: isNaN(n) ? 0 : n });
            }}
            style={{
              width: 80, padding: '6px 10px',
              border: '1px solid var(--border-2)', borderRadius: 6,
              background: 'var(--bg-surface)',
              color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13,
              textAlign: 'right',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>minutes</span>
        </div>
      </SettingRow>
      {colorRow('Overdue text color', 'textColor')}
      {colorRow('Overdue marker border color', 'borderColor')}
      <div style={{ margin: '18px 0 4px', fontSize: 14, fontWeight: 600 }}>Needs Attention</div>
      {ALERT_DEFS.map(def => (
        <SettingRow key={def.key} label={def.label} hint={def.hint}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={0}
              value={t[def.key]}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setThresholds({ ...t, [def.key]: isNaN(n) ? 0 : n });
              }}
              style={{
                width: 80, padding: '6px 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-surface)',
                color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13,
                textAlign: 'right',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>days</span>
          </div>
        </SettingRow>
      ))}
    </div>
  );
}

// Slice 3 (#8): Tech Job Types. NO separate trade list — the trades ARE the
// existing work-order types (settings.types). This tab is now the single home
// for managing types (list + colors) AND techs (list + route colors); the old
// Workflow "Manage types/techs" modals were retired. techJobTypes is per tech,
// per type, a { selected, weight } cell (weight disabled unless selected).
// Routing (slice 5) reads techJobTypes[tech][wo.type].
const TRADE_WEIGHTS = ['low', 'med', 'high'];
function TradesSection({ types, setTypes, mapTypeColors, setMapTypeColors, techJobTypes, setTechJobTypes, techs, techColors, setTechColors }) {
  const list = (types || []).filter(Boolean);
  const [editingTypeIdx, setEditingTypeIdx] = React.useState(null);
  const [editingTechIdx, setEditingTechIdx] = React.useState(null);
  const [newType, setNewType] = React.useState('');
  const [newTech, setNewTech] = React.useState('');
  // Same color resolution the map markers use: explicit override, else the
  // letter default for the built-ins, else a neutral gray. Electrical is
  // legacy-only (see TYPE_COLORS).
  const tc = { HVAC: TYPE_COLORS.H, Plumbing: TYPE_COLORS.P, Electrical: TYPE_COLORS.E, ...(mapTypeColors || {}) };
  const colorOf = (name) => tc[name] || '#6b7280';
  // Type list/color management (name-based so indices never drift). Renaming or
  // deleting leaves any orphaned color/cell keyed by the old name; harmless.
  const updTypeColor = (name, value) => setMapTypeColors && setMapTypeColors({ ...(mapTypeColors || {}), [name]: value });
  const renameType = (oldName, val) => {
    const n = (val || '').trim();
    setEditingTypeIdx(null);
    if (n && n !== oldName && !(types || []).includes(n)) setTypes((types || []).map(t => t === oldName ? n : t));
  };
  const deleteType = (name) => { if (window.confirm('Remove type "' + name + '"?')) setTypes((types || []).filter(t => t !== name)); };
  const moveType = (name, delta) => { const i = (types || []).indexOf(name); if (i >= 0) setTypes(swapAt(types, i, i + delta)); };
  const addType = () => { const n = newType.trim(); if (!n || (types || []).includes(n)) return; setTypes([...(types || []), n]); setNewType(''); };
  // Tech list management.
  const renameTech = (oldName, val) => {
    const n = (val || '').trim();
    setEditingTechIdx(null);
    if (n && n !== oldName && !(techs || []).includes(n)) setTechs((techs || []).map(t => t === oldName ? n : t));
  };
  const deleteTech = (name) => { if (window.confirm('Remove tech "' + name + '"?')) setTechs((techs || []).filter(t => t !== name)); };
  const moveTech = (name, delta) => { const i = (techs || []).indexOf(name); if (i >= 0) setTechs(swapAt(techs, i, i + delta)); };
  const addTech = () => { const n = newTech.trim(); if (!n || (techs || []).includes(n)) return; setTechs([...(techs || []), n]); setNewTech(''); };
  // Patch one tech/type cell. Selecting for the first time defaults weight med.
  const setCell = (tech, type, patch) => {
    const techMap = (techJobTypes && techJobTypes[tech]) || {};
    const cur = techMap[type] || {};
    const nextCell = { ...cur, ...patch };
    if (nextCell.selected && !nextCell.weight) nextCell.weight = 'med';
    setTechJobTypes({ ...techJobTypes, [tech]: { ...techMap, [type]: nextCell } });
  };
  const cellStyle = { padding: '4px 8px', textAlign: 'center', borderBottom: '1px solid var(--border-1)' };
  const addInputStyle = { flex: 1, minWidth: 0, padding: '6px 9px', border: '1px solid var(--border-2)', borderRadius: 6, background: 'var(--bg-canvas)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12 };
  return (
    <div>
      <SettingTitle sub="Manage the job-type list and colors, the tech list and route colors, and which types each tech handles (with a preference weight). Used by routing to rank suggested work.">Tech Job Types</SettingTitle>
      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No types yet. Add one below to start.</div>
      ) : (
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-3)', fontWeight: 600, borderBottom: '1px solid var(--border-1)' }}>Tech</th>
              {list.map((type, ti) => (
                <th key={type} style={{ padding: '4px 8px', color: 'var(--text-2)', fontWeight: 600, borderBottom: '1px solid var(--border-1)', minWidth: 130 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input type="color" value={normalizeHex(colorOf(type))}
                        onChange={(e) => updTypeColor(type, e.target.value)}
                        title="Type color (marker border)" style={{ width: 20, height: 20, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                      {editingTypeIdx === ti
                        ? <InlineEdit value={type} onCommit={(v) => renameType(type, v)} onCancel={() => setEditingTypeIdx(null)}
                            style={{ width: 80, fontSize: 13, background: 'var(--bg-canvas)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-1)', fontFamily: 'inherit' }} />
                        : <span onDoubleClick={() => setEditingTypeIdx(ti)} title="Double-click to rename" style={{ cursor: 'text' }}>{type}</span>}
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <button onClick={() => moveType(type, -1)} disabled={ti === 0} title="Move left" style={{ ...miniBtnStyle, padding: '0 6px', opacity: ti === 0 ? 0.4 : 1 }}>{'‹'}</button>
                      <button onClick={() => moveType(type, 1)} disabled={ti === list.length - 1} title="Move right" style={{ ...miniBtnStyle, padding: '0 6px', opacity: ti === list.length - 1 ? 0.4 : 1 }}>{'›'}</button>
                      <button onClick={() => deleteType(type)} title="Remove type" style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 6px' }}>{'✕'}</button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(techs || []).length === 0 ? (
              <tr><td colSpan={list.length + 1} style={{ padding: '8px', color: 'var(--text-3)', fontSize: 12 }}>No techs yet. Add one below.</td></tr>
            ) : (techs || []).map((tech, hi) => (
              <tr key={tech}>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-1)', fontWeight: 500 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Slice 5 (#10): per-tech route color used for map polylines. */}
                    {setTechColors && (
                      <input type="color" value={normalizeHex((techColors && techColors[tech]) || '#6b7280')}
                        onChange={(e) => setTechColors({ ...(techColors || {}), [tech]: e.target.value })}
                        title="Route color" style={{ width: 20, height: 20, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                    )}
                    {editingTechIdx === hi
                      ? <InlineEdit value={tech} onCommit={(v) => renameTech(tech, v)} onCancel={() => setEditingTechIdx(null)}
                          style={{ flex: 1, fontSize: 13, background: 'var(--bg-canvas)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-1)', fontFamily: 'inherit' }} />
                      : <span onDoubleClick={() => setEditingTechIdx(hi)} title="Double-click to rename" style={{ cursor: 'text' }}>{tech}</span>}
                    <span style={{ flex: 1 }} />
                    <ReorderBtns onUp={() => moveTech(tech, -1)} onDown={() => moveTech(tech, 1)} disableUp={hi === 0} disableDown={hi === techs.length - 1} />
                    <button onClick={() => deleteTech(tech)} title="Remove tech" style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 6px' }}>{'✕'}</button>
                  </div>
                </td>
                {list.map(type => {
                  const cell = (techJobTypes && techJobTypes[tech] && techJobTypes[tech][type]) || {};
                  return (
                    <td key={type} style={cellStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <input type="checkbox" checked={!!cell.selected}
                          onChange={(e) => setCell(tech, type, { selected: e.target.checked })} />
                        <select value={cell.weight || 'med'} disabled={!cell.selected}
                          onChange={(e) => setCell(tech, type, { weight: e.target.value })}
                          style={{ background: 'var(--bg-surface-2)', color: cell.selected ? 'var(--text-1)' : 'var(--text-3)',
                            border: '1px solid var(--border-2)', borderRadius: 6, padding: '1px 4px',
                            fontFamily: 'inherit', fontSize: 12, opacity: cell.selected ? 1 : 0.5 }}>
                          {TRADE_WEIGHTS.map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 220px', minWidth: 0 }}>
          <input value={newType} onChange={e => setNewType(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addType(); }}
            placeholder="New job type" style={addInputStyle} />
          <ActionBtn primary onClick={addType}>Add type</ActionBtn>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 220px', minWidth: 0 }}>
          <input value={newTech} onChange={e => setNewTech(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTech(); }}
            placeholder="New tech" style={addInputStyle} />
          <ActionBtn primary onClick={addTech}>Add tech</ActionBtn>
        </div>
      </div>
    </div>
  );
}

// Slice 5 (#10): routing weight tuning. Weights feed the "Suggested" composite
// score in the Schedule modal. Tech route colors live in Tech Job Types.
const ROUTING_WEIGHT_DEFS = [
  { key: 'dist',         label: 'Distance',          hint: 'Closer WOs score higher (1 / road-km).' },
  { key: 'city',         label: 'Same city',         hint: 'Bonus when the candidate shares the anchor WO city.' },
  { key: 'unfilledCity', label: 'Unfilled city',     hint: 'Bonus when more unscheduled WOs remain in that city.' },
  { key: 'type',         label: 'Job-type preference', hint: "Weight of the tech's low/med/high preference for the WO type." },
];
function RoutingSection({ weights, setWeights }) {
  const w = { ...DEFAULT_ROUTING_WEIGHTS, ...(weights || {}) };
  return (
    <div>
      <SettingTitle sub="Tune how the Schedule modal ranks Suggested work orders. Distance is Haversine x 1.3 (no live traffic). Route colors are set per tech in Tech Job Types.">Routing</SettingTitle>
      {ROUTING_WEIGHT_DEFS.map(def => (
        <SettingRow key={def.key} label={def.label} hint={def.hint}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" min={0} step={0.1} value={w[def.key]}
              onChange={(e) => { const n = parseFloat(e.target.value); setWeights({ ...w, [def.key]: isNaN(n) ? 0 : n }); }}
              style={{ width: 80, padding: '6px 10px', border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-surface)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13, textAlign: 'right' }}
            />
            {w[def.key] !== DEFAULT_ROUTING_WEIGHTS[def.key] && (
              <button onClick={() => setWeights({ ...w, [def.key]: DEFAULT_ROUTING_WEIGHTS[def.key] })} style={{
                height: 24, padding: '0 8px', border: '1px solid var(--border-2)', background: 'var(--bg-surface)',
                color: 'var(--text-3)', borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
              }}>Reset</button>
            )}
          </div>
        </SettingRow>
      ))}
    </div>
  );
}

function TraySection({ trayEnabled, setTrayEnabled, trayBadgeSource, setTrayBadgeSource }) {
  return (
    <div>
      <SettingTitle sub="Always-on tray icon. Quick access from anywhere.">Tray</SettingTitle>
      <SettingRow label="Enable tray icon">
        <Seg value={trayEnabled ? 'on' : 'off'} onChange={setTrayEnabled} options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]} />
      </SettingRow>
      <SettingRow label="Badge source" hint="What number appears on the tray icon.">
        <Seg value={trayBadgeSource} onChange={setTrayBadgeSource} options={[
          { value: 'attention', label: 'Needs attention' },
          { value: 'active',    label: 'Active total' },
          { value: 'off',       label: 'No badge' },
        ]} />
      </SettingRow>
    </div>
  );
}

function AboutSection({ onResetSettings, onRestoreBackup, updateState, onCheckUpdate, onInstallUpdate }) {
  // null = probing, true = backup present, false = absent.
  // While probing the button stays enabled so a click works even on
  // the first 50ms after mount; the restore callback already toasts
  // "No pre-migration backup found" if storage comes up empty.
  const [hasBackup, setHasBackup] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.storage || !window.storage.get) {
        if (!cancelled) setHasBackup(false);
        return;
      }
      try {
        const r = await window.storage.get('wo_data_pre_migration_backup');
        if (cancelled) return;
        setHasBackup(!!(r && r.value));
      } catch {
        if (!cancelled) setHasBackup(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const restoreDisabled = hasBackup === false;
  return (
    <div>
      <SettingTitle>About</SettingTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <GambleMark size={48} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Trade Tracker</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>by Gamble &middot; v{APP_VERSION}</div>
        </div>
      </div>

      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border-1)' }}>
        <SettingRow label="Updates" hint={updateStatusText(updateState)}>
          <div style={{ display: 'flex', gap: 8 }}>
            {updateState && updateState.status === 'ready' && onInstallUpdate && (
              <ActionBtn primary onClick={onInstallUpdate}>Restart now</ActionBtn>
            )}
            <ActionBtn
              onClick={onCheckUpdate}
              disabled={!!updateState && (updateState.status === 'checking' || updateState.status === 'downloading')}
            >Check for updates</ActionBtn>
          </div>
        </SettingRow>
      </div>

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-1)' }}>
        {/* change11: explicit one-click backup, distinct from the auto-rotated
            backups/ folder. User picks the save path; the live wo-data.json
            is copied as-is. Use this BEFORE installing a new version. */}
        <SettingRow
          label="Back up work order data"
          hint="Saves a copy of your current wo-data.json to a location you choose. Recommended before installing a new version."
        >
          <ActionBtn
            onClick={async () => {
              if (!(window.backup && window.backup.saveNow)) return;
              const r = await window.backup.saveNow();
              if (r && r.ok) alert('Backup saved to:\n' + r.path);
              else if (r && r.canceled) { /* user dismissed */ }
              else alert('Backup failed: ' + ((r && r.error) || 'unknown error'));
            }}
          >Back up now…</ActionBtn>
        </SettingRow>
        <SettingRow
          label="Open auto-backup folder"
          hint="Opens the rolling backup folder. The app keeps the last 10 saves automatically. Useful if you need to dig out an older snapshot."
        >
          <ActionBtn
            onClick={async () => {
              if (window.backup && window.backup.openFolder) await window.backup.openFolder();
            }}
          >Open folder</ActionBtn>
        </SettingRow>
        <SettingRow label="Reset all settings" hint="Restores theme, density, alerts, and tray to defaults. Does NOT touch your WOs.">
          <ActionBtn
            onClick={onResetSettings}
            style={{ background: 'var(--flag-emergency)', color: 'var(--accent-fg)', border: 'none' }}
          >Reset settings</ActionBtn>
        </SettingRow>
        <SettingRow
          label="Restore pre-migration backup"
          hint={restoreDisabled
            ? 'No pre-migration backup found in storage. Re-tick "Back up workbook first" on your next migration to create one.'
            : 'Replaces current data with the snapshot taken just before the last migration applied.'
          }
        >
          <ActionBtn
            onClick={onRestoreBackup}
            disabled={restoreDisabled}
            style={restoreDisabled ? { opacity: 0.5 } : undefined}
          >Restore backup</ActionBtn>
        </SettingRow>
      </div>
    </div>
  );
}

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
function BulkBar({ count, actions, onClear }) {
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
function updateStatusText(state) {
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
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
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
function migrateOrders(orders, storedPhases) {
  if (!Array.isArray(orders)) return orders;
  // Build a lookup of phase-name -> complete-flag from stored phases so the
  // change11 tab migration can determine which active WOs should flip to
  // tab='complete'. Stored phases pre-migration carry the legacy
  // `complete: true` flag on wrap/done/billing; phaseForOrder uses statuses
  // to bucket each WO into a named phase.
  const phaseList = Array.isArray(storedPhases) && storedPhases.length ? storedPhases : DEFAULT_PHASES;
  const completeNames = new Set(phaseList.filter(p => p && p.complete === true).map(p => p.name));
  return orders.map(o => {
    const cards = Array.isArray(o.noteCards) ? o.noteCards.slice() : [];

    // 0) Ensure every existing card has a stable id (guards against id-less cards
    //    from old imports; id-less keys caused React to reuse wrong NoteCard instances).
    for (let i = 0; i < cards.length; i++) {
      if (!cards[i].id) {
        cards[i] = { ...cards[i], id: 'n_mig_fix_' + (o.id || 'x') + '_' + i };
      }
    }

    // 1) o.notes is now the "More Information" (Misc) field (change8); it is no
    //    longer folded into the note stream. Preserved as-is on the order.

    // 2) Priority field -> archive card (skip if already imported)
    const prio = typeof o.priority === 'string' ? o.priority.trim() : '';
    if (prio) {
      const already = cards.some(c => c && typeof c.body === 'string' && c.body.startsWith('Imported priority:'));
      if (!already) {
        cards.push({
          id: 'n_mig_prio_' + (o.id || Date.now()),
          ts: Date.now(),
          type: 'Note',
          body: 'Imported priority: ' + prio,
          pinned: false,
          edited: false,
        });
      }
    }

    // 3) Strip priority + dead workbook-sync fields (syncStatus, bidItems);
    //    carry everything else through.
    const { priority: _drop, syncStatus: _drop2, bidItems: _drop3, ...rest } = o;
    const next = { ...rest, noteCards: cards };

    // change11: tab model rework.
    // - tab='paid' or 'invoiced' (deprecated) -> 'sent' (Invoices module).
    // - tab='active' WOs whose phase was complete-marked -> tab='complete'.
    // - deleted WOs without a status -> 'Cancelled' (so Trash row reads right).
    if (next.tab === 'paid' || next.tab === 'invoiced') {
      next.tab = 'sent';
    } else if ((next.tab || 'active') === 'active') {
      const phaseName = phaseForOrder(next, phaseList);
      if (completeNames.has(phaseName)) {
        next.tab = 'complete';
        // Auto-unschedule per change11 rule: complete WOs leave the itinerary.
        if (next.schedule) delete next.schedule;
      }
    }
    if (next.deleted && !next.status) next.status = 'Cancelled';
    return next;
  });
}

// change11: migrate stored phases, statuses, statusColors in sync with
// migrateOrders. Returns a patch object suitable for updateData(...).
function migrateSettingsForChange11(stored) {
  const out = {};

  // Phases: strip the deprecated complete flag, ensure 'Bid Approved - Complete'
  // sits at the end of 'In progress' (move from approved if present).
  const inPhases = Array.isArray(stored && stored.phases) ? stored.phases : DEFAULT_PHASES;
  const phases = inPhases.map(p => {
    if (!p) return p;
    const { complete: _drop, ...rest } = p;
    return { ...rest, statuses: Array.isArray(p.statuses) ? p.statuses.slice() : [] };
  });
  const approvedP = phases.find(p => p.id === 'approved');
  const progressP = phases.find(p => p.id === 'progress');
  if (approvedP && approvedP.statuses.includes('Bid Approved - Complete')) {
    approvedP.statuses = approvedP.statuses.filter(s => s !== 'Bid Approved - Complete');
  }
  if (progressP && !progressP.statuses.includes('Bid Approved - Complete')) {
    progressP.statuses = [...progressP.statuses, 'Bid Approved - Complete'];
  }
  out.phases = phases;

  // Statuses: ensure Cancelled + 'Complete - Pending Approval' both present.
  const inStatuses = Array.isArray(stored && stored.statuses) ? stored.statuses : DEFAULT_STATUSES;
  let nextStatuses = inStatuses.slice();
  if (!nextStatuses.includes('Cancelled')) nextStatuses.push('Cancelled');
  if (!nextStatuses.includes('Complete - Pending Approval')) nextStatuses.push('Complete - Pending Approval');
  out.statuses = nextStatuses;

  // Status colors: set defaults if not already mapped.
  const inColors = (stored && stored.statusColors) || {};
  let colorsPatch = null;
  if (!inColors['Cancelled']) colorsPatch = { ...(colorsPatch || inColors), Cancelled: '#6b7280' };
  if (!inColors['Complete - Pending Approval']) colorsPatch = { ...(colorsPatch || inColors), 'Complete - Pending Approval': '#fbbf24' };
  if (colorsPatch) out.statusColors = colorsPatch;

  return out;
}

// ── Service-item Library module ──────────────────────────────────────────────
// Generic source-of-truth library. Tabs are SOURCE-scoped (General / AMH), not
// PM agreements. Persists to storage key 'service_library' independent of wo_data.
// xlsx seed/import/export delegated to window.library (main process, exceljs).
const LIBRARY_TABS = ['General', 'AMH'];
function emptyLibrary() { return { General: [], AMH: [] }; }

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
function useServiceLibraryStore() {
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

// Settings > Service Library: data tools (seed/import/export) + sub-category
// management, moved off the module header to declutter it.
function LibraryToolsSection({ subCats, setSubCats, toast }) {
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

function ServiceLibrary({ toast, subCats, setSubCats }) {
  const [lib, persist] = useServiceLibraryStore();
  const [tab, setTab] = React.useState('General');
  const [q, setQ] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [subCatsOpen, setSubCatsOpen] = React.useState(false);

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
          <ModuleNavChevrons side="home" />
          <ModuleNavChevrons side="left" />
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Service Library
          </div>
          <div style={{ flex: 1 }} />
          {btn('Sub-categories', () => setSubCatsOpen(true))}
          <HeaderChips />
          <ModuleNavChevrons side="right" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
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
          <SidebarLauncherButton />
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
function InvoiceEditor({ order, library, existingNumbers, onSave, onClose }) {
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
    // No saved invoice yet — pre-populate from the WO's scraped bid items if
    // present. Bid items come from scraper.js as {name=remedy, desc, qty, price}.
    // The remedy (b.name) is DROPPED. b.desc is matched (case-insensitive) to a
    // catalog item by name OR desc; on hit the library entry drives the line.
    // On miss the line falls back to name='Labor!' with desc=b.desc so the user
    // sees the bid description for context and can swap to 'Materials!' if needed.
    const bid = order && Array.isArray(order.bidItems) ? order.bidItems : [];
    if (bid.length) {
      const norm = (s) => String(s || '').trim().toLowerCase();
      const findCatalog = (bidDesc) => {
        const q = norm(bidDesc);
        if (!q) return null;
        for (const it of catalog) {
          if (it && (norm(it.name) === q || norm(it.desc) === q)) return it;
        }
        return null;
      };
      return bid.map(b => {
        const qty = Number(b.qty) > 0 ? Number(b.qty) : 1;
        const bidDesc = String(b.desc || '').trim();
        const hit = findCatalog(bidDesc);
        // line.desc ALWAYS comes from the bid description so the user sees
        // AMH's context regardless of whether the library matched.
        if (hit) {
          return {
            ...blankLine(),
            name: hit.name,
            desc: bidDesc,
            qty,
            unitPrice: typeof hit.price === 'number' ? hit.price : (parseFloat(hit.price) || 0),
            taxable: !!hit.taxable,
            agreement: tabName,
          };
        }
        return {
          ...blankLine(),
          name: 'Labor!',
          desc: bidDesc,
          qty,
          unitPrice: Number(b.price) || 0,
          agreement: tabName,
        };
      });
    }
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
const MODULE_GROUPS = [
  { category: 'Order Management', items: [
    { id: 'work-orders', glyph: '▤', title: 'Work Orders', blurb: 'Track, triage, and bill jobs' },
    { id: 'itinerary',   glyph: '◷', title: 'Itinerary',   blurb: 'Schedule technicians day by day' },
    { id: 'maps',        glyph: '◎', title: 'Maps',        blurb: 'Locate work orders on the map' },
  ]},
  { category: 'Accounting', items: [
    { id: 'invoices',      glyph: '$', title: 'Invoices',      blurb: 'Build invoices for the billing queue' },
    { id: 'service-items', glyph: '▦', title: 'Service Items', blurb: 'Edit the service-item price library' },
  ]},
];
const MODULES = MODULE_GROUPS.flatMap(g => g.items);
// Flat cycle order for prev/next nav. Derived so launcher + arrows agree.
const MODULE_ORDER = MODULES.map(m => m.id);
// In-pane tab pills for the Work Orders module header. change11 reduced
// the model to Active / Complete / Trash. Sent is hidden here — it lives
// in the Invoices module. Invoiced and Paid are retired (QuickBooks).
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
const ModuleNavContext = React.createContext({ currentModule: '', onPrev: () => {}, onNext: () => {}, onHome: () => {} });
// App-wide header actions context. Powers HeaderChips on every module header
// (Add WO, attention badge, kebab menu for Export/New inbox/Modules/Settings).
// Lifted out of Sidebar in change10 slice 3.5.
const HeaderActionsContext = React.createContext({
  onAddWO: () => {}, onOpenAttention: () => {}, attentionCount: 0,
  onExportCsv: () => {}, onAddInbox: () => {}, onOpenLauncher: () => {}, onOpenSettings: () => {},
});
function HeaderChips() {
  const a = React.useContext(HeaderActionsContext);
  const [menuOpen, setMenuOpen] = React.useState(false);
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
      {a.attentionCount > 0 && (
        <button onClick={a.onOpenAttention} style={{
          ...chipBtn, color: 'var(--flag-emergency)', borderColor: 'var(--flag-emergency)',
        }} title="Open Needs attention">
          ✦ {a.attentionCount}
        </button>
      )}
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
function ModuleNavChevrons({ side = 'left' }) {
  const { currentModule, onPrev, onNext, onHome } = React.useContext(ModuleNavContext);
  const idx = MODULE_ORDER.indexOf(currentModule);
  const hasPrev = idx > 0;
  const hasNext = idx >= 0 && idx < MODULE_ORDER.length - 1;
  const prevLabel = hasPrev ? MODULES.find(m => m.id === MODULE_ORDER[idx - 1])?.title : '';
  const nextLabel = hasNext ? MODULES.find(m => m.id === MODULE_ORDER[idx + 1])?.title : '';
  const ghostBtn = (disabled, bigger) => ({
    background: 'transparent', border: 'none',
    color: 'var(--text-2)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.3 : 1,
    padding: bigger ? '2px 10px' : '2px 8px',
    borderRadius: 6,
    fontFamily: 'inherit',
    fontSize: bigger ? 26 : 22,
    fontWeight: 700, lineHeight: 1,
    userSelect: 'none',
  });
  if (side === 'right') {
    return (
      <button onClick={hasNext ? onNext : undefined} disabled={!hasNext}
        title={hasNext ? ('Next: ' + nextLabel) : 'Last module'}
        style={ghostBtn(!hasNext)}>{'›'}</button>
    );
  }
  if (side === 'home') {
    return (
      <button onClick={onHome}
        title="Home (Overview)"
        style={ghostBtn(false, true)}>{'«'}</button>
    );
  }
  return (
    <button onClick={hasPrev ? onPrev : undefined} disabled={!hasPrev}
      title={hasPrev ? ('Previous: ' + prevLabel) : 'First module'}
      style={ghostBtn(!hasPrev)}>{'‹'}</button>
  );
}
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
function MapsModule({ activeOrders, geocache, defaultView, setDefaultView, selected, setSelected, progress, onOpenWO, onWoAction, mapsHomeState, mapsHomeAddress, mapsHomeCity, locationIqKey, mapMarkerColors, mapTypeColors, overdueCfg, overdueTick, statusTags, statusColors, techColors }) {
  const [query, setQuery] = React.useState('');
  // Slice 5 (#10): route polylines track one day at a time. Default today.
  const [routeDay, setRouteDay] = React.useState(itinTodayStr());
  // change10 queue item #4: multi-stop driving directions. Ordered list of WO
  // ids the user has staged for a route. "Open in Google Maps" passes them as
  // waypoints to /maps/dir; origin defaults to the home address from settings.
  // State is session-local (does not persist) so it never blocks normal use.
  const [routeStops, setRouteStops] = React.useState([]);
  const inRoute = React.useCallback((id) => routeStops.includes(id), [routeStops]);
  const toggleRoute = React.useCallback((id) => {
    setRouteStops(cur => cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  }, []);
  const moveStop = React.useCallback((id, dir) => {
    setRouteStops(cur => {
      const i = cur.indexOf(id);
      if (i < 0) return cur;
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);
  const clearRoute = React.useCallback(() => setRouteStops([]), []);
  const launchRoute = React.useCallback(() => {
    const byId = new Map((activeOrders || []).map(o => [o.id, o]));
    const stops = routeStops
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(o => {
        const { addr, city } = splitAddress(o);
        if (!addr) return '';
        return addr + (city ? ', ' + city : '');
      })
      .filter(Boolean);
    if (!stops.length) return;
    const homeAddr = (mapsHomeAddress || '').trim();
    const homeFull = homeAddr ? (homeAddr + (mapsHomeCity ? ', ' + mapsHomeCity : '')) : '';
    openMapsRoute(stops, homeFull);
  }, [routeStops, activeOrders, mapsHomeAddress, mapsHomeCity]);
  // Marker color settings with defaults baked in.
  const markerColors = React.useMemo(() => ({
    ...DEFAULT_MAP_MARKER_COLORS,
    ...(mapMarkerColors || {}),
  }), [mapMarkerColors]);
  const typeColors = React.useMemo(() => {
    // Hardcoded defaults map by type name (full); merge user overrides.
    const def = {
      HVAC:       TYPE_COLORS.H,
      Plumbing:   TYPE_COLORS.P,
      Electrical: TYPE_COLORS.E,
    };
    return { ...def, ...(mapTypeColors || {}) };
  }, [mapTypeColors]);
  // Maps-specific right-click menu. Small set of actions (no full WO menu).
  const [ctxMenu, setCtxMenu] = React.useState(null); // { woId, x, y }
  const closeCtxMenu = React.useCallback(() => setCtxMenu(null), []);
  React.useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e) => { if (e.key === 'Escape') closeCtxMenu(); };
    const onClick = () => closeCtxMenu();
    const onCtx = () => closeCtxMenu();
    const t = setTimeout(() => {
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      document.addEventListener('contextmenu', onCtx, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onCtx, true);
    };
  }, [ctxMenu, closeCtxMenu]);
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const markersLayerRef = React.useRef(null);
  const markerByIdRef = React.useRef({});
  // One-time auto-fit so the map does not keep jumping while the App-level
  // worker streams geocode results in. After the first non-empty fit, user
  // controls pan/zoom; subsequent marker draws preserve it.
  const fittedRef = React.useRef(false);
  // Tracks the WO id whose popup we have auto-opened. Combined with the
  // pre-clearLayers isPopupOpen capture below, this lets the popup:
  //   - auto-open on first marker arrival for a newly-selected WO,
  //   - persist if the user kept it open through a marker re-render,
  //   - STAY CLOSED if the user manually dismissed it (until a different
  //     WO is selected).
  const popupShownForRef = React.useRef(null);
  // Reset the auto-open guard when the user picks a different WO so the
  // new selection's popup opens on its next render.
  React.useEffect(() => { popupShownForRef.current = null; }, [selected]);
  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (activeOrders || [])
      .filter(o => !o.deleted)
      .filter(o => {
        if (!q) return true;
        const { addr, city } = splitAddress(o);
        return String(o.id).toLowerCase().includes(q)
          || (addr || '').toLowerCase().includes(q)
          || (city || '').toLowerCase().includes(q);
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  }, [activeOrders, query]);

  // Init Leaflet map once on mount; tear down on unmount.
  // Initial center/zoom: settings.mapsDefaultView if set, else US-wide fallback.
  React.useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const L = window.L;
    const v = defaultView;
    const center = (v && isFinite(v.lat) && isFinite(v.lon)) ? [v.lat, v.lon] : [39.8283, -98.5795];
    const zoom   = (v && isFinite(v.zoom)) ? v.zoom : 4;
    const m = L.map(containerRef.current, { zoomControl: true }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(m);
    markersLayerRef.current = L.layerGroup().addTo(m);
    mapRef.current = m;
    return () => {
      m.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      markerByIdRef.current = {};
    };
  }, []);

  // Render markers for every WO that has a cached lat/lon. Re-runs when
  // the filtered list or geocache changes. Auto-fits bounds when nothing
  // is selected so all markers are visible.
  React.useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current || !window.L) return;
    const L = window.L;
    // Capture whether the selected WO's popup was open BEFORE we tear
    // down the marker layer, so we can restore it after re-creating
    // markers (instead of having geocode-driven re-renders dismiss the
    // user's popup or, worse, reopen one they just closed).
    const prevSelMarker = selected ? markerByIdRef.current[selected] : null;
    const selWasOpen = !!(prevSelMarker && typeof prevSelMarker.isPopupOpen === 'function' && prevSelMarker.isPopupOpen());
    markersLayerRef.current.clearLayers();
    markerByIdRef.current = {};
    const points = [];
    for (const o of list) {
      const g = geocache && geocache[o.id];
      if (!g || g.error || g.lat == null) continue;
      // Slice 4 (#9): `offmap`-tagged status (field work done, bid entry only)
      // drops the marker. All other active WOs stay, incl. unscheduled.
      if (statusTags[o.status] === 'offmap') continue;
      const { addr, city } = splitAddress(o);
      const isSel = o.id === selected;
      const suspect = !!g.suspect;
      const reasons = Array.isArray(g.reasons) ? g.reasons.join('; ') : '';
      // Returned address (from geocoder) shown when it differs from the
      // WO's stored city. Helps catch scraper bugs that mislabel cities.
      const ncity = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const retCity = String(g.returnedCity || '').trim();
      const showResolved = retCity && city && ncity(retCity) !== ncity(city)
        && !ncity(retCity).includes(ncity(city))
        && !ncity(city).includes(ncity(retCity));
      const resolvedHtml = showResolved
        ? '<div style="margin-top:4px;font-size:11px;color:#9333ea">Resolved as: ' + retCity + '</div>'
        : '';
      const warnHtml = suspect
        ? '<div style="margin-top:4px;padding:4px 6px;background:#a14400;color:#fff;border-radius:3px;font-size:11px">'
          + 'Suspect location' + (reasons ? ' - ' + reasons : '')
          + '<br/>Right-click the marker to re-geocode or dismiss the flag.'
          + '</div>'
        : '';
      // Phones: every unique number across o.phone + all contacts, digits-
      // normalized for dedup, rendered number-only (no names) one per line.
      const phoneNums = [];
      const seenPhone = new Set();
      const addPhone = (raw) => {
        if (!raw) return;
        const norm = String(raw).replace(/\D/g, '');
        if (!norm || seenPhone.has(norm)) return;
        seenPhone.add(norm);
        phoneNums.push(formatPhone(raw));
      };
      addPhone(o.phone);
      (Array.isArray(o.contacts) ? o.contacts : []).forEach(c => c && addPhone(c.phone));
      const schedHtml = (o.schedule && o.schedule.date)
        ? '<div style="color:#facc15;margin-top:2px">◷ ' + fmtSchedule(o.schedule.date, o.schedule.start) + '</div>'
        : '';
      const phoneHtml = phoneNums.length
        ? '<div style="border-top:1px solid #555;margin-top:4px;padding-top:4px">'
          + phoneNums.map(p => '<div>' + p + '</div>').join('')
          + '</div>'
        : '';
      const html = (
        '<div style="font-size:12px;line-height:1.4">'
          + '<div style="font-weight:600">' + String(o.id) + '</div>'
          + '<div>' + (addr || '') + (city ? '<br/>' + city : '') + '</div>'
          + (o.tech ? '<div style="color:#888;margin-top:2px">Tech: ' + o.tech + '</div>' : '')
          + schedHtml
          + phoneHtml
          + resolvedHtml
          + warnHtml
        + '</div>'
      );
      // Color scheme (swapped): the status pill color now FILLS the droplet
      // body; the job-type color is the BORDER, drawn bold so categories stay
      // easy to tell apart against any fill. suspect location overrides the
      // fill as a warning (job-type stays visible on the border).
      const isScheduled = !!(o.schedule && o.schedule.date);
      // Slice 2 (#3): past schedule + threshold swaps gold to overdue color.
      const isOverdue = isScheduled && isOverdueSched(o.schedule.date, o.schedule.start);
      // Slice 4 (#9): status composite (reuses the pill colors in
      // statusColors). Precedence: onsite-tag wins (tech is live on site ->
      // beats overdue), then overdue, then the status color, then the legacy
      // scheduled-gold / white fallback. This now drives the FILL.
      const tag = statusTags[o.status];
      const statusPill = statusColors && statusColors[o.status];
      const statusComposite =
        tag === 'onsite'   ? (statusPill || '#3b82f6')
        : isOverdue        ? overdueCfg.borderColor
        : (statusPill || (isScheduled ? '#facc15' : '#fff'));
      const fillColor = suspect ? markerColors.suspect : statusComposite;
      // Job-type color on the border, bold.
      const strokeColor = typeColors[o.type] || markerColors.fallback;
      const emphasize = tag === 'onsite' || isScheduled;
      const strokeWidth = emphasize ? 4 : 3;
      const centerR     = emphasize ? 5 : 4;
      const centerFill  = strokeColor;
      const icon = L.divIcon({
        className: '',
        // viewBox padded 2px on every side ("-2 -2 28 40") so the stroke (up to
        // 3px wide, i.e. 1.5px outside the path edge) is not clipped at the
        // crown/sides. Anchor recomputed for the padded box: tip (path 12,36)
        // maps to px (12, 32) at 24x34.
        html: '<svg viewBox="-2 -2 28 40" width="24" height="34" style="display:block;overflow:visible">'
          + '<path d="M12 0C5.4 0 0 5.4 0 12c0 8.5 12 24 12 24s12-15.5 12-24c0-6.6-5.4-12-12-12z" '
          + 'fill="' + fillColor + '" stroke="' + strokeColor + '" stroke-width="' + strokeWidth + '"/>'
          + '<circle cx="12" cy="12" r="' + centerR + '" fill="' + centerFill + '"/>'
          + '</svg>',
        iconSize: [24, 34], iconAnchor: [12, 32],
        popupAnchor: [0, -30],
      });
      const marker = L.marker([g.lat, g.lon], { icon, opacity: isSel ? 1 : 0.9 })
        .addTo(markersLayerRef.current);
      marker.bindPopup(html);
      // Hover preview uses the SAME popup bubble (no separate tooltip).
      // _hoverOpen marks a popup opened by hover; mouseout closes only
      // those. Click clears the flag so the popup turns sticky.
      marker.on('mouseover', () => {
        // While any popup is click-sticky (open and not hover-opened),
        // hover on other markers must not steal it -- Leaflet auto-closes
        // the existing popup when another openPopup() fires.
        const stickyOpen = Object.values(markerByIdRef.current)
          .some((m) => m !== marker && m.isPopupOpen() && !m._hoverOpen);
        if (stickyOpen) return;
        if (!marker.isPopupOpen()) { marker._hoverOpen = true; marker.openPopup(); }
      });
      marker.on('mouseout', () => {
        if (marker._hoverOpen) { marker._hoverOpen = false; marker.closePopup(); }
      });
      marker.on('click', () => {
        marker._hoverOpen = false;
        setSelected(o.id);
        // Leaflet's default click handler toggles (closes) a popup that the
        // hover already opened; force it back open so click = sticky.
        marker.openPopup();
      });
      marker.on('contextmenu', (ev) => {
        const oe = ev && ev.originalEvent;
        if (oe) { oe.preventDefault(); oe.stopPropagation(); }
        console.log('[maps-ctx] marker right-click', o.id, oe && oe.clientX, oe && oe.clientY);
        setSelected(o.id);
        setCtxMenu({ woId: o.id, x: oe ? oe.clientX : 200, y: oe ? oe.clientY : 200 });
      });
      markerByIdRef.current[o.id] = marker;
      points.push([g.lat, g.lon]);
    }
    // Slice 5 (#10): per-tech route polylines. Group the rendered, geocoded,
    // scheduled WOs by tech, order each tech's stops by schedule date+time, and
    // draw a straight-line polyline in the tech's color (settings.techColors).
    // Added to the same markers layer so it clears/redraws with the markers.
    {
      const byTech = {};
      for (const o of list) {
        if (!o.tech || !(o.schedule && o.schedule.date)) continue;
        if (o.schedule.date !== routeDay) continue; // only the selected day's route
        const g = geocache && geocache[o.id];
        if (!g || g.error || g.lat == null) continue;
        (byTech[o.tech] = byTech[o.tech] || []).push(o);
      }
      for (const techName of Object.keys(byTech)) {
        const stops = byTech[techName]
          .sort((a, b) => (a.schedule.date + (a.schedule.start || '')).localeCompare(b.schedule.date + (b.schedule.start || '')))
          .map(o => { const g = geocache[o.id]; return [g.lat, g.lon]; });
        if (stops.length < 2) continue;
        const color = (techColors && techColors[techName]) || '#6b7280';
        L.polyline(stops, { color, weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(markersLayerRef.current);
      }
    }
    // Auto-fit only when the user has NOT configured a home view. With a
    // home set, startup centers on home and stays there until the user
    // pans or clicks "Go to home".
    const hasHome = !!(defaultView && isFinite(defaultView.lat));
    if (!hasHome && !fittedRef.current && !selected && points.length > 1) {
      mapRef.current.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
      fittedRef.current = true;
    } else if (!hasHome && !fittedRef.current && !selected && points.length === 1) {
      mapRef.current.setView(points[0], 14);
      fittedRef.current = true;
    }
    // Popup open / preserve / first-arrival logic for the selected WO.
    if (selected && markerByIdRef.current[selected]) {
      const m = markerByIdRef.current[selected];
      if (selWasOpen) {
        // User had the popup open before this re-render; restore it.
        m.openPopup();
        popupShownForRef.current = selected;
      } else if (popupShownForRef.current !== selected) {
        // First marker arrival for the current selection (e.g. Jump to
        // Map fired before the address was geocoded). Auto-open once.
        m.openPopup();
        popupShownForRef.current = selected;
      }
      // Otherwise: popup was previously dismissed by the user. Leave it
      // closed until they pick a different WO.
    }
  }, [list, geocache, selected, overdueCfg, overdueTick, statusTags, statusColors, techColors, routeDay]);

  // Pan to the selected WO when selection changes. Does NOT touch the
  // popup - that is handled by the render-markers effect above so a
  // geocache update never resurrects a popup the user closed.
  React.useEffect(() => {
    if (!selected || !mapRef.current) return;
    const m = markerByIdRef.current[selected];
    if (m) mapRef.current.panTo(m.getLatLng());
  }, [selected]);

  // Geocoder lives at the App level (runs at startup + after imports). The
  // Maps module only reads the cache + progress here.
  const markersOnMap = list.reduce((n, o) => (geocache && geocache[o.id] && !geocache[o.id].error ? n + 1 : n), 0);

  return (
    <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '14px 18px 10px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ModuleNavChevrons side="home" />
          <ModuleNavChevrons side="left" />
          <div>
            <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
              Maps
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              Route to a work order
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {/* Slice 5 (#10): route polylines track one day. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Route lines show only this day's scheduled stops per tech">
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Route day</span>
            <button onClick={() => setRouteDay(d => itinShiftDay(d, -1))} style={{ height: 28, width: 24, border: '1px solid var(--border-1)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>‹</button>
            <input type="date" value={routeDay} onChange={(e) => e.target.value && setRouteDay(e.target.value)}
              style={{ height: 28, padding: '0 6px', border: '1px solid var(--border-1)', borderRadius: 6, background: 'var(--bg-canvas)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12 }} />
            <button onClick={() => setRouteDay(d => itinShiftDay(d, 1))} style={{ height: 28, width: 24, border: '1px solid var(--border-1)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>›</button>
            <button onClick={() => setRouteDay(itinTodayStr())} style={{ height: 28, padding: '0 8px', border: '1px solid ' + (routeDay === itinTodayStr() ? 'var(--accent)' : 'var(--border-1)'), borderRadius: 6, background: routeDay === itinTodayStr() ? 'var(--bg-row-sel)' : 'var(--bg-surface)', color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>Today</button>
          </div>
          <button
            onClick={() => {
              if (!mapRef.current || !defaultView || !isFinite(defaultView.lat)) return;
              mapRef.current.setView([defaultView.lat, defaultView.lon], defaultView.zoom || 11);
            }}
            disabled={!defaultView || !isFinite(defaultView.lat)}
            title="Recenter the map on the home address (set in Settings -> Maps)"
            style={{
              height: 28, padding: '0 10px',
              border: '1px solid var(--border-1)', borderRadius: 8,
              background: 'var(--bg-surface)', color: 'var(--text-1)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
              cursor: (!defaultView || !isFinite(defaultView.lat)) ? 'default' : 'pointer',
              opacity: (!defaultView || !isFinite(defaultView.lat)) ? 0.5 : 1,
            }}
          >Go to home</button>
          <HeaderChips />
          <ModuleNavChevrons side="right" />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '280px 1fr' }}>
        <aside style={{
          borderRight: '1px solid var(--border-1)',
          background: 'var(--bg-surface)',
          display: 'flex', flexDirection: 'column',
          minHeight: 0,
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search WO #, address, city..."
              style={{
                width: '100%', height: 30, padding: '0 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-canvas)', color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {list.length === 0 && (
              <div style={{ padding: '20px 14px', fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>
                No active work orders.
              </div>
            )}
            {list.map(o => {
              const { addr, city } = splitAddress(o);
              const isSel = o.id === selected;
              return (
                <div
                  key={o.id}
                  onClick={() => setSelected(o.id)}
                  onContextMenu={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setSelected(o.id);
                    setCtxMenu({ woId: o.id, x: e.clientX, y: e.clientY });
                  }}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border-2)',
                    background: isSel ? 'var(--bg-row-sel)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {(() => { const i = routeStops.indexOf(o.id); return i < 0 ? null : (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 18, height: 18, borderRadius: 9,
                          background: 'var(--accent)', color: 'var(--accent-fg)',
                          fontSize: 11, fontWeight: 700,
                        }}>{i + 1}</span>
                      ); })()}
                      {o.id}
                    </span>
                    {o.tech && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{o.tech}</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {addr || '(no address)'}
                  </div>
                  {city && (
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{city}</div>
                  )}
                </div>
              );
            })}
          </div>
          {/* change10 queue #4: route stop panel. Visible only when at least
              one stop is staged. Reorder with ‹/›, clear, or open the chain
              in Google Maps directions in the default browser. */}
          {routeStops.length > 0 && (() => {
            const byId = new Map((activeOrders || []).map(o => [o.id, o]));
            const homeAddr = (mapsHomeAddress || '').trim();
            return (
              <div style={{
                flexShrink: 0, borderTop: '1px solid var(--border-1)',
                background: 'var(--bg-surface-2)', padding: '8px 10px',
                display: 'flex', flexDirection: 'column', gap: 6,
                maxHeight: 260, overflowY: 'auto',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Route · {routeStops.length}
                  </div>
                  <div style={{ flex: 1 }} />
                  <button onClick={clearRoute} title="Clear all stops" style={{
                    height: 22, padding: '0 8px', border: '1px solid var(--border-1)', borderRadius: 4,
                    background: 'transparent', color: 'var(--text-2)', fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
                  }}>Clear</button>
                </div>
                {!homeAddr && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
                    Tip: set a home address in Settings → Maps to use as the route origin.
                  </div>
                )}
                {routeStops.map((id, i) => {
                  const o = byId.get(id);
                  const { addr, city } = o ? splitAddress(o) : { addr: '(missing)', city: '' };
                  return (
                    <div key={id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 6px', borderRadius: 4,
                      background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
                    }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 18, height: 18, borderRadius: 9,
                        background: 'var(--accent)', color: 'var(--accent-fg)',
                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                      }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {addr || '(no address)'}
                        </div>
                        {city && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{city}</div>}
                      </div>
                      <button onClick={() => moveStop(id, -1)} disabled={i === 0}
                        title="Move up" style={{
                          height: 20, width: 20, padding: 0, border: 'none', background: 'transparent',
                          color: i === 0 ? 'var(--text-3)' : 'var(--text-2)', cursor: i === 0 ? 'default' : 'pointer',
                          fontSize: 12, opacity: i === 0 ? 0.4 : 1,
                        }}>{'▲'}</button>
                      <button onClick={() => moveStop(id, 1)} disabled={i === routeStops.length - 1}
                        title="Move down" style={{
                          height: 20, width: 20, padding: 0, border: 'none', background: 'transparent',
                          color: i === routeStops.length - 1 ? 'var(--text-3)' : 'var(--text-2)',
                          cursor: i === routeStops.length - 1 ? 'default' : 'pointer',
                          fontSize: 12, opacity: i === routeStops.length - 1 ? 0.4 : 1,
                        }}>{'▼'}</button>
                      <button onClick={() => toggleRoute(id)} title="Remove from route" style={{
                        height: 20, width: 20, padding: 0, border: 'none', background: 'transparent',
                        color: 'var(--text-3)', cursor: 'pointer', fontSize: 12,
                      }}>{'✕'}</button>
                    </div>
                  );
                })}
                <button onClick={launchRoute} style={{
                  marginTop: 4, height: 32, padding: '0 12px',
                  border: 'none', borderRadius: 6,
                  background: 'var(--accent)', color: 'var(--accent-fg)',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}>Open in Google Maps</button>
              </div>
            );
          })()}
          <SidebarLauncherButton />
        </aside>
        <div style={{ minWidth: 0, position: 'relative' }}>
          <div
            ref={containerRef}
            style={{ position: 'absolute', inset: 0, background: 'var(--bg-surface-2)' }}
          />
          {progress && (
            <div style={{
              position: 'absolute', top: 12, left: 12, right: 12,
              maxWidth: 360,
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.75)', color: '#fff',
              borderRadius: 8, fontSize: 12,
              pointerEvents: 'none', zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Geocoding addresses...</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: Math.round((progress.done / Math.max(1, progress.total)) * 100) + '%',
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 240ms ease',
                }} />
              </div>
            </div>
          )}
          {!progress && markersOnMap === 0 && list.length > 0 && (
            <div style={{
              position: 'absolute', top: 12, left: 12,
              padding: '6px 10px',
              background: 'rgba(0,0,0,0.65)', color: '#fff',
              borderRadius: 6, fontSize: 12,
              pointerEvents: 'none', zIndex: 1000,
            }}>
              No addresses could be located.
            </div>
          )}
        </div>
      </div>

      {ctxMenu && (() => {
        const o = (activeOrders || []).find(x => x.id === ctxMenu.woId);
        const g = geocache && geocache[ctxMenu.woId];
        const pad = 8;
        const w = 220;
        const h = 200;
        let top = ctxMenu.y;
        let left = ctxMenu.x;
        if (left + w > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - w - pad);
        if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
        const item = (label, onClick, danger) => (
          <div
            onClick={() => { onClick(); closeCtxMenu(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{
              padding: '7px 12px', fontSize: 13,
              color: danger ? 'var(--flag-emergency)' : 'var(--text-1)',
              cursor: 'pointer', userSelect: 'none',
            }}
          >{label}</div>
        );
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', top, left,
              minWidth: w, background: 'var(--bg-surface)',
              border: '1px solid var(--border-2)', borderRadius: 8,
              boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
              padding: '4px 0', zIndex: 1100,
            }}
          >
            <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {ctxMenu.woId}
            </div>
            <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />
            {onOpenWO && item('Open WO details', () => onOpenWO(ctxMenu.woId))}
            {onWoAction && item('Edit details', () => onWoAction(ctxMenu.woId, 'editDetails'))}
            <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />
            {item(inRoute(ctxMenu.woId) ? 'Remove from route' : 'Add to route', () => toggleRoute(ctxMenu.woId))}
            <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />
            {g && g.lat != null && item('Center map here', () => {
              if (mapRef.current) mapRef.current.panTo([g.lat, g.lon]);
            })}
            {g && g.lat != null && setDefaultView && item('Set this point as default view', () => {
              const z = mapRef.current ? mapRef.current.getZoom() : (defaultView && defaultView.zoom) || 10;
              setDefaultView({ lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5), zoom: z });
            })}
            {onWoAction && item('Re-geocode address', () => onWoAction(ctxMenu.woId, 'regeocode'))}
            {onWoAction && g && g.suspect && item('Dismiss suspect flag', () => onWoAction(ctxMenu.woId, 'dismissSuspect'))}
          </div>
        );
      })()}
    </div>
  );
}

function ModuleLauncher({ current, onPick, onClose }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { cancelAnimationFrame(id); document.removeEventListener('keydown', onKey); };
  }, [onClose]);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'var(--bg-canvas)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      opacity: mounted ? 1 : 0, transition: 'opacity 220ms ease', overflow: 'auto',
    }}>
      <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700,
        fontSize: 30, letterSpacing: '-0.02em', marginBottom: 28 }}>Modules</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, padding: '0 24px', alignItems: 'center' }}>
        {MODULE_GROUPS.map(g => (
          <div key={g.category} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            <div style={{
              fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 600,
              fontSize: 16, letterSpacing: '-0.01em', color: 'var(--text-3)',
            }}>{g.category}</div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
              {g.items.map(m => (
                <button key={m.id} onClick={(e) => { e.stopPropagation(); onPick(m.id); }} style={{
                  width: 220, height: 180, borderRadius: 14, cursor: 'pointer', textAlign: 'left',
                  padding: 20, display: 'flex', flexDirection: 'column', gap: 10,
                  border: '1px solid ' + (current === m.id ? 'var(--accent)' : 'var(--border-1)'),
                  background: current === m.id ? 'var(--bg-row-sel)' : 'var(--bg-surface)',
                  color: 'var(--text-1)', fontFamily: 'inherit',
                }}>
                  <div style={{ fontSize: 34, lineHeight: 1 }}>{m.glyph}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }}>{m.title}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-3)' }}>{m.blurb}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 24, fontSize: 12, color: 'var(--text-3)' }}>Esc or click outside to close</div>
    </div>
  );
}

// ── Invoices module (slice 3) ─────────────────────────────────────────────────
// change11: Billing-queue view shows tab='sent' WOs only. Row click opens the
// invoice editor for that WO. Shows recorded invoice # + grand total when present.
function InvoicesModule({ sentOrders, selectedId, onOpenInvoice, onWoAction }) {
  const fmt = (n) => '$' + money(n).toFixed(2);
  const [query, setQuery] = React.useState('');
  // change11: status filter dropped (only 'sent' exists now). Aging filter
  // retained for throughput review.
  const [agingFilter, setAgingFilter] = React.useState(null);     // null | '0-30' | '31-60' | '60+'
  const selRef = React.useRef(null);
  React.useEffect(() => {
    if (selRef.current) selRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedId]);
  const q = query.trim().toLowerCase();
  const matches = (o) => {
    if (!q) return true;
    const inv = o.invoice;
    return (
      String(o.id || '').toLowerCase().includes(q) ||
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
          <ModuleNavChevrons side="home" />
          <ModuleNavChevrons side="left" />
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
          <ModuleNavChevrons side="right" />
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
          <SidebarLauncherButton />
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
                  <th style={{ textAlign: 'left', padding: '6px', color: 'var(--text-3)', fontWeight: 600, width: 70 }}>PM</th>
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
        </div>
      </div>
    </div>
  );
}

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
function itinSlots() {
  const out = [];
  for (let m = ITIN_START_MIN; m < ITIN_END_MIN; m += ITIN_STEP_MIN) {
    out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
  }
  return out;
}
function itinFmtTime(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (Number.isNaN(h)) return hhmm || '';
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + String(m).padStart(2, '0') + ' ' + ap;
}
function itinTodayStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function itinShiftDay(dateStr, delta) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, mo - 1, d + delta, 12);
  const p = (n) => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}
function itinDayLabel(dateStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, mo - 1, d, 12);
  return dt.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}
// MM/DD (American) from 'YYYY-MM-DD'.
function itinDayMonth(dateStr) {
  const [y, mo, d] = String(dateStr || '').split('-').map(Number);
  if (!d) return '';
  return String(mo).padStart(2, '0') + '/' + String(d).padStart(2, '0');
}
// "MM/DD h:mm AM" for a {date,start} schedule, or '' if unscheduled.
function fmtSchedule(dateStr, start) {
  if (!dateStr) return '';
  return itinDayMonth(dateStr) + ' ' + itinFmtTime(start);
}
// Snap an arbitrary 'HH:MM' to the nearest valid timeline slot string.
function itinSnapSlot(start) {
  const all = itinSlots();
  if (all.includes(start)) return start;
  const [h, m] = String(start || '').split(':').map(Number);
  if (Number.isNaN(h)) return all[0];
  let mins = h * 60 + (m || 0);
  mins = Math.max(ITIN_START_MIN, Math.min(ITIN_END_MIN - ITIN_STEP_MIN, mins));
  const snapped = Math.round(mins / ITIN_STEP_MIN) * ITIN_STEP_MIN;
  return String(Math.floor(snapped / 60)).padStart(2, '0') + ':' + String(snapped % 60).padStart(2, '0');
}

function ItineraryModule({ activeOrders, techs, phases, statusColors, statusTags, focus, tech, setTech, onClearFocus, onSetSchedule, onOpenWO, statuses, types, pms, inboxes, onWoAction, onAddToInbox, onAddToNewInbox, onRemoveFromInbox }) {
  // Unscheduled section collapse (controls + pool list share one state).
  const [poolOpen, togglePool] = useCollapsedSection('itin-unscheduled');
  // Right-click context menu state (shared component with ListPane/DetailPane).
  const [ctxMenu, setCtxMenu] = React.useState(null);
  const closeCtx = React.useCallback(() => setCtxMenu(null), []);
  React.useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e) => { if (e.key === 'Escape') closeCtx(); };
    const onClick = () => closeCtx();
    const onCtx = () => closeCtx();
    const t = setTimeout(() => {
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      document.addEventListener('contextmenu', onCtx, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onCtx, true);
    };
  }, [ctxMenu, closeCtx]);
  const openCardCtx = (e, o) => {
    e.preventDefault(); e.stopPropagation();
    setCtxMenu({ woId: o.id, x: e.clientX, y: e.clientY, tab: o.tab || 'active' });
  };
  // Tech selection lifted to App so it persists across module navigation.
  // Page reload still defaults to 'ALL' since App state resets on reload.
  const [date, setDate] = React.useState(itinTodayStr());
  const [dragId, setDragId] = React.useState(null);
  const [overSlot, setOverSlot] = React.useState(null);
  const [popId, setPopId] = React.useState(null);
  const [poolQuery, setPoolQuery] = React.useState('');
  const [cityFilter, setCityFilter] = React.useState('');
  const [highlightId, setHighlightId] = React.useState(null);
  const [suggestFor, setSuggestFor] = React.useState(null); // scheduled WO id whose nearby list is open
  const [hoverInfo, setHoverInfo] = React.useState(null);   // { id, rect } — hovered card mini-detail anchor
  const highlightRef = React.useRef(null);
  const hoverDelayRef = React.useRef(null);
  React.useEffect(() => () => { if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current); }, []);

  React.useEffect(() => { if (techs.length && tech !== 'ALL' && !techs.includes(tech)) setTech(techs[0]); }, [techs, tech]);

  // React to a focus request from the WO context menu (jump/add to schedule).
  // Apply any pending focus (jump-from-WO, transition-to-itinerary auto-tech).
  // App clears focus after apply via onClearFocus, so the same focus does not
  // re-apply on a later remount and override the user's manual tech pick.
  const lastFocusTs = React.useRef(0);
  React.useEffect(() => {
    if (!focus || !focus.ts || focus.ts <= lastFocusTs.current) return;
    lastFocusTs.current = focus.ts;
    if (focus.tech && techs.includes(focus.tech)) setTech(focus.tech);
    if (focus.date) setDate(focus.date);
    if (focus.highlightId != null) setHighlightId(focus.highlightId);
    if (onClearFocus) onClearFocus();
  }, [focus && focus.ts]);

  // Scroll the highlighted card into view once it renders.
  React.useEffect(() => {
    if (highlightId != null && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightId, date, tech]);

  const slots = React.useMemo(() => itinSlots(), []);
  const isAll = tech === 'ALL';
  const colorOf = (o) => statusColor(o.status, statusColors);
  const cityOf = (o) => splitAddress(o).city || '';

  // change11: activeOrders already filters to tab='active'. Complete WOs now
  // live in tab='complete' and never reach the Itinerary. No phase-complete
  // check needed.
  const schedulable = activeOrders;

  // Scheduled blocks for this day (all techs when isAll), keyed by snapped slot.
  // Uses activeOrders (NOT the complete-filtered pool) so a scheduled WO always
  // shows on the timeline even if its status later moved to a complete phase.
  // Slice 4 (#9): a `visited`-tagged status drops the WO off the day timeline
  // (the visit is done); its schedule data is kept for history/map.
  const tags = statusTags || {};
  const dayScheduled = React.useMemo(
    () => activeOrders.filter(o => o.schedule && o.schedule.date === date && (isAll || o.tech === tech) && tags[o.status] !== 'visited'),
    [activeOrders, date, tech, isAll, tags]
  );
  const scheduledBySlot = React.useMemo(() => {
    const map = {};
    for (const o of dayScheduled) {
      const slot = itinSnapSlot(o.schedule.start);
      (map[slot] = map[slot] || []).push(o);
    }
    return map;
  }, [dayScheduled]);
  const scheduledCount = dayScheduled.length;

  // Status -> rank from workflow order (phases, in order), for status sorting.
  const statusRank = React.useMemo(() => {
    const m = {}; let i = 0;
    (phases || []).forEach(p => (p.statuses || []).forEach(s => { if (!(s in m)) m[s] = i++; }));
    return m;
  }, [phases]);
  const byWo = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  // Unscheduled pool (all unscheduled schedulable WOs), sorted by workflow status order.
  const unscheduled = React.useMemo(
    () => schedulable.filter(o => !o.schedule).sort((a, b) => {
      const ra = statusRank[a.status] ?? Infinity, rb = statusRank[b.status] ?? Infinity;
      if (ra !== rb) return ra - rb;
      return byWo(a, b);
    }),
    [schedulable, statusRank]
  );
  const cityOptions = React.useMemo(() => {
    const set = new Set();
    unscheduled.forEach(o => { const c = cityOf(o); if (c) set.add(c); });
    return Array.from(set).sort();
  }, [unscheduled]);
  const pool = React.useMemo(() => {
    const q = poolQuery.trim().toLowerCase();
    return unscheduled.filter(o => {
      if (cityFilter && cityOf(o) !== cityFilter) return false;
      if (!q) return true;
      const { addr, city } = splitAddress(o);
      return String(o.id).toLowerCase().includes(q)
        || (addr || '').toLowerCase().includes(q)
        || (city || '').toLowerCase().includes(q);
    });
  }, [unscheduled, poolQuery, cityFilter]);

  const popOrder = popId != null ? activeOrders.find(o => o.id === popId) : null;
  const nextFreeSlot = () => slots.find(s => !scheduledBySlot[s]) || slots[slots.length - 1];

  const dropOnSlot = (slot) => {
    setOverSlot(null);
    const id = dragId;
    setDragId(null);
    if (id == null || isAll) return; // ALL is read-only overview: no target tech
    onSetSchedule(id, { date, start: slot }, tech);
  };

  // Hover-show / drag-hide for the mini-detail popup. 250ms delay avoids
  // flickering when the cursor crosses a card on the way to drag a different one.
  const openHover = (id, el) => {
    if (hoverDelayRef.current) clearTimeout(hoverDelayRef.current);
    const rect = el && el.getBoundingClientRect();
    hoverDelayRef.current = setTimeout(() => {
      setHoverInfo({ id, rect });
    }, 250);
  };
  const closeHover = (id) => {
    if (hoverDelayRef.current) { clearTimeout(hoverDelayRef.current); hoverDelayRef.current = null; }
    setHoverInfo(prev => (prev && prev.id === id) ? null : prev);
  };
  const dropHover = () => {
    if (hoverDelayRef.current) { clearTimeout(hoverDelayRef.current); hoverDelayRef.current = null; }
    setHoverInfo(null);
  };

  const woCard = (o, opts = {}) => {
    const { addr, city } = splitAddress(o);
    const isHi = o.id === highlightId;
    const c = colorOf(o);
    return (
      <div
        key={o.id}
        ref={isHi ? highlightRef : undefined}
        draggable
        onDragStart={(e) => { dropHover(); setDragId(o.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(o.id)); } catch {} }}
        onDragEnd={() => { setDragId(null); setOverSlot(null); }}
        onMouseEnter={(e) => openHover(o.id, e.currentTarget)}
        onMouseLeave={() => closeHover(o.id)}
        onClick={opts.onClick}
        onContextMenu={(e) => openCardCtx(e, o)}
        style={{
          border: '1px solid var(--border-1)', borderLeft: '4px solid ' + c,
          borderRadius: 8, background: 'var(--bg-surface)', padding: '6px 8px',
          cursor: opts.onClick ? 'pointer' : 'grab', fontSize: 12, opacity: dragId === o.id ? 0.4 : 1,
          display: 'flex', flexDirection: 'column', gap: 2,
          boxShadow: isHi ? '0 0 0 2px var(--accent)' : 'none',
        }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{o.id}</span>
          {o.emergency && <span style={{ color: 'var(--danger, #d9534f)', fontWeight: 700 }}>!</span>}
          <TypeIcon kind={typeLetter(o.type)} />
          {o.schedule && o.schedule.date && isOverdueSched(o.schedule.date, o.schedule.start) && (
            <span title="Past scheduled time" style={{ color: OVERDUE_CFG.textColor, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              ◷ {itinFmtTime(o.schedule.start)}
            </span>
          )}
          {opts.tag && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>{opts.tag}</span>}
          {o.pm && <span style={{ marginLeft: 'auto' }}><PMChip pm={o.pm} /></span>}
        </div>
        <div style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {addr || '(no address)'}{city ? ', ' + city : ''}
        </div>
        {opts.footer}
      </div>
    );
  };

  return (
    <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: '10px 18px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <ModuleNavChevrons side="home" />
          <ModuleNavChevrons side="left" />
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Itinerary
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginLeft: 8 }}>
            {itinDayLabel(date)} · {isAll ? 'All techs' : tech} · {scheduledCount} job{scheduledCount === 1 ? '' : 's'}
          </div>
          <div style={{ flex: 1 }} />
          <HeaderChips />
          <ModuleNavChevrons side="right" />
        </div>
      </div>

      {/* Body: module sidebar (day/tech/pool) + timeline */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid var(--border-1)', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg-surface)' }}>
          {/* Day section */}
          <div style={{ flexShrink: 0, padding: '10px 12px', borderBottom: '1px solid var(--border-1)' }}>
            <CollapsibleSection
              title="Day"
              sectionKey="itin-day"
              headerStyle={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}
            >
            <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
              <button onClick={() => setDate(itinShiftDay(itinTodayStr(), -1))} style={{
                flex: 1, height: 26, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
                border: '1px solid var(--border-1)', borderRadius: 6,
                background: date === itinShiftDay(itinTodayStr(), -1) ? 'var(--bg-row-sel)' : 'transparent',
                color: 'var(--text-1)',
              }}>Yesterday</button>
              <button onClick={() => setDate(itinTodayStr())} style={{
                flex: 1, height: 26, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
                border: '1px solid ' + (date === itinTodayStr() ? 'var(--accent)' : 'var(--border-1)'),
                borderRadius: 6,
                background: date === itinTodayStr() ? 'var(--bg-row-sel)' : 'transparent',
                color: 'var(--text-1)', fontWeight: date === itinTodayStr() ? 600 : 400,
              }}>Today</button>
              <button onClick={() => setDate(itinShiftDay(itinTodayStr(), 1))} style={{
                flex: 1, height: 26, fontSize: 11, fontFamily: 'inherit', cursor: 'pointer',
                border: '1px solid var(--border-1)', borderRadius: 6,
                background: date === itinShiftDay(itinTodayStr(), 1) ? 'var(--bg-row-sel)' : 'transparent',
                color: 'var(--text-1)',
              }}>Tomorrow</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => setDate(itinShiftDay(date, -1))} style={navBtnStyle}>‹</button>
              <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} style={{
                flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-1)',
                background: 'var(--bg-canvas)', color: 'var(--text-1)', fontSize: 12,
              }} />
              <button onClick={() => setDate(itinShiftDay(date, 1))} style={navBtnStyle}>›</button>
            </div>
            </CollapsibleSection>
          </div>
          {/* Tech section */}
          <div style={{ flexShrink: 0, padding: '10px 12px', borderBottom: '1px solid var(--border-1)' }}>
            <CollapsibleSection
              title="Tech"
              sectionKey="itin-tech"
              headerStyle={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}
            >
            <button onClick={() => setTech('ALL')} style={{
              width: '100%', height: 26, marginBottom: 4, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              border: '1px solid ' + (tech === 'ALL' ? 'var(--accent)' : 'var(--border-1)'),
              borderRadius: 6,
              background: tech === 'ALL' ? 'var(--bg-row-sel)' : 'transparent',
              color: 'var(--text-1)', fontWeight: tech === 'ALL' ? 600 : 400, textAlign: 'left', padding: '0 10px',
            }}>All techs</button>
            {techs.map(t => (
              <button key={t} onClick={() => setTech(t)} style={{
                width: '100%', height: 26, marginBottom: 4, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
                border: '1px solid ' + (tech === t ? 'var(--accent)' : 'var(--border-1)'),
                borderRadius: 6,
                background: tech === t ? 'var(--bg-row-sel)' : 'transparent',
                color: 'var(--text-1)', fontWeight: tech === t ? 600 : 400, textAlign: 'left', padding: '0 10px',
              }}>{t}</button>
            ))}
            </CollapsibleSection>
          </div>
          {/* Unscheduled pool */}
          <div style={{ flexShrink: 0, padding: '10px 12px 6px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              onClick={togglePool}
              style={{
                cursor: 'pointer', userSelect: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
                fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              }}
            >
              <span style={{
                fontSize: 9, color: 'var(--text-3)', width: 10, display: 'inline-block',
                transform: poolOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 120ms',
              }}>{'▾'}</span>
              <span style={{ flex: 1 }}>Unscheduled · {pool.length}</span>
            </div>
            {poolOpen && (
              <React.Fragment>
                <input
                  value={poolQuery}
                  onChange={(e) => setPoolQuery(e.target.value)}
                  placeholder="Search WO #, address, city..."
                  style={{ width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-1)',
                    background: 'var(--bg-canvas)', color: 'var(--text-1)', fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
                <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} style={{
                  width: '100%', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-1)',
                  background: 'var(--bg-canvas)', color: 'var(--text-1)', fontSize: 13, boxSizing: 'border-box',
                }}>
                  <option value="">All cities</option>
                  {cityOptions.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </React.Fragment>
            )}
          </div>
          {poolOpen && (
          <div
            onDragOver={(e) => { if (dragId != null) e.preventDefault(); }}
            onDrop={() => { if (dragId != null) onSetSchedule(dragId, null); setDragId(null); setOverSlot(null); }}
            style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pool.length === 0
              ? <div style={{ color: 'var(--text-3)', fontSize: 12, padding: '8px 2px' }}>No unscheduled work orders.</div>
              : pool.map(o => woCard(o, { title: 'Drag onto a time slot to schedule' }))}
          </div>
          )}
          <SidebarLauncherButton />
        </div>

        {/* Timeline */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 0' }}>
          {slots.map(slot => {
            const blocks = scheduledBySlot[slot] || [];
            const isOver = overSlot === slot && dragId != null;
            return (
              <div key={slot}
                onDragOver={(e) => { if (dragId != null) { e.preventDefault(); setOverSlot(slot); } }}
                onDragLeave={() => setOverSlot(s => s === slot ? null : s)}
                onDrop={() => dropOnSlot(slot)}
                style={{
                  display: 'flex', alignItems: 'stretch', borderTop: '1px solid var(--border-1)',
                  background: isOver ? 'var(--bg-row-sel)' : 'transparent', minHeight: 44,
                }}>
                <div style={{ width: 78, flexShrink: 0, padding: '6px 8px', fontSize: 11, color: 'var(--text-3)',
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {itinFmtTime(slot)}
                </div>
                <div style={{ flex: 1, padding: '4px 10px 4px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {blocks.map(o => {
                    const myCity = cityOf(o);
                    const nearby = myCity ? unscheduled.filter(u => cityOf(u) === myCity) : [];
                    return woCard(o, {
                      onClick: () => setPopId(o.id),
                      title: 'Click for options',
                      tag: isAll ? (o.tech || '—') : null,
                      footer: nearby.length > 0 && (
                        <div
                          onClick={(e) => { e.stopPropagation(); setSuggestFor(suggestFor === o.id ? null : o.id); }}
                          title={'Unscheduled WOs in ' + myCity + ': ' + nearby.map(n => n.id).join(', ')}
                          style={{ marginTop: 2, fontSize: 11, color: 'var(--accent)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          ⌖ {nearby.length} nearby in {myCity}
                        </div>
                      ),
                    });
                  })}
                </div>
              </div>
            );
          })}
          <div style={{ display: 'flex', borderTop: '1px solid var(--border-1)' }}>
            <div style={{ width: 78, flexShrink: 0, padding: '6px 8px', fontSize: 11, color: 'var(--text-3)', textAlign: 'right' }}>
              {itinFmtTime('18:00')}
            </div>
            <div style={{ flex: 1 }} />
          </div>
        </div>
      </div>

      {/* Nearby-suggestions popover (same-city routing aid) */}
      {suggestFor != null && (() => {
        const anchor = activeOrders.find(o => o.id === suggestFor);
        const aCity = anchor ? cityOf(anchor) : '';
        const nearby = aCity ? unscheduled.filter(u => cityOf(u) === aCity) : [];
        return (
          <div onClick={() => setSuggestFor(null)} style={{
            position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              width: 340, maxHeight: '70vh', overflowY: 'auto', background: 'var(--bg-surface)',
              border: '1px solid var(--border-1)', borderRadius: 12, padding: 16,
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              {(() => {
                const aTech = anchor ? anchor.tech : tech;
                const occupied = new Set(dayScheduled.filter(x => x.tech === aTech).map(x => itinSnapSlot(x.schedule.start)));
                const freeSlot = slots.find(s => !occupied.has(s)) || slots[slots.length - 1];
                return (<>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>Nearby unscheduled — {aCity}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Same city as {suggestFor}. Schedule one to {aTech || '—'} at the next open slot ({itinFmtTime(freeSlot)}).</div>
                  {nearby.length === 0
                    ? <div style={{ fontSize: 12, color: 'var(--text-3)' }}>None left.</div>
                    : nearby.map(o => woCard(o, {
                        footer: aTech ? (
                          <button onClick={(e) => { e.stopPropagation(); onSetSchedule(o.id, { date, start: freeSlot }, aTech); setSuggestFor(null); }}
                            style={{ ...navBtnStyle, marginTop: 4, alignSelf: 'flex-start' }}>Schedule next slot</button>
                        ) : null,
                      }))}
                </>);
              })()}
              <button onClick={() => setSuggestFor(null)} style={{ ...navBtnStyle, alignSelf: 'flex-end' }}>Close</button>
            </div>
          </div>
        );
      })()}

      {/* Block popover (centered card) */}
      {popOrder && (
        <div onClick={() => setPopId(null)} style={{
          position: 'fixed', inset: 0, zIndex: 320, background: 'rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 320, background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
            borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
          }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{popOrder.id}</div>
            <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
              {(() => { const { addr, city } = splitAddress(popOrder); return (addr || '(no address)') + (city ? ', ' + city : ''); })()}
            </div>
            {popOrder.phone && (
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {popOrder.contactName ? popOrder.contactName + ' · ' : ''}{formatPhone(popOrder.phone)}
              </div>
            )}
            {(() => {
              const lastPinned = (Array.isArray(popOrder.noteCards) ? popOrder.noteCards : [])
                .filter(n => n.pinned)
                .slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
              if (!lastPinned) return null;
              return (
                <div style={{ fontSize: 12, color: 'var(--text-2)', background: 'var(--bg-canvas)',
                  border: '1px solid var(--border-1)', borderRadius: 6, padding: '6px 8px',
                  whiteSpace: 'pre-wrap', maxHeight: 90, overflow: 'auto' }}>
                  <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                    📌 Pinned{lastPinned.type ? ' · ' + lastPinned.type : ''}
                  </div>
                  {String(lastPinned.body || '').slice(0, 320)}{String(lastPinned.body || '').length > 320 ? '…' : ''}
                </div>
              );
            })()}
            <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Day
              <input type="date" value={popOrder.schedule ? popOrder.schedule.date : date}
                onChange={(e) => { if (e.target.value) onSetSchedule(popOrder.id, { date: e.target.value, start: popOrder.schedule ? popOrder.schedule.start : slots[0] }, popOrder.tech); }}
                style={{ display: 'block', marginTop: 4, width: '100%', padding: '6px 8px', borderRadius: 8,
                  border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)' }} />
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Start time
              <select value={popOrder.schedule ? popOrder.schedule.start : slots[0]}
                onChange={(e) => onSetSchedule(popOrder.id, { date: popOrder.schedule ? popOrder.schedule.date : date, start: e.target.value }, popOrder.tech)}
                style={{ display: 'block', marginTop: 4, width: '100%', padding: '6px 8px', borderRadius: 8,
                  border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)' }}>
                {slots.map(s => <option key={s} value={s}>{itinFmtTime(s)}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12, color: 'var(--text-3)' }}>Technician
              <select value={popOrder.tech || ''}
                onChange={(e) => onSetSchedule(popOrder.id, popOrder.schedule || { date, start: slots[0] }, e.target.value)}
                style={{ display: 'block', marginTop: 4, width: '100%', padding: '6px 8px', borderRadius: 8,
                  border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)' }}>
                {techs.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {onOpenWO && <button onClick={() => { onOpenWO(popOrder.id); setPopId(null); }} style={navBtnStyle}>Open WO</button>}
              {onWoAction && <button onClick={() => { onWoAction(popOrder.id, 'jumpToMap'); setPopId(null); }} style={navBtnStyle} title="Show this job on the Maps module">Jump to Map</button>}
              <button onClick={() => { onSetSchedule(popOrder.id, null); setPopId(null); }}
                style={{ ...navBtnStyle, color: 'var(--danger, #d9534f)' }}>Unschedule</button>
              <button onClick={() => setPopId(null)} style={{ ...navBtnStyle, marginLeft: 'auto' }}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Hover mini-detail popup. Triggered by woCard onMouseEnter, hides on
          mouse leave or drag start. Focuses on the info a dispatcher needs at
          a glance: contact + notes. Status/type/PM live on the card itself. */}
      {hoverInfo && (() => {
        const o = activeOrders.find(x => x.id === hoverInfo.id);
        if (!o) return null;
        const r = hoverInfo.rect || { right: 0, top: 0, bottom: 0, left: 0, width: 0 };
        const W = 300, H = 220, GAP = 8;
        // Prefer right of card; flip to left if off-screen.
        let left = r.right + GAP;
        if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - GAP);
        let top = r.top;
        if (top + H > window.innerHeight - 8) top = Math.max(8, window.innerHeight - H - 8);
        const pinned = (Array.isArray(o.noteCards) ? o.noteCards : []).filter(n => n.pinned);
        const latest = (Array.isArray(o.noteCards) ? o.noteCards : []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
        const showNote = pinned[0] || latest;
        return (
          <div style={{
            position: 'fixed', top, left, width: W, maxHeight: H, zIndex: 340,
            background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
            borderRadius: 10, boxShadow: '0 12px 28px rgba(0,0,0,0.35)',
            padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
            fontSize: 12, color: 'var(--text-1)', pointerEvents: 'none',
            overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{o.id}</span>
              <span style={{ color: 'var(--text-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {(() => { const { addr, city } = splitAddress(o); return (addr || '') + (city ? ', ' + city : ''); })()}
              </span>
            </div>
            {(o.contactName || o.phone) && (
              <div style={{ color: 'var(--text-2)' }}>
                {o.contactName || ''}{o.contactName && o.phone ? ' · ' : ''}{o.phone ? formatPhone(o.phone) : ''}
              </div>
            )}
            {showNote && (
              <div style={{ color: 'var(--text-2)', background: 'var(--bg-canvas)',
                border: '1px solid var(--border-1)', borderRadius: 6, padding: '6px 8px',
                whiteSpace: 'pre-wrap', maxHeight: 110, overflow: 'hidden' }}>
                <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                  {pinned[0] ? '📌 Pinned' : 'Latest note'}{showNote.type ? ' · ' + showNote.type : ''}
                </div>
                {String(showNote.body || '').slice(0, 320)}{String(showNote.body || '').length > 320 ? '…' : ''}
              </div>
            )}
            {!showNote && !o.contactName && !o.phone && (
              <div style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>No notes or contact info on this WO.</div>
            )}
          </div>
        );
      })()}

      {ctxMenu && (() => {
        const ctxRow = activeOrders.find(o => o.id === ctxMenu.woId);
        return (
          <WOContextMenu
            ctxMenu={ctxMenu}
            ctxRow={ctxRow}
            bulkCount={1}
            source="itinerary"
            statuses={statuses}
            types={types}
            techs={techs}
            pms={pms}
            inboxes={inboxes}
            isInboxView={false}
            inboxId={null}
            onWoAction={onWoAction}
            onBulkSetStatus={null}
            onAddToInbox={onAddToInbox}
            onAddToNewInbox={onAddToNewInbox}
            onRemoveFromInbox={onRemoveFromInbox}
            onSelectWO={onOpenWO}
            onClose={closeCtx}
          />
        );
      })()}
    </div>
  );
}
const navBtnStyle = {
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
  const items = (state.batch || []).map(b => {
    const o = orders.find(x => x.id === b.id);
    return { ...b, o };
  }).filter(x => x.o);
  const newCount = items.filter(x => x.isNew).length;
  const updatedCount = items.length - newCount;
  return (
    <Modal open onClose={onClose} title={'Imported ' + items.length + ' work order' + (items.length === 1 ? '' : 's')} width={820}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
          {newCount > 0 && (newCount + ' new')}
          {newCount > 0 && updatedCount > 0 && ' · '}
          {updatedCount > 0 && (updatedCount + ' updated')}
          {state.dupSkipped ? ' · ' + state.dupSkipped + ' duplicate(s) skipped' : ''}
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
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>PM</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>Type</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>Tech</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid var(--border-1)' }}>Flags</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', borderBottom: '1px solid var(--border-1)' }}>Edit</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-1)' }}>State</th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ id, isNew, o }) => {
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
  const [recentWOs, setRecentWOs] = React.useState([]);
  const pushRecent = React.useCallback((id) => {
    if (!id) return;
    setRecentWOs(prev => [id, ...prev.filter(x => x !== id)].slice(0, 5));
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
  const [launcherOpen, setLauncherOpen] = React.useState(false);
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
  // Import inspect modal: shown after extension import to let user review
  // newly-imported WOs before they vanish into the active list. Cleared
  // when user clicks Done.
  const [importInspect, setImportInspect] = React.useState(null);
  const mapsDefaultView = settings.mapsDefaultView || DEFAULT_MAPS_VIEW;
  const setMapsDefaultView = React.useCallback((v) => updateSettings({ mapsDefaultView: v }), [updateSettings]);
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
  const types = (data?.types && data.types.length) ? data.types : DEFAULT_TYPES.slice();
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
    const LEGACY_COMPLETE_IDS = new Set(['wrap', 'done', 'billing']);
    const completePhaseNames = new Set();
    for (const p of storedPhases) {
      if (!p) continue;
      if (p.complete === true) completePhaseNames.add(p.name);
      if (p.id && LEGACY_COMPLETE_IDS.has(p.id)) completePhaseNames.add(p.name);
    }
    // v4.0.1: uses central narrower helper (bid submitted + complete, not
    // just "job complete"). Earlier reconciler version mis-flipped statuses
    // like "Job Complete - Enter Bid" that still belong on Active.
    const isCompletionStatus = isCompletionStatusName;
    let flipped = 0;
    let promotedFromInvoiced = 0;
    let hardcodedComplete = 0;
    let hardcodedCancelled = 0;
    let revertedFromComplete = 0;
    const nextOrders = (orders || []).map(o => {
      const t = (o.tab || 'active');
      // Pass 0: deleted/trash WOs — ensure status='Cancelled' AND no lingering
      // schedule (cancelled jobs should never appear on the itinerary). v5
      // added the schedule clear; earlier reconciler passes only fixed status.
      if (o.deleted) {
        const needsStatus   = o.status !== 'Cancelled';
        const needsUnsched  = !!o.schedule;
        if (needsStatus || needsUnsched) {
          hardcodedCancelled++;
          const next = { ...o };
          if (needsStatus) {
            next.prevStatus = o.prevStatus || o.status || 'Open';
            next.status = 'Cancelled';
          }
          if (needsUnsched) delete next.schedule;
          const detailParts = [];
          if (needsStatus)  detailParts.push((o.status || '') + ' → Cancelled');
          if (needsUnsched) detailParts.push('unscheduled');
          next.history = [...(Array.isArray(o.history) ? o.history : []),
            { ts: Date.now(), action: 'reconciled trash (change11 v5)', detail: detailParts.join(' · ') }];
          return next;
        }
        return o;
      }
      // Pass 1: tab='paid' or 'invoiced' (deprecated) -> 'sent'. Idempotent.
      if (t === 'paid' || t === 'invoiced') {
        promotedFromInvoiced++;
        const next = { ...o, tab: 'sent' };
        next.history = [...(Array.isArray(o.history) ? o.history : []),
          { ts: Date.now(), action: 'auto-flipped to Sent (change11 v4)', detail: 'was tab=' + t }];
        return next;
      }
      // Pass 2: Complete tab handling.
      //
      // v6 narrowed isCompletionStatusName so "Job Complete - Enter Bid" no
      // longer triggers the auto-flip. Earlier passes mis-flipped WOs with
      // that status (and similar). Detect + revert here:
      //   - tab='complete' AND prevStatus exists
      //   - prevStatus is NOT a completion status under the new rule
      //   - history shows the most recent complete-related action was an
      //     auto-flip (not a user-driven 'marked complete')
      // If all true, revert to active + restore prevStatus.
      //
      // Otherwise: fix any WO on Complete whose status isn't hardcoded.
      if (t === 'complete') {
        const hist = Array.isArray(o.history) ? o.history : [];
        let lastAutoIdx = -1, lastManualIdx = -1;
        for (let i = 0; i < hist.length; i++) {
          const a = String(hist[i].action || '').toLowerCase();
          if (a.includes('auto-flipped to complete')) lastAutoIdx = i;
          else if (a.includes('marked complete')) lastManualIdx = i;
        }
        const wasAutoFlipped = lastAutoIdx > lastManualIdx;
        if (o.prevStatus && wasAutoFlipped && !isCompletionStatusName(o.prevStatus)) {
          revertedFromComplete++;
          const next = {
            ...o, tab: 'active',
            status: o.prevStatus,
          };
          delete next.prevStatus;
          next.history = [...hist,
            { ts: Date.now(), action: 'reconciled complete (change11 v6)', detail: 'reverted auto-flip; status: Complete - Pending Approval → ' + o.prevStatus }];
          return next;
        }
        if (o.status !== 'Complete - Pending Approval') {
          hardcodedComplete++;
          return {
            ...o,
            prevStatus: o.prevStatus || o.status || 'Open',
            status: 'Complete - Pending Approval',
            history: [...(Array.isArray(o.history) ? o.history : []),
              { ts: Date.now(), action: 'hardcoded status (change11 v4)', detail: (o.status || '') + ' → Complete - Pending Approval' }],
          };
        }
        return o;
      }
      // Pass 3: active WOs whose stored phase or status signals tech-done.
      if (t !== 'active') return o;
      const phaseName = phaseForOrder(o, storedPhases);
      const byPhase  = completePhaseNames.has(phaseName);
      const byStatus = isCompletionStatus(o.status);
      if (!byPhase && !byStatus) return o;
      flipped++;
      const next = {
        ...o,
        tab: 'complete',
        prevStatus: o.prevStatus || o.status || 'Open',
        status: 'Complete - Pending Approval',
      };
      if (next.schedule) delete next.schedule;
      next.history = [...(Array.isArray(o.history) ? o.history : []),
        { ts: Date.now(), action: 'auto-flipped to Complete (change11 v4)',
          detail: 'phase=' + phaseName + ' status=' + (o.status || '') + ' → Complete - Pending Approval' }];
      return next;
    });
    // Pass 4: clear expired schedules in the SAME write so we never race with
    // the standalone auto-unschedule effect. The standalone effect is gated on
    // change11Reconciled_v6 being set, so it stays out of the way until this
    // pass completes.
    const today = itinTodayStr();
    let expiredCleared = 0;
    const finalOrders = nextOrders.map(o => {
      if (!o || !o.schedule || !o.schedule.date) return o;
      if (o.schedule.date >= today) return o;
      expiredCleared++;
      const clone = { ...o };
      const wasDate = clone.schedule.date;
      delete clone.schedule;
      clone.history = [...(Array.isArray(o.history) ? o.history : []),
        { ts: Date.now(), action: 'auto-unscheduled (expired)', detail: 'was ' + wasDate }];
      return clone;
    });
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
        const { imported, dupSkipped, batch } = upsertOrders(incoming);
        if (imported && dupSkipped)
          toast(`Imported ${imported} · skipped ${dupSkipped} duplicate(s)`);
        else if (imported)
          toast(`Imported ${imported} WO${imported === 1 ? '' : 's'}`);
        else if (dupSkipped)
          toast(`Skipped ${dupSkipped} duplicate(s) (already in tracker)`);
        if (Array.isArray(batch) && batch.length) {
          setImportInspect({ batch, ts: Date.now(), dupSkipped });
        }
        if (window.extensionBridge.acknowledge) window.extensionBridge.acknowledge();
      });
    }
    if (window.updater && window.updater.onStatus) {
      // Sticky: once a real update is in flight (available/downloading/ready),
      // ignore a later transient 'none'/'error' so the banner can't flash away
      // mid-update. A fresh 'checking' or real status still overrides.
      window.updater.onStatus((d) => setUpdateState(prev => {
        const inFlight = prev && (prev.status === 'available' || prev.status === 'downloading' || prev.status === 'ready');
        if (inFlight && d && (d.status === 'none' || d.status === 'error')) return prev;
        return d;
      }));
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
        // `visited` tag clears the schedule (mirrors the single-WO path).
        if (statusTags[status] === 'visited' && next.schedule) delete next.schedule;
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
  const effectiveQuery   = (activePreset || activeInbox) ? (activePreset ? (activePreset.query || '') : '') : query;
  const effectiveFilters = (activePreset || activeInbox) ? (activePreset ? (activePreset.filters || { pm: '', type: '', status: '', tech: '' }) : { pm: '', type: '', status: '', tech: '' }) : filters;
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

  const counts = loading
    ? { attention: '·', active: '·', complete: '·', sent: '·' }
    : {
        attention: alerts.length,
        active:    activeOrders.length,
        complete:  completeOrders.length,
        sent:      sentOrders.length,
      };

  const selectedRecord = React.useMemo(
    () => selectedWO ? orders.find(o => o.id === selectedWO) : null,
    [orders, selectedWO]
  );
  const detailData = toDetailData(selectedRecord);

  // change11: sendToInvoice is only valid from tab='complete'. Auto-unschedule
  // and emit a clear history entry. Active WOs cannot be invoiced anymore — the
  // detail-pane primary action on Active is "Mark Complete" instead.
  const doSendToInvoice = React.useCallback((id) => {
    updateOrder(id, cur => {
      const next = { ...cur, tab: 'sent' };
      if (next.schedule) delete next.schedule;
      next.history = [...(Array.isArray(cur.history) ? cur.history : []),
        { ts: Date.now(), action: 'sent to billing queue', detail: '' }];
      return next;
    });
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
    updateOrder(id, cur => {
      const prior = cur.status || 'Open';
      const next = {
        ...cur,
        tab: 'complete',
        prevStatus: cur.prevStatus || prior,
        status: 'Complete - Pending Approval',
      };
      if (next.schedule) delete next.schedule;
      next.history = [...(Array.isArray(cur.history) ? cur.history : []),
        { ts: Date.now(), action: 'marked complete', detail: 'status: ' + prior + ' → Complete - Pending Approval' }];
      return next;
    });
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
    updateOrder(id, cur => {
      const from = cur.tab || 'active';
      const next = { ...cur };
      if (from === 'complete') {
        next.tab = 'active';
        const restored = cur.prevStatus || 'Open';
        next.status = restored;
        delete next.prevStatus;
        next.history = [...(Array.isArray(cur.history) ? cur.history : []),
          { ts: Date.now(), action: 'reopened', detail: 'complete → active, status: ' + (cur.status || '') + ' → ' + restored }];
      } else if (from === 'sent') {
        next.tab = 'complete';
        next.prevStatus = cur.prevStatus || cur.status || 'Open';
        next.status = 'Complete - Pending Approval';
        next.history = [...(Array.isArray(cur.history) ? cur.history : []),
          { ts: Date.now(), action: 'reopened', detail: 'sent → complete' }];
      } else {
        next.tab = 'active';
        next.history = [...(Array.isArray(cur.history) ? cur.history : []),
          { ts: Date.now(), action: 'reopened', detail: from + ' → active' }];
      }
      return next;
    });
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
      const detail = schedule
        ? (schedule.date + ' ' + schedule.start + ((tech || o.tech) ? ' · ' + (tech || o.tech) : ''))
        : '';
      next.history = [...(Array.isArray(o.history) ? o.history : []),
        { ts: Date.now(), action: schedule === null ? 'unscheduled' : 'scheduled', detail }];
      return next;
    });
  }, [updateOrder]);

  // Sidebar WO-view selection always returns to the Work Orders module.
  const selectView = React.useCallback((v) => {
    setCurrentModule('work-orders');
    setCurrentView(v);
  }, []);

  // MODULE_ORDER is declared at module scope so ModuleNavChevrons can read it
  // without a context round-trip; see definition near MODULE_GROUPS.

  // Module entry side-effects: itinerary auto-snaps to selectedWO's schedule
  // (if any); invoices highlights selectedWO row via selectedId prop.
  const switchModule = React.useCallback((m) => {
    if (m === 'itinerary' && selectedWO) {
      const sel = orders.find(x => x.id === selectedWO);
      if (sel && sel.schedule && sel.schedule.date) {
        setItinFocus({
          tech: sel.tech || '',
          date: sel.schedule.date,
          highlightId: selectedWO,
          ts: Date.now(),
        });
      }
    }
    setCurrentModule(m);
  }, [selectedWO, orders]);

  const pickModule = React.useCallback((m) => {
    switchModule(m);
    setLauncherOpen(false);
  }, [switchModule]);

  const goPrevModule = React.useCallback(() => {
    const i = MODULE_ORDER.indexOf(currentModule);
    if (i > 0) switchModule(MODULE_ORDER[i - 1]);
  }, [currentModule, switchModule]);
  const goNextModule = React.useCallback(() => {
    const i = MODULE_ORDER.indexOf(currentModule);
    if (i >= 0 && i < MODULE_ORDER.length - 1) switchModule(MODULE_ORDER[i + 1]);
  }, [currentModule, switchModule]);

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
      ['PM',           o => o.pm || ''],
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

  // In-app portal capture: drives a BrowserWindow (main process) through the
  // WO's tabs and merges the scraped fields into THIS record. Re-capture
  // updates in place (updateOrder), never spawning a duplicate. Returns a
  // promise so callers can show progress. Shared by context menu + detail pane.
  const captureOrder = React.useCallback((id) => {
    const src = orders.find(o => o.id === id);
    if (!src) return Promise.resolve();
    const pm = String(src.pm || '').toUpperCase();
    if (pm === 'MSR') { toast('MSR work orders import through the Chrome extension, not in-app capture'); return Promise.resolve(); }
    if (pm !== 'AMH') { toast('In-app capture supports AMH work orders only'); return Promise.resolve(); }
    if (!window.scraper || !window.scraper.captureWO) { toast('Capture is only available in the desktop app'); return Promise.resolve(); }
    toast('Capturing ' + id + ' from ' + pm + '…');
    return window.scraper.captureWO(src).then(res => {
      if (!res || !res.ok) { toast('Capture failed: ' + ((res && res.error) || 'unknown error')); return; }
      const s = res.wo || {};
      updateOrder(id, cur => {
        const patch = { ...cur };
        const set = (k, v) => { if (v !== undefined && v !== null && v !== '') patch[k] = v; };
        // Status + priority are left to the user's workflow — re-capture must
        // not drag a manually-advanced WO back to the portal's status.
        set('address', s.address);
        set('city', s.city);
        if (s.phone) patch.phone = formatPhone(s.phone);
        set('type', s.type);
        set('propertyId', s.propertyId);
        set('portalLink', s.portalLink);
        set('bidAmount', s.bidAmount);
        if (Array.isArray(s.bidItems) && s.bidItems.length) patch.bidItems = s.bidItems;
        if (s.notes) patch.notes = s.notes;
        set('contactName', s.contactName);
        if (Array.isArray(s.contacts) && s.contacts.length) patch.contacts = s.contacts;
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
      const warnings = Array.isArray(res.warnings) ? res.warnings : [];
      if (warnings.length) {
        toast('Captured ' + id + ' (warnings: ' + warnings.join(' / ') + ')', 'warn');
      } else {
        toast('Captured ' + id);
      }
    }).catch(e => toast('Capture error: ' + e.message));
  }, [orders, updateOrder, toast]);

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
          // Slice 4 (#9): `visited` tag clears the schedule (tech finished at the
          // site). Same data effect as completion, but the WO stays on its tab.
          // The Itinerary tag-filter still hides legacy visited WOs that were
          // saved before this clear-on-transition existed.
          if (statusTags[payload] === 'visited' && next.schedule) delete next.schedule;
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
  }, [updateOrder, captureOrder, toast, orders, sendToInvoice, markComplete, reopen, updateSettings, statusTags, setScheduleTarget]);

  // ⋯ menu actions on the detail pane.
  const detailAction = React.useCallback((kind, payload) => {
    const id = selectedWO;
    if (!id) return;
    // Delegate shared cases to woAction.
    if (kind === 'setStatus' || kind === 'backToActive' || kind === 'softDelete' ||
        kind === 'toggleEmergency' || kind === 'toggleWarranty' ||
        kind === 'markComplete' || kind === 'reopen') {
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
      default: break;
    }
  }, [selectedWO, woAction, captureOrder, orders, updateOrder, deleteOrderHard, addOrder, toast]);

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

  let rightPane;
  if (currentView === 'attention') {
    rightPane = <Landing
      alerts={alerts}
      onSelectWO={(wo) => { setSelectedWO(wo); pushRecent(wo); setCurrentView('active'); }}
    />;
  } else if (currentView === 'settings') {
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
  } else {
    rightPane = <DetailPane
      data={detailData}
      onSendToInvoice={sendToInvoice}
      onMarkComplete={markComplete}
      onReopen={reopen}
      onAddNote={addNote}
      onEditNote={editNote}
      onDeleteNote={deleteNote}
      onPinNote={togglePinNote}
      onSetMisc={setMisc}
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
    />;
  }

  return (
    <PMsContext.Provider value={pms}>
    <PhasesContext.Provider value={phases}>
     <StatusColorsContext.Provider value={statusColors}>
      <ToastContext.Provider value={toast}>
       <ModuleNavContext.Provider value={{ currentModule, onPrev: goPrevModule, onNext: goNextModule, onHome: () => setCurrentModule('overview') }}>
        <HeaderActionsContext.Provider value={{
          onAddWO: handleAddWO,
          onOpenAttention: () => { setCurrentModule('work-orders'); setCurrentView('attention'); },
          attentionCount: alerts.length,
          onExportCsv: exportViewCsv,
          onAddInbox: onAddInbox,
          onOpenLauncher: () => setLauncherOpen(true),
          onOpenSettings: () => { setCurrentModule('work-orders'); setCurrentView('settings'); },
        }}>
        <UpdateBanner
          state={updateState}
          onInstall={() => window.updater && window.updater.install && window.updater.install()}
        />
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
          position: 'fixed', inset: 0,
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
          <div />
          {currentModule === 'service-items' ? (
            <ServiceLibrary toast={toast} subCats={librarySubCats} setSubCats={setLibrarySubCats} />
          ) : currentModule === 'maps' ? (
            <MapsModule
              activeOrders={mapOrders}
              geocache={geocache}
              defaultView={mapsDefaultView}
              setDefaultView={setMapsDefaultView}
              selected={mapsSelected}
              setSelected={setMapsSelected}
              progress={geocodeProgress}
              onOpenWO={(id) => { setSelectedWO(id); pushRecent(id); setCurrentView('active'); setCurrentModule('work-orders'); }}
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
              onOpenWO={(id) => { setCurrentModule('work-orders'); setCurrentView('active'); setSelectedWO(id); pushRecent(id); }}
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
            />
            <div style={{ flex: 1, minHeight: 0, display: 'flex', minWidth: 0 }}>
              <Sidebar
                activeView={currentView}
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
                  selectedWO={(currentView === 'attention' || currentView === 'settings') ? null : selectedWO}
                  onSelectWO={(wo) => {
                    setSelectedWO(wo);
                    pushRecent(wo);
                    if (currentView === 'settings' || currentView === 'attention') setCurrentView('active');
                  }}
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
              <div style={{ flex: '1.2 1 0', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                {rightPane}
              </div>
            </div>
          </div>
          )}
        </div>
        )}

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

        {launcherOpen && (
          <ModuleLauncher current={currentModule} onPick={pickModule} onClose={() => setLauncherOpen(false)} />
        )}
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
        {/* Module nav arrows live inside each module's header via
            <ModuleNavChevrons/> (consumes ModuleNavContext). The old
            full-height side rails were removed in change10 slice 2. */}
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

