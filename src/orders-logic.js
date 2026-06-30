// Pure order/phase/age/migration logic. Carved out of app.jsx so node tests
// import the SHIPPED code instead of a hand-copied mirror (the change11 drift
// that produced false-green tests). React-free; depends only on constants.js.
import { DEFAULT_PHASES, DEFAULT_STATUSES, isCompletionStatusName } from './constants.js';

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

// Age in days, scoped to the current tab.
// - paid:      null (no age, no tint — WO is finalized)
// - sent:      days since the most recent 'sent to billing queue' history entry.
// change11:
// - complete:  days since the most recent 'marked complete' history entry.
//              Surfaces aging color coding on the Complete tab (not yet paid).
// - sent:      days since the most recent 'sent to billing' entry — used
//              ONLY by the Invoices module's aging buckets, not by ageDaysFor
//              directly (sent rows do not display an age in the WO list).
// - other:     days since dateCreated (legacy behavior).
export function ageDaysFor(o) {
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
        // Auto-unschedule per change11 rule: complete WOs leave the itinerary.
        if (next.schedule) delete next.schedule;
      }
    }
    if (next.deleted && !next.status) next.status = 'Cancelled';
    return next;
  });
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

// Active -> Complete. Hardcodes status, saves prevStatus for Reopen, unschedules.
export function applyMarkComplete(cur) {
  const prior = cur.status || 'Open';
  const next = {
    ...cur,
    tab: 'complete',
    prevStatus: cur.prevStatus || prior,
    status: 'Complete - Pending Approval',
  };
  if (next.schedule) delete next.schedule;
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

// Complete -> Sent (billing queue). Unschedules.
export function applySendToInvoice(cur) {
  const next = { ...cur, tab: 'sent' };
  if (next.schedule) delete next.schedule;
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

// Today as YYYY-MM-DD (local), for expired-schedule comparison.
export function itinTodayStr() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
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
    if (next.schedule) delete next.schedule;
    next.history = appendHistory(o, 'auto-flipped to Complete (change11 v4)',
      'phase=' + phaseName + ' status=' + (o.status || '') + ' → Complete - Pending Approval');
    return next;
  });
  // Pass 4: clear expired schedules in the SAME write.
  const today = itinTodayStr();
  let expiredCleared = 0;
  const finalOrders = nextOrders.map(o => {
    if (!o || !o.schedule || !o.schedule.date) return o;
    if (o.schedule.date >= today) return o;
    expiredCleared++;
    const clone = { ...o };
    const wasDate = clone.schedule.date;
    delete clone.schedule;
    clone.history = appendHistory(o, 'auto-unscheduled (expired)', 'was ' + wasDate);
    return clone;
  });
  return { orders: finalOrders, flipped, promotedFromInvoiced, hardcodedComplete,
    hardcodedCancelled, revertedFromComplete, expiredCleared };
}
