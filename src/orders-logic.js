// Pure order/phase/age/migration logic. Carved out of app.jsx so node tests
// import the SHIPPED code instead of a hand-copied mirror (the change11 drift
// that produced false-green tests). React-free; depends only on constants.js.
import { DEFAULT_PHASES, DEFAULT_STATUSES, isCompletionStatusName, catalogTax } from './constants.js';

/* ---------- data adapters ---------- */

// Configurable phase mapping. `phases` arg comes from wo_data.phases (defaults if absent).
// Lookup is exact-first, then case-insensitive, then a legacy heuristic so old data still buckets.
export function phaseFor(status, phases) {
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
export function phaseForOrder(o, phases) {
  if (o.deleted || o.tab === 'trash') return 'Cancelled';
  if (o.tab === 'sent')     return 'Billing';
  if (o.tab === 'complete') return 'Complete';
  return phaseFor(o.status, phases);
}

export function phaseStyle(status, phases) {
  const list = Array.isArray(phases) && phases.length ? phases : DEFAULT_PHASES;
  const name = phaseFor(status, list);
  const p = list.find(x => x.name === name);
  if (p) return { phase: name, fg: p.fg, bg: p.bg, dot: p.fg };
  return { phase: name, fg: 'var(--text-2)', bg: 'var(--bg-surface-2)', dot: 'var(--text-2)' };
}

export function daysSince(d) {
  if (!d) return 0;
  const t = new Date(String(d) + 'T00:00:00').getTime();
  if (isNaN(t)) return 0;
  return Math.floor((Date.now() - t) / 86400000);
}

export function ageLevelFor(d) {
  const n = daysSince(d);
  return ageLevelForDays(n);
}

export function ageLevelForDays(n) {
  if (n == null) return 0;
  if (n >= 30) return 3;
  if (n >= 15) return 2;
  if (n >= 8)  return 1;
  return 0;
}

// Age in days, scoped to the current tab. Returns null (no age, no tint) or a number.
// change11:
// - complete:  days since the most recent 'marked complete' history entry.
//              Surfaces aging color coding on the Complete tab (not yet paid).
// - sent:      days since the most recent 'sent to billing' entry — used
//              ONLY by the Invoices module's aging buckets, not by ageDaysFor
//              directly (sent rows do not display an age in the WO list).
// - other:     days since dateCreated (legacy behavior).
// There is NO tab='paid'. It is a pre-change11 value that migrateOrders rewrites to
// 'sent' (see the tab model rework below), so it never reaches this function. Do not
// re-add a 'paid' branch here; it would be dead code. A stale comment claiming paid
// returned null is what led a review agent to "fix" an unreachable case.
export function ageDaysFor(o) {
  if (!o) return null;  // sparse/hand-edited records: o.tab would throw
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

// Date a WO ORIGINALLY entered the Invoices queue: the FIRST 'sent to billing'
// history entry. Deliberately not the aging base (InvoicesModule.ageOf takes the
// MOST RECENT such entry, so a reopen-and-resend restarts the aging clock, while
// this column must not move). Local date, not UTC, so an evening send does not
// display as tomorrow. Returns '' when the WO has no such entry (pre-change11
// records); callers fall back to dateCreated.
export function sentToInvoiceIso(o) {
  const h = (o && Array.isArray(o.history)) ? o.history : [];
  for (const e of h) {
    if (!e || !e.ts) continue;
    if (!/sent to billing/i.test(String(e.action || ''))) continue;
    const d = new Date(e.ts);
    if (isNaN(d.getTime())) continue;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mm + '-' + dd;
  }
  return '';
}

// '$1,234.50' / '1234.5' / junk -> number. Was a local helper in invoices.jsx;
// lifted here so the Bid totals tile and the Total-column sort agree on one parse.
export function parseBidAmount(raw) {
  if (raw == null) return 0;
  const m = String(raw).replace(/,/g, '').match(/(-?\d+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : 0;
}

// Numeric value behind the Invoices Total column: recorded invoice wins, else the
// bid, else 0 (the "No Bid!" rows sort as free).
export function invoiceRowTotal(o) {
  if (o && o.invoice) return computeInvoiceTotals(o.invoice, o.pm).grandTotal;
  return parseBidAmount(o && o.bidAmount);
}

// Column sort for the Invoices table. Rows here are RAW order records, so this
// cannot reuse sortRows() in app.jsx: that one keys off ListPane row objects
// (row.wo / ageDays / createdTs), fields these records do not have.
// Blanks always sink to the bottom whichever way dir points, so flipping the
// arrow never buries the populated rows under a wall of empty cells.
export function sortInvoiceRows(orders, sort) {
  const list = Array.isArray(orders) ? [...orders] : [];
  const key = (sort && sort.key) || 'sent';
  const dir = (sort && sort.dir) === 'asc' ? 1 : -1;
  const woNum = (o) => parseInt(String((o && o.id) || '').replace(/[^0-9]/g, ''), 10) || 0;
  const textOf = (o) => {
    if (key === 'address') return (String((o && o.address) || '') + ' ' + String((o && o.city) || '')).trim();
    if (key === 'client') return String((o && o.pm) || '').trim();
    return String((o && o.invoice && o.invoice.number) || '').trim();   // 'invoice'
  };
  const blanksLast = (a, b) => (a ? -1 : (b ? 1 : 0));
  return list.sort((a, b) => {
    if (key === 'wo') return (woNum(a) - woNum(b)) * dir;
    if (key === 'total') return (invoiceRowTotal(a) - invoiceRowTotal(b)) * dir;
    if (key === 'sent') {
      // ISO yyyy-mm-dd sorts correctly as a string. dateCreated fallback matches
      // what the Sent cell displays, so the order never contradicts the column.
      const av = sentToInvoiceIso(a) || String((a && a.dateCreated) || '');
      const bv = sentToInvoiceIso(b) || String((b && b.dateCreated) || '');
      if (!av || !bv) return blanksLast(av, bv);
      return av < bv ? -dir : (av > bv ? dir : 0);
    }
    const av = textOf(a), bv = textOf(b);
    if (!av || !bv) return blanksLast(av, bv);
    return av.localeCompare(bv) * dir;
  });
}

export function migrateOrders(orders, storedPhases) {
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
        // Schedule is RETAINED (scheduling-module S1): tab='complete' already
        // says the visit happened, and the calendar needs the past date.
      }
    }
    if (next.deleted && !next.status) next.status = 'Cancelled';
    return next;
  });
}

// ── Service Library model migration (S1a) ─────────────────────────────────────
// Introduces the 3-level model (L2 `page`). Pure + idempotent + version-guarded via
// a SIBLING storage key (NOT stored inside the lib object -- that would pollute
// Object.keys(lib)/LIBRARY_TABS iterations). AMH overloaded `desc` to hold its trade
// -> promote to `page` and clear desc. MSR was flat/all-HVAC -> stamp page='HVAC'.
// General already nests correctly and custom L1 categories are left alone. NEVER
// mutates name/price/taxable or the L1 keys. Second run flips 0 rows.
// Returns { lib, flipped } -- count flipped rows, do not trust the version flag alone.
export const LIB_MODEL_VERSION = 1;
export function migrateLibraryModel(lib) {
  if (!lib || typeof lib !== 'object') return { lib, flipped: 0 };
  let flipped = 0;
  const out = {};
  for (const key of Object.keys(lib)) {
    const items = lib[key];
    if (!Array.isArray(items)) { out[key] = items; continue; }
    out[key] = items.map(it => {
      if (!it || typeof it !== 'object') return it;
      if (key === 'AMH' && !it.page && it.desc) {
        flipped++;
        const { desc, ...rest } = it;
        return { ...rest, page: desc, desc: '' };
      }
      if (key === 'MSR' && !it.page) {
        flipped++;
        return { ...it, page: 'HVAC' };
      }
      return it;
    });
  }
  return { lib: out, flipped };
}

