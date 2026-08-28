'use strict';
// Single source of truth for bid-wording tokenization. Shared by the ESM
// orders-logic.js (via the esbuild renderer bundle + loadEsm test bridge, which can
// import this CJS module) and the CJS bid-select.js/main.js. Both sides must tokenize
// IDENTICALLY (these defs were extracted from orders-logic.js), so any change here
// moves catalog matching AND bid-line dedup together, by design.

// Keyword tokens for fuzzy catalog matching. Lowercase, strip punctuation, drop
// stopwords, and crudely stem so verb and noun forms of one word collapse to one
// token. Bid wording is human + varies; tokens absorb it.
const MATCH_STOP = new Set(['to','the','a','an','of','for','and','with','in','on','at','new',
  'my','is','are','be','per','up','down','into','through','from','it','that','this','or']);
// Service-catalog BOILERPLATE (post-stem). These recur verbatim on a handful of AMH
// items ("- no additional labor fee", "Includes ...") so plain IDF wrongly ranks them
// DISTINCTIVE and their unshared mass sinks the real item's coverage below the gate.
// They carry no identity, so strip them at tokenization -- object nouns (contactor,
// faucet, coil) still carry the match. Also matches the handoff's "fee/labor near-zero".
const MATCH_BOILER = new Set(['fee','labor','no','additional','include','includ','necessary',
  'provide','provid','as','when']);
// Crude stemmer. The old form was a bare /(ing|ed|es|s)$/ strip, which split ONE
// word into three tokens ("replacing"/"replaced" -> "replac" but "replace" and
// "replacement" stayed whole) and destroyed short words ("ring" -> "r"). Now:
// derivational suffixes strip before inflections, then a trailing "e" is trimmed, so
// replace/replacing/replaced/replacement all reach "replac" and
// install/installed/installing/installation all reach "install". A strip that would
// leave fewer than MIN_STEM characters is REFUSED, which keeps "ring" as "ring".
// Longest suffix first; if it is refused on length the next shorter one is tried.
// Bare "tion"/"ion" are deliberately NOT stripped: they over-collapse unrelated nouns
// (condition -> cond, station -> sta) and that widened the AMH red-flag count. Only the
// full "ation" pair the plan named (installation/install) is bridged.
const MIN_STEM = 3;
const STEM_SUFFIX = ['ation', 'ment', 'ing', 'ed', 'es', 's'];
// STACKED suffixes strip in SEQUENCE, not once: "replacements" is a plural sitting on
// top of a derivational suffix, so a single pass would stop at "replacement" and never
// reach "replac". Each pass strictly shortens the word, so the loop terminates.
function stem(t) {
  for (let stripped = true; stripped; ) {
    stripped = false;
    for (const suf of STEM_SUFFIX) {
      if (t.length - suf.length >= MIN_STEM && t.endsWith(suf)) {
        t = t.slice(0, -suf.length); stripped = true; break;
      }
    }
  }
  return (t.endsWith('e') && t.length - 1 >= MIN_STEM) ? t.slice(0, -1) : t;
}
function matchTokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter(Boolean).map(stem)
    // Drop stopwords, boilerplate, and BARE NUMBERS ("9 lbs" must not match "9-GPM
    // tankless"; tonnage variants disambiguate by PRICE, not the digit). Alphanumerics
    // like "r410a"/"50ft" survive as one token.
    .filter(t => t && !MATCH_STOP.has(t) && !MATCH_BOILER.has(t) && !/^\d+$/.test(t));
}

module.exports = { MATCH_STOP, MATCH_BOILER, matchTokens };
