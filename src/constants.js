// Pure data + pure helpers carved out of app.jsx (no React, no JSX). One-way
// dependency: app.jsx (and later section modules) import from here.

export const DEFAULT_PMS = [
  { name: 'AMH',   color: '#1a73e8' },
  { name: 'MSR',   color: '#10b981' },
  { name: 'Other', color: '#6b7280' },
];
// Job types: only HVAC + Plumbing are real trades; 'Plumbing+HVAC' is a dual job
// (rendered with a split icon). 'Other' is intentionally NOT offered.
export const DEFAULT_TYPES = ['HVAC', 'Plumbing', 'Plumbing+HVAC'];
export const DEFAULT_TECHS = ['Daniel', 'Andrew', 'Devyn'];

// change11: the `complete: true` phase flag is DEPRECATED. All phases are
// considered active workflow now; the tab field (active / complete / sent /
// trash) drives completion state. Migration removes the flag from stored data
// and moves WOs that were in complete-marked phases into tab='complete'.
// 'Bid Approved - Complete' moved from 'approved' to end of 'In progress'
// (per user: not really job-complete yet).
export const DEFAULT_PHASES = [
  { id: 'intake',   name: 'Intake',      fg: 'var(--p-intake)',   bg: 'var(--p-intake-bg)',   statuses: ['Open'] },
  { id: 'await',    name: 'Awaiting PM', fg: 'var(--p-await)',    bg: 'var(--p-await-bg)',    statuses: ['Bid Submitted'] },
  { id: 'approved', name: 'Approved',    fg: 'var(--p-approved)', bg: 'var(--p-approved-bg)', statuses: ['Bid Approved - Return'] },
  { id: 'progress', name: 'In progress', fg: 'var(--p-progress)', bg: 'var(--p-progress-bg)', statuses: ['Parts Pending', 'Bid Approved - Complete'] },
  { id: 'wrap',     name: 'Wrapping up', fg: 'var(--p-wrap)',     bg: 'var(--p-wrap-bg)',     statuses: ['Pending-Complete'] },
  { id: 'done',     name: 'Done',        fg: 'var(--p-done)',     bg: 'var(--p-done-bg)',     statuses: ['Closed'] },
];

// Density scale tokens. Read in App via `settings.density`, applied to
// list-row padding and primary line font-size. Values picked so compact
// fits ~25% more rows on screen and generous gives ~15% breathing room
// over balanced.
export const DENSITY_MAP = {
  compact:  { rowPadY: 6,  rowGap: 2, line1: 14, line2: 12 },
  balanced: { rowPadY: 9,  rowGap: 3, line1: 15, line2: 13 },
  generous: { rowPadY: 13, rowGap: 5, line1: 16, line2: 13 },
};
export function densityFor(value) {
  return DENSITY_MAP[value] || DENSITY_MAP.balanced;
}

export const MIGRATION_VERSION = '3.0';
// Display-only app version (keep in sync with package.json on release).
export const APP_VERSION = '4.5.0';

// Legacy status colors (kept until per-status colors are made user-editable).
// Matches the DSC map in the v2.6.0 renderer so existing data looks identical.
export const DEFAULT_STATUS_COLORS = {
  'Open':                    '#10b981',
  'Bid Submitted':           '#a0e114',
  'Bid Approved - Return':   '#db0a0a',
  'Parts Pending':           '#f59e0b',
  'Bid Approved - Complete': '#a23ef4',
  'Pending-Complete':        '#8b5cf6',
  'Closed':                  '#4b5563',
  // change11: hardcoded on Complete entry. Amber reads as "waiting for PM".
  'Complete - Pending Approval': '#fbbf24',
  // change11: hardcoded on Trash entry. Muted gray reads as "out of pipeline".
  'Cancelled':               '#6b7280',
};

// change11: these statuses are hardcoded by softDelete (Cancelled) and
// markComplete / auto-flip (Complete - Pending Approval). User-driven rename
// or delete would break the tab-flip + restore logic, so the StatusesEditor
// blocks both actions for them. Color is still editable.
export const LOCKED_STATUSES = new Set(['Cancelled', 'Complete - Pending Approval']);

