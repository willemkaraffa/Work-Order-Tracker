'use strict';
// clientTree / noteTreeKeys: the Journal rail's Clients tree (Admin S5 slice J2).
// Pins the parts that go wrong silently -- the field reuse (o.pm is the client,
// address + city the property, o.id the WO number), the three-deep grouping, the
// counts the rail prints, and the deliberate ABSENCE of notes that carry no
// resolvable woId. SHIPPED code via the esbuild bridge. 0 pass / 1 fail.
const assert = require('assert');
const { loadEsm } = require('./_load.js');
const { clientTree, noteTreeKeys, notesForOrder, isImportedNote, IMPORTED_NOTE_PREFIX,
  journalFolders, normalizeNote, sortTreeWos, completedTsFor } = loadEsm('src/orders-logic.js');

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, err: e.message }); }
}

// App field names, and the store's real shape: city is usually EMPTY because the
// address already carries it.
const ORDERS = [
  { id: '77021', pm: 'MSR', address: '21 Ash St, Largo, NC 27520', city: '' },
  { id: '77022', pm: 'MSR', address: '21 Ash St, Largo, NC 27520', city: '' },
  { id: '77023', pm: 'MSR', address: '315 W Barnes St', city: 'Wendell' },
  { id: '88033', pm: 'AMH', address: '51 Scotch Bonnet Ridge', city: 'Clayton' },
  { id: '99044', pm: '', address: '', city: '' },
];
const NOTES = [
  { id: 'n1', woId: '77021', body: 'a' },
  { id: 'n2', woId: '77021', body: 'b' },
  { id: 'n3', woId: '77022', body: 'c' },
  { id: 'n4', woId: '77023', body: 'd' },
  { id: 'n5', woId: '88033', body: 'e' },
  { id: 'n6', body: 'unlinked jotting' },
  { id: 'n7', woId: 'GONE', body: 'links a WO that is not in the store' },
];

test('noteTreeKeys reuses pm as the client and address + city as the property', () => {
  assert.deepStrictEqual(noteTreeKeys(ORDERS[2]), { client: 'MSR', prop: '315 W Barnes St, Wendell' });
  assert.deepStrictEqual(noteTreeKeys(ORDERS[0]), { client: 'MSR', prop: '21 Ash St, Largo, NC 27520' });
});

test('noteTreeKeys falls back rather than throwing on a blank order', () => {
  assert.deepStrictEqual(noteTreeKeys(ORDERS[4]), { client: '(no client)', prop: '(no address)' });
  assert.strictEqual(noteTreeKeys(null), null);
});

test('the tree is three deep: client, property, WO number', () => {
  const t = clientTree(NOTES, ORDERS);
  assert.deepStrictEqual(t.map(c => c.name), ['AMH', 'MSR']);
  const msr = t.find(c => c.name === 'MSR');
  assert.deepStrictEqual(msr.props.map(p => p.name), ['21 Ash St, Largo, NC 27520', '315 W Barnes St, Wendell']);
  assert.deepStrictEqual(msr.props[0].wos.map(w => w.id), ['77021', '77022']);
});

test('two WOs at one address share ONE property branch', () => {
  const msr = clientTree(NOTES, ORDERS).find(c => c.name === 'MSR');
  assert.strictEqual(msr.props.length, 2);
  assert.strictEqual(msr.props[0].wos.length, 2);
});

test('counts are note counts, and they roll up', () => {
  const t = clientTree(NOTES, ORDERS);
  const msr = t.find(c => c.name === 'MSR');
  assert.strictEqual(msr.count, 4);              // n1 n2 n3 n4
  assert.strictEqual(msr.props[0].count, 3);     // n1 n2 on 77021, n3 on 77022
  assert.strictEqual(msr.props[0].wos[0].count, 2);
  assert.strictEqual(msr.props[0].wos[1].count, 1);
  assert.strictEqual(t.find(c => c.name === 'AMH').count, 1);
});

test('a note with no woId is ABSENT from the tree (it has no client)', () => {
  const total = clientTree(NOTES, ORDERS).reduce((n, c) => n + c.count, 0);
  assert.strictEqual(total, 5);                  // n1..n5, never n6
});

test('a note whose woId names no order is ABSENT too, and invents no branch', () => {
  const names = clientTree(NOTES, ORDERS).map(c => c.name);
  assert.ok(!names.includes('(no client)'));
  assert.ok(!names.includes('GONE'));
});

test('the tree groups only what it is HANDED, so a search-filtered pool narrows it', () => {
  const filtered = NOTES.filter(n => n.woId === '88033');
  const t = clientTree(filtered, ORDERS);
  assert.deepStrictEqual(t.map(c => c.name), ['AMH']);
  assert.strictEqual(t[0].count, 1);
});

