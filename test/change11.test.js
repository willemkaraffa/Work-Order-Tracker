// change11 state-transition test harness. Extracts the pure logic from
// index.html (migrateOrders, reconciler core, ageDaysFor, phaseForOrder,
// isCompletionStatus, handler semantics) and runs it against scripted
// scenarios — including a real sample of the user's data shape.
//
// Why a separate harness instead of jsdom on index.html: change11 is pure
// data-shape logic. jsdom would add 600ms+ of overhead and force us to inline
// React. Direct extraction is faster and lets us assert on the actual
// transformations.
//
// Run:  node test/change11.test.js
// Exit code: 0 = all green, 1 = at least one fail.

'use strict';

const assert = require('assert');
const { loadEsm } = require('./_load.js');

// SHIPPED logic imported via the esbuild bridge — no more hand-copied mirrors.
// phaseFor / phaseForOrder / daysSince / ageDaysFor / migrateOrders /
// migrateSettingsForChange11 come from src/orders-logic.js; DEFAULT_PHASES /
// DEFAULT_STATUSES / isCompletionStatusName from src/constants.js. Breaking any
// branch in those now turns THIS test red — that is the change11 drift fix.
const {
  phaseFor, phaseForOrder, daysSince, ageDaysFor, migrateOrders, migrateSettingsForChange11,
  applyMarkComplete, applyReopen, applySendToInvoice, reconcileChange11, itinTodayStr,
  wasVisited, isTrashedReimport,
} = loadEsm('src/orders-logic.js');
const { DEFAULT_PHASES, DEFAULT_STATUSES, isCompletionStatusName } = loadEsm('src/constants.js');
const isCompletionStatus = isCompletionStatusName; // existing test bodies call isCompletionStatus

// Aliases: existing test bodies keep their names but now exercise SHIPPED code.
// reconcileChange11 carries the real v6 revert logic (a superset of the old
// distilled reconcileV5); the prior assertions hold and new branches are covered.
const reconcileV5   = reconcileChange11;
const markComplete  = applyMarkComplete;
const reopen        = applyReopen;
const sendToInvoice = applySendToInvoice;

// softDelete / restore / applySetStatus remain LOCAL distillations: those
// transforms are still inline inside the woAction switch + bulk ops in app.jsx,
// not yet extracted. See roadmap-handoffs/qa-gaps-remaining.md.

function softDelete(o) {
  const next = {
    ...o, deleted: true, tab: 'trash',
    prevStatus: o.prevStatus || o.status || 'Open',
    status: 'Cancelled',
  };
  if (next.schedule) delete next.schedule;
  return next;
}

function restore(o) {
  const restored = o.prevStatus || 'Open';
  const next = { ...o, deleted: false, status: restored, tab: 'active' };
  delete next.prevStatus;
  return next;
}

function applySetStatus(o, payload) {
  const sl = String(payload || '').toLowerCase();
  const isCompletion = payload === 'Pending-Complete' || payload === 'Closed' || sl.includes('job complete');
  if ((o.tab || 'active') === 'active' && isCompletion) {
    const next = {
      ...o, tab: 'complete',
      prevStatus: o.prevStatus || payload,
      status: 'Complete - Pending Approval',
    };
    if (next.schedule) delete next.schedule;
    return next;
  }
  return { ...o, status: payload };
}

// ─── Test runner ─────────────────────────────────────────────────────────────

const results = [];
let failures = 0;
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) {
    failures++;
    results.push({ name, ok: false, err: e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : '') });
  }
}

// ─── State-transition tests ──────────────────────────────────────────────────

test('markComplete: saves prevStatus + hardcodes + unschedules', () => {
  const o = { id: 'A', tab: 'active', status: 'Bid Submitted - Job Complete', schedule: { date: '2030-01-01', start: '09:00' } };
  const r = markComplete(o);
  assert.strictEqual(r.tab, 'complete');
  assert.strictEqual(r.status, 'Complete - Pending Approval');
  assert.strictEqual(r.prevStatus, 'Bid Submitted - Job Complete');
  assert.strictEqual(r.schedule, undefined);
});

