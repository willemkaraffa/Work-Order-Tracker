// Schedule module, carved out of app.jsx. Read-only calendar (day / week /
// month) over every WO that carries a schedule, plus the DayTimeline rail used
// by the WO command center. Shared WO helpers import from app.jsx (live ES
// bindings; app.jsx <-> schedule.jsx cycle is eval-safe).
import React from 'react';
import { statusColor, FLAG_COLORS } from './constants.js';
import {
  isLiveSchedule, weekDays, monthGrid, groupByScheduleDate, deriveMilestones,
  groupNotesByDate, backlogNotes, scratchpadNotes, noteTitle, orderMatchesQuery,
  noteMatchesQuery, clientTree, noteTreeKeys, notesForOrder, isImportedNote,
  journalFolders,
} from './orders-logic.js';
import { useTypeToSearch } from './search-hook.js';
import { TypeIcon, Seg, ActionBtn, BinderTabs, NoteFlagBtn } from './primitives.jsx';
import {
  splitAddress, typeLetter, isOverdueSched, OVERDUE_CFG,
  navBtnStyle, HeaderChips, Modal, confirmDialog,
  itinTodayStr, itinShiftDay, itinFmtTime, fmtHistTime,
  itinDayLabel, itinDayMonth,
} from './app.jsx';

