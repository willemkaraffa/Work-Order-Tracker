// Shared UI atoms carved out of app.jsx. Dep direction:
// constants + contexts <- primitives <- sections/app.
import React from 'react';
import { usePMs, useStatusColors } from './contexts.js';
import { normalizeHex, hexToRgba, TYPE_COLORS, statusColor } from './constants.js';

export function Dot() {
  return <span style={{ width: 3, height: 3, borderRadius: 2, background: 'var(--text-3)', opacity: 0.6 }} />;
}

export function PMChip({ pm }) {
  const pms = usePMs();
  // o.pm is the stable Client CODE; resolve color + full-name tooltip by code.
  const entry = pms.find(p => p.name === pm);
  const hex = entry ? normalizeHex(entry.color) : '#6b7280';
  const bg = hexToRgba(hex, 0.18);
  return (
    <span title={entry && entry.fullName ? entry.fullName : pm} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 28, height: 22, borderRadius: 5, padding: '0 4px',
      background: bg, color: hex,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.02em',
      flexShrink: 0,
    }}>{pm}</span>
  );
}

// Accepts a letter ('P'/'H'/'E'/'PH'), a full type ('Plumbing', 'HVAC',
// 'Plumbing+HVAC'), or legacy values — normalizes so every call site renders
// the same icon regardless of what it passes.
function normType(kind) {
  const s = String(kind || '');
  const t = s.toLowerCase();
  const hasP = t === 'p' || /plumb/.test(t);
  const hasH = t === 'h' || /hvac|heat|cool|furnace/.test(t);
  if (t === 'ph' || (hasP && hasH)) return 'PH';   // dual
  if (hasP) return 'P';
  if (hasH) return 'H';
  if (t === 'e' || /electric/.test(t)) return 'E';
  return (s.slice(0, 1).toUpperCase() || '?');
}

export function TypeIcon({ kind }) {
  const k = normType(kind);
  // Dual job (Plumbing + HVAC): diagonal split of the two trade colors.
  if (k === 'PH') {
    const cp = TYPE_COLORS.P, ch = TYPE_COLORS.H;
    return (
      <span title="Plumbing + HVAC" style={{
        display: 'inline-flex', width: 20, height: 20, borderRadius: 4,
        overflow: 'hidden', border: `1px solid ${hexToRgba('#888', 0.45)}`, flexShrink: 0,
      }}>
        <svg viewBox="0 0 20 20" width="20" height="20" style={{ display: 'block' }}>
          <polygon points="0,0 20,0 0,20" fill={hexToRgba(cp, 0.30)} />
          <polygon points="20,0 20,20 0,20" fill={hexToRgba(ch, 0.30)} />
          <line x1="20" y1="0" x2="0" y2="20" stroke="rgba(0,0,0,0.5)" strokeWidth="1" />
          <text x="3.5" y="9.5" fontSize="8" fontWeight="800" fill={cp} fontFamily="ui-monospace, monospace">P</text>
          <text x="11" y="17.5" fontSize="8" fontWeight="800" fill={ch} fontFamily="ui-monospace, monospace">H</text>
        </svg>
      </span>
    );
  }
  const label = k === 'P' ? 'Plumbing' : k === 'H' ? 'HVAC' : k === 'E' ? 'Electrical' : (kind || '');
  const c = TYPE_COLORS[k] || '#6b7280';
  return (
    <span title={label} style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 20, height: 20, borderRadius: 4,
      border: `1px solid ${hexToRgba(c, 0.5)}`,
      background: hexToRgba(c, 0.18),
      color: c, fontSize: 11, fontWeight: 800,
      fontFamily: 'ui-monospace, monospace',
      flexShrink: 0,
    }}>{k}</span>
  );
}