test('markComplete: idempotent on prevStatus when called twice', () => {
  const o1 = { id: 'A', tab: 'active', status: 'Open' };
  const r1 = markComplete(o1);
  const r2 = markComplete(r1);
  assert.strictEqual(r2.prevStatus, 'Open');
  assert.strictEqual(r2.status, 'Complete - Pending Approval');
});

test('reopen: complete → active restores prevStatus and clears prevStatus field', () => {
  const o = { id: 'A', tab: 'complete', status: 'Complete - Pending Approval', prevStatus: 'Parts Pending' };
  const r = reopen(o);
  assert.strictEqual(r.tab, 'active');
  assert.strictEqual(r.status, 'Parts Pending');
  assert.strictEqual(r.prevStatus, undefined);
});

test('reopen: sent → complete re-hardcodes + preserves prevStatus', () => {
  const o = { id: 'A', tab: 'sent', status: 'Complete - Pending Approval', prevStatus: 'Job Complete - Enter Bid' };
  const r = reopen(o);
  assert.strictEqual(r.tab, 'complete');
  assert.strictEqual(r.status, 'Complete - Pending Approval');
  assert.strictEqual(r.prevStatus, 'Job Complete - Enter Bid');
});

test('softDelete: hardcodes Cancelled + saves prevStatus + unschedules + tab=trash', () => {
  const o = { id: 'A', tab: 'active', status: 'Open', schedule: { date: '2030-01-01', start: '09:00' } };
  const r = softDelete(o);
  assert.strictEqual(r.deleted, true);
  assert.strictEqual(r.tab, 'trash');
  assert.strictEqual(r.status, 'Cancelled');
  assert.strictEqual(r.prevStatus, 'Open');
  assert.strictEqual(r.schedule, undefined);
});

test('softDelete from Complete preserves the underlying prevStatus', () => {
  const onCompleteTab = { id: 'A', tab: 'complete', status: 'Complete - Pending Approval', prevStatus: 'Bid Submitted - Job Complete' };
  const r = softDelete(onCompleteTab);
  assert.strictEqual(r.status, 'Cancelled');
  assert.strictEqual(r.prevStatus, 'Bid Submitted - Job Complete'); // prior prevStatus wins
});

test('restore: reverts Cancelled to prevStatus + tab=active', () => {
  const o = { id: 'A', deleted: true, tab: 'trash', status: 'Cancelled', prevStatus: 'Parts Pending' };
  const r = restore(o);
  assert.strictEqual(r.deleted, false);
  assert.strictEqual(r.status, 'Parts Pending');
  assert.strictEqual(r.tab, 'active');
  assert.strictEqual(r.prevStatus, undefined);
});

test('restore: prevStatus missing falls back to Open', () => {
  const o = { id: 'A', deleted: true, tab: 'trash', status: 'Cancelled' };
  const r = restore(o);
  assert.strictEqual(r.status, 'Open');
});

test('sendToInvoice: tab=sent + unschedules', () => {
  const o = { id: 'A', tab: 'complete', status: 'Complete - Pending Approval', schedule: { date: '2030-01-01', start: '10:00' } };
  const r = sendToInvoice(o);
  assert.strictEqual(r.tab, 'sent');
  assert.strictEqual(r.schedule, undefined);
});

test('applySetStatus: Active + Pending-Complete → auto-flip + hardcode', () => {
  const o = { id: 'A', tab: 'active', status: 'Open' };
  const r = applySetStatus(o, 'Pending-Complete');
  assert.strictEqual(r.tab, 'complete');
  assert.strictEqual(r.status, 'Complete - Pending Approval');
  assert.strictEqual(r.prevStatus, 'Pending-Complete');
});

test('applySetStatus: Active + custom "Job Complete - Enter Bid" → auto-flip', () => {
  const o = { id: 'A', tab: 'active', status: 'Open' };
  const r = applySetStatus(o, 'Job Complete - Enter Bid');
  assert.strictEqual(r.tab, 'complete');
});

test('applySetStatus: Active + normal status → no flip', () => {
  const o = { id: 'A', tab: 'active', status: 'Open' };
  const r = applySetStatus(o, 'Parts Pending');
  assert.strictEqual(r.tab, 'active');
  assert.strictEqual(r.status, 'Parts Pending');
});

