// Schedule module, carved out of app.jsx. Read-only calendar (day / week /
// month) over every WO that carries a schedule, plus the DayTimeline rail used
// by the WO command center. Shared WO helpers import from app.jsx (live ES
// bindings; app.jsx <-> schedule.jsx cycle is eval-safe).
import React from 'react';
import { statusColor } from './constants.js';
import {
  isLiveSchedule, weekDays, monthGrid, groupByScheduleDate,
  groupNotesByDate, backlogNotes, noteToEntryForm,
} from './orders-logic.js';
import { TypeIcon, Seg, ActionBtn } from './primitives.jsx';
import {
  splitAddress, typeLetter, isOverdueSched, OVERDUE_CFG,
  navBtnStyle, HeaderChips, Modal,
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

// remindAt is stored as epoch ms; a datetime-local input speaks
// 'YYYY-MM-DDTHH:MM' in LOCAL time (no offset suffix), which Date.parse reads
// back as local. Empty string both ways means "no reminder".
function msToLocalInput(ms) {
  if (typeof ms !== 'number') return '';
  const d = new Date(ms), pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
    + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function localInputToMs(v) {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

// Create / edit one schedule entry. `entry` is the entry-form VIEW of a note
// (noteToEntryForm) or a draft ({ kind, date }) minted by the caller -- an id
// means edit, no id means create. Field rules (undated tasks only, time format)
// and the kind -> flags mapping are enforced by normalizeNote on the way into
// the store, not here; this form only collects.
// Admin S1: notes have no title field, so `title` is the body's first line;
// normalizeNote folds the two back together.
function EntryModal({ entry, techs, orders, onSave, onDelete, onClose }) {
  const [kind, setKind] = React.useState(entry.kind || 'task');
  const [title, setTitle] = React.useState(entry.title || '');
  const [body, setBody] = React.useState(entry.body || '');
  const [date, setDate] = React.useState(entry.date || '');
  const [start, setStart] = React.useState(entry.start || '');
  const [end, setEnd] = React.useState(entry.end || '');
  const [tech, setTech] = React.useState(entry.tech || '');
  const [woId, setWoId] = React.useState(entry.woId || '');
  const [remindAt, setRemindAt] = React.useState(msToLocalInput(entry.remindAt));
  const isEdit = !!entry.id;

  const fld = {
    display: 'block', marginTop: 4, width: '100%', padding: '8px', borderRadius: 8,
    border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box',
  };
  const lbl = { fontSize: 12, color: 'var(--text-3)' };
  // An event occupies a day, so it cannot be saved undated; the store would
  // default it to today anyway. Say so instead of silently moving it.
  const dateMissing = kind !== 'task' && !date;
  const canSave = !!title.trim() && !dateMissing;

  return (
    <Modal open onClose={onClose} title={isEdit ? 'Edit entry' : 'New entry'} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Seg
          options={[{ value: 'task', label: 'Task' }, { value: 'event', label: 'Event' }, { value: 'reminder', label: 'Reminder' }]}
          value={kind}
          onChange={setKind}
        />
        <label style={lbl}>Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus style={fld} />
        </label>
        <label style={lbl}>{kind === 'task' ? 'Due date (blank = backlog)' : 'Day'}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={fld} />
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ ...lbl, flex: 1 }}>Start
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={fld} />
          </label>
          <label style={{ ...lbl, flex: 1 }}>End
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={fld} />
          </label>
        </div>
        <label style={lbl}>Remind me (blank = no reminder)
          <input type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} style={fld} />
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ ...lbl, flex: 1 }}>Tech
            <select value={tech} onChange={(e) => setTech(e.target.value)} style={fld}>
              <option value="">(anyone)</option>
              {(techs || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={{ ...lbl, flex: 1 }}>Work order
            <input value={woId} onChange={(e) => setWoId(e.target.value)} list="entry-wo-ids" placeholder="WO #" style={fld} />
            <datalist id="entry-wo-ids">
              {(orders || []).slice(0, 400).map(o => <option key={o.id} value={o.id} />)}
            </datalist>
          </label>
        </div>
        <label style={lbl}>Notes
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} style={{ ...fld, resize: 'vertical' }} />
        </label>
        {dateMissing && <div style={{ fontSize: 12, color: 'var(--danger, #d9534f)' }}>{kind === 'event' ? 'An event needs a day.' : 'A reminder needs a day.'}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {isEdit && <ActionBtn onClick={() => onDelete(entry.id)}>Delete</ActionBtn>}
          <ActionBtn onClick={onClose}>Cancel</ActionBtn>
          <ActionBtn primary disabled={!canSave}
            onClick={() => onSave({ kind, title, body, date: date || null, start: start || null, end: end || null, tech: tech || null, woId: woId || null, remindAt: localInputToMs(remindAt) })}>
            Save
          </ActionBtn>
        </div>
      </div>
    </Modal>
  );
}

