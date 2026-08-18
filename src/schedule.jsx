// Schedule module, carved out of app.jsx. Read-only calendar (day / week /
// month) over every WO that carries a schedule, plus the DayTimeline rail used
// by the WO command center. Shared WO helpers import from app.jsx (live ES
// bindings; app.jsx <-> schedule.jsx cycle is eval-safe).
import React from 'react';
import { statusColor } from './constants.js';
import { isLiveSchedule, weekDays, monthGrid, groupByScheduleDate } from './orders-logic.js';
import { TypeIcon, Seg } from './primitives.jsx';
import {
  splitAddress, typeLetter, isOverdueSched, OVERDUE_CFG,
  navBtnStyle, HeaderChips,
  itinTodayStr, itinShiftDay, itinSlots, itinSnapSlot, itinFmtTime,
  itinDayLabel, itinDayMonth,
} from './app.jsx';

// Read-only day timeline for the command-center right rail. Shows the WO's
// assigned tech's full scheduled day (the WO's schedule date), auto-scrolled to
// the WO's slot and ring-highlighted; "Open in Schedule" jumps to the full
// module. Not scheduled -> a "Not Scheduled" placeholder + jump to schedule.
// Keeps the fixed 30-min slot rail (itinSlots/itinSnapSlot); the calendar
// module below deliberately does NOT.
export function DayTimeline({ wo, activeOrders, statusColors, statusTags, onOpenItinerary }) {
  const highlightRef = React.useRef(null);
  const scheduled = !!(wo && wo.schedule && wo.schedule.date);
  const tech = wo && wo.tech;
  const date = scheduled ? wo.schedule.date : null;
  const slots = React.useMemo(() => itinSlots(), []);
  const tags = statusTags || {};
  // Pinned to this WO's tech; `visited`-tagged statuses drop off the day.
  const dayScheduled = React.useMemo(
    () => (scheduled
      ? (activeOrders || []).filter(o => o.schedule && o.schedule.date === date && o.tech === tech && tags[o.status] !== 'visited')
      : []),
    [activeOrders, date, tech, scheduled, tags]
  );
  const scheduledBySlot = React.useMemo(() => {
    const map = {};
    for (const o of dayScheduled) { const s = itinSnapSlot(o.schedule.start); (map[s] = map[s] || []).push(o); }
    return map;
  }, [dayScheduled]);
  // Scroll the WO's card into view once it renders (the inset is the scroll parent).
  React.useEffect(() => {
    if (scheduled && highlightRef.current) highlightRef.current.scrollIntoView({ block: 'center' });
  }, [wo && wo.id, scheduled, dayScheduled.length]);

  const card = (o) => {
    const { addr, city } = splitAddress(o);
    const isHi = wo && o.id === wo.id;
    return (
      <div key={o.id} ref={isHi ? highlightRef : undefined} style={{
        border: '1px solid var(--border-1)', borderLeft: '4px solid ' + statusColor(o.status, statusColors),
        borderRadius: 8, background: 'var(--bg-surface)', padding: '6px 8px', fontSize: 12,
        display: 'flex', flexDirection: 'column', gap: 2,
        boxShadow: isHi ? '0 0 0 2px var(--accent)' : 'none',
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{o.id}</span>
          {o.emergency && <span style={{ color: 'var(--danger, #d9534f)', fontWeight: 700 }}>!</span>}
          <TypeIcon kind={typeLetter(o.type)} />
          {o.schedule && o.schedule.start && (
            <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums',
              color: isOverdueSched(o.schedule.date, o.schedule.start) ? OVERDUE_CFG.textColor : 'var(--text-2)' }}>
              ◷ {itinFmtTime(o.schedule.start)}
            </span>
          )}
        </div>
        <div style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {addr || '(no address)'}{city ? ', ' + city : ''}
        </div>
      </div>
    );
  };

  const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' };
  const jumpBtn = onOpenItinerary && wo && (
    <button onClick={() => onOpenItinerary(wo.id)} style={{
      height: 22, padding: '0 8px', border: '1px solid var(--border-2)', borderRadius: 6,
      background: 'var(--bg-surface-2)', color: 'var(--accent)', fontFamily: 'inherit',
      fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
    }}>Open in Schedule →</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px 12px', borderTop: '1px solid var(--border-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={labelStyle}>Schedule</span>
        {jumpBtn}
      </div>
      {!scheduled ? (
        <div style={{ height: 160, borderRadius: 8, border: '1px dashed var(--border-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, fontWeight: 600 }}>
          Not Scheduled
        </div>
      ) : (<>
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{itinDayLabel(date)} · {tech || 'Unassigned'}</div>
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border-1)', borderRadius: 8 }}>
          {slots.map(slot => {
            const blocks = scheduledBySlot[slot] || [];
            return (
              <div key={slot} style={{ display: 'flex', alignItems: 'stretch', borderTop: '1px solid var(--border-1)', minHeight: 30 }}>
                <div style={{ width: 64, flexShrink: 0, padding: '4px 6px', fontSize: 11, color: 'var(--text-3)',
                  textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{itinFmtTime(slot)}</div>
                <div style={{ flex: 1, padding: '3px 8px 3px 4px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {blocks.map(card)}
                </div>
              </div>
            );
          })}
        </div>
      </>)}
    </div>
  );
}

// Read-only calendar over every WO that carries a schedule (NOT just active
// ones: S1 retention keeps schedules on completed WOs, so past days still read
// as history -- not-live jobs just render muted). Day / Week / Month; week is
// seven stacked day columns, not an hour grid. No drag, no drop, no inline
// reschedule: clicking a card opens the WO command center over this module.
export function ScheduleModule({ orders, techs, statusColors, statusTags, tech, setTech, focus, onClearFocus, onOpenWO }) {
  const [view, setView] = React.useState('week');
  const [anchor, setAnchor] = React.useState(itinTodayStr());
  const [highlightId, setHighlightId] = React.useState(null);
  const highlightRef = React.useRef(null);
  const today = itinTodayStr();
  const isAll = tech === 'ALL';

  React.useEffect(() => { if (techs.length && tech !== 'ALL' && !techs.includes(tech)) setTech(techs[0]); }, [techs, tech]);

  // Apply any pending focus (jump-from-WO, Maps route send, module-entry
  // auto-tech) exactly once. App clears it via onClearFocus so a later remount
  // does not re-apply it and override the user's manual tech pick.
  //
  // The dep list is WIDE on purpose. The ts guard on the first line is what
  // makes "exactly once" true, not a narrow dep list: any re-run triggered by
  // techs/setTech/onClearFocus changing returns immediately because focus.ts is
  // no longer greater than lastFocusTs. A narrow list bought nothing and cost
  // correctness -- the effect could close over a stale `techs` array and get
  // techs.includes(focus.tech) wrong, silently dropping the tech switch.
  const lastFocusTs = React.useRef(0);
  React.useEffect(() => {
    if (!focus || !focus.ts || focus.ts <= lastFocusTs.current) return;
    lastFocusTs.current = focus.ts;
    if (focus.tech && techs.includes(focus.tech)) setTech(focus.tech);
    if (focus.date) setAnchor(focus.date);
    if (focus.highlightId != null) setHighlightId(focus.highlightId);
    if (onClearFocus) onClearFocus();
  }, [focus && focus.ts, techs, setTech, setAnchor, setHighlightId, onClearFocus]);

  // Scroll the highlighted card into view once it renders. Cards mount
  // unconditionally (no render guard), so the ref is attached by the time this
  // effect runs for whatever range/tech the focus moved us to.
  React.useEffect(() => {
    if (highlightId != null && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightId, anchor, view, tech]);

  const byDate = React.useMemo(() => groupByScheduleDate(orders), [orders]);
  const jobsOn = React.useCallback((d) => {
    const list = byDate[d] || [];
    return isAll ? list : list.filter(o => (o.tech || '') === tech);
  }, [byDate, isAll, tech]);

  const days = view === 'day' ? [anchor] : view === 'week' ? weekDays(anchor) : monthGrid(anchor);
  const total = days.reduce((n, d) => n + jobsOn(d).length, 0);

  // prev/next steps one day, one week or one month depending on the view.
  const step = (dir) => {
    if (view === 'day')  return setAnchor(itinShiftDay(anchor, dir));
    if (view === 'week') return setAnchor(itinShiftDay(anchor, dir * 7));
    const [y, mo] = anchor.split('-').map(Number);
    const dt = new Date(y, mo - 1 + dir, 1, 12);
    setAnchor(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-01');
  };

  const rangeLabel = view === 'day' ? itinDayLabel(anchor)
    : view === 'week' ? itinDayMonth(days[0]) + ' - ' + itinDayMonth(days[6])
    : (() => {
      const [y, mo] = anchor.split('-').map(Number);
      return new Date(y, mo - 1, 1, 12).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    })();

  const weekdayOf = (d) => {
    const [y, mo, dd] = String(d).split('-').map(Number);
    return new Date(y, mo - 1, dd, 12).toLocaleDateString(undefined, { weekday: 'short' });
  };
  const colHeadStyle = (d) => ({
    padding: '4px 6px', fontSize: 11, fontWeight: 700, textAlign: 'center',
    borderBottom: '1px solid var(--border-1)',
    color: d === today ? 'var(--accent)' : 'var(--text-3)',
    background: d === today ? 'var(--bg-row-sel)' : 'transparent',
  });

  // One shared card renderer. A plain function returning JSX, NOT a component
  // defined inside render (that would remount the card on every parent render
  // and drop the highlight ref).
  const card = (o, compact) => {
    const live = isLiveSchedule(o, statusTags);
    const isHi = highlightId != null && o.id === highlightId;
    const { city } = splitAddress(o);
    return (
      <div key={o.id} ref={isHi ? highlightRef : undefined}
        onClick={() => onOpenWO && onOpenWO(o.id)}
        title={o.id + (city ? ' - ' + city : '') + (o.tech ? ' - ' + o.tech : '')}
        style={{
          border: '1px solid var(--border-1)', borderLeft: '4px solid ' + statusColor(o.status, statusColors),
          borderRadius: 6, background: 'var(--bg-surface)', cursor: 'pointer',
          padding: compact ? '2px 4px' : '5px 7px', fontSize: compact ? 11 : 12,
          display: 'flex', flexDirection: 'column', gap: compact ? 0 : 2,
          opacity: live ? 1 : 0.5, boxShadow: isHi ? '0 0 0 2px var(--accent)' : 'none',
          overflow: 'hidden',
        }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap' }}>
          {o.schedule.start && (
            <span style={{ fontVariantNumeric: 'tabular-nums',
              color: live && isOverdueSched(o.schedule.date, o.schedule.start) ? OVERDUE_CFG.textColor : 'var(--text-2)' }}>
              {itinFmtTime(o.schedule.start)}
            </span>
          )}
          <span style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, background: statusColor(o.status, statusColors) }} />
          <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.id}</span>
          {!compact && <TypeIcon kind={typeLetter(o.type)} />}
        </div>
        {!compact && (
          <div style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {city || '(no city)'}{isAll && o.tech ? ' - ' + o.tech : ''}
          </div>
        )}
      </div>
    );
  };

  const emptyLine = <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>No jobs scheduled</div>;

  return (
    <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: '10px 18px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
            Schedule
          </div>
          <button onClick={() => step(-1)} style={navBtnStyle}>&lsaquo;</button>
          <button onClick={() => setAnchor(today)} style={navBtnStyle}>Today</button>
          <button onClick={() => step(1)} style={navBtnStyle}>&rsaquo;</button>
          <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
            {rangeLabel} - {isAll ? 'All techs' : tech} - {total} job{total === 1 ? '' : 's'}
          </div>
          <Seg
            options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]}
            value={view}
            onChange={setView}
          />
          <select value={tech} onChange={(e) => setTech(e.target.value)} style={{
            padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border-1)',
            background: 'var(--bg-surface)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13,
          }}>
            <option value="ALL">All techs</option>
            {techs.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ flex: 1 }} />
          <HeaderChips />
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
        {view === 'day' && (
          <div style={{ border: '1px solid ' + (anchor === today ? 'var(--accent)' : 'var(--border-1)'),
            borderRadius: 8, background: 'var(--bg-surface)' }}>
            <div style={colHeadStyle(anchor)}>{itinDayLabel(anchor)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 6 }}>
              {jobsOn(anchor).length ? jobsOn(anchor).map(o => card(o, false)) : emptyLine}
            </div>
          </div>
        )}

        {view === 'week' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 6 }}>
            {days.map(d => (
              <div key={d} style={{
                border: '1px solid ' + (d === today ? 'var(--accent)' : 'var(--border-1)'),
                borderRadius: 8, background: 'var(--bg-surface)', minHeight: 120,
                display: 'flex', flexDirection: 'column', minWidth: 0,
              }}>
                <div style={colHeadStyle(d)}>{weekdayOf(d)} {itinDayMonth(d)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 5 }}>
                  {jobsOn(d).map(o => card(o, false))}
                </div>
              </div>
            ))}
            {total === 0 && <div style={{ gridColumn: '1 / -1' }}>{emptyLine}</div>}
          </div>
        )}

        {view === 'month' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
            {days.map(d => {
              const jobs = jobsOn(d);
              const inMonth = d.slice(0, 7) === anchor.slice(0, 7);
              return (
                <div key={d} onClick={() => { setAnchor(d); setView('day'); }} style={{
                  border: '1px solid ' + (d === today ? 'var(--accent)' : 'var(--border-1)'),
                  borderRadius: 6, background: 'var(--bg-surface)', minHeight: 84, cursor: 'pointer',
                  padding: 4, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0,
                  opacity: inMonth ? 1 : 0.45,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: d === today ? 'var(--accent)' : 'var(--text-3)' }}>
                    {Number(d.slice(8))}
                  </div>
                  {jobs.slice(0, 3).map(o => card(o, true))}
                  {jobs.length > 3 && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>+{jobs.length - 3} more</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