test('applySetStatus: already on Complete + completion status → no double-flip, just status update', () => {
  const o = { id: 'A', tab: 'complete', status: 'Complete - Pending Approval', prevStatus: 'X' };
  const r = applySetStatus(o, 'Bid Submitted - Job Complete');
  assert.strictEqual(r.tab, 'complete');
  // (We don't preserve old prevStatus on direct setStatus when tab is not active —
  //  the auto-flip branch only fires for Active.)
});

// ─── Reconciler v5 — broad-shape tests ───────────────────────────────────────

test('reconciler: tab=invoiced → sent', () => {
  const r = reconcileV5([{ id: 'A', tab: 'invoiced', status: 'X' }], DEFAULT_PHASES);
  assert.strictEqual(r.promotedFromInvoiced, 1);
  assert.strictEqual(r.orders[0].tab, 'sent');
});

test('reconciler: tab=paid → sent', () => {
  const r = reconcileV5([{ id: 'A', tab: 'paid', status: 'X' }], DEFAULT_PHASES);
  assert.strictEqual(r.promotedFromInvoiced, 1);
  assert.strictEqual(r.orders[0].tab, 'sent');
});

test('reconciler: deleted WO without Cancelled status → hardcoded + schedule cleared', () => {
  const o = { id: 'A', deleted: true, tab: 'active', status: 'Parts Pending', schedule: { date: '2030-01-01', start: '09:00' } };
  const r = reconcileV5([o], DEFAULT_PHASES);
  assert.strictEqual(r.hardcodedCancelled, 1);
  assert.strictEqual(r.orders[0].status, 'Cancelled');
  assert.strictEqual(r.orders[0].schedule, undefined);
  assert.strictEqual(r.orders[0].prevStatus, 'Parts Pending');
});

test('reconciler: Active + Pending-Complete → tab=complete, status=hardcoded, prevStatus saved', () => {
  const o = { id: 'A', tab: 'active', status: 'Pending-Complete', schedule: { date: '2030-01-01', start: '09:00' } };
  const r = reconcileV5([o], DEFAULT_PHASES);
  assert.strictEqual(r.flipped, 1);
  assert.strictEqual(r.orders[0].tab, 'complete');
  assert.strictEqual(r.orders[0].status, 'Complete - Pending Approval');
  assert.strictEqual(r.orders[0].prevStatus, 'Pending-Complete');
  assert.strictEqual(r.orders[0].schedule, undefined);
});

test('reconciler: Active + user-custom Job Complete status → flips to Complete', () => {
  const o = { id: 'A', tab: 'active', status: 'Bid Submitted - Job Complete' };
  const r = reconcileV5([o], []);
  assert.strictEqual(r.flipped, 1);
  assert.strictEqual(r.orders[0].tab, 'complete');
});

test('reconciler: legacy phase id (wrap) + active status → flips to Complete', () => {
  const legacyPhases = [
    { id: 'wrap', name: 'Wrapping up', statuses: ['Pending-Complete'] },
  ];
  const o = { id: 'A', tab: 'active', status: 'Pending-Complete' };
  const r = reconcileV5([o], legacyPhases);
  assert.strictEqual(r.flipped, 1);
  assert.strictEqual(r.orders[0].tab, 'complete');
});

test('reconciler: tab=complete with raw status → hardcoded', () => {
  const o = { id: 'A', tab: 'complete', status: 'Bid Submitted - Job Complete' };
  const r = reconcileV5([o], DEFAULT_PHASES);
  assert.strictEqual(r.hardcodedComplete, 1);
  assert.strictEqual(r.orders[0].status, 'Complete - Pending Approval');
  assert.strictEqual(r.orders[0].prevStatus, 'Bid Submitted - Job Complete');
});

test('reconciler: expired schedule cleared even on Active+normal status', () => {
  const o = { id: 'A', tab: 'active', status: 'Parts Pending', schedule: { date: '2020-01-01', start: '09:00' } };
  const r = reconcileV5([o], DEFAULT_PHASES);
  assert.strictEqual(r.expiredCleared, 1);
  assert.strictEqual(r.orders[0].schedule, undefined);
});