// change11: migrate stored phases, statuses, statusColors in sync with
// migrateOrders. Returns a patch object suitable for updateData(...).
export function migrateSettingsForChange11(stored) {
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

// ── WO action transforms (pure cur -> next) ──────────────────────────────────
// Extracted from the React useCallback handlers in app.jsx so tests run the
// SHIPPED transform. Handlers keep their UI gates (bid prompt, tab checks) and
// the updateOrder(id, fn) wiring; they just delegate the state change here.

function appendHistory(cur, action, detail) {
  return [...(Array.isArray(cur.history) ? cur.history : []), { ts: Date.now(), action, detail }];
}

// Active -> Complete. Hardcodes status, saves prevStatus for Reopen. Keeps the
// schedule (S1 retention: past days stay populated; tab carries "done").
export function applyMarkComplete(cur) {
  const prior = cur.status || 'Open';
  const next = {
    ...cur,
    tab: 'complete',
    prevStatus: cur.prevStatus || prior,
    status: 'Complete - Pending Approval',
  };
  next.history = appendHistory(cur, 'marked complete', 'status: ' + prior + ' → Complete - Pending Approval');
  return next;
}

// Safety-net reverse. complete -> active (restore prevStatus); sent -> complete
// (re-hardcode); anything else -> active.
export function applyReopen(cur) {
  const from = cur.tab || 'active';
  const next = { ...cur };
  if (from === 'complete') {
    next.tab = 'active';
    const restored = cur.prevStatus || 'Open';
    next.status = restored;
    delete next.prevStatus;
    next.history = appendHistory(cur, 'reopened', 'complete → active, status: ' + (cur.status || '') + ' → ' + restored);
  } else if (from === 'sent') {
    next.tab = 'complete';
    next.prevStatus = cur.prevStatus || cur.status || 'Open';
    next.status = 'Complete - Pending Approval';
    next.history = appendHistory(cur, 'reopened', 'sent → complete');
  } else {
    next.tab = 'active';
    next.history = appendHistory(cur, 'reopened', from + ' → active');
  }
  return next;
}

// Complete -> Sent (billing queue). Keeps the schedule (S1 retention).
export function applySendToInvoice(cur) {
  const next = { ...cur, tab: 'sent' };
  next.history = appendHistory(cur, 'sent to billing queue', '');
  return next;
}

// Was this WO actually VISITED before? Drives return-trip detection in
// setSchedule. A visit = a `visited`-tagged status applied to the WO (that tag
// also auto-clears the schedule and hides the WO from the itinerary). We detect
// it from the current status or any past 'status' history entry whose target is
// visited-tagged. NOT "was ever scheduled" — a WO the tech never showed up to
// (scheduled then re-scheduled) must count as a first trip, not a return.
// history 'status' detail format is '<old> → <new>' (see setStatus).
export function wasVisited(o, statusTags) {
  const tags = statusTags || {};
  if (o && tags[o.status] === 'visited') return true;
  const h = Array.isArray(o && o.history) ? o.history : [];
  for (const e of h) {
    if (!e || e.action !== 'status') continue;
    const parts = String(e.detail || '').split('→');
    const to = parts.length > 1 ? parts[parts.length - 1].trim() : '';
    if (to && tags[to] === 'visited') return true;
  }
  return false;
}

// Does an incoming scraped WO match a WO the user already TRASHED/cancelled
// in-app? If so the import paths should auto-reject it (don't re-create as a new
// WO) and notify (round5 A4 / #13). Match by portal WO number / id only — NOT
// address/phone: a genuinely new WO# at a trashed WO's address is a real new
// job. Keyed off current `deleted` state, so a RESTORED WO is not rejected.
export function isTrashedReimport(inc, deletedOrders) {
  if (!inc || !Array.isArray(deletedOrders) || !deletedOrders.length) return false;
  const woNum = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
  const incNum = woNum(inc.woId) || woNum(inc.id);
  const incPortal = String(inc.woId || '').trim();
  for (const o of deletedOrders) {
    if (!o || !o.deleted) continue;
    const oNum = woNum(o.woId) || woNum(o.id);
    if (incNum && oNum && incNum === oNum) return true;
    if (incPortal && (o.id === incPortal || o.woId === incPortal)) return true;
  }
  return false;
}

// Should setting this status clear the WO's itinerary schedule, while leaving
// the WO on its current tab? True when the status is `visited`-tagged (existing
// hook) OR its name contains "job complete" (round5 A1 / #8). Plumbers batch
// statuses straight to "Job Complete - Enter Bid" — that is NOT a completion
// status (bid still pending, stays active) but the site visit IS done, so the
// WO must leave the itinerary. Completion statuses are handled separately (they
// flip to Complete and clear schedule there); this is for the active case.
export function clearsScheduleOnSet(status, statusTags) {
  const tags = statusTags || {};
  if (tags[status] === 'visited') return true;
  return /job complete/i.test(String(status || ''));
}

// Is this WO still a LIVE job whose schedule means something? Schedules now
// persist through complete/sent/visited/past dates (S1 retention), so
// "has a schedule" no longer implies "is upcoming". Deliberately NO date
// comparison inside, so callers compose it:
//   upcoming = isUpcomingSchedule(o, tags)  -- defined below, adds the date test
//   overdue  = isLiveSchedule(o, tags) && isOverdueSched(date, start)
// The status test REUSES clearsScheduleOnSet -- exactly the statuses that used
// to delete the schedule (visited-tagged OR "Job Complete") now just read as
// not-live, so behavior is preserved without the data loss.
// `onsite` is NOT excluded here: only the overdue nag silences onsite (app.jsx),
// while the chip/marker still show onsite jobs today. Keeping that split
// preserves existing behavior exactly.
export function isLiveSchedule(o, statusTags) {
  if (!o || !o.schedule || !o.schedule.date) return false;
  if (o.deleted || (o.tab || 'active') !== 'active') return false;
  return !clearsScheduleOnSet(o.status, statusTags);
}

// The "is upcoming" composition, hoisted out of the four callers that used to
// hand-write it (display-row chip, schedule form's already-scheduled set, map
// marker, map context menu). `>=` so a job scheduled for TODAY still counts.
export function isUpcomingSchedule(o, statusTags) {
  return isLiveSchedule(o, statusTags) && o.schedule.date >= itinTodayStr();
}

// Milestone rows for the WO command center: a curated VIEW of o.history, not a
// stored field. Phase labels come from the user's configured `phases`, so the
// rows track their status edits instead of a frozen stage list. Nothing here is
// persisted -- re-derive on every render.
// DELIBERATELY EXCLUDED: `unscheduled` / `auto-unscheduled (expired)`. Those are
// the ABSENCE of a milestone, and a reschedule writes unschedule-then-schedule,
// so including them rendered Unscheduled / In Progress / Scheduled-for triplets
// and pushed the worst case from 28 rows to 32.
// Returns oldest-first [{ ts, label }].
export function deriveMilestones(o, phases) {
  const hist = o && Array.isArray(o.history) ? o.history : [];
  if (!hist.length) return [];
  const byStatus = {};
  for (const p of (Array.isArray(phases) ? phases : [])) {
    for (const s of (p && Array.isArray(p.statuses) ? p.statuses : [])) byStatus[s] = p.name;
  }
  const out = [];
  // Collapse key for the row before this one. Carried EXPLICITLY, never parsed
  // back out of the label: phase names are user-editable, so a phase called
  // "Ready for Approval" would lose its tail to any suffix-stripping regex and
  // collapse into a different "Ready for ..." phase.
  let prevBase = '';
  for (const h of hist) {
    if (!h) continue;
    // ` (bulk)` variants are the same milestone as their plain form.
    const action = String(h.action || '').replace(/ \(bulk\)$/, '');
    const detail = String(h.detail || '');
    let label = '', rowBase = '';
    if (action === 'created' || action === 'imported') label = 'Created';
    else if (action === 'status' || action === 'edit status') {
      // detail is "<old> → <new>"; only the NEW status names a phase, and an
      // unmapped status names none, so it emits nothing.
      label = byStatus[detail.slice(detail.lastIndexOf('→') + 1).trim()] || '';
    }
    else if (action === 'scheduled') { label = 'Scheduled for ' + detail; rowBase = 'Scheduled'; }
    else if (action === 'marked complete') label = 'Complete';
    else if (action === 'sent to billing queue') label = 'Sent to billing';
    else if (action === 'sent to Invoiced' || action === 'marked invoiced') label = 'Invoiced';
    else if (action === 'marked Paid' || action === 'invoice billed from remittance') label = 'Paid';
    else if (action === 'sent to Trash') label = 'Cancelled';
    else if (action === 'restored from Trash' || action === 'back to Active') label = 'Reopened';
    if (!label) continue;
    // Collapse CONSECUTIVE same-base rows (a flip into a phase named Scheduled
    // plus the `scheduled` write are one event). Non-consecutive repeats
    // survive: re-entering a phase after a return trip is real history.
    if (!rowBase) rowBase = label;
    if (out.length && prevBase === rowBase) continue;
    prevBase = rowBase;
    out.push({ ts: h.ts, label });
  }
  // Older WOs never logged a creation entry; the first thing that happened to
  // them stands in, so no WO reads as having no history at all.
  if (!out.some(m => m.label === 'Created')) out.unshift({ ts: hist[0].ts, label: 'Created' });
  return out;
}

// Is this overdue notification suppressed? Dismissals persist in
// settings.dismissedOverdueIds keyed to the schedule DATE they were dismissed
// for. A bare id set would silence a WO forever (notif ids are 'overdue-'+id,
// stable across reschedules); keying on the date re-arms the nag the moment the
// WO is rescheduled and later goes overdue again.
export function isOverdueDismissed(dismissed, notifId, schedDate) {
  if (!dismissed || !schedDate) return false;
  return dismissed[notifId] === schedDate;
}

// Today as YYYY-MM-DD (local), for schedule date comparison.
export function itinTodayStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

// Shift 'YYYY-MM-DD' by delta days. Anchored at noon so a DST transition can
// never push the result into the neighbouring day. Moved here from app.jsx
// (re-exported there) so the calendar math below can reuse it without a cycle.
export function itinShiftDay(dateStr, delta) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, mo - 1, d + delta, 12);
  const p = (n) => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}

/* ---------- calendar ranges (Schedule module) ---------- */
// All three build dates by day-stepping from a noon-anchored Date, so month and
// year boundaries and DST are handled by the Date object, not by arithmetic here.

// Sunday of the week containing dateStr.
export function weekStart(dateStr) {
  const [y, mo, d] = String(dateStr).split('-').map(Number);
  return itinShiftDay(dateStr, -new Date(y, mo - 1, d, 12).getDay());
}

// The 7 date strings of that week, Sunday first.
export function weekDays(dateStr) {
  const s = weekStart(dateStr);
  return Array.from({ length: 7 }, (_, i) => itinShiftDay(s, i));
}

// 6x7 = 42 date strings starting at the Sunday of the week holding the 1st of
// dateStr's month. Leading/trailing days from the adjacent months are included
// (the view dims them).
export function monthGrid(dateStr) {
  const [y, mo] = String(dateStr).split('-').map(Number);
  const first = y + '-' + String(mo).padStart(2, '0') + '-01';
  const s = weekStart(first);
  return Array.from({ length: 42 }, (_, i) => itinShiftDay(s, i));
}

// { 'YYYY-MM-DD': [orders] } for every scheduled, non-deleted WO. Buckets are
// sorted by start time then id. Deliberately NOT filtered to active orders:
// S1 retention keeps schedules on completed WOs so past days read as history.
export function groupByScheduleDate(orders) {
  const out = {};
  for (const o of orders || []) {
    if (!o || o.deleted || !o.schedule || !o.schedule.date) continue;
    (out[o.schedule.date] = out[o.schedule.date] || []).push(o);
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) =>
      String(a.schedule.start || '').localeCompare(String(b.schedule.start || '')) ||
      String(a.id).localeCompare(String(b.id)));
  }
  return out;
}

// --- The note record (Admin S1) ---------------------------------------------
// ONE flat wo_data.notes array holds every note in the app. A WO note carries
// woId; an Admin note has woId null. Nothing else distinguishes them, so there
// is one write path, one backup, one journal.
//
//   note = { id, ts, updated, type, body, pinned, edited, flags,
//            woId, pm, contactId, tech }
//
// body is the ONLY required field. `ts` is written-at and holds the journal
// position -- editing an old note never bumps it; `updated` is edited-at and is
// never a sort key. `type` ('Note' / 'Customer call' / ...) is carried from the
// old WO note card; S4 maps it onto flags.
//
// FLAGS ARE INDEPENDENT (absent key = not set): a note can be a dated calendar
// item AND a reminder at once. The old mutually-exclusive entry `kind` is gone
// from storage; it survives only as a form projection (noteToEntryForm /
// normalizeNote's legacy branch) so the Schedule editor keeps working.
//   task: {done, due}  reminder: {at}  calendar: {date, start, end}
//   parts: {part, status, distributor, address, po}  journal: true
//   contact: {contactId}
export const ENTRY_KINDS = ['task', 'event', 'reminder'];

const noteDay  = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const noteTime = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v).padStart(5, '0') : null);
const noteStr  = (v) => (v ? String(v) : null);

// Coerce a stored flags blob. Unknown keys are dropped; a set flag always has
// every field present (null, never undefined) so the JSON round-trip is stable.
function normalizeFlags(f) {
  const src = (f && typeof f === 'object') ? f : {};
  const out = {};
  if (src.task) out.task = { done: !!src.task.done, due: noteDay(src.task.due) };
  if (src.reminder && typeof src.reminder.at === 'number') out.reminder = { at: src.reminder.at };
  if (src.calendar) {
    out.calendar = {
      date: noteDay(src.calendar.date) || itinTodayStr(),
      start: noteTime(src.calendar.start), end: noteTime(src.calendar.end),
    };
  }
  if (src.parts) {
    // S4 ruling 1 added `po` (the cost / PO number the team asks about). Same
    // noteStr coercion as its siblings, so a record written before S4 simply
    // loads with po null -- absent key IS the null, no migration.
    out.parts = {
      part: noteStr(src.parts.part), status: noteStr(src.parts.status),
      distributor: noteStr(src.parts.distributor), address: noteStr(src.parts.address),
      po: noteStr(src.parts.po),
    };
  }
  if (src.journal) out.journal = true;
  if (src.contact && src.contact.contactId) out.contact = { contactId: String(src.contact.contactId) };
  return out;
}

// Coerce anything (a note composer submit, a Schedule entry form, a legacy
// entry, a hand-edited blob) into a storable note.
//   `now` is the WRITE clock: pass it from a store mutator and `updated` moves;
//   omit it (migrations, reads) and `updated` is preserved.
// A raw with a `kind` string speaks the old entry language: its flat
// title/date/start/end/done/remindAt fields rebuild the task/calendar/reminder
// flags, and its title is folded into the body -- notes have no title field.
// Any other flag already on the record (parts, journal, contact) survives.
export function normalizeNote(raw, id, now) {
  const r = raw || {};
  const clock = typeof now === 'number' ? now : null;
  const ts = typeof r.ts === 'number' ? r.ts
    : typeof r.created === 'number' ? r.created
    : (clock === null ? Date.now() : clock);
  const flags = normalizeFlags(r.flags);
  if (typeof r.kind === 'string') {
    const kind = ENTRY_KINDS.indexOf(r.kind) !== -1 ? r.kind : 'task';
    const day = noteDay(r.date), start = noteTime(r.start), end = noteTime(r.end);
    delete flags.task; delete flags.calendar; delete flags.reminder;
    if (kind === 'task') {
      flags.task = { done: !!r.done, due: day };
      // A dated task may still carry times; the locked task shape is {done,due},
      // so the clock half lives on calendar (same day, one editor field).
      if (day && (start || end)) flags.calendar = { date: day, start, end };
    } else {
      // An event/reminder occupies a day, so it can never be stored undated.
      flags.calendar = { date: day || itinTodayStr(), start, end };
    }
    if (typeof r.remindAt === 'number') flags.reminder = { at: r.remindAt };
  }
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const rest = r.body == null ? '' : String(r.body);
  return {
    id: id || r.id || null,
    ts,
    updated: clock === null ? (typeof r.updated === 'number' ? r.updated : ts) : clock,
    type: r.type ? String(r.type) : 'Note',
    body: title ? (rest ? title + '\n' + rest : title) : rest,
    pinned: !!r.pinned,
    edited: !!r.edited,
    flags,
    woId: r.woId ? String(r.woId).trim() : null,
    pm: noteStr(r.pm),
    contactId: noteStr(r.contactId),
    tech: noteStr(r.tech),
  };
}

// First non-blank line of the body. Notes have no title; this is what the
// calendar chip and the reminder bell show in a title's place.
export function noteTitle(note) {
  const line = String((note && note.body) || '').split('\n').find(l => l.trim());
  return line ? line.trim() : '';
}