test('empty and null inputs return an empty tree, never a throw', () => {
  assert.deepStrictEqual(clientTree([], ORDERS), []);
  assert.deepStrictEqual(clientTree(NOTES, []), []);
  assert.deepStrictEqual(clientTree(null, null), []);
  assert.deepStrictEqual(clientTree([null, undefined], ORDERS), []);
});

test('the pane that opens a WO reads notesForOrder, and it agrees with the counts', () => {
  const msr = clientTree(NOTES, ORDERS).find(c => c.name === 'MSR');
  const wo = msr.props[0].wos[0];
  assert.strictEqual(notesForOrder(NOTES, wo.id).length, wo.count);
});

// ── J4: every WO on the property, banded and sorted ─────────────────────────

// One property, one client, every band represented. `tab` and `status` are the
// sort's whole input besides history and invoice.
const J4_ORDERS = [
  { id: 'A-parts', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'active', status: 'Parts Pending' },
  { id: 'A-open', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'active', status: 'Open' },
  { id: 'A-odd', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'active', status: 'Renamed By User' },
  { id: 'C-old', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'complete',
    history: [{ ts: 1000, action: 'marked complete' }] },
  { id: 'C-new', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'complete',
    history: [{ ts: 9000, action: 'auto-flipped to complete' }] },
  { id: 'C-none', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'complete', history: [] },
  { id: 'S-jan', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'sent', invoice: { date: '2026-01-05' } },
  { id: 'S-mar', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'sent', invoice: { date: '2026-03-05' } },
  { id: 'S-none', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'sent' },
  { id: 'X-trash', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'trash' },
  { id: 'X-del', pm: 'MSR', address: '1 Elm St', city: 'T', tab: 'active', deleted: true },
  // A property NO note ever opened. The client level stays note-derived, so this
  // must not appear at all.
  { id: 'U-1', pm: 'MSR', address: '9 Oak Ave', city: 'T', tab: 'active', status: 'Open' },
];
const J4_NOTES = [{ id: 'j1', woId: 'A-parts' }, { id: 'j2', woId: 'A-parts' }, { id: 'j3', woId: 'S-jan' }];
const j4prop = () => clientTree(J4_NOTES, J4_ORDERS).find(c => c.name === 'MSR')
  .props.find(p => p.name === '1 Elm St, T');

test('completedTsFor reads the LAST completion entry, either wording', () => {
  assert.strictEqual(completedTsFor(J4_ORDERS[3]), 1000);
  assert.strictEqual(completedTsFor(J4_ORDERS[4]), 9000);
  assert.strictEqual(completedTsFor({ history: [{ ts: 1, action: 'marked complete' }, { ts: 2, action: 'marked complete' }] }), 2);
  assert.strictEqual(completedTsFor(J4_ORDERS[5]), null);
  assert.strictEqual(completedTsFor(null), null);
});

test('a property lists EVERY WO on it, not only the note-carriers', () => {
  const ids = j4prop().wos.map(w => w.id);
  assert.ok(ids.includes('A-open'), ids.join(','));   // no note, still listed
  assert.ok(ids.includes('C-new'), ids.join(','));
  assert.ok(ids.includes('S-none'), ids.join(','));
});

test('count 0 IS the greyed state, and only note-carriers count', () => {
  const wos = j4prop().wos;
  assert.strictEqual(wos.find(w => w.id === 'A-parts').count, 2);
  assert.strictEqual(wos.find(w => w.id === 'S-jan').count, 1);
  assert.strictEqual(wos.find(w => w.id === 'A-open').count, 0);
  // The property's own count stays a NOTE count, so the greyed rows add nothing.
  assert.strictEqual(j4prop().count, 3);
});

test('TRASH never appears, deleted or tab', () => {
  const ids = j4prop().wos.map(w => w.id);
  assert.ok(!ids.includes('X-trash'), ids.join(','));
  assert.ok(!ids.includes('X-del'), ids.join(','));
});

test('a property no note opened is NOT invented from orders', () => {
  const props = clientTree(J4_NOTES, J4_ORDERS).find(c => c.name === 'MSR').props.map(p => p.name);
  assert.deepStrictEqual(props, ['1 Elm St, T']);
});

test('bands run ACTIVE, then COMPLETE, then SENT', () => {
  const ids = j4prop().wos.map(w => w.id);
  const band = ids.map(id => (id[0] === 'A' ? 0 : id[0] === 'C' ? 1 : 2));
  assert.deepStrictEqual(band, [...band].sort(), ids.join(','));
});