test('reconciler: future schedule NOT cleared', () => {
  const o = { id: 'A', tab: 'active', status: 'Parts Pending', schedule: { date: '2099-01-01', start: '09:00' } };
  const r = reconcileV5([o], DEFAULT_PHASES);
  assert.strictEqual(r.expiredCleared, 0);
  assert.deepStrictEqual(r.orders[0].schedule, { date: '2099-01-01', start: '09:00' });
});

test('reconciler: idempotent (running twice produces no further changes)', () => {
  const o = { id: 'A', tab: 'active', status: 'Bid Submitted - Job Complete' };
  const r1 = reconcileV5([o], DEFAULT_PHASES);
  const r2 = reconcileV5(r1.orders, DEFAULT_PHASES);
  assert.strictEqual(r2.flipped, 0);
  assert.strictEqual(r2.hardcodedComplete, 0);
  assert.strictEqual(r2.promotedFromInvoiced, 0);
});

// ─── Real-data shape: user's actual statuses + phases ────────────────────────

const USER_PHASES = [
  { id: 'ph_a', name: 'Open Work Orders', statuses: ['Open', 'Contacted', 'Scheduled'] },
  { id: 'ph_b', name: 'In Progress', statuses: ['On Site', 'Return - Bid Not Entered', 'Bid Submitted - Return', 'Return Trip Scheduled', 'Parts Pending'] },
  { id: 'ph_c', name: 'Job Complete - Submit', statuses: ['Job Complete - Enter Bid', 'Bid Submitted - Job Complete'] },
  { id: 'ph_d', name: 'Cancelled', statuses: ['Cancelled'] },
];

test('user data: status "Bid Submitted - Job Complete" detected as completion via heuristic', () => {
  assert.strictEqual(isCompletionStatus('Bid Submitted - Job Complete'), true);
});

test('v4.0.1: status "Job Complete - Enter Bid" NOT completion (still active workflow)', () => {
  assert.strictEqual(isCompletionStatus('Job Complete - Enter Bid'), false);
});

test('user data: status "Parts Pending" NOT a completion', () => {
  assert.strictEqual(isCompletionStatus('Parts Pending'), false);
});

test('user data: Active + "Bid Submitted - Job Complete" flips via reconciler', () => {
  const o = { id: 'A', tab: 'active', status: 'Bid Submitted - Job Complete', dateCreated: '2026-04-28' };
  const r = reconcileV5([o], USER_PHASES);
  assert.strictEqual(r.flipped, 1);
  assert.strictEqual(r.orders[0].tab, 'complete');
  assert.strictEqual(r.orders[0].status, 'Complete - Pending Approval');
  assert.strictEqual(r.orders[0].prevStatus, 'Bid Submitted - Job Complete');
});

test('user data: tab=invoiced WO migrates to sent (legacy data path)', () => {
  const o = { id: 'A', tab: 'invoiced', status: 'Bid Submitted - Complete', dateCreated: '2026-04-28' };
  const r = reconcileV5([o], USER_PHASES);
  assert.strictEqual(r.promotedFromInvoiced, 1);
  assert.strictEqual(r.orders[0].tab, 'sent');
});

test('user data: deleted Cancelled WO with stale schedule → schedule cleared, no double-status-set', () => {
  const o = { id: 'A', deleted: true, tab: 'active', status: 'Cancelled', schedule: { date: '2026-05-28', start: '14:00' } };
  const r = reconcileV5([o], USER_PHASES);
  // Status already Cancelled, so hardcodedCancelled SHOULD increment because of needsUnsched only
  assert.strictEqual(r.hardcodedCancelled, 1);
  assert.strictEqual(r.orders[0].schedule, undefined);
  assert.strictEqual(r.orders[0].status, 'Cancelled');
});

// ─── ageDaysFor edge cases ───────────────────────────────────────────────────

test('ageDaysFor: tab=sent → null (no age display)', () => {
  assert.strictEqual(ageDaysFor({ tab: 'sent' }), null);
});