// Slice 4 (#9): system tags bind a BEHAVIOR to a user-named status, stored in
// settings.statusTags = { [statusName]: tag }. The handler is hardcoded; which
// status triggers it is user-configurable (Settings > Workflow > Manage
// statuses). `schedule` and `visited` are imperative (run in the setStatus
// handlers, single + bulk); `onsite` and `offmap` are pure render rules (map
// fill / presence) read live from the WO's current status.
//   schedule -> open Schedule modal when set on one WO
//   onsite   -> map marker fill = status color, wins over the overdue border
//   visited  -> clear the WO's schedule (also drops it off the Itinerary list)
//   offmap   -> hide the map marker (field work done, bid entry only)
export const SYSTEM_TAGS = ['schedule', 'onsite', 'visited', 'offmap'];
export const SYSTEM_TAG_LABELS = {
  schedule: 'Schedule (open modal)',
  onsite:   'On site (map highlight)',
  visited:  'Visited (clear schedule)',
  offmap:   'Off map (hide marker)',
};

// change11 v4.0.1: heuristic for "tech-done, bid submitted" — fires the
// auto-flip from Active → Complete. Earlier versions matched any string
// containing "job complete", which incorrectly caught "Job Complete - Enter
// Bid" (still active workflow — bid not yet submitted). New rule:
//   - exact 'Pending-Complete' or 'Closed' (legacy defaults), OR
//   - status contains BOTH "bid submitted" AND "complete" — i.e. bid is in
//     AND tech work is done. Catches "Bid Submitted - Complete" and
//     "Bid Submitted - Job Complete". Excludes "Job Complete - Enter Bid".
export function isCompletionStatusName(s) {
  if (!s) return false;
  if (s === 'Pending-Complete' || s === 'Closed') return true;
  const sl = String(s).toLowerCase();
  return sl.includes('bid submitted') && sl.includes('complete');
}

// Custom-theme picker scope. Settings → Appearance exposes color pickers for
// these CSS variables only. Phase colors live in Workflow; borders / age
// tints / flags / phase swatches stay tied to the base theme so semantics
// (e.g. red = emergency) remain consistent. customTheme overrides merge over
// the base theme (light/dark) at the themeVars assignment in App.
export const EDITABLE_THEME_VARS = [
  { group: 'Surfaces', items: [
    { key: '--bg-canvas',    label: 'Canvas',         desc: 'App background' },
    { key: '--bg-surface',   label: 'Surface',        desc: 'Card / row background' },
    { key: '--bg-surface-2', label: 'Surface 2',      desc: 'Phase header band' },
    { key: '--bg-hover',     label: 'Hover',          desc: 'Row hover state' },
    { key: '--bg-row-sel',   label: 'Selected row',   desc: 'Active list row tint' },
  ]},
  { group: 'Text', items: [
    { key: '--text-1', label: 'Primary',   desc: 'Main copy' },
    { key: '--text-2', label: 'Secondary', desc: 'Labels and chips' },
    { key: '--text-3', label: 'Muted',     desc: 'Subtitles and hints' },
  ]},
  { group: 'Accent', items: [
    { key: '--accent',      label: 'Accent',       desc: 'Primary buttons, links, focus' },
    { key: '--accent-fg',   label: 'Accent text',  desc: 'Text on accent backgrounds' },
    { key: '--accent-soft', label: 'Accent soft',  desc: 'Tinted backgrounds' },
  ]},
];

// Color for the "More Information" detail card. Distinct from pinned-note
// accent (blue) so the field reads as a header extension, not a timeline note.
// User-editable via Settings -> Workflow.
export const DEFAULT_MORE_INFO_COLOR = '#d97706';

export function statusColor(status, statusColors) {
  return (statusColors && statusColors[status]) || DEFAULT_STATUS_COLORS[status] || '#6b7280';
}

// Border colors for the two active trades. Chosen as bold, well-separated
// hues that read clearly as marker BORDERS over any status-pill fill and
// avoid the known fill clashes (scheduled-gold, onsite-blue, suspect-violet).
// E (Electrical) is legacy-only: not an active type, kept so old data still
// renders. See memory project_hvac_plumbing_only.
export const TYPE_COLORS = {
  P: '#0891b2', // Plumbing - cyan
  H: '#dc2626', // HVAC - red
  E: '#eab308', // Electrical - amber (legacy data only)
};

// Default colors for map marker categories. User can override individually
// via Settings -> Maps. Suspect is intentionally violet, distinct from the
// HVAC orange, so an out-of-region geocode does not blend in with a normal
// HVAC marker.
export const DEFAULT_MAP_MARKER_COLORS = {
  suspect:  '#9333ea', // violet - geocoder hit but suspect
  fallback: '#6b7280', // gray - unknown type
};

// Ensure a color value is a hex string; falls back to #6b7280.
export function normalizeHex(v) {
  if (!v) return '#6b7280';
  if (v.startsWith('#')) return v;
  // CSS var or named color -- return fallback
  return '#6b7280';
}

// Returns rgba() string from a hex color.
export function hexToRgba(hex, alpha) {
  const h = (hex || '#6b7280').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
