'use strict';
// Export-surface guard for scraper-extract.js (the module that ships in the
// AMH/MSR capture BrowserWindow). A refactor that drops or renames an extractor
// nulls a captured field at runtime with no error. This fails the gate loudly
// instead. Shape only — field-level extraction is covered by the fixture tests.
const path = require('path');

delete require.cache[require.resolve(path.join(__dirname, '..', 'scraper-extract.js'))];
const api = require(path.join(__dirname, '..', 'scraper-extract.js'));

const EXTRACTORS = ['detectPortal', 'amhGeneral', 'amhIssues', 'amhContacts', 'amhBidDetail', 'msr'];
const INTERNALS = ['extractWONumber', 'extractAddressCity', 'extractCityFromAddress',
  'extractPropertyId', 'applyMappings', 'mapPriority', 'mapTradeToType', 'toISODate'];

let fails = 0;
function isFn(label, v) {
  if (typeof v === 'function') console.log('  ok   ' + label);
  else { fails++; console.log('  FAIL ' + label + ': not a function (got ' + typeof v + ')'); }
}

console.log('scraper-extract surface');
console.log('=======================');
for (const name of EXTRACTORS) isFn(name, api && api[name]);
if (!api || !api._internals) { fails++; console.log('  FAIL _internals missing'); }
else for (const name of INTERNALS) isFn('_internals.' + name, api._internals[name]);

console.log('');
console.log(fails ? (fails + ' FAILURES') : 'ALL PASS');
process.exit(fails ? 1 : 0);