test('ageDaysFor: tab=complete with markComplete history → days since', () => {
  const tenDaysAgo = Date.now() - 10 * 86400000;
  const o = { tab: 'complete', history: [{ ts: tenDaysAgo, action: 'marked complete' }] };
  const d = ageDaysFor(o);
  assert.ok(d === 10 || d === 9, 'expected ~10d, got ' + d);
});

test('ageDaysFor: tab=complete without history falls back to dateCreated', () => {
  const o = { tab: 'complete', dateCreated: '2020-01-01', history: [] };
  const d = ageDaysFor(o);
  assert.ok(d > 1000, 'expected large days since 2020, got ' + d);
});

// ─── migrateSettingsForChange11 ──────────────────────────────────────────────

test('migrateSettings: adds Cancelled if missing', () => {
  const r = migrateSettingsForChange11({ statuses: ['Open', 'Closed'] });
  assert.ok(r.statuses.includes('Cancelled'));
});

test('migrateSettings: adds Complete - Pending Approval if missing', () => {
  const r = migrateSettingsForChange11({ statuses: ['Open'] });
  assert.ok(r.statuses.includes('Complete - Pending Approval'));
});

test('migrateSettings: idempotent — does not duplicate if already present', () => {
  const stored = { statuses: ['Open', 'Cancelled', 'Complete - Pending Approval'] };
  const r = migrateSettingsForChange11(stored);
  const cancelledCount = r.statuses.filter(s => s === 'Cancelled').length;
  const completeCount  = r.statuses.filter(s => s === 'Complete - Pending Approval').length;
  assert.strictEqual(cancelledCount, 1);
  assert.strictEqual(completeCount, 1);
});

test('migrateSettings: moves Bid Approved - Complete from approved to end of progress', () => {
  const r = migrateSettingsForChange11({ phases: DEFAULT_PHASES });
  const approved = r.phases.find(p => p.id === 'approved');
  const progress = r.phases.find(p => p.id === 'progress');
  assert.ok(!approved.statuses.includes('Bid Approved - Complete'));
  assert.ok(progress.statuses.includes('Bid Approved - Complete'));
  assert.strictEqual(progress.statuses[progress.statuses.length - 1], 'Bid Approved - Complete');
});

test('migrateSettings: strips complete flag from phases', () => {
  const r = migrateSettingsForChange11({ phases: [{ id: 'wrap', name: 'Wrapping up', complete: true, statuses: [] }] });
  assert.strictEqual(r.phases[0].complete, undefined);
});

// ─── migrateOrders (SHIPPED, imported) ───────────────────────────────────────
// Direct coverage of the real migrateOrders so a broken branch fails the gate.

test('migrateOrders: tab=paid/invoiced → sent', () => {
  const r = migrateOrders([
    { id: 'P', tab: 'paid', status: 'X' },
    { id: 'I', tab: 'invoiced', status: 'X' },
  ], DEFAULT_PHASES);
  assert.strictEqual(r[0].tab, 'sent');
  assert.strictEqual(r[1].tab, 'sent');
});

test('migrateOrders: priority field → archive note card, priority stripped', () => {
  const r = migrateOrders([{ id: 'A', tab: 'active', status: 'Open', priority: 'High' }], DEFAULT_PHASES);
  assert.strictEqual(r[0].priority, undefined);
  assert.ok(r[0].noteCards.some(c => c.body === 'Imported priority: High'));
});

test('migrateOrders: id-less note card gets a stable id', () => {
  const r = migrateOrders([{ id: 'A', tab: 'active', status: 'Open', noteCards: [{ body: 'hi' }] }], DEFAULT_PHASES);
  assert.ok(r[0].noteCards[0].id, 'expected an id assigned');
});

test('migrateOrders: active WO in a complete-flagged phase → tab=complete + unscheduled', () => {
  const phases = DEFAULT_PHASES.map(p => p.id === 'done' ? { ...p, complete: true } : p);
  const r = migrateOrders([
    { id: 'A', tab: 'active', status: 'Closed', schedule: { date: '2099-01-01', start: '09:00' } },
  ], phases);
  assert.strictEqual(r[0].tab, 'complete');
  assert.strictEqual(r[0].schedule, undefined);
});

test('migrateOrders: non-array input passes through', () => {
  assert.strictEqual(migrateOrders(null), null);
});