// Project a note back into the flat entry-form view the Schedule module edits
// (kind picker + title + date/start/end). The inverse of normalizeNote's legacy
// branch, so form -> store -> form round-trips without drift.
export function noteToEntryForm(note) {
  const n = note || {};
  const f = n.flags || {};
  const lines = String(n.body || '').split('\n');
  return {
    id: n.id || null,
    kind: f.task ? 'task' : f.reminder ? 'reminder' : f.calendar ? 'event' : 'task',
    title: (lines[0] || '').trim(),
    body: lines.slice(1).join('\n'),
    date: (f.task && f.task.due) || (f.calendar && f.calendar.date) || '',
    start: (f.calendar && f.calendar.start) || '',
    end: (f.calendar && f.calendar.end) || '',
    remindAt: f.reminder ? f.reminder.at : null,
    done: !!(f.task && f.task.done),
    tech: n.tech || null,
    woId: n.woId || null,
    type: n.type || 'Note',
  };
}

// --- Migrations into the flat notes array (Admin S1) ------------------------
// Both are IDEMPOTENT by id: a note already in the array is never appended
// twice, and the source is emptied on the way out, so a second pass is a no-op.

// o.noteCards -> notes (woId = the order's id), and noteCards removed from the
// order. Returns BOTH halves; the caller writes them together.
export function migrateNoteCardsToNotes(orders, notes) {
  const list = Array.isArray(notes) ? notes.slice() : [];
  const seen = new Set(list.map(n => n && n.id).filter(Boolean));
  const nextOrders = (Array.isArray(orders) ? orders : []).map(o => {
    if (!o || !Array.isArray(o.noteCards)) return o;
    o.noteCards.forEach((c, i) => {
      if (!c) return;
      const id = c.id || ('n_mig_card_' + (o.id || 'x') + '_' + i);
      if (seen.has(id)) return;
      seen.add(id);
      list.push(normalizeNote({ ...c, woId: o.id, pm: o.pm || null }, id));
    });
    const { noteCards: _drop, ...rest } = o;
    return rest;
  });
  return { orders: nextOrders, notes: list };
}

// wo_data.entries -> notes. kind becomes flags (see normalizeNote), the entry
// title folds into the body, and woId / tech / created(-> ts) / updated carry.
export function migrateEntriesToNotes(entries, notes) {
  const list = Array.isArray(notes) ? notes.slice() : [];
  const seen = new Set(list.map(n => n && n.id).filter(Boolean));
  (Array.isArray(entries) ? entries : []).forEach((e, i) => {
    if (!e) return;
    const id = e.id || ('n_mig_entry_' + i);
    if (seen.has(id)) return;
    seen.add(id);
    list.push(normalizeNote(e, id));
  });
  return list;
}

// --- Note readers -----------------------------------------------------------

// One WO's notes, pinned first then newest-written first. The detail pane and
// the read-only Maps popup both render this order.
export function notesForOrder(notes, woId) {
  if (!woId) return [];
  return (notes || [])
    .filter(n => n && n.woId === woId)
    .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
}

// Newest written-at across one WO's notes; feeds the list-pane 'lastNote' sort.
export function lastNoteTsFor(notes, woId) {
  let max = 0;
  for (const n of notes || []) if (n && n.woId === woId && (n.ts || 0) > max) max = n.ts;
  return max;
}

// Within one day: timed items first in clock order, untimed after, then title.
function noteDaySort(a, b) {
  const startOf = (n) => (n.flags && n.flags.calendar && n.flags.calendar.start) || '99:99';
  return String(startOf(a)).localeCompare(String(startOf(b)))
    || noteTitle(a).localeCompare(noteTitle(b))
    || String(a.id || '').localeCompare(String(b.id || ''));
}

// { 'YYYY-MM-DD': [notes] } for every note that lands on a day -- a calendar
// flag puts it there, a task's due date does too. Mirrors groupByScheduleDate
// so the calendar can zip the two maps per day.
export function groupNotesByDate(notes) {
  const out = {};
  for (const n of notes || []) {
    const f = (n && n.flags) || {};
    const day = (f.calendar && f.calendar.date) || (f.task && f.task.due);
    if (!day) continue;
    (out[day] = out[day] || []).push(n);
  }
  for (const k of Object.keys(out)) out[k].sort(noteDaySort);
  return out;
}

// Undated tasks, open ones first, oldest first within each group. A note with
// no task flag (a WO note, an Admin jotting) is not backlog, it is journal.
export function backlogNotes(notes) {
  return (notes || [])
    .filter(n => n && n.flags && n.flags.task && !n.flags.task.due
      && !(n.flags.calendar && n.flags.calendar.date))
    .sort((a, b) => ((a.flags.task.done ? 1 : 0) - (b.flags.task.done ? 1 : 0))
      || (a.ts || 0) - (b.ts || 0)
      || String(a.id || '').localeCompare(String(b.id || '')));
}

// Scratchpad: raw jottings, newest first. The Admin module lands on these.
//
// "No active flags" is literally ZERO OWN KEYS on the flags object.
// normalizeFlags only ever ADDS a key when the flag is set -- it writes no
// `false`/`null` placeholder for an unset one -- so there is nothing per-key to
// test and Object.keys().length === 0 is the exact predicate. That also means a
// flag added in a later slice needs no change here: setting it puts a key on the
// object and the note leaves the scratchpad by itself.
// woId null keeps WO notes out; they belong to their order's detail pane.
// Sorted by ts (written-at), the same journal position S5 will inherit --
// never by `updated`, so editing an old jotting does not jump it to the top.
export function scratchpadNotes(notes) {
  return (notes || [])
    .filter(n => n && !n.woId && Object.keys((n && n.flags) || {}).length === 0)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0)
      || String(b.id || '').localeCompare(String(a.id || '')));
}

// "MM/DD h:mm AM" for an epoch-ms reminder time. Mirrors fmtSchedule's shape
// (app.jsx) but reads a timestamp instead of a {date,start} pair.
function fmtRemindAt(ms) {
  const d = new Date(ms), h = d.getHours();
  return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0')
    + ' ' + (h % 12 === 0 ? 12 : h % 12) + ':' + String(d.getMinutes()).padStart(2, '0')
    + ' ' + (h < 12 ? 'AM' : 'PM');
}

// Notes whose flags.reminder.at has arrived, as header-bell notification items
// in the same shape as the derived overdue items in app.jsx. Re-evaluated by the
// existing minute tick, so no timer lives here and a reminder that fired while
// the app was shut simply appears on next launch. A done task never nags.
// `dismissed` is settings.dismissedOverdueIds -- ONE map for both kinds; ids are
// namespaced ('overdue-' / 'reminder-') so they cannot collide, and reusing it
// means the persisted-dismissal plumbing (dismissOverdue) is shared. schedDate
// carries the fire time, so editing the reminder re-arms it exactly as
// rescheduling re-arms an overdue WO. `now` is injectable for tests.
export function getReminderNotificationItems(notes, dismissed, now) {
  const ts = now || Date.now();
  const out = [];
  for (const n of notes || []) {
    const f = (n && n.flags) || {};
    if (!n || !n.id || !f.reminder || typeof f.reminder.at !== 'number' || f.reminder.at > ts) continue;
    if (f.task && f.task.done) continue;
    const id = 'reminder-' + n.id;
    const schedDate = String(f.reminder.at);
    if (isOverdueDismissed(dismissed, id, schedDate)) continue;
    const item = {
      id, kind: 'reminder', schedDate,
      title: 'Reminder · ' + (noteTitle(n) || 'Untitled'),
      sub: fmtRemindAt(f.reminder.at) + (n.woId ? ' · ' + n.woId : ''),
    };
    if (n.woId) item.wo = n.woId;
    out.push(item);
  }
  return out;
}

// change11 self-healing reconciler (v6) — PURE core. The effect in app.jsx
// gates it (settings flag), calls this, then writes the result + settings patch
// + toast. Returns the reconciled orders plus per-pass counters.
export function reconcileChange11(orders, storedPhases) {
  const phaseList = Array.isArray(storedPhases) && storedPhases.length ? storedPhases : DEFAULT_PHASES;
  const LEGACY_COMPLETE_IDS = new Set(['wrap', 'done', 'billing']);
  const completePhaseNames = new Set();
  for (const p of phaseList) {
    if (!p) continue;
    if (p.complete === true) completePhaseNames.add(p.name);
    if (p.id && LEGACY_COMPLETE_IDS.has(p.id)) completePhaseNames.add(p.name);
  }
  let flipped = 0, promotedFromInvoiced = 0, hardcodedComplete = 0,
      hardcodedCancelled = 0, revertedFromComplete = 0;
  const nextOrders = (orders || []).map(o => {
    const t = (o.tab || 'active');
    // Pass 0: deleted/trash WOs -> Cancelled + no lingering schedule.
    if (o.deleted) {
      const needsStatus  = o.status !== 'Cancelled';
      const needsUnsched = !!o.schedule;
      if (needsStatus || needsUnsched) {
        hardcodedCancelled++;
        const next = { ...o };
        if (needsStatus) { next.prevStatus = o.prevStatus || o.status || 'Open'; next.status = 'Cancelled'; }
        if (needsUnsched) delete next.schedule;
        const detailParts = [];
        if (needsStatus)  detailParts.push((o.status || '') + ' → Cancelled');
        if (needsUnsched) detailParts.push('unscheduled');
        next.history = appendHistory(o, 'reconciled trash (change11 v5)', detailParts.join(' · '));
        return next;
      }
      return o;
    }
    // Pass 1: tab='paid'/'invoiced' (deprecated) -> 'sent'.
    if (t === 'paid' || t === 'invoiced') {
      promotedFromInvoiced++;
      const next = { ...o, tab: 'sent' };
      next.history = appendHistory(o, 'auto-flipped to Sent (change11 v4)', 'was tab=' + t);
      return next;
    }
    // Pass 2: Complete tab. v6 reverts auto-flips whose prevStatus is no longer a
    // completion status under the narrower rule; otherwise hardcodes the status.
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
        const next = { ...o, tab: 'active', status: o.prevStatus };
        delete next.prevStatus;
        next.history = appendHistory(o, 'reconciled complete (change11 v6)', 'reverted auto-flip; status: Complete - Pending Approval → ' + o.prevStatus);
        return next;
      }
      if (o.status !== 'Complete - Pending Approval') {
        hardcodedComplete++;
        return {
          ...o,
          prevStatus: o.prevStatus || o.status || 'Open',
          status: 'Complete - Pending Approval',
          history: appendHistory(o, 'hardcoded status (change11 v4)', (o.status || '') + ' → Complete - Pending Approval'),
        };
      }
      return o;
    }
    // Pass 3: active WOs whose stored phase or status signals tech-done.
    if (t !== 'active') return o;
    const phaseName = phaseForOrder(o, phaseList);
    const byPhase  = completePhaseNames.has(phaseName);
    const byStatus = isCompletionStatusName(o.status);
    if (!byPhase && !byStatus) return o;
    flipped++;
    const next = {
      ...o,
      tab: 'complete',
      prevStatus: o.prevStatus || o.status || 'Open',
      status: 'Complete - Pending Approval',
    };
    next.history = appendHistory(o, 'auto-flipped to Complete (change11 v4)',
      'phase=' + phaseName + ' status=' + (o.status || '') + ' → Complete - Pending Approval');
    return next;
  });
  // Pass 4 (expired-schedule clearing) REMOVED in S1: past schedules are kept.
  return { orders: nextOrders, flipped, promotedFromInvoiced, hardcodedComplete,
    hardcodedCancelled, revertedFromComplete };
}

/* ---------- WO search number match ---------- */

// Match a query against a WO's number(s): the minted id (or a display-row's `wo`
// field) AND the real portal number `woId`. MSR/captured WOs keep the portal
// number in `woId` while `id` is a minted 'WO-###', so searching by the real
// number must check woId too -- omitting it was the "search returns nothing on a
// pasted number" bug. Case-insensitive substring. Empty query -> true. Accepts
// either an order ({id,woId}) or a display row ({wo,woId}).
export function orderNumberMatches(row, q) {
  const needle = String(q == null ? '' : q).trim().toLowerCase();
  if (!needle) return true;
  const id = (row && (row.id != null ? row.id : row.wo)) || '';
  const woId = (row && row.woId) || '';
  return String(id).toLowerCase().includes(needle)
      || String(woId).toLowerCase().includes(needle);
}

