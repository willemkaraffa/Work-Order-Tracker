// App-wide navigation, carved out of app.jsx. Owns the module registry
// (MODULE_GROUPS/MODULES/MODULE_ORDER), ModuleNavContext, and the fold-out
// NavWing that replaces the old ModuleLauncher + top-bar prev/next chevrons.
// Dep direction: constants/contexts <- nav. App shell still owns currentModule
// + switchModule; it feeds them in via ModuleNavContext.
import React from 'react';

// Module registry. MODULE_GROUPS drives both the wing sections and the
// Overview jump grid. Order here = the wing's top-to-bottom order.
export const MODULE_GROUPS = [
  { category: 'Order Management', items: [
    { id: 'work-orders', glyph: '▤', title: 'Work Orders', blurb: 'Track, triage, and bill jobs' },
    { id: 'itinerary',   glyph: '◷', title: 'Itinerary',   blurb: 'Schedule technicians day by day' },
    { id: 'maps',        glyph: '◎', title: 'Maps',        blurb: 'Locate work orders on the map' },
  ]},
  { category: 'Accounting', items: [
    { id: 'invoices',      glyph: '$', title: 'Invoices',      blurb: 'Build invoices for the billing queue' },
    { id: 'remittances',   glyph: '▣', title: 'Remittances',   blurb: 'Reconcile PM remittance PDFs to bids' },
    { id: 'service-items', glyph: '▦', title: 'Service Items', blurb: 'Edit the service-item price library' },
  ]},
];
export const MODULES = MODULE_GROUPS.flatMap(g => g.items);
// Flat cycle order. Kept so any residual prev/next callers still agree.
export const MODULE_ORDER = MODULES.map(m => m.id);

// App-wide module nav context. App provides currentModule + handlers; the wing
// consumes them without prop-drilling. onPick(id) switches to a module;
// onHome returns to Overview.
export const ModuleNavContext = React.createContext({
  currentModule: '', onPick: () => {}, onHome: () => {},
});

// NavWing. Always-collapsed left-edge icon rail (RAIL wide). Each module is a
// glyph row; hovering a row highlights it and floats a label tooltip to the
// right (over content). No expand/collapse animation. Sections mirror
// MODULE_GROUPS, plus an Overview row pinned to the bottom. Present on every
// module EXCEPT Overview (Overview keeps its own jump grid). Mounted once by
// the App shell, which reserves RAIL px of left inset for it.
export const RAIL = 48; // collapsed icon-rail width; App shell reserves this.

export function NavWing() {
  const { currentModule, onPick, onHome } = React.useContext(ModuleNavContext);
  // Single hovered id (module id, or 'overview') drives both the row highlight
  // and which floating tooltip shows. Kept here (not per-row state) so rows
  // stay plain JSX in the map — no inline component to remount and drop hover.
  const [hovered, setHovered] = React.useState(null);

  // One rail row. Glyph-only; floating label tooltip on hover. active = the
  // current module gets an accent left bar + accent glyph.
  const row = (id, glyph, title, onClick) => {
    const active = currentModule === id;
    const hot = hovered === id;
    return (
      <button
        key={id}
        onClick={onClick}
        onMouseEnter={() => setHovered(id)}
        onMouseLeave={() => setHovered(h => (h === id ? null : h))}
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: '100%', height: 44, padding: 0, boxSizing: 'border-box',
          border: 'none', borderLeft: '3px solid ' + (active ? 'var(--accent)' : 'transparent'),
          background: active ? 'var(--bg-row-sel)' : (hot ? 'var(--bg-hover)' : 'transparent'),
          color: active ? 'var(--accent)' : (hot ? 'var(--text-1)' : 'var(--text-2)'),
          cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1,
          transition: 'background 100ms ease, color 100ms ease',
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 18, marginLeft: -3 }}>{glyph}</span>
        {hot && (
          <span style={{
            position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)',
            marginLeft: 8, padding: '6px 10px', whiteSpace: 'nowrap',
            background: 'var(--bg-surface)', color: 'var(--text-1)',
            border: '1px solid var(--border-2)', borderRadius: 8,
            boxShadow: '0 6px 18px rgba(0,0,0,0.4)',
            fontSize: 13, fontWeight: 600, pointerEvents: 'none', zIndex: 210,
          }}>{title}</span>
        )}
      </button>
    );
  };

  return (
    <div
      style={{
        position: 'fixed', top: 0, bottom: 0, left: 0, width: RAIL,
        zIndex: 200, boxSizing: 'border-box',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-2)',
        display: 'flex', flexDirection: 'column', overflow: 'visible',
      }}
    >
      <div style={{
        height: 52, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--accent)', fontSize: 18,
        borderBottom: '1px solid var(--border-1)',
      }}>
        <span aria-hidden="true">{'⊞'}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, paddingTop: 4 }}>
        {MODULE_GROUPS.map((g, gi) => (
          <React.Fragment key={g.category}>
            {gi > 0 && <div style={{ height: 1, background: 'var(--border-1)', margin: '6px 10px' }} />}
            {g.items.map(m => row(m.id, m.glyph, m.title, () => onPick(m.id)))}
          </React.Fragment>
        ))}
      </div>

      <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-1)', paddingBottom: 8, paddingTop: 4 }}>
        {row('overview', '«', 'Overview', onHome)}
      </div>
    </div>
  );
}