// ─── isTrashedReimport (auto-reject, round5 A4 / #13) ────────────────────────

test('isTrashedReimport: incoming WO# matches a trashed record → true', () => {
  const deleted = [{ id: 'WO-007', woId: '03061113', deleted: true }];
  assert.strictEqual(isTrashedReimport({ woId: '03061113' }, deleted), true);
});

test('isTrashedReimport: leading-zero / formatting differences still match', () => {
  const deleted = [{ id: '3061113', deleted: true }];
  assert.strictEqual(isTrashedReimport({ woId: '03061113' }, deleted), true);
});

test('isTrashedReimport: a NEW WO# not in trash → false (real new job)', () => {
  const deleted = [{ id: 'WO-007', woId: '03061113', deleted: true }];
  assert.strictEqual(isTrashedReimport({ woId: '09999999' }, deleted), false);
});

test('isTrashedReimport: matches a NON-deleted record → false (only trash rejects)', () => {
  const active = [{ id: 'WO-007', woId: '03061113', deleted: false }];
  assert.strictEqual(isTrashedReimport({ woId: '03061113' }, active), false);
});

test('isTrashedReimport: empty/no-deleted safe', () => {
  assert.strictEqual(isTrashedReimport({ woId: '1' }, []), false);
  assert.strictEqual(isTrashedReimport(null, [{ deleted: true, id: '1' }]), false);
});

// ─── wasVisited (return-trip predicate, round5 A2 / #12a) ────────────────────

const TAGS = { 'Visited': 'visited', 'Open': 'schedule', 'Return Trip Scheduled': 'returnschedule' };

test('wasVisited: scheduled-but-never-visited → false (first trip, not return)', () => {
  // WO 03061113 case: scheduled, tech never showed, no visited status applied.
  const o = { status: 'Open', history: [{ action: 'scheduled', detail: '2026-06-24 09:00' }] };
  assert.strictEqual(wasVisited(o, TAGS), false);
});

test('wasVisited: current status is visited-tagged → true', () => {
  assert.strictEqual(wasVisited({ status: 'Visited', history: [] }, TAGS), true);
});

test('wasVisited: past status-change to a visited-tagged status → true', () => {
  const o = { status: 'Open', history: [
    { action: 'scheduled', detail: '2026-06-01 09:00' },
    { action: 'status', detail: 'Open → Visited' },
    { action: 'status', detail: 'Visited → Open' },
  ] };
  assert.strictEqual(wasVisited(o, TAGS), true);
});

test('wasVisited: no visited tag configured → false', () => {
  const o = { status: 'Open', history: [{ action: 'status', detail: 'Open → Closed' }] };
  assert.strictEqual(wasVisited(o, {}), false);
});

test('wasVisited: null/empty safe', () => {
  assert.strictEqual(wasVisited(null, TAGS), false);
  assert.strictEqual(wasVisited({}, undefined), false);
});

// ─── phaseForOrder ───────────────────────────────────────────────────────────

test('phaseForOrder: deleted → Cancelled', () => {
  assert.strictEqual(phaseForOrder({ deleted: true, tab: 'active', status: 'Open' }, DEFAULT_PHASES), 'Cancelled');
});

test('phaseForOrder: tab=trash → Cancelled', () => {
  assert.strictEqual(phaseForOrder({ tab: 'trash', status: 'Open' }, DEFAULT_PHASES), 'Cancelled');
});

test('phaseForOrder: tab=sent → Billing', () => {
  assert.strictEqual(phaseForOrder({ tab: 'sent', status: 'X' }, DEFAULT_PHASES), 'Billing');
});

test('phaseForOrder: tab=complete → Complete (renamed from Done in change11)', () => {
  assert.strictEqual(phaseForOrder({ tab: 'complete', status: 'X' }, DEFAULT_PHASES), 'Complete');
});

// ─── State-machine round-trip ────────────────────────────────────────────────

