'use strict';
// Bid/CO sheet selection helpers for read-bid-lineitems. Pure (no fs/electron) so
// they unit-test by direct require (test/bid-select.test.js); main.js does the fs
// stat + exceljs read and passes the results in. Mirrors library_io.js: a plain
// root CJS module required by the CJS main.js (which cannot import the ESM
// src/orders-logic.js).
const { matchTokens } = require('./text-normalize');

// Bug A: a WO folder can hold several bid/CO xlsx. A Bid is a FULL statement, so a
// later Bid SUPERSEDES earlier ones -- summing them double-counts revised lines. A
// CO (change order) is an additive delta -- keep them all. So: newest Bid (by mtime)
// + every CO. Zero bids -> all COs; one bid -> that bid (+COs). Input is pre-filtered
// to bid|CO files: [{name, mtime, ...}] (extra fields like `path` pass through). CO
// classification wins over Bid (a CO filename can also contain "bid"). Returns the
// chosen subset of the input objects. Ties on mtime resolve to first-seen (stable
// given the caller's list order) so the choice is deterministic.
function chooseBidCoFiles(files) {
  const list = Array.isArray(files) ? files : [];
  const cos = [];
  let bestBid = null;
  for (const f of list) {
    const name = String((f && f.name) || '');
    if (/\bCO\b/.test(name)) { cos.push(f); continue; }
    if (!/bid/i.test(name)) continue;
    const t = Number(f && f.mtime) || 0;
    if (!bestBid || t > bestBid.t) bestBid = { f, t };
  }
  return bestBid ? [bestBid.f, ...cos] : cos;
}

// Bug B: the trade is guessed from rec.type, so a WO whose type misses the HVAC
// regex reads the Plumbing sheet in an HVAC-only workbook -> zero items. Instead pick
// the bid sheet that ACTUALLY EXISTS in the workbook. sheetNames = worksheet names in
// the file; bidCells = BID_CELLS (single source of truth for the canonical names).
// Exactly one canonical sheet present -> that name. Both or neither present -> null
// (caller falls back to the current rec.type guess).
function resolveBidSheetName(sheetNames, bidCells) {
  const names = Array.isArray(sheetNames) ? sheetNames : [];
  const present = Object.values(bidCells || {})
    .map(v => v && v.sheet)
    .filter(sheet => sheet && names.includes(sheet));
  return present.length === 1 ? present[0] : null;
}

// Bug A (real cause): a bid sheet lists the SAME work in both its main catalog table
// and its OTHER free-text summary (the human hand-writes OTHER for MSR's Salesforce
// submission), with wording ("Clean Condenser" vs "Clean condenser coil") and rounding
// (124.584 vs 124.58) drift, so an exact desc|price seen-set double-counts. FUZZY
// dedup: two items collapse iff BOTH (a) prices are cent-equal AND (b) one's matchTokens
// set CONTAINS the other's (smaller set is a subset of the larger AND has >=1 token, so
// an all-filler/empty desc never swallows a real one). Keep the RICHER (longer) desc;
// price is identical by the gate. items = [{desc, unitPrice, qty}]. Pure.
function dedupeLineItems(items) {
  const list = Array.isArray(items) ? items : [];
  const kept = [];  // { desc, unitPrice, qty, toks:Set }
  for (const it of list) {
    if (!it) continue;
    const cents = Math.round((Number(it.unitPrice) || 0) * 100);
    const toks = new Set(matchTokens(it.desc));
    let merged = false;
    for (const k of kept) {
      if (Math.round((Number(k.unitPrice) || 0) * 100) !== cents) continue;
      // token containment: smaller set subset of larger, and non-empty.
      const small = toks.size <= k.toks.size ? toks : k.toks;
      const large = small === toks ? k.toks : toks;
      if (!small.size) continue;
      let subset = true;
      for (const t of small) { if (!large.has(t)) { subset = false; break; } }
      if (!subset) continue;
      // duplicate: keep the richer (longer) desc + its token set.
      if (String(it.desc || '').length > String(k.desc || '').length) { k.desc = it.desc; k.toks = toks; }
      merged = true;
      break;
    }
    if (!merged) kept.push({ desc: it.desc, unitPrice: it.unitPrice, qty: it.qty, toks });
  }
  return kept.map(k => ({ desc: k.desc, unitPrice: k.unitPrice, qty: k.qty }));
}

// OTHER free-text bid lines: the human hand-writes MSR's Salesforce summary as packed
// "$amount desc" lines (one or more per cell row) and the vendor's Material/Labor rollup
// counts only the POSITIVE, non-warranty ones. Two kinds of line are NOT billable and
// are DROPPED so the parsed set matches that rollup:
//   - a NEGATIVE line = struck/removed scope, written "-$800 for no compressor install".
//     Splitting on '$' put the '-' at the tail of the PRIOR segment, so the amount read
//     as +800 and INFLATED the bid; the sign is now recovered and the line dropped.
//   - a WARRANTY line = designated non-billable to the PM ("$124.58 Capacitor - Warranty").
// A line can pack several "$amount desc"; a leading no-'$' segment ("200 Labor...") still
// parses. Verified against Advantis (317.50), Dell Meadows (230.66), Nightshade (1595).
// Pure. -> [{desc, unitPrice}].
function parseOtherCell(text) {
  const out = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('$');
    for (let i = 0; i < parts.length; i++) {
      const s = parts[i].trim();
      if (!s) continue;
      // Sign: a struck line reads "-$800 ...", so the '-' sits at the END of the segment
      // BEFORE this '$' (parts[i-1] ends with '-'). A leading no-'$' segment (i===0)
      // carries its own leading sign.
      let neg = i > 0 && /-\s*$/.test(parts[i - 1]);
      let body = s;
      if (i === 0) {
        const lead = body.match(/^(-)?\s*(.*)$/);
        if (lead && lead[1]) { neg = true; body = lead[2]; }
      }
      const m = body.match(/^([\d,]+(?:\.\d+)?)\s*(.+?)\s*$/);
      if (!m) continue;
      const price = parseFloat(m[1].replace(/,/g, ''));
      if (!Number.isFinite(price) || price <= 0) continue;
      if (neg) continue;                        // struck/removed scope: not charged
      const desc = m[2].trim();
      if (/warranty/i.test(desc)) continue;     // designated non-billable to the PM
      out.push({ desc, unitPrice: Math.round(price * 100) / 100 });
    }
  }
  return out;
}

module.exports = { chooseBidCoFiles, resolveBidSheetName, dedupeLineItems, parseOtherCell };