export function FlagGlyph({ kind }) {
  // Slice 4 (#9): returnPending (Option A flag) renders a distinct return-arrow
  // badge — "visited, bid not entered; needs a return before re-booking".
  if (kind === 'returnPending') {
    return (
      <span title="Return - bid not entered" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 13, height: 14, flexShrink: 0, color: '#f59e0b', fontSize: 13, fontWeight: 700, lineHeight: 1,
      }}>↩</span>
    );
  }
  const color = kind === 'emergency' ? 'var(--flag-emergency)' : 'var(--flag-warranty)';
  return (
    <span title={kind === 'emergency' ? 'Emergency' : 'Warranty'} style={{
      display: 'inline-block', width: 12, height: 14, flexShrink: 0,
    }}>
      <svg viewBox="0 0 12 14" width="12" height="14" style={{ display: 'block' }}>
        <path d="M2 1 L2 13 M2 1 L10 1 L8 4 L10 7 L2 7" stroke={color} strokeWidth="1.6" fill={color} strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function StatusPill({ status, size = 'md' }) {
  const colors = useStatusColors();
  const c = statusColor(status, colors);
  const h = size === 'sm' ? 20 : 22;
  const px = size === 'sm' ? 8 : 10;
  const fs = size === 'sm' ? 11 : 12;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      height: h, padding: `0 ${px}px`,
      border: `1px solid ${hexToRgba(c, 0.45)}`,
      background: hexToRgba(c, 0.18),
      color: c,
      borderRadius: 999,
      fontSize: fs, fontWeight: 600,
    }}>{status}</span>
  );
}

export function ActionBtn({ children, primary, onClick, type = 'button', disabled, style: extraStyle }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      height: 30, padding: '0 12px',
      border: primary ? '1px solid var(--accent)' : '1px solid var(--border-2)',
      background: primary ? 'var(--accent)' : 'var(--bg-surface)',
      color: primary ? 'var(--accent-fg)' : 'var(--text-1)',
      borderRadius: 6,
      fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
      cursor: disabled ? 'not-allowed' : 'pointer',
      ...extraStyle,
    }}>{children}</button>
  );
}

export function FilterChip({ children }) {
  return (
    <div style={{
      height: 26, padding: '0 10px',
      border: '1px solid var(--border-2)', borderRadius: 999,
      background: 'var(--bg-surface)',
      display: 'inline-flex', alignItems: 'center',
      fontSize: 13, color: 'var(--text-1)',
      cursor: 'pointer',
    }}>{children}</div>
  );
}

export function InlineEdit({ value, onCommit, onCancel, style, title }) {
  const ref = React.useRef(null);
  const mountedAt = React.useRef(0);
  const done = React.useRef(false);
  const [v, setV] = React.useState(value == null ? '' : String(value));
  React.useEffect(() => {
    mountedAt.current = Date.now();
    const el = ref.current;
    if (el) { el.focus(); el.select(); }
  }, []);
  const commit = () => { if (done.current) return; done.current = true; onCommit(v); };
  const cancel = () => { if (done.current) return; done.current = true; (onCancel || (() => onCommit(value)))(); };
  return (
    <input
      ref={ref}
      value={v}
      title={title}
      onChange={(e) => setV(e.target.value)}
      onBlur={(e) => {
        if (!e.relatedTarget && Date.now() - mountedAt.current < 250) {
          if (ref.current) ref.current.focus();
          return;
        }
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      style={style}
    />
  );
}

export function SettingTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--text-1)' }}>{children}</div>
      {sub && <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function SettingRow({ label, hint, children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      padding: '14px 0',
      borderBottom: '1px solid var(--border-1)',
      gap: 24,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export function Seg({ options, value, onChange, equal }) {
  return (
    <div style={{
      display: equal ? 'flex' : 'inline-flex',
      width: equal ? '100%' : undefined,
      border: '1px solid var(--border-2)', borderRadius: 6,
      overflow: 'hidden',
      background: 'var(--bg-surface)',
    }}>
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          style={{
            padding: '8px 12px',
            flex: equal ? 1 : undefined,
            textAlign: equal ? 'center' : undefined,
            background: value === o.value ? 'var(--accent)' : 'transparent',
            color: value === o.value ? 'var(--accent-fg)' : 'var(--text-1)',
            border: 'none', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}

export const miniBtnStyle = {
  height: 20, padding: '0 5px',
  background: 'var(--bg-canvas)', border: '1px solid var(--border-1)',
  borderRadius: 4, fontFamily: 'inherit', fontSize: 11, color: 'var(--text-2)',
  cursor: 'pointer', flexShrink: 0, lineHeight: 1,
};

// Reusable up/down reorder buttons. Used by Workflow editors (phases,
// statuses, PMs, types, techs) and any future ordered list.
export function ReorderBtns({ onUp, onDown, disableUp, disableDown }) {
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
      <button onClick={onUp}   style={miniBtnStyle} disabled={disableUp}>{'▲'}</button>
      <button onClick={onDown} style={miniBtnStyle} disabled={disableDown}>{'▼'}</button>
    </span>
  );
}

// Generic swap helper for ordered arrays. Returns a new array.
export function swapAt(arr, i, j) {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