// Match a query against a WO's phone number(s): the primary `phone` plus every
// `contacts[].phone`. Digits-only on BOTH sides so a typed '9195550148' finds a
// stored '(919)-555-0148' (formatPhone punctuation would break a plain substring
// match). A leading US '1' is dropped from BOTH sides so 11- and 10-digit forms
// compare equal in either direction (stripping only the stored side left a pasted
// '19195550148' longer than its own haystack, so it never matched). Queries with
// fewer than 3 digits return false -- a bare
// '1' would otherwise match nearly every WO. Accepts an order or a display row
// (both carry `phone` + `contacts`).
export function phoneMatches(row, q) {
  const raw = String(q == null ? '' : q).trim();
  // A query carrying LETTERS is never a phone number. Without this guard the
  // digits are stripped out of an ADDRESS and the remainder is matched as a
  // phone: '615 N Hardee St' becomes '615' and hits every WO whose phone
  // contains 615. Proven live on real data -- 15 hits where 3 were right, which
  // reads to the user as "search does not narrow". Digits and the punctuation
  // real phone numbers carry are allowed, so '615', '919-555', '(919) 555 1234'
  // and '+1 919 555 1234' all still work.
  if (!/^[\d\s().+-]+$/.test(raw)) return false;
  const norm = (v) => {
    const d = String(v || '').replace(/\D/g, '');
    return d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  };
  const needle = norm(q);
  if (needle.length < 3 || !row) return false;
  const nums = [row.phone].concat(Array.isArray(row.contacts) ? row.contacts.map(c => c && c.phone) : []);
  return nums.some(p => norm(p).includes(needle));
}

/* ---------- cross-tab search (search-ux Part 4) ---------- */

// A WO's "location" = the tab it lives in. Modules are views of tabs:
// active/complete/trash -> Work Orders module; sent -> Invoices module.
export function locationOfOrder(o) {
  if (!o) return 'active';
  if (o.deleted || o.tab === 'trash') return 'trash';
  return o.tab || 'active';
}

// Badge labels for a location. `sent` reads as "Sent to invoice" in-app.
export const TAB_LABELS = { active: 'ACTIVE', complete: 'COMPLETE', sent: 'SENT', trash: 'TRASH' };

// Superset search predicate for the cross-tab "found elsewhere" list: the WO
// number(s) OR address/city/pm/tech substring. Empty query -> false (the off-view
// list only appears when there IS a query).
export function orderMatchesQuery(o, q) {
  const needle = String(q == null ? '' : q).trim().toLowerCase();
  if (!needle || !o) return false;
  if (orderNumberMatches(o, needle)) return true;
  if (phoneMatches(o, needle)) return true;
  const has = (v) => String(v || '').toLowerCase().includes(needle);
  return has(o.address) || has(o.city) || has(o.pm) || has(o.tech);
}

// S5 slice 2: does a JOURNAL note match the search box? A note matches on its
// own text, or on the work order it is linked to -- the user searches by WO
// number or address as often as by wording. The WO half delegates to
// orderMatchesQuery (number, address, city, PM, tech, phone) rather than
// growing a second matcher that would drift from it. The order lookup is the
// CALLER's job, which is what keeps this pure and testable.
export function noteMatchesQuery(note, order, q) {
  const needle = String(q == null ? '' : q).trim().toLowerCase();
  if (!needle || !note) return false;
  // J1b: `pinned` is a KEYWORD -- the Pinned rail button retired into the search
  // box, still reading the note record's existing `pinned` field. UNION with the
  // two matches below, never a replacement, so a note whose TEXT says pinned is
  // still found and the keyword can hide nothing. Measured on the live 846-note
  // store: zero bodies contain pinned / pin / pending / task / star, so the
  // collision risk is nil today and the union is what keeps it harmless later.
  if (needle === 'pinned' && note.pinned) return true;
  if (String(note.body || '').toLowerCase().includes(needle)) return true;
  return order ? orderMatchesQuery(order, needle) : false;
}

// Orders matching q whose location is NOT in shownLocations (the tab(s) the
// current module already shows). Returns lightweight rows for the badge list.
export function findOtherViewMatches(orders, q, shownLocations) {
  const needle = String(q == null ? '' : q).trim();
  if (!needle) return [];
  const shown = new Set(shownLocations || []);
  const out = [];
  for (const o of (orders || [])) {
    if (!o) continue;
    const loc = locationOfOrder(o);
    if (shown.has(loc)) continue;
    if (!orderMatchesQuery(o, needle)) continue;
    out.push({ id: o.id, woId: o.woId || '', address: o.address || '', city: o.city || '', pm: o.pm || '', tab: loc });
  }
  return out;
}

/* ---------- invoice tax model ---------- */

// TAX_RATE is the tax-INCLUSIVE multiplier (1 + 0.0725). A taxable line's price
// is treated as tax-INCLUSIVE (divide the tax back out) only for catalogs whose
// signed pricing is inclusive (MSR); AMH/General taxable lines are pre-tax so tax
// is added on top. Non-taxable lines never get tax. Policy per catalog lives in
// CATALOG_TAX (constants.js).
export const TAX_RATE = 1.0725;

export function money(n) {
  const v = (typeof n === 'number' && !Number.isNaN(n)) ? n : 0;
  return Math.round(v * 100) / 100;
}

// The blank-cell sentinel the service library stores on a material/labor cell
// (library_io.js MATERIAL_INCLUDED). It means that side is BUNDLED INTO THE OTHER,
// NOT zero, so it must never be coerced to a number. Re-declared here rather than
// imported: library_io.js is a CJS main-process module that pulls in exceljs, which
// must not enter the renderer bundle.
const MATERIAL_INCLUDED = 'Included';

// THE CHOKE POINT for carrying the split across a boundary. Every site that builds an
// invoice line OUT OF something else spreads this instead of re-listing the two field
// names by hand: re-listing them is exactly how the split got silently dropped at four
// separate boundaries (reconcileMsrRow, the editor save map, reconcileBlockToInvoice,
// recomputeInvoice), each time reverting a line to the whole-price divide-out with no
// visible symptom. Returns {} when the source carries no split, so the spread is always
// safe, and it never coerces: 'Included' stays the string sentinel.
export function taxSplit(src) {
  if (!src || (src.material == null && src.labor == null)) return {};
  return { material: src.material, labor: src.labor };
}
// True when a line carries a usable tax base at all. A spread that someone forgets is
// still silent at the boundary, so the money core COUNTS the misses instead
// (computeInvoiceTotals -> missingSplit): a tax-inclusive line with no split is
// indistinguishable in its numbers from a dropped one, and this is what makes the drop
// observable + assertable per boundary rather than invisible until an invoice is wrong.
function hasTaxSplit(li) {
  return !!li && (li.material != null || li.labor != null);
}

// LABOR SHARE of a line's face price, 0..1. TAX-INCLUSIVE agreements ONLY -- the caller
// checks catalogTax(...).taxableInclusive first, so this can never reach an AMH or
// General line. That gate is load-bearing: AMH's library material/labor columns are
// INTERNAL COST BASIS that deliberately do not sum to the sell price (library_io.js
// ~92), so reading them as a tax basis would compute tax from our own cost. AMH is ruled
// out of this model entirely (roadmap-handoffs/msr-tax-accuracy.md D7).
// The split is applied as a SHARE, never as absolute dollars: an item listed
// 1772.30 material / 500.00 labor is 22.0% labor, so a line billed at any other figure
// keeps that 22.0% labor share and the line total still equals the bid price.
// No usable split (a saved line predating it) -> fall back to the line's boolean
// `taxable`, which reproduces the old whole-price divide-out exactly.
function laborShare(li) {
  const material = li && li.material;
  const labor = li && li.labor;
  if (labor === MATERIAL_INCLUDED) return 0;      // labor bundled into material -> untaxed
  if (material === MATERIAL_INCLUDED) return 1;   // material bundled into labor -> all taxed
  const m = typeof material === 'number' && !Number.isNaN(material) ? material : null;
  const l = typeof labor === 'number' && !Number.isNaN(labor) ? labor : null;
  if (m != null && l != null && m + l > 0) return l / (m + l);
  return (li && li.taxable) ? 1 : 0;
}

// Pure. invoice = { lineItems:[{ unitPrice, qty, taxable, material, labor, agreement }] }.
// defaultAgreement = the WO's catalog tab (General/AMH/MSR), used when a line
// carries no agreement of its own.
//   TAX-INCLUSIVE catalog (MSR): the face price is the final post-tax figure and the tax
//     rides on the LABOR portion ONLY (material already bore sales tax at purchase --
//     msr-tax-accuracy.md D1). face = material + labor; pre-tax labor = labor/TAX_RATE;
//     tax = labor - pre-tax labor; the line total is the face, always. Cents are settled
//     PER LINE here and the material remainder is taken by subtraction, so pre + tax ==
//     face exactly and the grand total equals the face BY CONSTRUCTION (a 1-cent drift
//     is enough to flip reconcileMsrRow from 'match' to 'off').
//   NON-inclusive catalog (AMH, General): unchanged -- the price is pre-tax and tax is
//     added on top of the taxable subtotal, rounded once on the subtotal.
// Returns per-line breakdown + { taxableSubtotal, nonTaxableSubtotal, tax, grandTotal }.
export function computeInvoiceTotals(invoice, defaultAgreement) {
  const lines = (invoice && Array.isArray(invoice.lineItems)) ? invoice.lineItems : [];
  let taxableRaw = 0;        // pre-tax sum of taxable (non-inclusive) lines
  let nonTaxableRaw = 0;
  let inclusiveTax = 0;      // cent-exact, summed per inclusive line
  let inclusivePre = 0;      // cent-exact pre-tax (material + pre-tax labor)
  let inclusiveNonTax = 0;   // cent-exact material portions
  let missingSplit = 0;      // tax-inclusive lines arriving with NO tax base (see hasTaxSplit)
  const rows = lines.map((li) => {
    const qty = Number(li.qty) > 0 ? Number(li.qty) : 1;
    const unit = money(Number(li.unitPrice));
    const taxable = !!li.taxable;
    const inclusive = catalogTax(li.agreement || defaultAgreement).taxableInclusive;
    if (inclusive) {
      const split = hasTaxSplit(li);
      if (!split) missingSplit++;
      const face = money(unit * qty);
      const laborPortion = money(face * laborShare(li));
      const materialPortion = money(face - laborPortion);          // remainder: no drift
      const preTaxLabor = money(laborPortion / TAX_RATE);
      const lineTax = money(laborPortion - preTaxLabor);
      const linePre = money(face - lineTax);                       // == material + pre-tax labor
      inclusiveTax += lineTax;
      inclusivePre += preTaxLabor;
      inclusiveNonTax += materialPortion;
      return { ...li, qty, unitPrice: unit, preTaxUnit: money(linePre / qty), lineSubtotal: linePre,
        ...(split ? {} : { splitMissing: true }) };
    }
    // Accumulate raw (unrounded) line values so the cent rounding happens once
    // on the subtotals, not per line (avoids 1-cent drift on multi-line invoices).
    const lineRaw = unit * qty;
    if (taxable) taxableRaw += lineRaw;
    else nonTaxableRaw += lineRaw;
    return { ...li, qty, unitPrice: unit, preTaxUnit: unit, lineSubtotal: money(lineRaw) };
  });
  // Tax on the non-inclusive side is added on top of its OWN rounded subtotal, exactly
  // as before, so an AMH/General invoice is byte-identical to the pre-split behaviour.
  const addedTax = money(money(taxableRaw) * (TAX_RATE - 1));
  const taxableSubtotal = money(taxableRaw + inclusivePre);
  const nonTaxableSubtotal = money(nonTaxableRaw + inclusiveNonTax);
  const tax = money(addedTax + inclusiveTax);
  const grandTotal = money(taxableSubtotal + tax + nonTaxableSubtotal);
  return { rows, taxableSubtotal, nonTaxableSubtotal, tax, grandTotal, missingSplit };
}

/* ---------- invoice line normalization (Build A) ---------- */

const priceOf = (p) => (typeof p === 'number' ? p : (parseFloat(p) || 0));

// matchTokens (with MATCH_STOP/MATCH_BOILER) now lives in the root CJS
// text-normalize.js so the CJS bid-select.js and this ESM module tokenize
// identically. Safe: orders-logic.js is only ever consumed bundled (esbuild) or via
// the loadEsm test bridge, both of which can import a CJS module.
import { matchTokens } from '../text-normalize.js';

