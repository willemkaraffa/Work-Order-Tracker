'use strict';
// Single source of truth for bid-wording tokenization. Shared by the ESM
// orders-logic.js (via the esbuild renderer bundle + loadEsm test bridge, which can
// import this CJS module) and the CJS bid-select.js/main.js. Behavior must not change:
// these three defs were extracted VERBATIM from orders-logic.js so catalog matching
// and bid-line dedup tokenize identically.

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

module.exports = { MATCH_STOP, MATCH_BOILER, matchTokens };
