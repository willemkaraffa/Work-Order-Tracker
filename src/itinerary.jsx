// Itinerary module, carved out of app.jsx. Day/tech timeline + unscheduled
// pool with drag-to-schedule. Shared WO helpers + WOContextMenu import from
// app.jsx (live ES bindings; app.jsx <-> itinerary.jsx cycle is eval-safe).
import React from 'react';
import { statusColor } from './constants.js';
import { formatPhone } from './utils.js';
import { Dot, PMChip, TypeIcon } from './primitives.jsx';
import {
  splitAddress, typeLetter, isOverdueSched, OVERDUE_CFG, fmtSchedule,
  useCollapsedSection, navBtnStyle, WOContextMenu, HeaderChips, CollapsibleSection,
  itinTodayStr, itinShiftDay, itinSlots, itinSnapSlot, itinFmtTime,
  itinDayLabel, itinDayMonth,
} from './app.jsx';

export function ItineraryModule({ activeOrders, techs, phases, statusColors, statusTags, focus, tech, setTech, onClearFocus, onSetSchedule, onOpenWO, statuses, types, pms, inboxes, onWoAction, onAddToInbox, onAddToNewInbox, onRemoveFromInbox }) {
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
    if (focus.highlightId != null) {
      setHighlightId(focus.highlightId);
      // Unscheduled target lives in the pool; open it so the card renders and
      // the scroll-into-view effect can reach it.
      const u = activeOrders.find(o => o.id === focus.highlightId && !o.schedule);
      if (u && !poolOpen) togglePool();
    }
    if (onClearFocus) onClearFocus();
  }, [focus && focus.ts]);

  // Scroll the highlighted card into view once it renders.
  React.useEffect(() => {
    if (highlightId != null && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightId, date, tech, poolOpen]);

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
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Itinerary
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', marginLeft: 8 }}>
            {itinDayLabel(date)} · {isAll ? 'All techs' : tech} · {scheduledCount} job{scheduledCount === 1 ? '' : 's'}
          </div>
          <div style={{ flex: 1 }} />
          <HeaderChips />
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