// Best keyword resolution within ONE catalog. PRICE is a CONFIRMER, not a gate:
// invoice price is always the bid price (we may charge above the library over time),
// so price only decides CONFIDENCE. Returns:
//   { confirmed: item }  strong keyword AND price == library price (identity certain)
//   { suspects: [item] } strong keyword but price differs (needs human confirmation)
//   null                 no strong keyword match
//
// Slice-1b scoring (tuned vs the 133 live AMH bid lines, scratchpad/matchrate.js):
// a plain shared-token count flagged 43% of lines RED, mostly FALSE, because every
// token weighed the same -- generic words ("fee","replace","service") and the AMH
// desc=tab-name ("HVAC" on every HVAC item) manufactured matches ("Diagnostic fee"
// -> "Main water line ... Diagnostic fee (per LF)"; "HVAC - Service Call" -> "Replace
// contactor"). Fix = IDF weighting + fractional distinctive-token coverage:
//   - idf(t) = log((N+1)/(df+1)) over item-NAME tokens (desc=tab noise is dropped),
//     so a token in nearly every item (hvac/replace) counts ~0 and a rare token
//     (contactor/txv/schrader) counts a lot.
//   - COVERAGE gate over DISTINCTIVE tokens only: the shared distinctive tokens must
//     carry a real FRACTION (MATCH_MIN_COVER) of the candidate's distinctive IDF mass.
//     Generic filler (labor/fee/no/additional/replace) is excluded from BOTH sides so
//     a descriptive catalog name isn't penalized for its tail ("Clean condenser coil
//     - no additional labor fee" still covers fully), while a terse bid that only
//     touches a candidate's peripheral word fails ("Diagnostic fee" shares just
//     "diagnostic" of "Main water line dig up ... Diagnostic fee (per LF)").
//   - STRONG = coverage met AND summed IDF of the shared tokens >= MATCH_MIN_IDF.
// Erring toward FEWER false suspects (a missed suspect is a plain sentinel the user
// can still fix; a false RED flag spams and misleads).
const MATCH_MIN_IDF = 2.0;      // absolute distinctiveness floor for the shared tokens
const MATCH_MIN_COVER = 0.45;   // shared distinctive IDF / candidate distinctive IDF
const MATCH_GENERIC_IDF = 1.5;  // below this a token is generic filler (ignored in coverage)
const MATCH_SOLO_IDF = 4.0;     // a lone shared distinctive token must be THIS rare to flag
function resolveInCatalog(wording, price, catalog, bidIsMaterial) {
  const items = (Array.isArray(catalog) ? catalog : []).filter(Boolean);
  if (!items.length) return null;
  const w = new Set(matchTokens(wording));
  if (!w.size) return null;
  // Document frequency over item-NAME tokens (identity vocabulary; desc is dropped
  // because AMH desc is just the scope-tab label and pollutes every item alike).
  const N = items.length;
  const nameToks = items.map(it => new Set(matchTokens(it.name)));
  const df = new Map();
  for (const toks of nameToks) for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  const idf = (t) => Math.log((N + 1) / ((df.get(t) || 0) + 1));
  // The BID's own distinctive tokens, for the terse-bid route in the loop below.
  const wDistinct = [...w].filter(t => idf(t) >= MATCH_GENERIC_IDF);
  const scored = [];
  for (let i = 0; i < items.length; i++) {
    const toks = nameToks[i];
    if (!toks.size) continue;
    // KIND gate: a MATERIAL bid ("Material - drain line") is a physical thing, not a
    // labor service, so it must not match a labor/cleaning catalog item -- those NAMES
    // LEAD with an action verb ("Clean Drain Pan...", "Replace Supply Line"). Material
    // catalog items lead with a noun ("Capacitor Replacement", "R410a"), so a legit
    // material->material match still passes.
    if (bidIsMaterial && ACTION_VERB.test(String(items[i].name).split(/\s+/)[0] || '')) continue;
    let score = 0, distinctTotal = 0, distinctShared = 0, distinctCount = 0;
    for (const t of toks) {
      const s = idf(t);
      if (w.has(t)) score += s;
      if (s >= MATCH_GENERIC_IDF) { distinctTotal += s; if (w.has(t)) { distinctShared += s; distinctCount++; } }
    }
    if (score < MATCH_MIN_IDF) continue;
    // TERSE-BID route into the scored set. Coverage is shared-distinctive over the
    // CANDIDATE's distinctive mass, which structurally punishes a SHORT bid against a
    // LONG catalog name ("Replace toilet" covers 0.24 of "Toilet with Wax Ring and
    // Bolts"; "Emergency Call" covers 0.26 of "Emergency or After Hours Diagnostic
    // Fee"), so those never got scored at all. A candidate may ALSO pass when EVERY
    // distinctive token the human wrote is present in its name AND its price equals the
    // bid price exactly. Both together, never either alone: the price is identical by
    // construction so this cannot move money, and full bid coverage means it cannot
    // invent identity. The tuning constants above stay where they are -- the 43% false-
    // red history is why they are there.
    const terse = wDistinct.length > 0 && wDistinct.every(t => toks.has(t))
      && Math.abs(priceOf(items[i].price) - price) < 0.005;
    if (!terse && distinctTotal > 0 && distinctShared / distinctTotal < MATCH_MIN_COVER) continue;
    scored.push({ it: items[i], score, distinctCount, distinctShared });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  // CONFIRM only within the TOP-scored group (best identity match). Price disambiguates
  // equal-scored variants (tonnage: two "Heat Pump" rows, the bid price picks one). A
  // lower-scored item that merely price-collides must NOT confirm -- e.g. "shower valve"
  // $260 top-matches "Tub and Shower Valve" ($220, price off) while "Replace Shower Pan"
  // coincidentally reads $260; confirming the pan would be a silent wrong identity. So a
  // top group that doesn't contain the bid price stays a SUSPECT (flag), not a confirm.
  const top = scored[0].score;
  const topGroup = scored.filter(s => Math.abs(s.score - top) < 1e-9);
  const priceMatch = topGroup.find(s => Math.abs(priceOf(s.it.price) - price) < 0.005);
  if (priceMatch) return { confirmed: priceMatch.it };
  // EXACT-PRICE CONFIRM OUTSIDE THE TOP GROUP. Price-checking only the top group loses a
  // right-priced candidate to a higher-scoring WRONG one: "Toilet with Wax Ring and Bolts"
  // ($11.10) outscores "Wax Ring and Bolts" ($7.55) on a bid that IS the wax ring, and
  // "Clean Evaporator Coil In Place" outscores "Clean Condenser". So when the top group has
  // no price hit, look among the OTHER gate-passing candidates for one whose price equals
  // the bid EXACTLY -- but demand real identity evidence (>=2 shared DISTINCTIVE tokens),
  // which is exactly what refuses the counterexample above ("shower valve" $260 vs "Replace
  // Shower Pan" $260 shares only "shower", distinctCount 1). Two candidates at the same
  // exact price is ambiguous identity: confirm NEITHER, fall through to the suspect path.
  const exactOut = scored.filter(s => s.distinctCount >= 2
    && Math.abs(priceOf(s.it.price) - price) < 0.005);
  if (exactOut.length === 1) return { confirmed: exactOut[0].it };
  // A SUSPECT (price-off FLAG) needs real evidence: >=2 shared distinctive tokens, OR a
  // single shared token that is genuinely RARE (idf >= MATCH_SOLO_IDF). One common word
  // ("air" -> Air Handler, "line" -> Supply Line) is too weak to flag; a rare one
  // ("capacitor", "plenum") is worth surfacing. Nothing strong enough -> no flag.
  const strong = topGroup.filter(s => s.distinctCount >= 2 || s.distinctShared >= MATCH_SOLO_IDF);
  if (!strong.length) return null;
  return { suspects: strong.map(s => s.it) };
}

// Labor vs Material for a bid line with no confirmed match. User rule: a line is
// MATERIAL if it says "Material -/:", or has NO action verb (materials are things,
// not actions); otherwise it's LABOR (action verbs: replace/install/clear/etc.).
// NOTE: "drain" is deliberately NOT a verb here -- it reads far more often as a NOUN
// ("drain line", "drain pan", "drain assembly") than a verb ("drain the system"), so
// treating it as a verb wrongly filed those materials as Labor. Real drain work still
// carries a true verb (clear/replace/clean the drain) and stays Labor.
// "label" IS a verb here: on this catalog it only ever appears as the act ("Label
// Breakers", "Label disconnect"), never as a thing bought. Missing it billed
// "Label Breakers and Disconnect $50" as a NON-TAXABLE material (real WO 03278789) and
// filed the confirmed 25.00 line as 'material'. A bought label still leads with
// "Material -", which wins before this test runs.
const ACTION_VERB = /\b(replac|instal|clear|repair|clean|augur|remov|correct|cut|inspect|unclog|snak|run|flush|seal|patch|test|reset|rewir|mount|connect|adjust|tighten|fix|swap|label)\w*/i;
function isMaterialWording(desc) {
  // A line LEADING with "Material"/"Materials" is a material (non-taxable), whatever
  // follows -- user rule: bias combined "Material to replace ..." lines to material; the
  // rare combined labor+material line is fixed at invoicing. "Labor..." leads as labor.
  if (/^\s*materials?\b/i.test(desc)) return true;
  if (/^\s*labor\b/i.test(desc)) return false;
  return !ACTION_VERB.test(desc);
}

// Service Call / Diagnostic / Emergency wording -> ALWAYS taxed (both PMs; core truth
// #3). Used by the resolveBidLine sentinel to force taxable on an unmatched service line.
const SERVICE_TAXABLE_RE = /\b(diagnostic|service\s*(call|fee|charge)|trip\s*(fee|charge)|emergency)\b/i;

// Resolve ONE bid line to an invoice line. Fallback chain: the WO's CLIENT library
// first, then General, then sentinel. unitPrice = ALWAYS the bid price.
//   confirmed (client or general) -> library name + taxable.
//   client strong-keyword but price off -> RED flag (AMH/MSR = fixed contract) or
//     YELLOW (General agreement); keep sentinel name, attach suspects.
//   general strong-keyword but price off -> YELLOW flag + suspects.
//   nothing -> per-agreement sentinel by verb: material -> Materials!; labor ->
//     Labor! (General) / AMH! / MSR!, each with that catalog's labor-taxable default.
// suspects = [{name, price}] the library item(s) it resembles (drives the UI flag).
// Pure: (wording, price, clientCatalog, generalCatalog, agreement) -> line (no qty).
export function resolveBidLine(wording, price, clientCatalog, generalCatalog, agreement) {
  const bidPrice = priceOf(price);
  const desc = String(wording || '').trim();
  const base = { desc, unitPrice: bidPrice, agreement };
  // Unmatched labor sentinel is ALWAYS 'Labor!' now -- Labor!/Materials! are reserved
  // for items NOT in the library (their true purpose). The client is carried on the
  // line's `agreement`, which drives tax (catalogTax) AND the derived category label
  // (categoryLabel: a CONFIRMED AMH/MSR item reads 'AMH'/'MSR'); the sentinel name no
  // longer encodes the PM. Retiring AMH!/MSR! does NOT change any total (tax = agreement
  // + taxable only). AMH labor still defaults non-taxable via catalogTax(agreement).
  const laborName = () => 'Labor!';
  // The material/labor SPLIT is the tax base computeInvoiceTotals reads, and it is
  // MSR-only: gated on the agreement being tax-inclusive so it can never ride on an AMH
  // line, whose library material/labor columns are internal COST BASIS that deliberately
  // do not sum to the sell price (library_io.js ~92) and are not a tax basis at all
  // (roadmap-handoffs/msr-tax-accuracy.md D7 rules AMH out of this model).
  const inclusive = catalogTax(agreement).taxableInclusive;
  // Field names reused from the library items on purpose (NOT a new `taxableBase`): the
  // line and the catalog then speak one language -- the invoice editor already renders
  // material/labor cells and computeInvoiceTotals reads exactly these two names.
  const split = (laborPortion) => (inclusive
    ? { material: money(bidPrice - laborPortion), labor: money(laborPortion) }
    : {});
  const sentinel = () => {
    // Service Call / Diagnostic / Emergency are ALWAYS taxed (both PMs) and are a
    // billable SERVICE (labor), not a material -- even though the wording is verbless
    // (would otherwise fall to Materials!). Force labor + taxable. (Core truth #3.)
    if (SERVICE_TAXABLE_RE.test(desc)) {
      return { ...base, ...split(bidPrice), name: laborName(), category: 'labor', taxable: true };
    }
    // No library counterpart -> no catalog split, so read the wording convention the
    // user already writes by hand in the bid sheet free-text box (D6, 13 of 13 on real
    // data): a "Material(s)" lead is 100% material and untaxed, a "Labor"/verb lead is
    // 100% labor and fully tax-bearing.
    const mat = isMaterialWording(desc);
    if (mat) {
      // Fits NEITHER lead and carries no action verb: isMaterialWording files it as
      // material, the conservative direction on a tax record, but on a tax-inclusive
      // agreement that split is a guess -- surface it for a human ruling on the EXISTING
      // priceFlag/FlagResolveModal path (yellow = needs a look, not a contract breach)
      // rather than inventing a second flag concept.
      const ambiguous = inclusive && !/^\s*materials?\b/i.test(desc);
      return { ...base, ...split(0), name: 'Materials!', category: 'material', taxable: false,
        ...(ambiguous ? { priceFlag: 'yellow' } : {}) };
    }
    // Labor fallback: taxable = the catalog's labor default. General and MSR labor is
    // taxed (CATALOG_TAX.*.defaultLaborTaxable true); AMH defaults FALSE (Premier pricing
    // is inclusive). A matched library item's own taxable still wins on the confirm path.
    return { ...base, ...split(bidPrice), name: laborName(), category: 'labor', taxable: catalogTax(agreement).defaultLaborTaxable };
  };
  // Category from the bid wording (material vs labor), not hardcoded -- a CONFIRMED
  // material (e.g. a General refrigerant line) must not read as labor. Tax is unaffected
  // (driven by agreement + taxable); PM-listed lines display their client via categoryLabel.
  // A confirmed item also hands over ITS split as the line's tax base ('Included' stays
  // the string sentinel -- never coerced to a number).
  const itemSplit = (it) => (inclusive ? taxSplit(it) : {});
  const confirm = (it) => ({ ...base, ...itemSplit(it), name: it.name, category: isMaterialWording(desc) ? 'material' : 'labor', taxable: !!it.taxable });
  const suspectList = (items) => items.map(s => ({ name: s.name, price: priceOf(s.price) }));
  // Fixed-contract clients flag RED (price off the signed agreement); General drifts -> YELLOW.
  const clientFlag = (agreement === 'AMH' || agreement === 'MSR') ? 'red' : 'yellow';
  const bidIsMaterial = isMaterialWording(desc);   // gates out labor-service matches below

  const client = resolveInCatalog(desc, bidPrice, clientCatalog, bidIsMaterial);
  if (client) {
    if (client.confirmed) return confirm(client.confirmed);
    return { ...sentinel(), suspects: suspectList(client.suspects), priceFlag: clientFlag };
  }
  const gen = resolveInCatalog(desc, bidPrice, generalCatalog, bidIsMaterial);
  if (gen) {
    if (gen.confirmed) return confirm(gen.confirmed);
    return { ...sentinel(), suspects: suspectList(gen.suspects), priceFlag: 'yellow' };
  }
  return sentinel();
}

// Turn a WO's scraped bidItems into InvoiceEditor line items. The scraper emits
// bidItems as { name, qty, price } where `name` HOLDS THE DESCRIPTION. Each line
// runs the resolveBidLine fallback chain (client -> general -> sentinel). The
// invoice price NEVER deviates from the bid (what we are paid); the library only
// supplies identity + taxable on a CONFIRMED (price-matching) keyword hit.
// Pure: (bidItems, clientCatalog, agreement, generalCatalog) -> line[]. Empty -> [].
export function bidItemsToInvoiceLines(bidItems, clientCatalog, agreement, generalCatalog) {
  const bid = Array.isArray(bidItems) ? bidItems : [];
  if (!bid.length) return [];
  return bid.map((b) => {
    const qty = Number(b && b.qty) > 0 ? Number(b.qty) : 1;
    const line = resolveBidLine(String((b && b.name) || '').trim(), priceOf(b && b.price),
      clientCatalog, generalCatalog, agreement);
    return { ...line, qty };
  });
}

// True if the invoice lines already contain a service-call / diagnostic fee. Drives
// the "no service call" red alert (easy to forget; we lose that billing). Checks the
// line name OR its bid description.
export function invoiceHasServiceCall(lines) {
  const re = /\b(diagnostic|service\s*(call|fee|charge)|trip\s*(fee|charge))\b/i;
  return (Array.isArray(lines) ? lines : []).some(l => l && (re.test(l.name || '') || re.test(l.desc || '')));
}

/* ---------- MSR remittance reconcile (invoice-generation Slice 1) ---------- */

// Normalize a WO number to comparable digits: strip a WO-/WO prefix, drop an AMH
// "-N" child/revisit suffix, drop every non-digit, drop leading zeros. So the
// remittance "Invoice Notes : 02045937", the order.woId "02045937", and a minted
// "WO-2045937" all compare equal -- AND the portal's split-WO name "9746663-1"
// joins to its base "9746663" (the remittance token carries the base in W<wo>B and
// the -N separately). The suffix strip MUST precede the /\D/ removal, which would
// otherwise fold "9746663-1" into "97466631" -- a different number, the false-negative.
export function normWoNum(v) {
  return String(v == null ? '' : v)
    .replace(/^WO[-\s]*/i, '')
    .replace(/^(\d+)-\d+$/, '$1')
    .replace(/\D/g, '')
    .replace(/^0+/, '');
}

// Normalize an address for a fallback (non-WO-id) match: lowercase, keep only
// alphanumerics as space-separated tokens, sort them so "412 Sarazen Dr" and
// "Sarazen Dr 412" collapse. Street-NUMBER typos still won't match (by design --
// that mismatch is exactly what the "verify" flag is for).
export function normAddress(v) {
  return String(v == null ? '' : v).toLowerCase().replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

// Match one parsed remittance row to an app order. PRIMARY key = the WO number
// (row.woId = the Invoice Notes number == order.woId, the 8-digit portal number;
// order.id is a minted WO-### so check both). FALLBACK = normalized address
// equality, returned with matchBy:'address' so the UI can flag it "verify" (folder
// name typos make address unreliable). No match -> { order:null, matchBy:'none' }.
export function matchMsrRow(row, orders) {
  const list = Array.isArray(orders) ? orders : [];
  const rn = normWoNum(row && row.woId);
  // A real portal WO number is 7-8 digits. A 1-3 digit token is a PARSE ARTIFACT, and it
  // collides with the minted sequential ids checked below: the GUID note that parsed to
  // "3" matched WO-003 (normWoNum -> "3") and reconciled the 110 Margaret Dr payment
  // against 315 W Barnes St as a confident woId match, no verify flag. Live data has 8
  // orders whose normalized id is under 4 digits. Short token -> skip this branch only;
  // the address fallback and the none path still run. matchAmhRow is an alias of this
  // function, so AMH gets the same guard.
  if (rn && rn.length >= 4) {
    for (const o of list) {
      if (!o) continue;
      if (normWoNum(o.woId) === rn || normWoNum(o.id) === rn) return { order: o, matchBy: 'woId' };
    }
  }
  const ra = normAddress(row && row.addressRaw);
  if (ra) {
    for (const o of list) {
      if (o && normAddress(o.address) === ra) return { order: o, matchBy: 'address' };
    }
  }
  return { order: null, matchBy: 'none' };
}

// Reconcile ONE MSR remittance row against the WO's bid-sheet line items.
// MSR prices are tax-INCLUSIVE, so computed = sum(unitPrice*qty) and should equal
// the paid amount to the penny. bidItems = read-bid-lineitems output
// [{desc, unitPrice, qty}] (already deduped across the bid + CO sheets). match =
// matchMsrRow output. Returns a report block; the user is the FINAL arbitrator, so
// every line + total is meant to be editable downstream. Status:
//   match      computed == paid (to the penny)
//   off        computed != paid (bid on file incomplete, or a genuine discrepancy)
//   no-items   matched WO but no bid-sheet items (likely a service-call-only fix)
//   unmatched  no WO found for this remittance line
// WHY read-bid-lineitems returned nothing (main.js sets res.reason on an ok read;
// callers pass 'read-failed:<msg>' for a failed one). ONE wording shared by both
// readers -- the invoice editor banner and the remittance report flag -- so a silent
// empty can never come back on one path while the other explains itself. Unknown or
// absent reason -> null, and the caller says nothing extra.
export function bidReadReasonText(reason) {
  const r = String(reason || '');
  if (r === 'no-wo-folder') return 'This WO has no folder yet, so no bid sheet was read. Use "Go to folder" to create it, then put the bid sheet inside. A sheet filed anywhere else is not read: one property holds many WOs, so it cannot be attributed.';
  if (r === 'no-bid-sheet') return "No bid or CO sheet in this WO's folder.";
  if (r === 'sheets-had-no-rows') return "Found a bid sheet in this WO's folder but read zero line items from it.";
  if (r === 'no-desktop') return 'Bid sheets can only be read in the desktop app.';
  if (r.indexOf('read-failed:') === 0) return 'Could not read the bid sheet: ' + r.slice(12) + '.';
  return null;
}

export function reconcileMsrRow(row, match, bidItems, statedTotal, reason) {
  const paid = money(Number(row && row.amount));
  const items = Array.isArray(bidItems) ? bidItems : [];
  // Per-line tax breakdown via the tested money core. `taxable` comes from the caller
  // (the module resolves it against the MSR library); MSR is a divide-out, so a taxable
  // line's face price already includes 7.25% -> pre = face/1.0725, tax = face - pre,
  // post = face. A non-taxable/material line: pre = post = face, tax = 0. The grand
  // total = sum(face) either way, so `computed` is unchanged from the raw sum.
  const invLines = items.map(it => ({
    // `name` = the resolved library-canonical name (bidItemsToInvoiceLines set it);
    // `desc` = the original bid wording. Carry both so Slice-3 persistence keeps the
    // canonical name, not just the raw description.
    name: String((it && it.name) || (it && it.desc) || ''),
    desc: String((it && it.desc) || ''),
    unitPrice: money(Number(it && it.unitPrice)),
    qty: Number(it && it.qty) > 0 ? Number(it.qty) : 1,
    taxable: !!(it && it.taxable),
    // The material/labor split IS the tax base for a tax-inclusive line: without it the
    // money core falls back to the old whole-price divide-out. Copied through taxSplit
    // ('Included' stays the string sentinel meaning "bundled into the other side", not 0).
    ...taxSplit(it),
    // Carry the resolveBidLine identity flags so a billed invoice keeps the warning
    // icon (FlagResolveModal) for a price-off / unconfirmed line the user should vet.
    priceFlag: (it && it.priceFlag) || undefined,
    suspects: (it && it.suspects) || undefined,
    category: (it && it.category) || undefined,
    agreement: 'MSR',
  }));
  const t = computeInvoiceTotals({ lineItems: invLines }, 'MSR');
  const lines = invLines.map((l, i) => {
    const post = money(l.unitPrice * l.qty);
    const pre = t.rows[i] ? t.rows[i].lineSubtotal : post;   // pre-tax (divide-out for taxable)
    // The split rides OUT again: this block is what reconcileBlockToInvoice bills from
    // and what the persisted remittance report reopens with. Drop it here and the saved
    // invoice reports a different tax than the report on screen a moment earlier.
    return { name: l.name, desc: l.desc, qty: l.qty, unitPrice: l.unitPrice, taxable: l.taxable, ...taxSplit(l), priceFlag: l.priceFlag, suspects: l.suspects, category: l.category, agreement: 'MSR', pre, tax: money(post - pre), post };
  });
  const preTax = money(t.taxableSubtotal + t.nonTaxableSubtotal);
  const tax = t.tax;
  const computed = t.grandTotal;
  const order = match && match.order;
  const flags = [];
  let status;
  if (!order) {
    status = 'unmatched';
    flags.push('No work order found for this remittance line -- verify manually.');
  } else if (!lines.length) {
    status = 'no-items';
    flags.push('Paid ' + paid.toFixed(2) + ' but no bid-sheet items found -- likely a service-call-only correction; enter the line manually.');
    // ...and SAY WHICH empty state it is. Without this the bulk remittance path showed an
    // unexplained empty WO while the invoice editor explained the identical read.
    const why = bidReadReasonText(reason);
    if (why) flags.push(why);
  } else if (Math.abs(computed - paid) < 0.005) {
    status = 'match';
  } else {
    status = 'off';
    flags.push('Computed ' + computed.toFixed(2) + ' vs paid ' + paid.toFixed(2) + ' (off ' + money(computed - paid).toFixed(2) + ') -- bid on file may be incomplete.');
  }
  // Advisory (non-blocking): the bid sheet states its own BID TOTAL COST (a template
  // formula from labor hours), independent of the free-text lines we extract. If the
  // captured lines do not sum to it, a line was likely dropped or mis-split in capture.
  // Never changes status/total/selection -- just warns. MSR keeps bid price on resolve,
  // so `computed` (over resolved lines) equals the raw extracted sum.
  const stated = Number(statedTotal);
  if (order && lines.length && Number.isFinite(stated) && stated > 0 && Math.abs(computed - stated) >= 0.005) {
    flags.push('Captured ' + computed.toFixed(2) + ' across ' + lines.length + ' line(s) but bid sheet states ' + stated.toFixed(2) + ' -- verify line capture.');
  }
  if (match && match.matchBy === 'address') {
    flags.push('Matched by ADDRESS, not WO id -- verify this is the right work order.');
  }
  return {
    woId: (row && row.woId) || '',
    invoiceNum: (row && row.invoiceNum) || '',
    propCode: (row && row.propCode) || '',
    // Property ID for invoicing: from the matched order (scraper-set), MSR falls back to
    // the remittance property code. AMH remittance PDFs carry no property id.
    propertyId: (order && order.propertyId) || (row && row.propCode) || '',
    address: (order && order.address) || (row && row.addressRaw) || '',
    orderId: order ? order.id : null,
    matchBy: match ? match.matchBy : 'none',
    paid, preTax, tax, postTax: computed, computed, delta: money(computed - paid),
    lines, status, flags,
  };
}

/* ---------- AMH remittance reconcile (invoice-generation Slice 2) ---------- */

// The remittance matcher is agreement-agnostic (WO number first, address fallback),
// so AMH reuses matchMsrRow -- AMH rows have no addressRaw, so the fallback is inert.
export const matchAmhRow = matchMsrRow;

// Reconcile ONE AMH remittance row against the WO's itemized AMH portal-API bid lines.
// AMH Premier prices are tax-INCLUSIVE (Core Truth #2): the reconcile line AMOUNT =
// qty*unitPrice + vendorTax (the figure AMH actually pays), presented taxable:FALSE --
// EXCEPT service call / diagnostic / emergency, which are taxable (Core Truth #3).
// apiItems = [{name, qty, unitPrice/price, vendorTax}] from the captured AMH bid
// (scrape_amh.extract_bids). Each line's AMH-paid amount = qty*unitPrice + vendorTax
// (the reference amh_remittance_scraper.py mechanism). inclusiveTotal = the WO's
// authoritative tax-INCLUSIVE bid total (order.bidAmount, which capture already stores
// as sum(qty*unitPrice + vendorTax)); it is the fallback when a WO was captured BEFORE
// vendorTax was carried per line (its lines sum pre-tax). A WO with no items -> status
// 'unavailable' (aged out). match = matchAmhRow output.
export function reconcileAmhRow(row, match, apiItems, inclusiveTotal) {
  const paid = money(Number(row && row.amount));
  const items = Array.isArray(apiItems) ? apiItems : [];
  let subtotal = 0, perLineTax = 0;
  const lines = items.map(it => {
    const qty = Number(it && it.qty) > 0 ? Number(it.qty) : 1;
    const unit = money(Number(it && (it.unitPrice != null ? it.unitPrice : it.price)));
    const vtax = money(Number(it && it.vendorTax));
    const name = String((it && it.name) || '');
    const desc = String((it && (it.desc || it.name)) || '');
    // AMH inclusive -> non-taxable, EXCEPT service call / diagnostic / emergency.
    const taxable = SERVICE_TAXABLE_RE.test(name) || SERVICE_TAXABLE_RE.test(desc);
    subtotal += unit * qty; perLineTax += vtax;
    const pre = money(unit * qty);
    return { name, desc, qty, unitPrice: unit, vendorTax: vtax, category: 'labor', agreement: 'AMH', pre, tax: vtax, post: money(pre + vtax), amount: money(pre + vtax), taxable };
  });
  subtotal = money(subtotal);
  // Tax: prefer the summed per-line vendorTax (exact, post-fix captures). If it is zero
  // but the authoritative inclusive total exceeds the pre-tax subtotal, the WO was
  // captured before per-line vendorTax was stored -> derive the aggregate tax from
  // bidAmount so the total still matches the remittance (hard rule). Flag it so the
  // user knows to re-capture for the per-line split.
  let tax = money(perLineTax);
  let taxFromBidAmount = false;
  const inc = inclusiveTotal != null ? money(Number(inclusiveTotal)) : null;
  if (tax === 0 && inc != null && inc - subtotal > 0.005) { tax = money(inc - subtotal); taxFromBidAmount = true; }
  const computed = money(subtotal + tax);
  const order = match && match.order;
  const flags = [];
  let status;
  if (!order) {
    status = 'unmatched';
    flags.push('No work order found for this remittance line -- verify manually.');
  } else if (!lines.length) {
    status = 'unavailable';
    flags.push('No AMH bid items retrieved (WO likely aged out of the 100-order API window) -- needs AMH history access; enter items manually.');
  } else if (Math.abs(computed - paid) < 0.005) {
    status = 'match';
    if (taxFromBidAmount) flags.push('Per-line tax not stored (captured before the tax fix) -- tax ' + tax.toFixed(2) + ' taken from the approved bid total. Re-capture this AMH WO for the per-line split.');
  } else {
    status = 'off';
    flags.push('Computed ' + computed.toFixed(2) + ' vs paid ' + paid.toFixed(2) + ' (off ' + money(computed - paid).toFixed(2) + ').');
  }
  if (match && match.matchBy === 'address') {
    flags.push('Matched by ADDRESS, not WO id -- verify this is the right work order.');
  }
  return {
    woId: (row && row.woId) || '',
    invoiceNum: (row && row.invoiceNum) || '',
    bidNum: (row && row.bidNum) || '',
    revisit: (row && row.revisit) || '',
    // Property ID (from the matched order) — the AMH remittance PDF has none; invoicing needs it.
    propertyId: (order && order.propertyId) || '',
    address: (order && order.address) || '',
    orderId: order ? order.id : null,
    matchBy: match ? match.matchBy : 'none',
    paid, preTax: subtotal, subtotal, tax, postTax: computed, computed, delta: money(computed - paid),
    // taxFromBidAmount = tax came from the aggregate bid total, not per-line vendorTax
    // (captured before the tax fix). Slice-3 persistence uses this to require a fresh
    // "Fetch AMH items" before saving (a folded per-line invoice would be short the tax).
    taxFromBidAmount,
    lines, status, flags,
  };
}

/* ---------- Slice 3: persist a reconciled block as a WO invoice ---------- */

// Turn a reconcile report block (reconcileMsrRow / reconcileAmhRow output) into a
// saveable WO invoice { number, date, lineItems } that computeInvoiceTotals
// reproduces to the paid amount. Pure. source = 'amh' | 'msr'.
//   MSR: keep the face unitPrice + taxable flag; MSR is a divide-out so the grand
//        total = sum(face) = paid regardless (Core Truth #1).
//   AMH: FOLD the per-line vendorTax into unitPrice and mark taxable:false -- AMH is
//        NOT tax-inclusive in the invoice model, so a Premier line's paid amount
//        (qty*unitPrice + vendorTax = block line `post`) must be carried as the price
//        (Core Truth #2: present AMH lines non-taxable at the inclusive amount). This
//        is exact only when per-line vendorTax was captured; an aggregate-fallback
//        block (taxFromBidAmount) would be short the tax, so the caller must fetch
//        fresh AMH items first.
export function reconcileBlockToInvoice(block, source, dateIso) {
  const lines = (block && Array.isArray(block.lines)) ? block.lines : [];
  const isAmh = String(source) === 'amh';
  const agreement = isAmh ? 'AMH' : 'MSR';
  const lineItems = lines.map((l) => {
    const qty = Number(l && l.qty) > 0 ? Number(l.qty) : 1;
    const name = String((l && l.name) || (l && l.desc) || '').trim();
    const desc = String((l && l.desc) || '').trim();
    // Carry identity flags (MSR resolve suspects) so the editor lights the warning icon.
    const flags = (l && l.priceFlag) ? { priceFlag: l.priceFlag, suspects: l.suspects } : {};
    if (isAmh) {
      const post = money(Number(l && (l.post != null ? l.post : (Number(l.unitPrice) * qty + Number(l.vendorTax || 0)))));
      return { name, desc, qty, unitPrice: money(post / qty), category: 'labor', taxable: false, agreement, ...flags };
    }
    // MSR carries the SPLIT onto the saved invoice -- it is the tax base, and the saved
    // invoice is the artifact that matters. The AMH branch above deliberately gets none:
    // D7 rules AMH untaxed, and its cost-basis columns are not a tax basis.
    return { name, desc, qty, unitPrice: money(Number(l && l.unitPrice)), category: 'labor', taxable: !!(l && l.taxable), agreement, ...taxSplit(l), ...flags };
  });
  return {
    number: String((block && block.invoiceNum) || '').trim(),
    date: dateIso || new Date().toISOString().slice(0, 10),
    lineItems,
  };
}

/* ---------- Slice 5: recompute / refresh a saved invoice ---------- */

// Re-run the derive pipeline over a SAVED invoice against the CURRENT service
// library and repair drift. Pure. Auto-applies SAFE upgrades (a sentinel line that
// now matches a library item -> its canonical name + taxable; a taxable-flag
// correction) and FLAGS risky ones (a price-off suspect -> priceFlag, no rewrite).
// A line marked edited:true is left untouched (manual-edit protection). The bid
// PRICE is never changed (money rule); only identity/taxable snap. authoritativeTotal
// (optional) = the paid/bid figure; when given, a grand-total mismatch > $0.005 is
// reported in totalFlag. Returns { lines, changes:[{lineIdx,field,from,to}], totalDelta }.
const SENTINELS = new Set(['AMH!', 'MSR!', 'Labor!', 'Materials!']);

// A line is "PM-listed" when it is a CONFIRMED item from the AMH/MSR catalog (real
// library name, not a sentinel). Such lines take their client as the category label
// (derived from `agreement`, not stored) so the fuzzy labor/material heuristic runs
// ONLY for General + unlisted items. Old saved invoices with the retired AMH!/MSR!
// names are in SENTINELS, so they correctly read as unlisted (labor/material).
export function isPmListed(line) {
  const ag = line && line.agreement;
  return (ag === 'AMH' || ag === 'MSR') && !SENTINELS.has(String((line && line.name) || ''));
}
// Category label for display: 'AMH'/'MSR' for a PM-listed line, else labor/material.
export function categoryLabel(line) {
  if (isPmListed(line)) return line.agreement;
  return (line && line.category === 'material') ? 'material' : 'labor';
}
// RazorSync catalog SENTINEL for a line = the catalog "name" the user picks in
// RazorSync (which sets taxability RazorSync-side). Display/copy-only, no new field:
// derived from categoryLabel. AMH/MSR = the confirmed client item; labor/material =
// the unlisted fallback. { AMH:'AMH!', MSR:'MSR!', labor:'Labor!', material:'Materials!' }.
export function sentinelTag(line) {
  return { AMH: 'AMH!', MSR: 'MSR!', labor: 'Labor!', material: 'Materials!' }[categoryLabel(line)];
}

// RazorSync ENTRY rows for ONE line. RazorSync is the official invoice record (D2) and
// applies tax PER LINE from the catalog item, so a MIXED tax-inclusive line (taxed labor
// PLUS untaxed material) cannot enter as one row: a taxable row would tax the material,
// which D1 forbids, and an untaxed row records zero tax on work that carries tax. Section
// 7 ruling: the material portion enters under the non-taxable `Materials!` item and the
// PRE-TAX labor under the taxable `MSR!` item, so RazorSync re-adds 7.25% to the second
// row and the two rows land on the face price. Everything else stays ONE row, as today.
//
// The two prices sum to the line's PRE-TAX total (li.pre), NOT to the face: the face is
// what RazorSync arrives at AFTER it applies tax to the MSR! row. Material is taken as
// the REMAINDER of li.pre so the pair can never drift a cent from the money core.
//
// Pure: (line, defaultAgreement) -> [{ tag, desc, price }]. The remittance display AND
// CopyStepper both read THIS function, so the rows a user sees and the rows they copy
// cannot fall out of step.
export function razorSyncRows(line, defaultAgreement) {
  const li = line || {};
  const desc = li.desc || '';
  const pre = money(Number(li.pre) || 0);
  const single = [{ tag: sentinelTag(li), desc, price: pre }];
  // Same load-bearing gate laborShare sits behind: AMH library material/labor columns are
  // internal COST BASIS, never a tax basis, so AMH can never reach the split path (D7).
  if (!catalogTax(li.agreement || defaultAgreement).taxableInclusive) return single;
  if (!hasTaxSplit(li)) return single;
  const share = laborShare(li);
  if (!(share > 0 && share < 1)) return single;   // all-labor or all-material: one row
  const qty = Number(li.qty) > 0 ? Number(li.qty) : 1;
  const face = money(Number(li.unitPrice) * qty);
  const preTaxLabor = money(money(face * share) / TAX_RATE);
  return [
    { tag: 'Materials!', desc, price: money(pre - preTaxLabor) },
    { tag: 'MSR!', desc, price: preTaxLabor },
  ];
}
export function recomputeInvoice(savedInvoice, clientCatalog, generalCatalog, defaultAgreement, authoritativeTotal) {
  const saved = (savedInvoice && Array.isArray(savedInvoice.lineItems)) ? savedInvoice.lineItems : [];
  const changes = [];
  const before = computeInvoiceTotals({ lineItems: saved }, defaultAgreement).grandTotal;
  const lines = saved.map((l, idx) => {
    if (!l || l.edited) return l;   // honor manual-edit protection
    const agreement = l.agreement || defaultAgreement;
    // Re-resolve from the line's own wording (desc holds the bid text; fall back to name).
    const wording = String(l.desc || l.name || '').trim();
    const res = resolveBidLine(wording, Number(l.unitPrice), clientCatalog, generalCatalog, agreement);
    const next = { ...l };
    const resIsSentinel = SENTINELS.has(res.name);
    const curIsSentinel = SENTINELS.has(String(l.name || ''));
    const flagged = !!(res.priceFlag || res.suspects);
    const change = (field, from, to) => { changes.push({ lineIdx: idx, field, from, to }); };
    // Adopt the re-resolved SPLIT exactly like name/taxable are adopted. Saved invoices
    // predate the split, D3 rules that they recompute, and this is the only repair path --
    // without it a pre-existing invoice stays split-less forever and keeps reporting the
    // whole-price tax. Logged through change() so the repair is visible like any other
    // field. Money is untouched: on a tax-inclusive line the total is the face either way,
    // only the reported service/tax split moves. Non-inclusive agreements re-resolve with
    // no split at all, so AMH/General adopt nothing.
    const adoptSplit = () => {
      const s = taxSplit(res);
      if (s.material !== undefined && s.material !== l.material) { change('material', l.material == null ? null : l.material, s.material); next.material = s.material; }
      if (s.labor !== undefined && s.labor !== l.labor) { change('labor', l.labor == null ? null : l.labor, s.labor); next.labor = s.labor; }
    };
    // Price-off suspect: surface the flag for review, NEVER auto-rewrite the money.
    if (flagged && res.priceFlag && !l.priceFlag) { change('priceFlag', l.priceFlag || null, res.priceFlag); next.priceFlag = res.priceFlag; next.suspects = res.suspects; }
    if (curIsSentinel) {
      // UNLISTED / legacy line: the name is not identity-bearing, so normalize FREELY
      // even under a price flag -- migrate a legacy AMH!/MSR! to Labor!/Materials! (or a
      // confirmed canonical), re-derive labor/material category (fixes a material saved
      // as labor, e.g. R410A), and re-derive taxable. Money is never touched.
      if (res.name && res.name !== l.name) { change('name', l.name, res.name); next.name = res.name; }
      if (res.category && res.category !== l.category) { change('category', l.category, res.category); next.category = res.category; }
      if (!!res.taxable !== !!l.taxable) { change('taxable', !!l.taxable, !!res.taxable); next.taxable = !!res.taxable; }
      adoptSplit();
    } else if (!flagged) {
      // CONFIRMED real name, clean re-resolve: snap to the canonical library name + taxable;
      // keep the stored category. Never clobber a real name with a sentinel (library item
      // may have been removed) and never touch a price-flagged confirmed line.
      if (!resIsSentinel && res.name && res.name !== l.name) { change('name', l.name, res.name); next.name = res.name; }
      if (!!res.taxable !== !!l.taxable) { change('taxable', !!l.taxable, !!res.taxable); next.taxable = !!res.taxable; }
      adoptSplit();
    }
    return next;
  });
  const after = computeInvoiceTotals({ lineItems: lines }, defaultAgreement).grandTotal;
  const totalDelta = money(after - before);
  let totalFlag = null;
  if (authoritativeTotal != null) {
    const off = money(after - money(Number(authoritativeTotal)));
    if (Math.abs(off) > 0.005) totalFlag = off;
  }
  return { lines, changes, totalDelta, totalFlag };
}

// Rename a section label across the whole library: rewrite every item's
// subCategory old->new in every catalog. Pure; caller persists the result.
// Merge falls out naturally (two names -> one). Guards non-array values.
export function renameSubCategory(lib, oldName, newName) {
  if (!lib || !oldName || !newName || oldName === newName) return lib;
  const next = {};
  for (const [cat, arr] of Object.entries(lib)) {
    next[cat] = Array.isArray(arr)
      ? arr.map(it => it && it.subCategory === oldName ? { ...it, subCategory: newName } : it)
      : arr;
  }
  return next;
}

// W6: rename an L2 page within ONE catalog: rewrite item.page old->new for that
// catalog's items only (mirror of renameSubCategory, scoped to a single key).
// Order-preserving + immutable; other catalogs keep their array refs. Merge falls
// out (two page names -> one). Pure; caller persists.
export function renamePage(lib, catalog, oldPage, newPage) {
  if (!lib || !catalog || !oldPage || !newPage || oldPage === newPage || !Array.isArray(lib[catalog])) return lib;
  return { ...lib, [catalog]: lib[catalog].map(it => it && it.page === oldPage ? { ...it, page: newPage } : it) };
}

// W6: delete an L2 page = NULL the page on its items (non-destructive, mirrors the
// subcategory policy: items survive, they just lose their page). Scoped to one
// catalog. Order-preserving + immutable. Pure; caller confirm-gates + persists.
export function deletePage(lib, catalog, page) {
  if (!lib || !catalog || !page || !Array.isArray(lib[catalog])) return lib;
  return { ...lib, [catalog]: lib[catalog].map(it => it && it.page === page ? { ...it, page: null } : it) };
}

// S5: persistent EMPTY containers. Pages/sections normally derive from items;
// these two settings stores let an empty page or section persist with zero items
// ("empty container" model, chosen over seed-on-first-item). All pure/immutable,
// return the input UNCHANGED on a blank name or no-op (mirrors renamePage policy).
// libraryPages shape: { [catalog]: string[] } (declared empty page names).
export function addPage(store, catalog, page) {
  const name = (page || '').trim();
  if (!store || !catalog || !name) return store;
  const arr = store[catalog] || [];
  if (arr.includes(name)) return store;
  return { ...store, [catalog]: [...arr, name] };
}
export function removePage(store, catalog, page) {
  const name = (page || '').trim();
  if (!store || !catalog || !name || !Array.isArray(store[catalog]) || !store[catalog].includes(name)) return store;
  return { ...store, [catalog]: store[catalog].filter(p => p !== name) };
}
export function renamePageInStore(store, catalog, oldName, newName) {
  const nn = (newName || '').trim();
  if (!store || !catalog || !oldName || !nn || oldName === nn || !Array.isArray(store[catalog]) || !store[catalog].includes(oldName)) return store;
  return { ...store, [catalog]: store[catalog].map(p => p === oldName ? nn : p) };
}
// librarySections shape: { [catalog]: { [pageKey]: string[] } } where pageKey is
// the page name, or '' for the no-page (page===null / all) view. pageKey === ''
// is a valid key, so it is defaulted (`pageKey || ''`) not guarded as falsy.
export function addSection(store, catalog, pageKey, name) {
  const nm = (name || '').trim();
  if (!store || !catalog || !nm) return store;
  const pk = pageKey || '';
  const cat = store[catalog] || {};
  const arr = cat[pk] || [];
  if (arr.includes(nm)) return store;
  return { ...store, [catalog]: { ...cat, [pk]: [...arr, nm] } };
}
export function removeSection(store, catalog, pageKey, name) {
  const nm = (name || '').trim();
  if (!store || !catalog || !nm) return store;
  const pk = pageKey || '';
  const cat = store[catalog];
  if (!cat || !Array.isArray(cat[pk]) || !cat[pk].includes(nm)) return store;
  return { ...store, [catalog]: { ...cat, [pk]: cat[pk].filter(s => s !== nm) } };
}
export function renameSectionInStore(store, catalog, pageKey, oldName, newName) {
  const nn = (newName || '').trim();
  if (!store || !catalog || !oldName || !nn || oldName === nn) return store;
  const pk = pageKey || '';
  const cat = store[catalog];
  if (!cat || !Array.isArray(cat[pk]) || !cat[pk].includes(oldName)) return store;
  return { ...store, [catalog]: { ...cat, [pk]: cat[pk].map(s => s === oldName ? nn : s) } };
}

// Item 2: rename a CUSTOM catalog = rename the service_library KEY in place
// (Object.entries preserves order). Collision / missing / built-in guards are the
// caller's (built-ins are semantic: General fallback, CATALOG_TAX, red-flag).
export function renameCatalog(lib, oldName, newName) {
  if (!lib || !oldName || !newName || oldName === newName || !(oldName in lib) || (newName in lib)) return lib;
  const next = {};
  for (const [cat, arr] of Object.entries(lib)) next[cat === oldName ? newName : cat] = arr;
  return next;
}

// Delete a CUSTOM catalog = drop the service_library KEY (order preserved for the
// survivors). Built-in guard is the caller's (built-ins are semantic: General
// fallback, CATALOG_TAX, red-flag) -- mirrors renameCatalog. Non-destructive to
// saved invoices: any line whose agreement named this catalog keeps the string and
// resolves to DEFAULT_CATALOG_TAX (same tax as before), so totals are unaffected.
export function deleteCatalog(lib, name) {
  if (!lib || !name || !(name in lib)) return lib;
  const next = {};
  for (const [cat, arr] of Object.entries(lib)) { if (cat !== name) next[cat] = arr; }
  return next;
}

// W3: merge a whole catalog into another as an L2 page. Each lib[src] item moves
// into lib[dest] with item.page = src; if the item already carries a page, it is
// nested (`src + ' / ' + page`) so its prior grouping survives. The src key is
// dropped; moved items append after dest's existing items (both orders preserved).
// Immutable. Policy guards are caller-supplied so orders-logic stays React-free
// (no LIBRARY_TABS / masterCatalog import): opts.builtins = pinned catalogs the src
// may not be, opts.master = the master library the src may not be. Structural guards
// (src/dest exist, src !== dest) are inline. Returns lib unchanged on any violation.
export function mergeCatalogAsPage(lib, src, dest, opts = {}) {
  const builtins = opts.builtins || [];
  const master = opts.master || null;
  if (!lib || !src || !dest || src === dest) return lib;
  if (!Array.isArray(lib[src]) || !Array.isArray(lib[dest])) return lib;
  if (builtins.includes(src) || src === master) return lib;
  const moved = lib[src].map(it => it ? { ...it, page: it.page ? src + ' / ' + it.page : src } : it);
  const next = {};
  for (const [cat, arr] of Object.entries(lib)) {
    if (cat === src) continue;
    next[cat] = cat === dest ? [...arr, ...moved] : arr;
  }
  return next;
}

// Item 2: cascade a catalog rename to saved invoice line agreements so a renamed
// custom catalog does not orphan its billed lines (mirror of app.jsx renameClientCode).
// Totals are unaffected: custom catalogs all resolve to DEFAULT_CATALOG_TAX.
export function renameLineAgreement(orders, oldName, newName) {
  if (!Array.isArray(orders) || !oldName || !newName || oldName === newName) return orders;
  return orders.map(o => {
    const li = o && o.invoice && Array.isArray(o.invoice.lineItems) ? o.invoice.lineItems : null;
    if (!li || !li.some(l => l && l.agreement === oldName)) return o;
    return { ...o, invoice: { ...o.invoice, lineItems: li.map(l => l && l.agreement === oldName ? { ...l, agreement: newName } : l) } };
  });
}

// Item 1: persisted remittance history reducers (renderer holds the array; window.storage
// key `remittance_history`). Pure so they test without electron.
// upsert: newest-first, de-duped on source+fileName+invoiceDate so re-parsing the same
// statement on the same day REPLACES the prior snapshot instead of piling up.
export function upsertRemittanceHistory(list, snapshot) {
  const arr = Array.isArray(list) ? list : [];
  if (!snapshot) return arr;
  const key = s => String((s && s.source) || '') + '|' + String((s && s.fileName) || '') + '|' + String((s && s.invoiceDate) || '');
  const k = key(snapshot);
  return [snapshot, ...arr.filter(s => key(s) !== k)];
}
// remove one snapshot by id; unknown id is a no-op (returns the same-content array).
export function removeRemittanceById(list, id) {
  const arr = Array.isArray(list) ? list : [];
  return arr.filter(s => !(s && s.id === id));
}
