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
  const has = (v) => String(v || '').toLowerCase().includes(needle);
  return has(o.address) || has(o.city) || has(o.pm) || has(o.tech);
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

// Pure. invoice = { lineItems:[{ unitPrice, qty, taxable, agreement }] }.
// defaultAgreement = the WO's catalog tab (General/AMH/MSR), used when a line
// carries no agreement of its own. A taxable line divides the embedded tax out
// only when its catalog is tax-inclusive (catalogTax(agreement).taxableInclusive);
// otherwise the price is pre-tax and tax is added on top.
// Returns per-line breakdown + { taxableSubtotal, nonTaxableSubtotal, tax, grandTotal }.
export function computeInvoiceTotals(invoice, defaultAgreement) {
  const lines = (invoice && Array.isArray(invoice.lineItems)) ? invoice.lineItems : [];
  let taxableSubtotal = 0;   // pre-tax sum of taxable lines
  let nonTaxableSubtotal = 0;
  const rows = lines.map((li) => {
    const qty = Number(li.qty) > 0 ? Number(li.qty) : 1;
    const unit = money(Number(li.unitPrice));
    const taxable = !!li.taxable;
    const inclusive = catalogTax(li.agreement || defaultAgreement).taxableInclusive;
    // Accumulate raw (unrounded) line values so the cent rounding happens once
    // on the subtotals, not per line (avoids 1-cent drift on multi-line invoices).
    const preTaxUnitRaw = (taxable && inclusive) ? (unit / TAX_RATE) : unit;
    const lineRaw = preTaxUnitRaw * qty;
    if (taxable) taxableSubtotal += lineRaw;
    else nonTaxableSubtotal += lineRaw;
    return { ...li, qty, unitPrice: unit, preTaxUnit: money(preTaxUnitRaw), lineSubtotal: money(lineRaw) };
  });
  taxableSubtotal = money(taxableSubtotal);
  nonTaxableSubtotal = money(nonTaxableSubtotal);
  const tax = money(taxableSubtotal * (TAX_RATE - 1));
  const grandTotal = money(taxableSubtotal + tax + nonTaxableSubtotal);
  return { rows, taxableSubtotal, nonTaxableSubtotal, tax, grandTotal };
}

/* ---------- invoice line normalization (Build A) ---------- */

const priceOf = (p) => (typeof p === 'number' ? p : (parseFloat(p) || 0));

// Keyword tokens for fuzzy catalog matching. Lowercase, strip punctuation, drop
// stopwords, and crudely stem trailing -ing/-ed/-es/-s so "replace"/"replacing"/
// "replaced" collapse to one token. Bid wording is human + varies; tokens absorb it.
const MATCH_STOP = new Set(['to','the','a','an','of','for','and','with','in','on','at','new',
  'my','is','are','be','per','up','down','into','through','from','it','that','this','or']);
// Service-catalog BOILERPLATE (post-stem). These recur verbatim on a handful of AMH
// items ("- no additional labor fee", "Includes ...") so plain IDF wrongly ranks them
// DISTINCTIVE and their unshared mass sinks the real item's coverage below the gate.
// They carry no identity, so strip them at tokenization -- object nouns (contactor,
// faucet, coil) still carry the match. Also matches the handoff's "fee/labor near-zero".
const MATCH_BOILER = new Set(['fee','labor','no','additional','include','includ','necessary',
  'provide','provid','as','when']);
function matchTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(Boolean).map(t => t.replace(/(ing|ed|es|s)$/, ''))
    // Drop stopwords, boilerplate, and BARE NUMBERS ("9 lbs" must not match "9-GPM
    // tankless"; tonnage variants disambiguate by PRICE, not the digit). Alphanumerics
    // like "r410a"/"50ft" survive as one token.
    .filter(t => t && !MATCH_STOP.has(t) && !MATCH_BOILER.has(t) && !/^\d+$/.test(t));
}

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
    if (distinctTotal > 0 && distinctShared / distinctTotal < MATCH_MIN_COVER) continue;
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
const ACTION_VERB = /\b(replac|instal|clear|repair|clean|augur|remov|correct|cut|inspect|unclog|snak|run|flush|seal|patch|test|reset|rewir|mount|connect|adjust|tighten|fix|swap)\w*/i;
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
  const sentinel = () => {
    // Service Call / Diagnostic / Emergency are ALWAYS taxed (both PMs) and are a
    // billable SERVICE (labor), not a material -- even though the wording is verbless
    // (would otherwise fall to Materials!). Force labor + taxable. (Core truth #3.)
    if (SERVICE_TAXABLE_RE.test(desc)) {
      return { ...base, name: laborName(), category: 'labor', taxable: true };
    }
    const mat = isMaterialWording(desc);
    if (mat) return { ...base, name: 'Materials!', category: 'material', taxable: false };
    // Labor fallback: taxable = the catalog's labor default. General labor is taxed;
    // AMH/MSR default FALSE (AMH inclusive; MSR sheets tax-included). A matched library
    // item's own taxable still wins on the confirm path.
    return { ...base, name: laborName(), category: 'labor', taxable: catalogTax(agreement).defaultLaborTaxable };
  };
  // Category from the bid wording (material vs labor), not hardcoded -- a CONFIRMED
  // material (e.g. a General refrigerant line) must not read as labor. Tax is unaffected
  // (driven by agreement + taxable); PM-listed lines display their client via categoryLabel.
  const confirm = (it) => ({ ...base, name: it.name, category: isMaterialWording(desc) ? 'material' : 'labor', taxable: !!it.taxable });
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
  if (rn) {
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
export function reconcileMsrRow(row, match, bidItems) {
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
    // Carry the resolveBidLine identity flags so a billed invoice keeps the warning
    // icon (FlagResolveModal) for a price-off / unconfirmed line the user should vet.
    priceFlag: (it && it.priceFlag) || undefined,
    suspects: (it && it.suspects) || undefined,
    agreement: 'MSR',
  }));
  const t = computeInvoiceTotals({ lineItems: invLines }, 'MSR');
  const lines = invLines.map((l, i) => {
    const post = money(l.unitPrice * l.qty);
    const pre = t.rows[i] ? t.rows[i].lineSubtotal : post;   // pre-tax (divide-out for taxable)
    return { name: l.name, desc: l.desc, qty: l.qty, unitPrice: l.unitPrice, taxable: l.taxable, priceFlag: l.priceFlag, suspects: l.suspects, pre, tax: money(post - pre), post };
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
  } else if (Math.abs(computed - paid) < 0.005) {
    status = 'match';
  } else {
    status = 'off';
    flags.push('Computed ' + computed.toFixed(2) + ' vs paid ' + paid.toFixed(2) + ' (off ' + money(computed - paid).toFixed(2) + ') -- bid on file may be incomplete.');
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
    return { name, desc, qty, unitPrice: unit, vendorTax: vtax, pre, tax: vtax, post: money(pre + vtax), amount: money(pre + vtax), taxable };
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
    return { name, desc, qty, unitPrice: money(Number(l && l.unitPrice)), category: 'labor', taxable: !!(l && l.taxable), agreement, ...flags };
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
    } else if (!flagged) {
      // CONFIRMED real name, clean re-resolve: snap to the canonical library name + taxable;
      // keep the stored category. Never clobber a real name with a sentinel (library item
      // may have been removed) and never touch a price-flagged confirmed line.
      if (!resIsSentinel && res.name && res.name !== l.name) { change('name', l.name, res.name); next.name = res.name; }
      if (!!res.taxable !== !!l.taxable) { change('taxable', !!l.taxable, !!res.taxable); next.taxable = !!res.taxable; }
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