test('round-trip: Active → Complete → Sent → Reopen → Complete → Reopen → Active recovers original status', () => {
  let o = { id: 'A', tab: 'active', status: 'Parts Pending' };
  o = markComplete(o);
  assert.strictEqual(o.status, 'Complete - Pending Approval');
  assert.strictEqual(o.prevStatus, 'Parts Pending');
  o = sendToInvoice(o);
  assert.strictEqual(o.tab, 'sent');
  assert.strictEqual(o.status, 'Complete - Pending Approval'); // status unchanged on send
  assert.strictEqual(o.prevStatus, 'Parts Pending');
  o = reopen(o); // sent → complete
  assert.strictEqual(o.tab, 'complete');
  assert.strictEqual(o.prevStatus, 'Parts Pending');
  o = reopen(o); // complete → active
  assert.strictEqual(o.tab, 'active');
  assert.strictEqual(o.status, 'Parts Pending');
  assert.strictEqual(o.prevStatus, undefined);
});

test('round-trip: Active → Trash → Restore recovers original status', () => {
  let o = { id: 'A', tab: 'active', status: 'On Site' };
  o = softDelete(o);
  assert.strictEqual(o.status, 'Cancelled');
  assert.strictEqual(o.prevStatus, 'On Site');
  o = restore(o);
  assert.strictEqual(o.tab, 'active');
  assert.strictEqual(o.status, 'On Site');
});

// ─── Overview throughput ─────────────────────────────────────────────────────

function overviewWeekBuckets() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dow = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - dow);
  const buckets = [];
  for (let i = 7; i >= 0; i--) {
    const wStart = new Date(start);
    wStart.setDate(start.getDate() - i * 7);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 7);
    buckets.push({
      startMs: wStart.getTime(),
      endMs:   wEnd.getTime(),
      dispatched: 0, completed: 0,
    });
  }
  return buckets;
}
function overviewThroughput(orders) {
  const buckets = overviewWeekBuckets();
  const inBucket = (ts) => {
    for (let i = 0; i < buckets.length; i++) {
      if (ts >= buckets[i].startMs && ts < buckets[i].endMs) return buckets[i];
    }
    return null;
  };
  for (const o of (orders || [])) {
    if (!o) continue;
    if (o.dateCreated) {
      const ts = new Date(o.dateCreated + 'T00:00:00').getTime();
      const b = inBucket(ts);
      if (b) b.dispatched++;
    }
    const hist = Array.isArray(o.history) ? o.history : [];
    const completedBucketSeen = new Set();
    for (const h of hist) {
      if (!h || !h.ts) continue;
      const a = String(h.action || '').toLowerCase();
      if (!(a.includes('marked complete') || a.includes('auto-flipped to complete'))) continue;
      const b = inBucket(h.ts);
      if (!b || completedBucketSeen.has(b)) continue;
      completedBucketSeen.add(b);
      b.completed++;
    }
  }
  return buckets;
}

test('throughput: each WO counts once for dispatched (dateCreated-driven)', () => {
  const today = itinTodayStr();
  const orders = [
    { id: 'A', dateCreated: today, history: [] },
    { id: 'B', dateCreated: today, history: [] },
    { id: 'C', dateCreated: today, history: [] },
  ];
  const buckets = overviewThroughput(orders);
  const total = buckets.reduce((s, b) => s + b.dispatched, 0);
  assert.strictEqual(total, 3);
});

test('throughput: same WO marked complete twice in same week counts once', () => {
  const ts = Date.now() - 86400000; // yesterday
  const orders = [{
    id: 'A', dateCreated: '2026-04-28',
    history: [
      { ts, action: 'marked complete' },
      { ts: ts + 100, action: 'marked complete' }, // duplicate within same week
    ],
  }];
  const buckets = overviewThroughput(orders);
  const totalCompleted = buckets.reduce((s, b) => s + b.completed, 0);
  assert.strictEqual(totalCompleted, 1, 'expected dedup to 1, got ' + totalCompleted);
});

test('throughput: auto-flipped + marked complete in same week → counts once', () => {
  const ts = Date.now() - 86400000;
  const orders = [{
    id: 'A', dateCreated: '2026-04-28',
    history: [
      { ts, action: 'auto-flipped to Complete (change11 v5)' },
      { ts: ts + 1000, action: 'marked complete' },
    ],
  }];
  const buckets = overviewThroughput(orders);
  const total = buckets.reduce((s, b) => s + b.completed, 0);
  assert.strictEqual(total, 1);
});