// Read-only calendar over every WO that carries a schedule (NOT just active
// ones: S1 retention keeps schedules on completed WOs, so past days still read
// as history -- not-live jobs just render muted). Day / Week / Month; week is
// seven stacked day columns, not an hour grid. No drag, no drop, no inline
// reschedule: clicking a card opens the WO command center over this module.
export function ScheduleModule({ orders, techs, statusColors, statusTags, tech, setTech, focus, onClearFocus, onOpenWO,
  notes, onAddNote, onUpdateNote, onDeleteNote }) {
  const [view, setView] = React.useState('week');
  // The entry being created or edited, or null. A draft (no id) means create.
  const [editing, setEditing] = React.useState(null);
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

  // Admin S1: the calendar reads the flat notes array. A note lands on a day
  // through flags.calendar.date or a task's flags.task.due; an undated task is
  // backlog. Notes with neither flag (WO notes, Admin jottings) never show here.
  const byEntryDate = React.useMemo(() => groupNotesByDate(notes), [notes]);
  // Notes with no tech are admin work that belongs to nobody in particular,
  // so they stay visible under every tech filter; a tech-tagged note hides
  // like a WO does.
  const entriesOn = React.useCallback((d) => {
    const list = byEntryDate[d] || [];
    return isAll ? list : list.filter(e => !e.tech || e.tech === tech);
  }, [byEntryDate, isAll, tech]);
  const backlog = React.useMemo(() => {
    const list = backlogNotes(notes);
    return isAll ? list : list.filter(e => !e.tech || e.tech === tech);
  }, [notes, isAll, tech]);

  const saveEntry = (fields) => {
    if (editing && editing.id) onUpdateNote && onUpdateNote(editing.id, fields);
    else onAddNote && onAddNote(fields);
    setEditing(null);
  };
  const removeEntry = (id) => { if (onDeleteNote) onDeleteNote(id); setEditing(null); };

  const days = view === 'day' ? [anchor] : view === 'week' ? weekDays(anchor) : monthGrid(anchor);
  const total = days.reduce((n, d) => n + jobsOn(d).length, 0);
  const entryTotal = days.reduce((n, d) => n + entriesOn(d).length, 0);

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
        onClick={(ev) => { ev.stopPropagation(); if (onOpenWO) onOpenWO(o.id); }}
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

  // Entry chip. Same "plain function returning JSX" rule as `card` above: not a
  // component defined in render. Clicking the row opens the editor; clicking a
  // task's checkbox only toggles done (stopPropagation), it must not open it.
  const entryChip = (note, compact) => {
    // The module edits and renders the entry-form VIEW of a note (kind picker,
    // title = first body line); normalizeNote maps it back to flags on save.
    const e = noteToEntryForm(note);
    const isTask = e.kind === 'task';
    return (
      <div key={e.id} onClick={(ev) => { ev.stopPropagation(); setEditing(e); }}
        title={e.title + (e.tech ? ' - ' + e.tech : '') + (e.woId ? ' - ' + e.woId : '')}
        style={{
          border: '1px dashed var(--border-2)', borderLeft: '4px solid ' + (isTask ? 'var(--text-3)' : 'var(--accent)'),
          borderRadius: 6, background: 'var(--bg-surface-2, var(--bg-surface))', cursor: 'pointer',
          padding: compact ? '2px 4px' : '4px 7px', fontSize: compact ? 11 : 12,
          display: 'flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
          opacity: e.done ? 0.5 : 1,
        }}>
        {isTask && (
          <input type="checkbox" checked={!!e.done} onClick={(ev) => ev.stopPropagation()}
            onChange={() => onUpdateNote && onUpdateNote(e.id, { ...e, done: !e.done })}
            style={{ margin: 0, cursor: 'pointer', flexShrink: 0 }} />
        )}
        {e.start && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }}>{itinFmtTime(e.start)}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: e.done ? 'line-through' : 'none' }}>
          {e.title || '(untitled)'}
        </span>
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
            {entryTotal ? ' - ' + entryTotal + (entryTotal === 1 ? ' entry' : ' entries') : ''}
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
          <button onClick={() => setEditing({ kind: 'task', date: view === 'day' ? anchor : '' })}
            title="Create a task or event" style={navBtnStyle}>+ New</button>
          <div style={{ flex: 1 }} />
          <HeaderChips />
        </div>
      </div>

      {/* Body: calendar on the left, the undated-task backlog pinned right. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 12 }}>
        {view === 'day' && (
          <div style={{ border: '1px solid ' + (anchor === today ? 'var(--accent)' : 'var(--border-1)'),
            borderRadius: 8, background: 'var(--bg-surface)' }}>
            <div style={colHeadStyle(anchor)}>{itinDayLabel(anchor)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 6 }}>
              {entriesOn(anchor).map(e => entryChip(e, false))}
              {jobsOn(anchor).map(o => card(o, false))}
              {!jobsOn(anchor).length && !entriesOn(anchor).length && emptyLine}
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
                  {entriesOn(d).map(e => entryChip(e, false))}
                  {jobsOn(d).map(o => card(o, false))}
                </div>
              </div>
            ))}
            {total === 0 && entryTotal === 0 && <div style={{ gridColumn: '1 / -1' }}>{emptyLine}</div>}
          </div>
        )}

        {view === 'month' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
            {days.map(d => {
              const jobs = jobsOn(d);
              const ents = entriesOn(d);
              // Cell is short: at most 2 entries + 3 jobs, the rest rolls into "+N more".
              const hidden = Math.max(0, ents.length - 2) + Math.max(0, jobs.length - 3);
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
                  {ents.slice(0, 2).map(e => entryChip(e, true))}
                  {jobs.slice(0, 3).map(o => card(o, true))}
                  {hidden > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>+{hidden} more</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Backlog: undated tasks. Dating one (in the editor) moves it onto the
          calendar; there is no drag target, by design. */}
      <aside style={{ width: 240, flexShrink: 0, borderLeft: '1px solid var(--border-1)',
        display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid var(--border-1)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Backlog
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{backlog.length}</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setEditing({ kind: 'task', date: '' })} title="Add an undated task"
            style={{ ...navBtnStyle, padding: '2px 8px' }}>+</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {backlog.length
            ? backlog.map(e => entryChip(e, false))
            : <div style={{ padding: 10, color: 'var(--text-3)', fontSize: 12 }}>No undated tasks</div>}
        </div>
      </aside>
      </div>

      {editing && (
        <EntryModal
          entry={editing}
          techs={techs}
          orders={orders}
          onSave={saveEntry}
          onDelete={removeEntry}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
