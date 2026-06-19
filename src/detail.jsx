// Detail pane cluster, carved out of app.jsx: the WO detail view + its note
// stream (NoteCard/MoreInfoCard/NoteComposer), phone + overflow menu, and the
// activity log. Shared helpers import from app.jsx (live ES bindings; the
// app.jsx <-> detail.jsx cycle is eval-safe -- only the components run, at
// render time). App renders DetailPane.
import React from 'react';
import { DEFAULT_MORE_INFO_COLOR, LOCKED_STATUSES } from './constants.js';
import { formatPhone, openMaps } from './utils.js';
import { Dot, PMChip, TypeIcon, StatusPill, ActionBtn, FlagGlyph } from './primitives.jsx';
import {
  splitAddress, typeLetter, isOverdueSched, OVERDUE_CFG, fmtSchedule,
  WOContextMenu, Field, MenuItem, MenuDivider, MenuCaption, DEFAULT_STATUSES,
} from './app.jsx';

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


export function DetailPane({ data, onSendToInvoice, onMarkComplete, onReopen, onAddNote, onEditNote, onDeleteNote, onPinNote, onSetMisc, onEdit, onEditInvoice, onAction, statuses, moreInfoColor, types, techs, pms, inboxes, onWoAction, onAddToInbox, onAddToNewInbox, onRemoveFromInbox }) {
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

export function NoteCard({ id, type, time, body, pinned, edited, legacy, onEdit, onDelete, onPin }) {
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