// Read-only schedule summary for the command-center right rail: the WO's day
// and tech (click to jump to the full Schedule module) plus a Milestones
// disclosure derived from o.history. Not scheduled -> the "Not Scheduled"
// placeholder, which keeps the explicit jump button because it has no headline
// to click. The 30-min slot rail is gone: the rest of the tech's day belongs to
// the Schedule module, this rail answers "where is THIS WO".
export function DayTimeline({ wo, phases, onOpenItinerary }) {
  const scheduled = !!(wo && wo.schedule && wo.schedule.date);
  const tech = wo && wo.tech;
  const date = scheduled ? wo.schedule.date : null;
  const [msOpen, setMsOpen] = React.useState(false);
  const hist = wo && wo.history;
  // Derived every render, never stored. See deriveMilestones.
  const milestones = React.useMemo(() => deriveMilestones(wo, phases), [wo, hist, phases]);

  const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' };
  const headline = itinDayLabel(date) + ' · ' + (tech || 'Unassigned');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px 12px', borderTop: '1px solid var(--border-1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={labelStyle}>Schedule</span>
        {!scheduled && onOpenItinerary && wo && (
          <button onClick={() => onOpenItinerary(wo.id)} style={{
            height: 22, padding: '0 8px', border: '1px solid var(--border-2)', borderRadius: 6,
            background: 'var(--bg-surface-2)', color: 'var(--accent)', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>Open in Schedule →</button>
        )}
      </div>
      {!scheduled ? (
        <div style={{ height: 160, borderRadius: 8, border: '1px dashed var(--border-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13, fontWeight: 600 }}>
          Not Scheduled
        </div>
      ) : onOpenItinerary ? (
        // The headline IS the jump when there is one; degrades to plain text
        // when no handler was passed.
        <button onClick={() => onOpenItinerary(wo.id)} title="Open in Schedule" style={{
          background: 'transparent', border: 'none', padding: '0', textAlign: 'left',
          color: 'var(--accent)', fontFamily: 'inherit', fontSize: 12, cursor: 'pointer',
        }}>{headline}</button>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{headline}</div>
      )}
      {/* Collapsed by default, same idiom as DetailPane's activity log. */}
      <div>
        <button onClick={() => setMsOpen(o => !o)} title={msOpen ? 'Hide milestones' : 'Show milestones'} style={{
          width: '100%', height: 26, padding: 0, display: 'flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: 'none', color: 'var(--text-2)', fontFamily: 'inherit',
          fontSize: 12, fontWeight: 600, cursor: 'pointer', letterSpacing: '0.02em',
        }}>
          <span style={{ fontSize: 11 }}>{msOpen ? '▾' : '▸'}</span>
          <span>Milestones</span>
          {milestones.length > 0 && <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>· {milestones.length}</span>}
        </button>
        {msOpen && (
          <div style={{ border: '1px solid var(--border-1)', borderRadius: 8, padding: '6px 8px',
            maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12 }}>
            {milestones.map((m, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span style={{ color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtHistTime(m.ts)}</span>
                <span style={{ marginLeft: 'auto', textAlign: 'right', color: 'var(--text-1)' }}>{m.label}</span>
              </div>
            ))}
            {milestones.length === 0 && <div style={{ color: 'var(--text-3)' }}>No milestones yet.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// How long the pad waits after the last keystroke before it writes. RESETTING
// debounce, so continuous typing writes nothing until you pause; this delay IS
// the crash window.
//
// CRASH WINDOW, stated the way S2 states its own: a hard kill (power loss,
// task-kill) between the last keystroke and the next idle tick loses at most
// PAD_IDLE_MS of typing -- a few words -- plus whatever S2's disk debounce is
// still holding. createNoteWriter coalesces the trip to disk on its own
// NOTE_WRITE_MS timer and flushes on beforeunload, so an ordinary quit loses
// nothing and this timer only ever moves text into memory.
//
// 800ms is chosen to sit just past a natural typing pause (a comma, drawing
// breath mid-dictation) so the common case is one write per sentence rather
// than one per keystroke, while keeping the worst case to a fragment. Longer
// would buy fewer writes that S2 already coalesces anyway; shorter would write
// mid-word for no gain.
export const PAD_IDLE_MS = 800;

// ONE autosave discipline, shared by the Scratchpad pad AND the Journal editor.
// Written once on purpose (rule B3): two hand-rolled debounces drift, and the
// worst bug available in this design is a timer armed for note A firing after
// the editor has rebound to note B and writing A's text onto B's id. bind() and
// clear() FLUSH before they rebind, so a pending write can never outlive the
// note it belongs to.
//
// NOTEPAD KEYS everywhere: Enter is a newline, nothing about a keystroke saves,
// there is no Save button. Enter-to-save shipped in both editors and was
// rejected -- "messes me up sometimes as I forget shift+enter" -- and the hazard
// is identical in a side panel, so the Journal autosaves too.
//
//   onAdd          mint a new note and RETURN its id; null for an editor that
//                  only ever edits an existing note (the Journal panel)
//   onUpdate       patch an existing note; the patch is { body } and ONLY
//                  { body }, so updateNote's merge keeps ts, flags and woId and
//                  moves only `updated` -- the S1 rule that editing an old note
//                  never jumps it up the journal
//   detachOnBlank  true for the pad, where emptying it starts a NEW note;
//                  false for the Journal, where emptying it must not deselect
//
// flush() RETURNS the note's id on every path (null when there is none yet).
// That is what mint-then-flag rides on: one call both writes the pad and hands
// back the id to flag, with no second save path.
function useAutosave(onAdd, onUpdate, detachOnBlank) {
  const [text, setText] = React.useState('');
  const [id, setId] = React.useState(null);
  // ref is the TIMER'S ECHO of text/id, not a second source of truth: a fired
  // timeout and an unmount cleanup both read a render closure that is already
  // stale by the time they run, and every path below writes state and ref
  // together. `saved` is the last text actually WRITTEN, so a blur straight
  // after an idle tick cannot rewrite the same string -- that guard is what
  // keeps merely opening a note and clicking away from costing a store write.
  const ref = React.useRef({ body: '', id: null, saved: '' });
  const timer = React.useRef(null);
  const alive = React.useRef(true);

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = ref.current;
    const body = String(p.body || '').trim();
    if (!body) return ref.current.id;              // blank / whitespace-only writes nothing, ever
    if (body === p.saved) return ref.current.id;   // unchanged since the last write
    if (p.id) {
      if (onUpdate) onUpdate(p.id, { body });
      ref.current = { ...p, saved: body };
      return ref.current.id;
    }
    const minted = onAdd ? onAdd({ body }) : null;
    ref.current = { ...p, id: minted || null, saved: minted ? body : p.saved };
    // The mint can happen inside a fired timer or an unmount cleanup, so guard
    // the setState: React must not be told to update a component that is gone.
    if (minted && alive.current) setId(minted);
    return ref.current.id;
  };
  // Keep the unmount cleanup pointing at the LATEST flush. A cleanup declared
  // with [] would otherwise close over the mount render's props forever.
  const flushRef = React.useRef(flush);
  React.useEffect(() => { flushRef.current = flush; });
  // A7: the armed timer is cleared AND its debt is paid on unmount, so a module
  // switch or a tab close cannot strand a pending write.
  React.useEffect(() => () => {
    alive.current = false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    flushRef.current();
  }, []);

  const onChange = (ev) => {
    const body = ev.target.value;
    setText(body);
    const blank = !body.trim();
    if (detachOnBlank && blank) {
      // A pad emptied to blank DETACHES from its note: select-all-delete is how
      // a mouse starts a fresh note, and without this the next thing typed
      // would silently overwrite the note just finished. The old note keeps its
      // last saved text -- clearing the pad is not deleting a note.
      if (ref.current.id && alive.current) setId(null);
      ref.current = { body, id: null, saved: '' };
    } else {
      ref.current = { ...ref.current, body };
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; flushRef.current(); }, PAD_IDLE_MS);
  };

  // Load a saved note into the editor. FLUSHES FIRST, which is the whole point:
  // whatever was being written lands on ITS OWN id before the editor rebinds.
  const bind = (note) => {
    flush();
    const body = String((note && note.body) || '');
    setText(body); setId((note && note.id) || null);
    ref.current = { body, id: (note && note.id) || null, saved: body };
  };
  // Flush, then go back to a blank page / no selection. With autosave there is
  // no unsaved state to abandon, so discarding the tail would be data loss.
  const clear = () => {
    flush();
    setText(''); setId(null);
    ref.current = { body: '', id: null, saved: '' };
  };

  return { text, id, onChange, flush, bind, clear };
}

// ── Admin S4: the flag modals ───────────────────────────────────────────────
// A note gains meaning AFTER it is written, by flagging it. Locked decision 3:
// the modals are small, PER FLAG, and never one combined form. They only
// COLLECT fields -- the schema and every coercion live in normalizeFlags, so
// nothing here restates the shape.
//
// The contact flag is deliberately absent (S4 ruling 3: deferred to S7).
// normalizeFlags keeps tolerating a contact key either way.

// ms epoch <-> the value a datetime-local input wants. Recovered from the
// pre-S3b EntryModal: Date.parse reads a bare local datetime string back as
// local. Empty string both ways means "no reminder".
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

// The house field/label look, also recovered from the deleted EntryModal.
const fld = {
  display: 'block', marginTop: 4, width: '100%', padding: '8px', borderRadius: 8,
  border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)',
  fontFamily: 'inherit', fontSize: 14, boxSizing: 'border-box',
};
const lbl = { fontSize: 12, color: 'var(--text-3)' };
const warnStyle = { fontSize: 12, color: 'var(--danger, #d9534f)' };

// One frame for all five modals: the Modal shell the EntryModal used, plus the
// only footer a flag ever needs. "Remove flag" shows only when the flag is
// already set, so the same modal both applies and clears it.
function FlagFrame({ title, isSet, canSave, onSave, onRemove, onClose, children }) {
  // The flag modals close on Escape (the user asked for it). Modal itself still
  // ignores Escape app-wide -- import and edit dialogs hold work that a stray
  // keypress must not discard. Here the cost is one unsaved field, and the
  // frame mounts only while open, so the listener exists only then. Cleanup
  // removes exactly what was added (A7). onClose is a fresh arrow per render at
  // the call sites, so it IS the honest dep: the listener rebinds with it
  // rather than closing over a stale close.
  React.useEffect(() => {
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Modal open onClose={onClose} title={title} width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {children}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {isSet && onRemove && <ActionBtn onClick={onRemove}>Remove flag</ActionBtn>}
          <ActionBtn onClick={onClose}>Cancel</ActionBtn>
          <ActionBtn primary disabled={canSave === false} onClick={onSave}>Save</ActionBtn>
        </div>
      </div>
    </Modal>
  );
}

// Every modal below seeds its fields from the note ONCE, in useState (rule A2:
// the caller mounts it only while it is open, on a note that already exists, so
// the initializer can never run against a null note and then go stale behind
// it). There is no effect re-syncing them back to the record -- that is A1.

function TaskFlagModal({ note, onSave, onRemove, onClose }) {
  const cur = (note.flags && note.flags.task) || null;
  const [done, setDone] = React.useState(!!(cur && cur.done));
  const [due, setDue] = React.useState((cur && cur.due) || '');
  return (
    <FlagFrame title="Task" isSet={!!cur} onClose={onClose} onRemove={onRemove}
      onSave={() => onSave({ done, due: due || null })}>
      <label style={{ ...lbl, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} />
        <span style={{ fontSize: 14, color: 'var(--text-1)' }}>Done</span>
      </label>
      <label style={lbl}>Due date (blank = backlog)
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={fld} />
      </label>
    </FlagFrame>
  );
}

function ReminderFlagModal({ note, onSave, onRemove, onClose }) {
  const cur = (note.flags && note.flags.reminder) || null;
  const [at, setAt] = React.useState(msToLocalInput(cur ? cur.at : null));
  // normalizeFlags drops a reminder whose `at` is not a number, so a blank
  // field would silently save nothing. Say so instead of writing nothing.
  const ms = localInputToMs(at);
  return (
    <FlagFrame title="Reminder" isSet={!!cur} canSave={ms !== null} onClose={onClose} onRemove={onRemove}
      onSave={() => onSave({ at: ms })}>
      <label style={lbl}>Remind me at
        <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} autoFocus style={fld} />
      </label>
      {ms === null && <div style={warnStyle}>A reminder needs a date and time.</div>}
    </FlagFrame>
  );
}

function CalendarFlagModal({ note, onSave, onRemove, onClose }) {
  const cur = (note.flags && note.flags.calendar) || null;
  // A calendar note OCCUPIES a day and can never be stored undated -- the store
  // defaults it to today anyway, so seed today rather than move it silently.
  const [date, setDate] = React.useState((cur && cur.date) || itinTodayStr());
  const [start, setStart] = React.useState((cur && cur.start) || '');
  const [end, setEnd] = React.useState((cur && cur.end) || '');
  return (
    <FlagFrame title="Calendar" isSet={!!cur} canSave={!!date} onClose={onClose} onRemove={onRemove}
      onSave={() => onSave({ date, start: start || null, end: end || null })}>
      <label style={lbl}>Day
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
      {!date && <div style={warnStyle}>A calendar note needs a day.</div>}
    </FlagFrame>
  );
}

// S4 ruling 1 added `po`; ruling 2 governs the address. `prefillAddress` is the
// linked WO's address, resolved by the caller. It only SEEDS an EMPTY field:
// the user can overwrite it, and whatever is in the field is what gets STORED,
// so the note stays self-contained if the WO's address later changes.
// Deliberately not derived at render, deliberately not read-only.
function PartsFlagModal({ note, prefillAddress, onSave, onRemove, onClose }) {
  const cur = (note.flags && note.flags.parts) || null;
  const [part, setPart] = React.useState((cur && cur.part) || '');
  const [status, setStatus] = React.useState((cur && cur.status) || '');
  const [distributor, setDistributor] = React.useState((cur && cur.distributor) || '');
  const [address, setAddress] = React.useState((cur && cur.address) || prefillAddress || '');
  const [po, setPo] = React.useState((cur && cur.po) || '');
  return (
    <FlagFrame title="Parts order" isSet={!!cur} onClose={onClose} onRemove={onRemove}
      onSave={() => onSave({
        part: part || null, status: status || null, distributor: distributor || null,
        address: address || null, po: po || null,
      })}>
      <label style={lbl}>Part
        <input value={part} onChange={(e) => setPart(e.target.value)} autoFocus style={fld} />
      </label>
      <div style={{ display: 'flex', gap: 10 }}>
        <label style={{ ...lbl, flex: 1 }}>Status
          <input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="ordered / in / picked up" style={fld} />
        </label>
        <label style={{ ...lbl, flex: 1 }}>PO / cost number
          <input value={po} onChange={(e) => setPo(e.target.value)} style={fld} />
        </label>
      </div>
      <label style={lbl}>Distributor
        <input value={distributor} onChange={(e) => setDistributor(e.target.value)} style={fld} />
      </label>
      <label style={lbl}>Ship-to address
        <input value={address} onChange={(e) => setAddress(e.target.value)} style={fld} />
      </label>
    </FlagFrame>
  );
}

// The WO link is a LINK, not a flag key: it writes note.woId. The picker
// filters with the SHIPPED orderMatchesQuery (WO number, address, city, client,
// tech) -- no new matcher.
function WoLinkModal({ note, orders, onPick, onClose }) {
  const [q, setQ] = React.useState('');
  const hits = React.useMemo(
    () => (orders || []).filter(o => orderMatchesQuery(o, q)).slice(0, 40),
    [orders, q]);
  return (
    <Modal open onClose={onClose} title="Link a work order" width={460}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={lbl}>Search by WO number, address, client or tech
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus style={fld} />
        </label>
        <div style={{ maxHeight: 260, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {hits.map(o => (
            <button key={o.id} type="button" onClick={() => onPick(o.id)} style={{
              textAlign: 'left', padding: '7px 9px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid ' + (o.id === note.woId ? 'var(--accent)' : 'var(--border-1)'),
              background: 'var(--bg-surface)', color: 'var(--text-1)',
              fontFamily: 'inherit', fontSize: 13,
            }}>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{o.id}</span>
              <span style={{ color: 'var(--text-2)' }}>{o.address ? ' - ' + o.address : ''}{o.city ? ', ' + o.city : ''}</span>
            </button>
          ))}
          {!hits.length && (
            <div style={{ padding: 8, color: 'var(--text-3)', fontSize: 12 }}>
              {q.trim() ? 'No work order matches that.' : 'Type to search.'}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {note.woId && <ActionBtn onClick={() => onPick(null)}>Unlink</ActionBtn>}
          <ActionBtn onClick={onClose}>Cancel</ActionBtn>
        </div>
      </div>
    </Modal>
  );
}

// J3: pick the accordion a NON-WO note sits in. Folders are DERIVED from the
// notes that cite them, so creating one is just typing a name on a note -- there
// is no folder list to keep in step, and a folder empties out of existence when
// its last note leaves. Jottings is the null bucket, never the string.
function FolderModal({ note, folderNames, onPick, onClose }) {
  const [name, setName] = React.useState('');
  const clean = name.trim();
  return (
    <Modal open onClose={onClose} title="Move this note" width={380}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={lbl}>New folder
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter' && clean) { e.preventDefault(); onPick(clean); } }}
            placeholder="Type a name, press Enter" style={fld} />
        </label>
        <div style={{ maxHeight: 220, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[null, ...folderNames].map(key => (
            <button key={key === null ? '(jottings)' : key} type="button" onClick={() => onPick(key)} style={{
              textAlign: 'left', padding: '7px 9px', borderRadius: 8, cursor: 'pointer',
              border: '1px solid ' + ((note.folder || null) === key ? 'var(--accent)' : 'var(--border-1)'),
              background: 'var(--bg-surface)', color: 'var(--text-1)',
              fontFamily: 'inherit', fontSize: 13,
            }}>{key === null ? 'Jottings' : key}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {clean && <ActionBtn onClick={() => onPick(clean)}>Create "{clean}"</ActionBtn>}
          <ActionBtn onClick={onClose}>Cancel</ActionBtn>
        </div>
      </div>
    </Modal>
  );
}

// The ADMIN module: a ring binder, not a calendar. Four sub-modules behind
// binder tabs -- Scratchpad (a full-height notepad, the landing tab), Journal
// (every note, newest first, with a pinned + undated-task quick-nav), Calendar
// (the read-only day/week/month view, which owns ALL the calendar chrome) and
// Contacts (S7).
//
// Admin S3b deleted EntryModal, the "+ New" button and the backlog rail by
// explicit ruling. S4 pays back the two capabilities it named as debt: a flag
// ROW on every note the module has selected (task / reminder / calendar /
// parts / journal / WO link, each behind its own small modal), ticking a task
// done straight off its calendar chip, and deleting a note from here.
// The note is the primitive; a calendar entry is one thing a note becomes, so
// a chip is no longer a dead end -- it opens the note in the Journal.
//
// The calendar still reads EVERY WO that carries a schedule, not just active
// ones: S1 retention keeps schedules on completed WOs, so past days read as
// history and not-live jobs just render muted.
export function ScheduleModule({ orders, techs, statusColors, statusTags, tech, setTech, focus, onClearFocus, onOpenWO,
  onOpenMaps, notes, onAddNote, onUpdateNote, onDeleteNote }) {
  // The binder tab. Lands on Scratchpad: writing is the point of the module.
  const [tab, setTab] = React.useState('scratchpad');
  // S5 slice 1: Month, not Week. Week packed too much into too small a cell for
  // a view opened infrequently; Month is what shows a job or note set for later.
  // Day and Week stay one click away in the Seg switch below.
  const [view, setView] = React.useState('month');
  const [anchor, setAnchor] = React.useState(itinTodayStr());
  const [highlightId, setHighlightId] = React.useState(null);
  const highlightRef = React.useRef(null);
  const today = itinTodayStr();
  const isAll = tech === 'ALL';

  // setTech is in the deps (rule A4): an effect that calls a function must
  // observe it. In practice app.jsx passes the setItinTech useState setter,
  // which React guarantees is stable, so this was a LATENT risk rather than a
  // live stale closure -- but the guarantee lives in the caller, not here, and
  // the day someone wraps it the omission would bite silently.
  React.useEffect(() => { if (techs.length && tech !== 'ALL' && !techs.includes(tech)) setTech(techs[0]); }, [techs, tech, setTech]);

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
    // S3b: the module lands on Scratchpad, so an inbound JUMP (WO command centre
    // "Open in Schedule", a Maps route send, jumpToSchedule) has to switch the
    // binder to the Calendar tab or it would silently land on the notepad.
    // Setting it HERE, in the same render pass that sets highlightId, is what
    // keeps the scroll-into-view effect below correct: the chip's ref is
    // attached by the time that effect re-runs (its dep list carries `tab`).
    // Only an explicit jump takes over the binder. The module-entry auto-snap
    // sets tech and day silently so the Calendar is already on the right day
    // when the user goes there; hijacking the tab made the module open on
    // Calendar instead of the Scratchpad it is supposed to land on.
    if (focus.jump) setTab('calendar');
    if (onClearFocus) onClearFocus();
  }, [focus && focus.ts, techs, setTech, setAnchor, setHighlightId, onClearFocus]);

  // Scroll the highlighted card into view once it renders. Cards mount
  // unconditionally (no render guard), so the ref is attached by the time this
  // effect runs for whatever range/tech the focus moved us to.
  React.useEffect(() => {
    if (highlightId != null && highlightRef.current) {
      highlightRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [highlightId, anchor, view, tech, tab]);

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
  // Admin S3 scratchpad: unflagged, WO-less jottings, newest first. Deliberately
  // NOT tech-filtered like entriesOn: a scratchpad note is by definition
  // unflagged and the composer cannot set a tech, so the filter could never bite.
  const scratch = React.useMemo(() => scratchpadNotes(notes), [notes]);
  // J1b: Tasks moved OFF the Journal rail and onto this one, and opens DEFAULT --
  // the pad is where work gets written down, so the open worklist is what the
  // rail should land on. Tasks is backlogNotes in ITS own order (open before
  // done, then oldest first); Jottings is scratchpadNotes, unchanged. Both
  // honour the search box.
  const [sFilter, setSFilter] = React.useState('tasks');
  const [sQuery, setSQuery] = React.useState('');
  const scratchShown = React.useMemo(() => {
    const base = sFilter === 'jottings' ? scratch : backlogNotes(notes);
    const q = sQuery.trim();
    if (!q) return base;
    return base.filter(n => noteMatchesQuery(n, n.woId ? (orders || []).find(o => o && o.id === n.woId) : null, q));
  }, [scratch, notes, sFilter, sQuery, orders]);

  // JOURNAL body: EVERY note, newest first, jottings included. Sorted on `ts`
  // (written-at), never `updated`, so editing an old note does not jump it --
  // the same S1 rule scratchpadNotes follows. Derived, so useMemo, never state.
  // J3's USER-NOTE RULE, applied ONCE here because every Admin surface derives
  // from this memo: the tree, both search boxes and the WO note pane. Portal-
  // imported WO information stays in the WO module's own detail pane, which
  // reads notesForOrder directly and is deliberately untouched.
  const journal = React.useMemo(() => (notes || [])
    .filter(n => n && n.id && !isImportedNote(n))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0) || String(b.id).localeCompare(String(a.id))),
  [notes]);
  const [jQuery, setJQuery] = React.useState('');
  const jSearchRef = React.useRef(null);
  // The box is a Journal filter, not a module-wide one: carrying its text to
  // another tab and back leaves the user staring at a filtered list they no
  // longer remember typing.
  React.useEffect(() => { setJQuery(''); setSQuery(''); }, [tab]);
  // Type-to-search, the same hook the other modules use. Disabled off the
  // Journal tab so a keystroke meant for the Scratchpad pad is never stolen.
  useTypeToSearch({ setValue: setJQuery, inputRef: jSearchRef, disabled: tab !== 'journal' });
  // J1 collapsed the Journal's two filters into one; J1b emptied it. Tasks left
  // for the Scratchpad rail and Pinned became a search KEYWORD, so All is what
  // the unfiltered rail shows and the search box is the filter over it.
  const navShown = React.useMemo(() => {
    const q = jQuery.trim();
    if (!q) return journal;
    return journal.filter(n => noteMatchesQuery(n, n.woId ? (orders || []).find(o => o && o.id === n.woId) : null, q));
  }, [journal, jQuery, orders]);

  // ── J2: the Clients tree ──────────────────────────────────────────────────
  // TWO options. J1b resettled Tasks onto the Scratchpad rail and Pinned into
  // the search box; J3 then retired All, which carried notes stripped of
  // context while the tree already searched the whole client note index.
  // JOURNAL took its place: the NON-WO notes, on the left, and the default.
  // Both lists are built from navShown, the SEARCH-FILTERED pool, so their
  // counts always match the list the user is looking at.
  const [jNav, setJNav] = React.useState('journal');
  const tree = React.useMemo(() => clientTree(navShown, orders), [navShown, orders]);
  const treeCount = React.useMemo(() => tree.reduce((n, c) => n + c.count, 0), [tree]);
  // THE COLLAPSE RULE. Every level starts collapsed (both null on mount), and
  // one branch is open at a time per level -- "the branch that was open last" is
  // literally what these two values hold. Deliberately NOT reset on tab change:
  // coming back to the Journal must land where the user left it. User input, so
  // real state, not a derived mirror (rule A1).
  const [openClient, setOpenClient] = React.useState(null);
  const [openProp, setOpenProp] = React.useState(null);
  // The selected WO#. Its notes fill the main pane until a note is picked out of
  // them, and picking from the All list clears it so a stale WO cannot sit
  // behind an unrelated note.
  const [jWo, setJWo] = React.useState(null);
  const jWoNotes = React.useMemo(() => notesForOrder(navShown, jWo), [navShown, jWo]);
  // J3: the Journal accordions. Jottings is the null bucket and always first;
  // user folders follow. Same collapse rule as the tree -- null on mount, one
  // open at a time -- so this tab opens as a short list of headers.
  const folders = React.useMemo(() => journalFolders(navShown), [navShown]);
  // J3: while a search is running, a collapsed row would hide its own matches,
  // so every row carrying one renders expanded. DERIVED, never stored: the
  // user's own collapse state stays untouched in openClient / openProp /
  // openFolder, so clearing the box restores it for free (rule A1).
  const searching = jQuery.trim() !== '';
  const folderCount = React.useMemo(() => folders.reduce((n, f) => n + f.notes.length, 0), [folders]);
  const [openFolder, setOpenFolder] = React.useState(null);
  // The open-state identity is NOT the bucket key: Jottings IS the null bucket,
  // and null is also this state's "nothing open" sentinel, so keying on it left
  // Jottings permanently expanded and made its collapse click a no-op.
  const folderId = (key) => (key === null ? '(jottings)' : key);
  const pickFolder = (key) => {
    const id = folderId(key);
    setOpenFolder(openFolder === id ? null : id);
  };
  // Every folder NAME in use, for the picker. Derived from the notes, so there
  // is no second list of folders to keep in step with the notes citing them.
  const folderNames = React.useMemo(() => folders.filter(f => f.key !== null).map(f => f.key), [folders]);
  // Collapsing the branch a WO selection lives under would leave the main pane
  // showing a list the rail no longer offers, so a level toggle drops it. The
  // note editor is NOT dropped: an open note is the pane's content, not the
  // branch's, and losing it to a stray disclosure click would be a text-loser.
  const pickClient = (name) => {
    setOpenClient(openClient === name ? null : name);
    setOpenProp(null); setJWo(null);
  };
  const pickProp = (name) => {
    setOpenProp(openProp === name ? null : name);
    setJWo(null);
  };

  // ── The two editors ───────────────────────────────────────────────────────
  // Both run the SAME autosave discipline (useAutosave above). The pad mints new
  // notes and detaches when emptied; the Journal panel only ever edits the note
  // that is selected, so it passes no minter and never detaches on blank.
  const pad = useAutosave(onAddNote, onUpdateNote, true);
  const jrn = useAutosave(null, onUpdateNote, false);
  const composerRef = React.useRef(null);
  const jPadRef = React.useRef(null);

  // Cursor live on module entry AND every time the binder comes back to the
  // Scratchpad tab. ScheduleModule mounts when the module opens, so the first
  // run of this effect (tab === 'scratchpad') IS "on entry". The pad is never
  // unmounted -- inactive tabs hide it with display:none, they do not tear it
  // down -- so the ref is always attached when this runs (rule A3), and text
  // mid-autosave-window survives a trip to the Calendar tab and back.
  React.useEffect(() => { if (tab === 'scratchpad' && composerRef.current) composerRef.current.focus(); }, [tab]);

  // Clicking a jottings row loads it into the pad. bind() flushes first, so the
  // note being written lands on its own id before the pad rebinds.
  const editInComposer = (note) => {
    pad.bind(note);
    if (composerRef.current) composerRef.current.focus();
  };
  // Enter is a NEWLINE -- this handler deliberately lets it through untouched.
  // Escape is the only key the pad reacts to, and with autosave it no longer
  // means "abandon": the text is already saved, so Escape means "clear the pad
  // and start a new note". clear() flushes first, so nothing typed is ever
  // lost, and Escape does nothing at all on a pad that owns no note yet -- a
  // stray press can therefore never destroy text that was never saved.
  const composerKey = (ev) => {
    if (ev.key !== 'Escape') return;
    if (!pad.id) return;
    ev.preventDefault();
    pad.clear();
  };

  // ── Journal selection panel ───────────────────────────────────────────────
  // Selecting a journal row swaps the quick-nav column for that note, body
  // editable and autosaving exactly like the pad. Its own useAutosave instance,
  // not the pad's: ruling 8 says each tab owns its side column, and one shared
  // buffer would let a half-typed jotting leak into a saved note.
  //
  // jNote is DERIVED from the hook's id, not stored: if the selected note is
  // deleted elsewhere the panel falls back to the quick-nav on its own (A1).
  const jNote = React.useMemo(() => (notes || []).find(n => n && n.id === jrn.id) || null, [notes, jrn.id]);
  // bind() flushes the entry being LEFT before rebinding, so switching from note
  // A to note B mid-write can never land A's text on B's id.
  const selectJournal = (note) => jrn.bind(note);
  const closeJournal = () => jrn.clear();
  // J2. Picking a WO# fills the main pane with THAT WO's notes, so the note the
  // editor was holding has to let go first -- clear() flushes, so nothing typed
  // is lost on the way out. Picking out of the All list instead drops the WO,
  // because the WO context that led there is stale the moment you navigate
  // around it.
  const pickWo = (id) => { jrn.clear(); setJWo(id); };
  const selectFromJournal = (note) => { setJWo(null); jrn.bind(note); };
  // Same keys as the pad: Enter is a newline, Escape flushes then deselects.
  // Escape is the way back to the quick-nav, and it cannot lose the tail typed
  // since the last idle tick because clear() writes it first.
  const journalKey = (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    jrn.clear();
  };

  // The note the PAD currently owns, DERIVED from the hook's id and never
  // mirrored into state (rule A1). The flag row hangs off it; a pad holding no
  // note yet has nothing to flag.
  const padNote = React.useMemo(() => (notes || []).find(n => n && n.id === pad.id) || null, [notes, pad.id]);

  // ── S4 flags ───────────────────────────────────────────────────────────
  // WHICH modal is open, as { noteId, flag }. Modal open/close is genuine
  // user-driven state. The flag VALUES are not: every modal reads them straight
  // off the note record, so there is no useState mirror and no effect syncing
  // one back (rule A1). flagNote is DERIVED, so a note deleted underneath an
  // open modal simply stops rendering it.
  const [flagOpen, setFlagOpen] = React.useState(null);
  const flagNote = React.useMemo(
    () => (flagOpen ? (notes || []).find(n => n && n.id === flagOpen.noteId) || null : null),
    [notes, flagOpen]);
  const closeFlag = () => setFlagOpen(null);

  // MODULE-LEVEL Escape. composerKey / journalKey only fire while focus sits in
  // their textarea, so after clicking a note ROW the key went nowhere and the
  // note stayed bound with no way back to the quick-nav. Binds ONCE with a
  // stable handler and reads the live values off a ref refreshed after each
  // render, so the listener never closes over stale pad / jrn / tab / flagOpen
  // (A6), and the cleanup removes exactly what was added (A7). The refresh is a
  // LAYOUT effect, not a render-body write: writing a ref during render is not
  // pure, and a layout effect still lands before any keypress can reach the
  // handler, so there is no frame where Escape reads last render's values.
  // A flag modal owns the screen when it is open (Modal deliberately ignores
  // Escape), and a keypress already inside either textarea belongs to the
  // handlers above -- both are skipped here so nothing double-fires. clear()
  // flushes first, so nothing typed is lost.
  const escRef = React.useRef(null);
  React.useLayoutEffect(() => { escRef.current = { tab, pad, jrn, flagOpen }; });
  React.useEffect(() => {
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return;
      const s = escRef.current;
      if (!s || s.flagOpen) return;
      const t = ev.target;
      if (t && (t === composerRef.current || t === jPadRef.current)) return;
      if (s.tab === 'journal' && s.jrn.id) { ev.preventDefault(); s.jrn.clear(); return; }
      if (s.tab === 'scratchpad' && s.pad.id) { ev.preventDefault(); s.pad.clear(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // THE FLAG WRITE. Every flag mutation in this module funnels through here.
  //
  // LOAD-BEARING INVARIANT, the same one useAutosave already enforces for its
  // own rebinds: a write on a note an editor CURRENTLY OWNS must FLUSH THAT
  // EDITOR FIRST. Without it the editor's armed idle timer fires AFTER the flag
  // write, carrying the pre-flag body, and two writes race on one id -- the
  // exact hazard bind()/clear() exist to prevent, in a new shape. The flush
  // goes through the EXISTING hook: never a second debounce, never a new timer,
  // or the module ends up with two write disciplines that drift apart.
  const writeNote = (id, patch) => {
    if (pad.id === id) pad.flush();
    if (jrn.id === id) jrn.flush();
    if (onUpdateNote) onUpdateNote(id, patch);
  };
  // A flags patch REPLACES the whole flags object (the store coerces
  // { ...note, ...patch }), so it is always built by spreading what the note
  // already has: flags are INDEPENDENT and setting one must never drop another.
  // A null value REMOVES the key, which is what "not set" means.
  const setFlag = (note, key, value) => {
    const flags = { ...(note.flags || {}) };
    if (value == null) delete flags[key]; else flags[key] = value;
    writeNote(note.id, { flags });
    closeFlag();
  };
  // J3: folder is a plain record field like woId, NOT a flag, so it takes the
  // same writeNote path and never touches the flags object.
  const setFolder = (note, key) => { writeNote(note.id, { folder: key }); closeFlag(); };
  // S4 debt #1: tick a task done. Patches ONLY flags.task.done, so `ts` (the
  // journal position, written-at) never moves.
  const toggleTaskDone = (note) => {
    const t = note && note.flags && note.flags.task;
    if (!t) return;
    setFlag(note, 'task', { ...t, done: !t.done });
  };
  // S4 debt #2: delete a note from this module. ONE delete path -- the store's
  // own deleteNote, handed down as onDeleteNote. confirmDialog, never
  // window.confirm (the native dialog is what wedges renderer input).
  const removeNote = async (note) => {
    if (!onDeleteNote || !note) return;
    const yes = await confirmDialog('Delete this note?\n\n' + (noteTitle(note) || '(empty)'),
      { danger: true, confirmLabel: 'Delete' });
    if (!yes) return;
    // Release the note from whichever editor holds it BEFORE it disappears.
    // clear() flushes through the same hook, so nothing typed is lost on the
    // way out, and no editor is left holding a dead id whose next idle tick
    // would write into the void.
    if (pad.id === note.id) pad.clear();
    if (jrn.id === note.id) jrn.clear();
    closeFlag();
    onDeleteNote(note.id);
  };
  // A calendar chip is EDITABLE again: clicking it opens the note in the
  // Journal, where the body editor and the flag row already live. No second
  // editor is invented here. bind() flushes first, as always.
  // J2, the collapse rule's SECOND exception: a note routed in from a WO# entry
  // opens its branch EXPANDED, so the pane says where the note lives and not
  // just what it says. Set here, in the route itself, rather than in an effect
  // watching the selection -- an effect would re-expand on every rail click and
  // fight the user (rules A1/A4). An unlinked note has no branch, so the rail is
  // left exactly as it was.
  const openNoteInJournal = (note) => {
    setTab('journal');
    const o = note && note.woId ? (orders || []).find(x => x && x.id === note.woId) : null;
    const k = noteTreeKeys(o);
    if (k) {
      setJNav('clients');
      setOpenClient(k.client); setOpenProp(k.prop); setJWo(note.woId);
    }
    jrn.bind(note);
  };
  // S4 ruling 2: the parts modal's ship-to SEEDS from the linked WO. Resolved
  // here, because this is where `orders` lives; the modal stores whatever the
  // user leaves in the field.
  const woAddress = (note) => {
    const o = note && note.woId ? (orders || []).find(x => x && x.id === note.woId) : null;
    return o ? [o.address, o.city].filter(Boolean).join(', ') : '';
  };

  const isPad = view === 'scratchpad';
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

  // Calendar entry chip. EDITABLE again as of S4, in the two ways the slice
  // owes: a task chip carries a tick box that marks it done in place, and
  // clicking the chip opens the note in the Journal (body editor + flag row).
  // Reads flags DIRECTLY -- noteToEntryForm stays gone from this module because
  // projecting a note through the legacy entry form is what let an unflagged
  // jotting acquire kind 'task'. Same "plain function returning JSX" rule as
  // `card` above. stopPropagation because the month cell behind it navigates.
  const entryChip = (note, compact) => {
    const f = (note && note.flags) || {};
    const isTask = !!f.task;
    const done = !!(f.task && f.task.done);
    const start = f.calendar && f.calendar.start;
    const label = noteTitle(note);
    return (
      <div key={note.id}
        onClick={(ev) => {
          ev.stopPropagation();                                   // the month cell behind navigates
          if (ev.target && ev.target.type === 'checkbox') return; // the tick box owns its own click
          openNoteInJournal(note);
        }}
        title={label + (note.tech ? ' - ' + note.tech : '') + (note.woId ? ' - ' + note.woId : '')}
        style={{
          border: '1px dashed var(--border-2)', borderLeft: '4px solid ' + (isTask ? 'var(--text-3)' : 'var(--accent)'),
          borderRadius: 6, background: 'var(--bg-surface-2, var(--bg-surface))', cursor: 'pointer',
          padding: compact ? '2px 4px' : '4px 7px', fontSize: compact ? 11 : 12,
          display: 'flex', gap: 5, alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden',
          opacity: done ? 0.5 : 1,
        }}>
        {isTask && (
          <input type="checkbox" checked={done} title={done ? 'Mark not done' : 'Mark done'}
            onChange={() => toggleTaskDone(note)}
            style={{ margin: 0, flexShrink: 0, cursor: 'pointer' }} />
        )}
        {start && <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' }}>{itinFmtTime(start)}</span>}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: done ? 'line-through' : 'none' }}>
          {label || '(untitled)'}
        </span>
      </div>
    );
  };

  // ONE note-row renderer, shared by the scratchpad column, the journal body and
  // the quick-nav. A plain function returning JSX, NOT a component defined in
  // render (rule A5) -- a component here would remount every row on each parent
  // render and drop focus mid-click.
  //   activeId -- the row currently loaded in an editor, drawn with a ring
  //   onPick   -- what a click does (load into the pad / select in the journal)
  // S5: the row draws its own DOTS -- the same glyph the toolbar uses for each
  // SET flag, in its FLAG_COLORS hue -- so the colour coding reaches the LIST
  // and not just the one note an editor holds. Derived from the note at render,
  // never stored. This RETIRED the old `marks` parameter: only the quick-nav
  // passed it, and its ['Pinned', 'Task'] is two of these dots in less space.
  const padRow = (note, activeId, onPick) => {
    const f = note.flags || {};
    const dots = [];
    if (f.task) dots.push(['task', '✓', FLAG_COLORS.task]);
    if (f.reminder) dots.push(['reminder', '◷', FLAG_COLORS.reminder]);
    if (f.calendar) dots.push(['calendar', '▦', FLAG_COLORS.calendar]);
    if (f.parts) dots.push(['parts', '⚙', FLAG_COLORS.parts]);
    if (f.journal) dots.push(['journal', '★', FLAG_COLORS.journal]);
    if (note.woId) dots.push(['wo', '#', FLAG_COLORS.wo]);
    // Pinned is not a flag and owns no hue: the accent is what says pinned
    // everywhere else in this module.
    if (note.pinned) dots.push(['pinned', '⚑', 'var(--accent)']);
    const lines = String(note.body || '').split('\n');
    const first = lines.findIndex(l => l.trim());
    const rest = first < 0 ? '' : lines.slice(first + 1).join(' ').trim();
    return (
      <div key={note.id} onClick={() => onPick(note)}
        title={noteTitle(note)}
        style={{
          border: '1px solid var(--border-1)', borderRadius: 8, background: 'var(--bg-surface)',
          cursor: 'pointer', padding: '8px 10px', fontSize: 13,
          display: 'flex', flexDirection: 'column', gap: 2,
          boxShadow: note.id === activeId ? '0 0 0 2px var(--accent)' : 'none',
        }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {noteTitle(note) || '(empty)'}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {new Date(note.ts || 0).toLocaleDateString()}
          </span>
        </div>
        {rest && (
          <div style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {rest}
          </div>
        )}
        {dots.length > 0 && (
          <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
            {dots.map(([key, glyph, hex]) => (
              <span key={key} style={{ fontSize: 11, lineHeight: 1, color: hex }}>{glyph}</span>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ONE row renderer for all three levels of the J2 Clients tree. A plain
  // function returning JSX, NOT a component defined in render (rule A5) -- a
  // component here would remount every branch on each parent render and lose
  // the twisty mid-click. `open` is null on a leaf, which is what says "no
  // twisty"; `depth` is the only thing that differs between the levels.
  const treeRow = ({ key, label, count, depth, open, active, onClick }) => (
    <button key={key} onClick={onClick} title={label}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 7,
        padding: '7px 8px 7px ' + (8 + depth * 14) + 'px',
        background: active ? 'var(--accent)' : 'transparent',
        // J3 UX pass: the address line read too light to scan. Every level now
        // takes --text-1; DEPTH is carried by indent and weight alone.
        color: active ? 'var(--accent-fg)' : 'var(--text-1)',
        border: 'none', borderRadius: 0, cursor: 'pointer', textAlign: 'left',
        // Subtle divider between items, which is what the same pass asked for.
        // The list sets gap 0 so these read as one ruled column.
        borderBottom: '1px solid var(--border-1)',
        fontFamily: 'inherit', fontSize: 13, fontWeight: depth === 0 ? 700 : 500,
      }}>
      <span style={{ fontSize: 12, fontWeight: 700, width: 10, flexShrink: 0, opacity: open === null ? 0 : 1 }}>
        {open ? '▾' : '▸'}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ fontSize: 11, flexShrink: 0, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </button>
  );

  // ONE flag row, shared by the Scratchpad column and the Journal panel. A
  // plain function returning JSX, NOT a component defined in render (rule A5).
  // Journal is a straight toggle: it is a bare boolean, so a modal for it would
  // be a form with no fields. No contact button -- ruling 3 defers it to S7.
  // S3: it is now an ICON toolbar attached to the top edge of the writing
  // field. `note` may be null (an unsaved pad); `mint` is optional.
  const flagBar = (note, mint) => {
    const f = (note && note.flags) || {};
    // MINT-THEN-FLAG: pad text has no id until useAutosave mints one, so a flag
    // click on unsaved text flushes through the EXISTING hook first (flush
    // returns the id) and flags what it minted. Not a second save path, not a
    // second debounce, and never greyed-until-saved. An empty pad mints
    // nothing, so the click does nothing at all.
    const target = () => (note ? note.id : (mint ? mint() : null));
    const open = (flag) => () => { const id = target(); if (id) setFlagOpen({ noteId: id, flag }); };
    // The star is a direct toggle, so it needs a note OBJECT, and a just-minted
    // note is not in `notes` yet where this closure can see it. A note one
    // flush old provably has no flags, so an empty flags object is exact.
    const star = () => {
      const id = target();
      if (id) setFlag(note || { id, flags: {} }, 'journal', f.journal ? null : true);
    };
    // Glyphs, all already in use in this app. The gear also means Settings in
    // the app header and the grid also names Service Items in the nav wing;
    // both collisions are CROSS-SURFACE and accepted, because telling these
    // seven apart inside one toolbar beats global glyph uniqueness -- every
    // other geometric-shape candidate is an indistinguishable blob at 13px.
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, flexShrink: 0,
        padding: '6px 8px', background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)', borderBottom: 'none', borderRadius: '10px 10px 0 0' }}>
        <NoteFlagBtn icon color={FLAG_COLORS.task} label="✓" on={!!f.task} onClick={open('task')}
          title={f.task
            ? 'Task' + (f.task.due ? ', due ' + f.task.due : ', no due date') + (f.task.done ? ' (done)' : '')
            : 'Make this a task'} />
        <NoteFlagBtn icon color={FLAG_COLORS.reminder} label="◷" on={!!f.reminder} onClick={open('reminder')}
          title={f.reminder ? 'Reminder at ' + new Date(f.reminder.at).toLocaleString() : 'Set a reminder'} />
        <NoteFlagBtn icon color={FLAG_COLORS.calendar} label="▦" on={!!f.calendar} onClick={open('calendar')}
          title={f.calendar
            ? 'On the calendar ' + f.calendar.date + (f.calendar.start ? ' at ' + f.calendar.start : '')
            : 'Put this on a day'} />
        <NoteFlagBtn icon color={FLAG_COLORS.parts} label="⚙" on={!!f.parts} onClick={open('parts')}
          title={f.parts
            ? 'Parts order: ' + ([f.parts.part, f.parts.status, f.parts.po].filter(Boolean).join(' - ') || 'no details yet')
            : 'Record a parts order'} />
        <NoteFlagBtn icon color={FLAG_COLORS.journal} label={f.journal ? '★' : '☆'} on={!!f.journal} onClick={star}
          title={f.journal ? 'Starred into the journal - click to unstar' : 'Star this into the journal'} />
        {/* The glyph never becomes the WO number: the jump row below already
            carries a button labelled with it, and two same-labelled buttons
            doing different things in one panel is a trap. The ring says
            linked, the tooltip says to what. */}
        <NoteFlagBtn icon color={FLAG_COLORS.wo} label="#" on={!!(note && note.woId)} onClick={open('wo')}
          title={note && note.woId ? 'Linked to ' + note.woId + ' - click to change' : 'Link a work order'} />
        <div style={{ flex: 1 }} />
        {/* Delete stays OUT of the mint path: mint-then-delete is nonsense. */}
        <NoteFlagBtn icon label="✕" title="Delete this note" onClick={() => note && removeNote(note)} />
      </div>
    );
  };

  const emptyLine = <div style={{ padding: 16, color: 'var(--text-3)', fontSize: 13 }}>No jobs scheduled</div>;
  // 340, not 260: J2's Clients tree nests Client > Property Address > WO#, three
  // deep, and 260 truncates an address hard. ONE source, so both rails move.
  const asideStyle = {
    width: 340, flexShrink: 0, borderLeft: '1px solid var(--border-1)',
    display: 'flex', flexDirection: 'column', minHeight: 0,
  };
  // Both rails wear the same head: filter (where there is one), search, count.
  const railHeadStyle = {
    flexShrink: 0, padding: '10px 10px 8px', borderBottom: '1px solid var(--border-1)',
    display: 'flex', flexDirection: 'column', gap: 8,
  };
  const searchStyle = {
    width: '100%', height: 30, padding: '0 10px',
    border: '1px solid var(--border-2)', borderRadius: 6,
    background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 12, boxSizing: 'border-box',
  };
  const SEARCH_TITLE = 'Search notes, WO number or address. The word pinned lists pinned notes.';
  const listStyle = {
    flex: 1, minHeight: 0, overflow: 'auto', padding: 8,
    display: 'flex', flexDirection: 'column', gap: 6,
  };
  const padStyle = {
    flex: 1, minHeight: 0, width: '100%', boxSizing: 'border-box', resize: 'none',
    padding: '14px 16px', borderRadius: 10, border: '1px solid var(--border-1)',
    background: 'var(--bg-surface)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 15, lineHeight: 1.55,
  };

  return (
    <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      {/* Title row. S3b ruling 2: the module's top bar carries the binder and
          nothing else -- prev/Today/next, the day/week/month switch and the tech
          dropdown all moved inside the Calendar tab. */}
      <div style={{ flexShrink: 0, padding: '10px 18px 8px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
          Admin
        </div>
        <div style={{ flex: 1 }} />
        <HeaderChips />
      </div>
      <BinderTabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'scratchpad', label: 'Scratchpad', title: 'Write first, decide later' },
          { value: 'journal', label: 'Journal', title: 'Every note, newest first' },
          { value: 'calendar', label: 'Calendar', title: 'Scheduled jobs and dated notes' },
          { value: 'contacts', label: 'Contacts', title: 'Clients, distributors and PMs' },
        ]}
      />

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>

        {/* SCRATCHPAD. ALWAYS MOUNTED, hidden with display:none on the other
            tabs rather than unmounted (rule A3): the pad is ref-attached and
            autofocused, and tearing it down would drop a half-typed jotting
            every time the user glanced at the calendar. The pad fills the tab
            floor to ceiling -- it IS the module, not a field in it. */}
        <div style={{
          display: tab === 'scratchpad' ? 'flex' : 'none',
          flex: 1, minWidth: 0, minHeight: 0, padding: 14,
        }}>
          {/* Toolbar + field are ONE control: the toolbar always renders, even
              with nothing written yet, because mint-then-flag is what makes an
              ungated toolbar safe. */}
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {flagBar(padNote, () => pad.flush())}
            <textarea
              ref={composerRef}
              value={pad.text}
              onChange={pad.onChange}
              onKeyDown={composerKey}
              onBlur={pad.flush}
              placeholder="Start writing. The pad saves itself. Clear it (or press Escape) to start a new note."
              style={{ ...padStyle, borderRadius: '0 0 10px 10px' }}
            />
          </div>
        </div>
        <aside style={{ ...asideStyle, display: tab === 'scratchpad' ? 'flex' : 'none' }}>
          {/* Same rail treatment as the Journal. Tasks reuses the task flag's own
              U+2713; Jottings takes U+2630, the list glyph, free this slice
              because the Journal rail's All button retires in it. */}
          <div style={railHeadStyle}>
            <Seg
              equal
              options={[
                { value: 'tasks', label: '✓ Tasks' },
                { value: 'jottings', label: '☰ Jottings' },
              ]}
              value={sFilter}
              onChange={setSFilter}
            />
            <input
              type="text"
              value={sQuery}
              onChange={(e) => setSQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setSQuery(''); } }}
              placeholder="Search notes or pinned"
              title={SEARCH_TITLE}
              style={searchStyle}
            />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {scratchShown.length} {scratchShown.length === 1 ? 'note' : 'notes'}
            </span>
          </div>
          <div style={listStyle}>
            {scratchShown.length
              ? scratchShown.map(n => padRow(n, pad.id, editInComposer))
              : <div style={{ padding: 10, color: 'var(--text-3)', fontSize: 12 }}>
                {sFilter === 'tasks'
                  ? 'Nothing open. Flag a note as a task and it lands here.'
                  : 'Nothing yet. The pad is waiting.'}
              </div>}
          </div>
        </aside>

        {/* JOURNAL, INVERTED by J1. The main pane is the NOTE: the editor moved
            out of the aside INTACT (toolbar, textarea, jump row), with an empty
            state when nothing is selected. The aside stays on the RIGHT so the
            Journal and the Scratchpad match rather than mirror, and became the
            NAVIGATOR: filters, search, list, top to bottom. */}
        {tab === 'journal' && (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {jNote ? (<>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Note
                </span>
                <div style={{ flex: 1 }} />
                <button onClick={closeJournal} title="Close this note"
                  style={{ ...navBtnStyle, padding: '2px 8px' }}>Back</button>
              </div>
              {/* Body-only editor: the pad's behaviour in a wider box, and
                  literally the pad's code -- same useAutosave. Enter is a
                  newline, the text writes itself on the same idle debounce,
                  blur flushes, unchanged text writes nothing, Escape flushes
                  then deselects. J1 MOVED this block; it did not rewire it. */}
              <div style={{ flex: 1, minHeight: 0, padding: 12, display: 'flex', flexDirection: 'column' }}>
                {/* No mint here: this editor only ever edits an EXISTING note,
                    which is why its useAutosave is built with a null onAdd. */}
                {flagBar(jNote)}
                <textarea
                  ref={jPadRef}
                  value={jrn.text}
                  onChange={jrn.onChange}
                  onKeyDown={journalKey}
                  onBlur={jrn.flush}
                  style={{ ...padStyle, borderRadius: '0 0 10px 10px' }}
                />
              </div>
              {/* Jump row: the links, kept separate from the flags above. */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px 12px', flexShrink: 0 }}>
                {/* J3: the only entry point for folders. Deliberately NOT in
                    flagBar -- a folder is a plain record field like woId, not a
                    flag, and that toolbar is locked to the seven flags. */}
                <ActionBtn title="Move this note to a folder"
                  onClick={() => setFlagOpen({ noteId: jNote.id, flag: 'folder' })}>
                  {jNote.folder || 'Jottings'}
                </ActionBtn>
                {jNote.woId && (
                  <ActionBtn title={'Open ' + jNote.woId} onClick={() => onOpenWO && onOpenWO(jNote.woId)}>
                    {jNote.woId}
                  </ActionBtn>
                )}
                {jNote.woId && onOpenMaps && (
                  <ActionBtn title={'Show ' + jNote.woId + ' on the map'} onClick={() => onOpenMaps(jNote.woId)}>
                    Map
                  </ActionBtn>
                )}
              </div>
            </>) : jWo ? (
              /* J2: selecting a WO# in the tree fills the main pane with THAT
                 WO's notes. notesForOrder owns the order (pinned first, then
                 newest written), and it runs over navShown, so a search narrows
                 this list exactly as it narrowed the tree's counts. Picking a
                 row hands the pane back to the editor above. */
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
                  borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {jWo}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {woAddress({ woId: jWo })}
                  </span>
                  <div style={{ flex: 1 }} />
                  {onOpenWO && <ActionBtn title={'Open ' + jWo} onClick={() => onOpenWO(jWo)}>Open</ActionBtn>}
                  {onOpenMaps && <ActionBtn title={'Show ' + jWo + ' on the map'} onClick={() => onOpenMaps(jWo)}>Map</ActionBtn>}
                </div>
                <div style={{ ...listStyle, padding: 12 }}>
                  {jWoNotes.length
                    ? jWoNotes.map(n => padRow(n, jrn.id, selectJournal))
                    : <div style={{ padding: 10, color: 'var(--text-3)', fontSize: 12 }}>
                      {/* Unreachable through the tree -- a WO with no matching
                          notes has no branch to click. Reachable by typing a
                          search AFTER picking one, which is why it says so. */}
                      {jQuery.trim() ? 'No notes on this work order match the search.' : 'No notes on this work order.'}
                    </div>}
                </div>
              </>
            ) : (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 24, color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>
                Pick a note on the right to read it here.
              </div>
            )}
          </div>
        )}
        {tab === 'journal' && (
          <aside style={asideStyle}>
            {/* TWO buttons. Clients takes U+2302, the house, because the
                middle level of the tree is a property. Journal keeps J1's
                U+2630 and sits LEFT, as the default: J3 retired All in its
                favour, so this rail is now non-WO notes vs WO notes. */}
            <div style={railHeadStyle}>
              <Seg
                equal
                options={[
                  { value: 'journal', label: '☰ Journal' },
                  { value: 'clients', label: '⌂ Clients' },
                ]}
                value={jNav}
                onChange={(v) => { setJNav(v); if (v !== 'clients') setJWo(null); }}
              />
              <input
                ref={jSearchRef}
                type="text"
                value={jQuery}
                onChange={(e) => setJQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setJQuery(''); } }}
                placeholder="Search notes or pinned"
                title={SEARCH_TITLE}
                style={searchStyle}
              />
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {jNav === 'clients'
                  ? treeCount + (treeCount === 1 ? ' linked note' : ' linked notes')
                  : folderCount + (folderCount === 1 ? ' note' : ' notes')}
              </span>
            </div>
            {/* Both rail modes are ruled columns since J3 (treeRow draws its own
                divider), so gap 0 and no list padding: a gap would break the rule
                line into dashes. */}
            <div style={{ ...listStyle, padding: 0, gap: 0 }}>
              {jNav === 'clients' ? (
                /* THE COLLAPSE RULE, rendered: a level's children exist in the
                   DOM only while that level is the open one, so nothing is
                   expanded until it is clicked. */
                tree.length ? tree.map(c => (
                  <React.Fragment key={c.name}>
                    {treeRow({ key: c.name, label: c.name, count: c.count, depth: 0,
                      open: searching || openClient === c.name, onClick: () => pickClient(c.name) })}
                    {(searching || openClient === c.name) && c.props.map(p => (
                      <React.Fragment key={p.name}>
                        {treeRow({ key: p.name, label: p.name, count: p.count, depth: 1,
                          open: searching || openProp === p.name, onClick: () => pickProp(p.name) })}
                        {(searching || openProp === p.name) && p.wos.map(w => treeRow({
                          key: w.id, label: w.id, count: w.count, depth: 2,
                          open: null, active: jWo === w.id, onClick: () => pickWo(w.id),
                        }))}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                )) : (
                  <div style={{ padding: 10, color: 'var(--text-3)', fontSize: 12 }}>
                    {jQuery.trim() ? 'No linked notes match.' : 'No notes are linked to a work order yet. Unlinked notes live under Journal.'}
                  </div>
                )
              ) : (
                /* J3: the same collapse rule, one accordion at a time. Jottings
                   is always the first header even when empty, because it is the
                   bucket the pad writes into and a missing header reads as a
                   missing feature. */
                folders.map(f => (
                  <React.Fragment key={f.key === null ? '(jottings)' : f.key}>
                    {treeRow({ key: f.key === null ? '(jottings)' : f.key, label: f.name,
                      count: f.notes.length, depth: 0, open: (searching && f.notes.length > 0) || openFolder === folderId(f.key),
                      onClick: () => pickFolder(f.key) })}
                    {((searching && f.notes.length > 0) || openFolder === folderId(f.key)) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 2px' }}>
                        {f.notes.length
                          ? f.notes.map(n => padRow(n, jrn.id, selectFromJournal))
                          : <div style={{ padding: '4px 8px', color: 'var(--text-3)', fontSize: 12 }}>
                            {jQuery.trim() ? 'Nothing here matches.' : 'Empty. Move a note here from its Folder button.'}
                          </div>}
                      </div>
                    )}
                  </React.Fragment>
                ))
              )}
            </div>
          </aside>
        )}

        {/* CALENDAR. Owns every piece of calendar chrome. No backlog strip:
            ruling 3 retired the rail outright, it did not move here. Chips are
            read-only until S4's flag modals land. */}
        {tab === 'calendar' && (
          <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flexShrink: 0, padding: '10px 14px', borderBottom: '1px solid var(--border-1)',
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button onClick={() => step(-1)} style={navBtnStyle}>&lsaquo;</button>
              <button onClick={() => setAnchor(today)} style={navBtnStyle}>Today</button>
              <button onClick={() => step(1)} style={navBtnStyle}>&rsaquo;</button>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                {rangeLabel + ' - ' + (isAll ? 'All techs' : tech) + ' - ' + total + ' job' + (total === 1 ? '' : 's')
                  + (entryTotal ? ' - ' + entryTotal + (entryTotal === 1 ? ' entry' : ' entries') : '')}
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
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12 }}>
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
          </div>
        )}

        {/* CONTACTS. Empty until S7. No record shape, no fields, nothing
            speculative. */}
        {tab === 'contacts' && (
          <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 24 }}>
            <div style={{ maxWidth: 460, color: 'var(--text-3)', fontSize: 13, lineHeight: 1.6 }}>
              <div style={{ fontWeight: 700, color: 'var(--text-2)', marginBottom: 6 }}>Contacts</div>
              The contacts book -- clients, distributors and PMs -- lands in S7.
              Until then a contact is just a note: write it on the Scratchpad and
              it is in the Journal.
            </div>
          </div>
        )}

      </div>

      {/* FLAG MODALS. Mounted ONLY while open, on a note that is DERIVED from
          the store, and keyed on that note's id -- so each modal's useState
          seeds run against the note it belongs to and a second note can never
          inherit the first one's draft (rule A2). Every save routes through
          setFlag / writeNote, which flush the editors first. */}
      {flagNote && flagOpen.flag === 'task' && (
        <TaskFlagModal key={'task-' + flagNote.id} note={flagNote} onClose={closeFlag}
          onSave={(v) => setFlag(flagNote, 'task', v)}
          onRemove={() => setFlag(flagNote, 'task', null)} />
      )}
      {flagNote && flagOpen.flag === 'reminder' && (
        <ReminderFlagModal key={'reminder-' + flagNote.id} note={flagNote} onClose={closeFlag}
          onSave={(v) => setFlag(flagNote, 'reminder', v)}
          onRemove={() => setFlag(flagNote, 'reminder', null)} />
      )}
      {flagNote && flagOpen.flag === 'calendar' && (
        <CalendarFlagModal key={'calendar-' + flagNote.id} note={flagNote} onClose={closeFlag}
          onSave={(v) => setFlag(flagNote, 'calendar', v)}
          onRemove={() => setFlag(flagNote, 'calendar', null)} />
      )}
      {flagNote && flagOpen.flag === 'parts' && (
        <PartsFlagModal key={'parts-' + flagNote.id} note={flagNote} onClose={closeFlag}
          prefillAddress={woAddress(flagNote)}
          onSave={(v) => setFlag(flagNote, 'parts', v)}
          onRemove={() => setFlag(flagNote, 'parts', null)} />
      )}
      {flagNote && flagOpen.flag === 'folder' && (
        <FolderModal key={'folder-' + flagNote.id} note={flagNote} folderNames={folderNames}
          onClose={closeFlag} onPick={(key) => setFolder(flagNote, key)} />
      )}
      {flagNote && flagOpen.flag === 'wo' && (
        <WoLinkModal key={'wo-' + flagNote.id} note={flagNote} orders={orders} onClose={closeFlag}
          onPick={(id) => { writeNote(flagNote.id, { woId: id }); closeFlag(); }} />
      )}
    </div>
  );
}