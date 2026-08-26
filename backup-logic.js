'use strict';
// Backup tier policy. Pure (no fs/electron) so it unit-tests by direct require
// (test/admin-s2-backup.test.js); main.js does every fs call and passes the
// results in. Same convention as bid-select.js / library_io.js: a plain root CJS
// module required by the CJS main.js (which cannot import the ESM src/*.js).
//
// WHY TWO TIERS. The old single ring was a 10-slot FIFO written on EVERY store
// write, and the store is 3.1 MB. On 2026-08-26 all ten slots were consumed
// between 09:36 and 09:52 -- sixteen minutes of ordinary note editing evicted
// every pre-S1-migration snapshot, so the S1 note migration shipped with no
// rollback point. A churn ring and a rollback archive are different jobs:
//   RING (backups/wo-data.<iso>.json, MAX_BACKUPS): high-churn, minutes deep,
//     "undo the last few writes". Note writes now opt out of it entirely
//     (src/data.js passes skipBackup), so it can no longer be flooded.
//   MILESTONE (backups/milestones/, MAX_MILESTONES): low-churn, taken once per
//     day and once per app version, MONTHS deep, "roll back a bad migration".
// The tiers cannot evict each other because milestones live in a SUBDIRECTORY:
// rotateBackups lists only the top level of backups/ and only matches
// wo-data.*.json there, and the directory entry 'milestones' does not match that
// filter. Never put a milestone in backupDir itself -- a wo-data.*.json file
// there WOULD be pruned by the ring, which is the exact trap this module closes.

const MILESTONE_DIR   = 'milestones';
const MILESTONE_STATE = 'state.json';   // sidecar: { at, version } of the last milestone
const MAX_BACKUPS     = 10;             // ring depth (was inline in main.js)
const MAX_MILESTONES  = 12;             // ~a year of daily/version snapshots
const DAY_MS          = 24 * 60 * 60 * 1000;

// Ring member: a top-level backups/ snapshot. The 'milestones' directory entry
// fails this (no .json suffix), so the ring never sees, names or unlinks it.
function isRingBackup(name) {
  const n = String(name || '');
  return n.startsWith('wo-data.') && n.endsWith('.json');
}

// Milestone member: same naming, minus the state sidecar (which must survive
// every prune -- losing it would re-fire a 'first' milestone on next launch).
function isMilestoneBackup(name) {
  const n = String(name || '');
  return n !== MILESTONE_STATE && n.startsWith('wo-data.') && n.endsWith('.json');
}

// Retention, shared by BOTH tiers so they cannot drift apart. entries =
// [{name, mtime}]; keeps the newest `max` by mtime and returns the NAMES of
// everything past that, for the caller to unlink. Does not mutate the input.
function pruneList(entries, max) {
  const list = (Array.isArray(entries) ? entries : []).slice()
    .sort((a, b) => (Number(b && b.mtime) || 0) - (Number(a && a.mtime) || 0));
  return list.slice(Math.max(0, Number(max) || 0)).map(e => e && e.name);
}

// Is a milestone owed right now? `last` is the parsed state sidecar
// { at, version } or null. Returns the reason string (used in the filename) or
// null. A VERSION change beats the daily throttle on purpose: a migration ships
// with a version bump, and a snapshot taken AFTER the migration has run is
// worthless as a rollback point.
function milestoneDue(now, version, last) {
  if (!last || !last.at) return 'first';
  if (last.version !== version) return 'version';
  if (Number(now) - Number(last.at) >= DAY_MS) return 'daily';
  return null;
}

function milestoneFileName(reason, now) {
  return `wo-data.${reason}.${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`;
}

module.exports = {
  MILESTONE_DIR, MILESTONE_STATE, MAX_BACKUPS, MAX_MILESTONES, DAY_MS,
  isRingBackup, isMilestoneBackup, pruneList, milestoneDue, milestoneFileName,
};