test('ACTIVE sorts by workflow position, and an unknown status goes last', () => {
  const ids = j4prop().wos.map(w => w.id).filter(id => id[0] === 'A');
  assert.deepStrictEqual(ids, ['A-open', 'A-parts', 'A-odd']);
});

test('COMPLETE is newest first, and a WO with no completion entry sinks', () => {
  const ids = j4prop().wos.map(w => w.id).filter(id => id[0] === 'C');
  assert.deepStrictEqual(ids, ['C-new', 'C-old', 'C-none']);
});

test('SENT is newest invoice first, and the DATELESS sink to the bottom', () => {
  const ids = j4prop().wos.map(w => w.id).filter(id => id[0] === 'S');
  assert.deepStrictEqual(ids, ['S-mar', 'S-jan', 'S-none']);
});

test('the row carries its order, so the rail can print without a second lookup', () => {
  const w = j4prop().wos.find(x => x.id === 'S-jan');
  assert.strictEqual(w.order.invoice.date, '2026-01-05');
});

test('sortTreeWos is stable on ties, falling back to the WO number', () => {
  const mk = (id) => ({ id, count: 0, order: { id, tab: 'active', status: 'Open' } });
  assert.deepStrictEqual(sortTreeWos([mk('77022'), mk('77021')]).map(w => w.id), ['77021', '77022']);
  assert.deepStrictEqual(sortTreeWos([]), []);
});

// ── J3: the user-note rule and the Journal accordions ────────────────────────

test('isImportedNote tests the BODY, never the id', () => {
  // The live store's proof case: an n_mig_prio_ id the user later edited.
  assert.strictEqual(isImportedNote({ id: 'n_mig_prio_02691394', body: 'Need to Return to Finish Job' }), false);
  assert.strictEqual(isImportedNote({ id: 'n-whatever', body: 'Imported priority: High' }), true);
  assert.strictEqual(isImportedNote({ id: 'x', body: 'the client said imported priority: high' }), false);
  assert.strictEqual(isImportedNote(null), false);
  assert.strictEqual(isImportedNote({ id: 'x' }), false);
});

test('the imported prefix is ONE constant, shared with the migrator', () => {
  assert.strictEqual(IMPORTED_NOTE_PREFIX, 'Imported priority:');
  assert.strictEqual(isImportedNote({ body: IMPORTED_NOTE_PREFIX + ' Warranty' }), true);
});

test('folder survives normalizeNote, which is a WHITELIST every write passes', () => {
  assert.strictEqual(normalizeNote({ body: 'x', folder: 'Ideas' }, 'i1').folder, 'Ideas');
  assert.strictEqual(normalizeNote({ body: 'x' }, 'i2').folder, null);
  assert.strictEqual(normalizeNote({ body: 'x', folder: '' }, 'i3').folder, null);
});

test('journalFolders takes NON-WO notes only, Jottings first as the null bucket', () => {
  const f = journalFolders([
    { id: 'a', body: 'loose' },
    { id: 'b', body: 'filed', folder: 'Ideas' },
    { id: 'c', body: 'linked', woId: '77021' },
    { id: 'd', body: 'linked and filed', woId: '77021', folder: 'Ideas' },
  ]);
  assert.deepStrictEqual(f.map(x => x.name), ['Jottings', 'Ideas']);
  assert.deepStrictEqual(f[0].notes.map(n => n.id), ['a']);
  assert.deepStrictEqual(f[1].notes.map(n => n.id), ['b']);
});

test('Jottings is always present, even with nothing in it', () => {
  const f = journalFolders([{ id: 'b', body: 'filed', folder: 'Ideas' }]);
  assert.strictEqual(f[0].name, 'Jottings');
  assert.strictEqual(f[0].key, null);
  assert.strictEqual(f[0].notes.length, 0);
  assert.deepStrictEqual(journalFolders([]).map(x => x.name), ['Jottings']);
  assert.deepStrictEqual(journalFolders(null).map(x => x.name), ['Jottings']);
});

test('user folders sort alphabetically after Jottings', () => {
  const f = journalFolders([
    { id: '1', folder: 'Zebra' }, { id: '2', folder: 'Ideas' }, { id: '3', folder: 'Ideas' },
  ]);
  assert.deepStrictEqual(f.map(x => x.name), ['Jottings', 'Ideas', 'Zebra']);
  assert.strictEqual(f[1].notes.length, 2);
});

let fail = 0;
for (const r of results) {
  if (r.ok) console.log('  PASS ' + r.name);
  else { fail++; console.log('  FAIL ' + r.name + ' :: ' + r.err); }
}
console.log((results.length - fail) + '/' + results.length + ' passed');
process.exit(fail ? 1 : 0);
