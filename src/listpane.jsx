// Work-order list pane, carved out of app.jsx: ListPane + PhaseHeader +
// ListRow (filter/sort/group + per-row render + right-click menu). Shared
// helpers import from app.jsx (live-binding cycle, eval-safe). App renders
// ListPane.
import React from 'react';
import { densityFor, statusColor } from './constants.js';
import { usePMs, useStatusColors } from './contexts.js';
import { Dot, PMChip, TypeIcon, FlagGlyph, ReorderBtns, swapAt } from './primitives.jsx';
import {
  FilterDropdown, SortDropdown, BulkBar, WOContextMenu, sortRows, TT_VIEW_DATA,
  isOverdueSched, OVERDUE_CFG, fmtSchedule,
} from './app.jsx';

export function ListPane({ selectedWO, onSelectWO, onHighlightWO, onVisibleRows, view = 'active', data, phases, density, sort, setSort, query, setQuery, filters, setFilters, isPresetView, isInboxView, onSaveView, bulkActions, selectedIds, onCheck, onClearSelection, statuses, onWoAction, onBulkSetStatus, types, techs, inboxes, onAddToNewInbox, onAddToInbox, onRemoveFromInbox, onReorderInbox, onSelectView, alerts = [] }) {
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
  // PM/Client pill removed: client filtering moved to the Gmail-style sidebar
  // (cl: views). filters.pm is still honored (set by the sidebar) -- just no pill.
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

  // Report the current visible (post filter/sort/collapse) row order up so the
  // command center's prev/next walk the exact same order the user sees. flatRows
  // is a fresh array ref each render; only push when the CONTENT changes, else
  // the parent setState would re-render us in a loop.
  const lastRowsRef = React.useRef(null);
  React.useEffect(() => {
    if (!onVisibleRows) return;
    const key = flatRows.join('');
    if (key === lastRowsRef.current) return;
    lastRowsRef.current = key;
    onVisibleRows(flatRows);
  }, [flatRows, onVisibleRows]);

  React.useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Enter opens the command center for the highlighted row.
      if (e.key === 'Enter') { if (selectedWO) { e.preventDefault(); onSelectWO(selectedWO); } return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if (!flatRows.length) return;
      e.preventDefault();
      const idx = selectedWO ? flatRows.indexOf(selectedWO) : -1;
      let next;
      if (e.key === 'ArrowDown') next = idx < 0 ? 0 : (idx + 1) % flatRows.length;
      else                       next = idx <= 0 ? flatRows.length - 1 : idx - 1;
      // Arrows highlight only (no overlay pop); when the overlay is already open
      // changing selectedWO restacks it. Falls back to onSelectWO if no handler.
      (onHighlightWO || onSelectWO)(flatRows[next]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flatRows, selectedWO, onSelectWO, onHighlightWO]);

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
  const colors = useStatusColors();
  const sc = statusColor(row.status, colors);
  // Age moved from a row-background tint to a colored "Xd" counter. Escalating
  // warmth by ageLevel; level 3 reuses the emergency hue.
  const ageHidden = hideAge || row.age == null;
  const ageColor = ageHidden ? 'var(--text-2)' :
    row.ageLevel === 3 ? 'var(--flag-emergency)' :
    row.ageLevel === 2 ? '#e8843c' :
    row.ageLevel === 1 ? '#d9a441' : 'var(--text-2)';
  const d = densityFor(density);
  // Status-colored left bar replaces the in-row pill (kept in the modal). Sent
  // rows (Invoices) drop it; that module renders status itself.
  const showStatus = view !== 'sent' && statusMode !== 'hidden';
  // Change indicator: new/changed WOs stay tinted + chipped until opened.
  const unseen = row.unseen;
  const unseenBg = !unseen ? null
    : unseen.kind === 'new' ? 'color-mix(in srgb, var(--accent) 13%, transparent)'
    : 'color-mix(in srgb, #d9a441 13%, transparent)';
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
        background: (checked || selected) ? 'var(--bg-row-sel)' : (unseenBg || 'transparent'),
        borderBottom: '1px solid var(--border-2)',
        borderLeft: '4px solid ' + (showStatus ? sc : 'transparent'),
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
          {unseen && (
            <span title={unseen.kind === 'changed' && unseen.fields?.length ? 'Changed: ' + unseen.fields.join(', ') : 'New work order'}
              style={{
                flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                padding: '1px 5px', borderRadius: 4, whiteSpace: 'nowrap',
                background: unseen.kind === 'new' ? 'var(--accent)' : '#d9a441', color: '#fff',
              }}>{unseen.kind === 'new' ? 'NEW' : 'UPDATED'}</span>
          )}
          {row.flags?.map((f) => <FlagGlyph key={f} kind={f} />)}
          {(row.city || row.age != null) && (
            <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              {row.city && <span style={{ color: 'var(--text-2)', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>{row.city}</span>}
              {row.age != null && (
                <span title="Days in stage" style={{ fontSize: 13, fontWeight: row.ageLevel ? 700 : 400, color: ageColor, fontVariantNumeric: 'tabular-nums' }}>{row.age}</span>
              )}
            </div>
          )}
        </div>
        {/* Meta row: status · PM · type · tech | WO# right-aligned.
            change11: Status pill hidden in sent (Invoices module shows it). */}
        <div style={{ fontSize: d.line2, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {showStatus && <>
            <span style={{ color: sc, fontWeight: 600 }}>{row.status}</span>
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
