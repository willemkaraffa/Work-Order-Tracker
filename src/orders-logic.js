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
function resolveInCatalog(wording, price, catalog) {
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
    let score = 0, distinctTotal = 0, distinctShared = 0;
    for (const t of toks) {
      const s = idf(t);
      if (w.has(t)) score += s;
      if (s >= MATCH_GENERIC_IDF) { distinctTotal += s; if (w.has(t)) distinctShared += s; }
    }
    if (score < MATCH_MIN_IDF) continue;
    if (distinctTotal > 0 && distinctShared / distinctTotal < MATCH_MIN_COVER) continue;
    scored.push({ it: items[i], score });
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
  return { suspects: topGroup.map(s => s.it) };
}

// Labor vs Material for a bid line with no confirmed match. User rule: a line is
// MATERIAL if it says "Material -/:", or has NO action verb (materials are things,
// not actions); otherwise it's LABOR (action verbs: replace/install/clear/etc.).
const ACTION_VERB = /\b(replac|instal|clear|repair|clean|augur|remov|correct|cut|inspect|unclog|snak|run|flush|seal|patch|test|reset|rewir|mount|connect|adjust|tighten|drain|fix|swap)\w*/i;
function isMaterialWording(desc) {
  if (/^\s*material\s*[-:]/i.test(desc)) return true;
  return !ACTION_VERB.test(desc);
}

// Resolve ONE bid line to an invoice line. Fallback chain: the WO's CLIENT library
// first, then General, then sentinel. unitPrice = ALWAYS the bid price.
//   confirmed (client or general) -> library name + taxable.
//   client strong-keyword but price off -> RED flag (AMH/MSR = fixed contract) or
//     YELLOW (General agreement); keep sentinel name, attach suspects.
//   general strong-keyword but price off -> YELLOW flag + suspects.
//   nothing -> plain Labor!/Materials! sentinel by verb.
// suspects = [{name, price}] the library item(s) it resembles (drives the UI flag).
// Pure: (wording, price, clientCatalog, generalCatalog, agreement) -> line (no qty).
export function resolveBidLine(wording, price, clientCatalog, generalCatalog, agreement) {
  const bidPrice = priceOf(price);
  const desc = String(wording || '').trim();
  const base = { desc, unitPrice: bidPrice, agreement };
  const sentinel = () => {
    const mat = isMaterialWording(desc);
    return { ...base, name: mat ? 'Materials!' : 'Labor!', category: mat ? 'material' : 'labor',
      taxable: mat ? false : catalogTax(agreement).defaultLaborTaxable };
  };
  const confirm = (it) => ({ ...base, name: it.name, category: 'labor', taxable: !!it.taxable });
  const suspectList = (items) => items.map(s => ({ name: s.name, price: priceOf(s.price) }));
  // Fixed-contract clients flag RED (price off the signed agreement); General drifts -> YELLOW.
  const clientFlag = (agreement === 'AMH' || agreement === 'MSR') ? 'red' : 'yellow';

  const client = resolveInCatalog(desc, bidPrice, clientCatalog);
  if (client) {
    if (client.confirmed) return confirm(client.confirmed);
    return { ...sentinel(), suspects: suspectList(client.suspects), priceFlag: clientFlag };
  }
  const gen = resolveInCatalog(desc, bidPrice, generalCatalog);
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