// ─── Null/empty safety ──────────────────────────────────────────────────────

test('reconciler: empty orders array', () => {
  const r = reconcileV5([], DEFAULT_PHASES);
  assert.strictEqual(r.flipped, 0);
  assert.deepStrictEqual(r.orders, []);
});

test('reconciler: null orders', () => {
  const r = reconcileV5(null, DEFAULT_PHASES);
  assert.deepStrictEqual(r.orders, []);
});

test('reconciler: order with no tab defaults to active', () => {
  const o = { id: 'A', status: 'Open' };
  const r = reconcileV5([o], DEFAULT_PHASES);
  assert.strictEqual(r.flipped, 0); // Open is not completion
});

test('migrateSettings: stored is null', () => {
  const r = migrateSettingsForChange11(null);
  assert.ok(r.statuses.includes('Cancelled'));
  assert.ok(r.statuses.includes('Complete - Pending Approval'));
});

test('isCompletionStatus: null/undefined → false', () => {
  assert.strictEqual(isCompletionStatus(null), false);
  assert.strictEqual(isCompletionStatus(undefined), false);
  assert.strictEqual(isCompletionStatus(''), false);
});

// ─── Mixed batch on real-shaped data ─────────────────────────────────────────

test('reconciler: mixed batch — 5 different states reconcile correctly in one pass', () => {
  const orders = [
    { id: 'A1', tab: 'active', status: 'Open', dateCreated: '2026-04-28' },                                  // unchanged
    { id: 'A2', tab: 'active', status: 'Bid Submitted - Job Complete', dateCreated: '2026-04-28' },          // → complete
    { id: 'I1', tab: 'invoiced', status: 'X', dateCreated: '2026-04-28' },                                  // → sent
    { id: 'P1', tab: 'paid', status: 'X', dateCreated: '2026-04-28' },                                      // → sent
    { id: 'C1', tab: 'complete', status: 'Bid Submitted - Job Complete', dateCreated: '2026-04-28' },        // → hardcoded status
    { id: 'T1', deleted: true, tab: 'active', status: 'Parts Pending', dateCreated: '2026-04-28', schedule: { date: '2026-05-28', start: '10:00' } }, // → Cancelled + unschedule
    { id: 'E1', tab: 'active', status: 'Open', dateCreated: '2026-04-28', schedule: { date: '2020-01-01', start: '09:00' } }, // expired → unschedule
  ];
  const r = reconcileV5(orders, USER_PHASES);
  assert.strictEqual(r.flipped, 1);
  assert.strictEqual(r.promotedFromInvoiced, 2);
  assert.strictEqual(r.hardcodedComplete, 1);
  assert.strictEqual(r.hardcodedCancelled, 1);
  assert.strictEqual(r.expiredCleared, 1);
  // Verify each WO landed where expected
  const byId = Object.fromEntries(r.orders.map(o => [o.id, o]));
  assert.strictEqual(byId.A1.tab, 'active');
  assert.strictEqual(byId.A2.tab, 'complete');
  assert.strictEqual(byId.A2.status, 'Complete - Pending Approval');
  assert.strictEqual(byId.I1.tab, 'sent');
  assert.strictEqual(byId.P1.tab, 'sent');
  assert.strictEqual(byId.C1.status, 'Complete - Pending Approval');
  assert.strictEqual(byId.C1.prevStatus, 'Bid Submitted - Job Complete');
  assert.strictEqual(byId.T1.status, 'Cancelled');
  assert.strictEqual(byId.T1.schedule, undefined);
  assert.strictEqual(byId.E1.schedule, undefined);
});

// ─── Report ──────────────────────────────────────────────────────────────────

console.log('change11 test harness');
console.log('=====================');
let pass = 0, fail = 0;
for (const r of results) {
  if (r.ok) { pass++; console.log('  ✓ ' + r.name); }
  else      { fail++; console.log('  ✗ ' + r.name + '\n      ' + r.err); }
}
console.log('');
console.log('Total: ' + (pass + fail) + ' | Pass: ' + pass + ' | Fail: ' + fail);
process.exit(fail > 0 ? 1 : 0);
