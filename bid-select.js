'use strict';
// Bid/CO sheet selection helpers for read-bid-lineitems. Pure (no fs/electron) so
// they unit-test by direct require (test/bid-select.test.js); main.js does the fs
// stat + exceljs read and passes the results in. Mirrors library_io.js: a plain
// root CJS module required by the CJS main.js (which cannot import the ESM
// src/orders-logic.js).
const { matchTokens } = require('./text-normalize');

// Bug A: a WO folder can hold several bid/CO xlsx. Both a Bid and a CO (change order)
// are FULL restatements of the WO's scope -- the MSR workflow copies the whole bid
// sheet into a dated subfolder and edits it, so a CO re-lists every base line plus the
// change (verified: Nightshade WO 03920688 CO restates all 5 base lines and swaps the
// faucet lines for a diverter, total 1595 -> 1343 = the paid amount). Summing a Bid and
// its CO therefore double-counts the base and keeps BOTH the superseded and the new
// lines. So the NEWEST file (by mtime) wins outright, whether Bid or CO -- a CO is just
// a newer revision. On an mtime tie a CO beats a Bid (the CO is the later intent); a
// further tie keeps first-seen (stable given caller list order) for determinism. Input
// is pre-filtered to bid|CO files: [{name, mtime, ...}] (extra fields like `path` pass
// through). Returns a single-element array (or [] when empty).
function chooseBidCoFiles(files) {
  const list = Array.isArray(files) ? files : [];
  let best = null;  // { f, t, isCo }
  for (const f of list) {
    const name = String((f && f.name) || '');
    const isCo = /\bCO\b/.test(name);
    if (!isCo && !/bid/i.test(name)) continue;
    const t = Number(f && f.mtime) || 0;
    if (!best || t > best.t || (t === best.t && isCo && !best.isCo)) best = { f, t, isCo };
  }
  return best ? [best.f] : [];
}

// Additive fallback (pre-2026-08 model): when a CO was NOT fully itemized it lists only
// the delta, so the WO's true scope is the newest Bid + EVERY CO (multiple bids are full
// revisions of one another, so only the newest bid counts). dedupeLineItems (applied by
// selectBidItems) then collapses the base lines a partial CO shares with the bid.
function additiveBidCoFiles(files) {
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

// Paid amount is the SOURCE OF TRUTH for which sheets describe the WO. MSR now requires
// each CO to FULLY restate the WO scope, so the single newest sheet (chooseBidCoFiles) is
// primary. Legacy/incomplete COs list only the delta, so the additive union
// (additiveBidCoFiles) is the fallback. Return whichever candidate's deduped total is
// CLOSEST to the paid amount; the primary (restatement) wins ties AND when neither total
// matches (it is what SHOULD be correct, so a genuine under/overpay still reconciles
// against it and flags off). candidates = [{name, mtime, rows:[{desc,unitPrice,qty}]}];
// paid = remittance amount (<=0 / absent -> primary, e.g. invoice-generation preview).
// Returns {items, statedTotal}; statedTotal is set ONLY when the single-sheet primary is
// chosen (a per-sheet bid total is undefined across a multi-sheet additive union).
function selectBidItems(candidates, paid) {
  const rowsOf = (files) => (Array.isArray(files) ? files : []).reduce((acc, f) => acc.concat((f && f.rows) || []), []);
  const sumItems = (arr) => Math.round((Array.isArray(arr) ? arr : []).reduce((s, x) => {
    const q = Number(x && x.qty) > 0 ? Number(x.qty) : 1;
    return s + (Number(x && x.unitPrice) || 0) * q;
  }, 0) * 100) / 100;
  const primaryFiles = chooseBidCoFiles(candidates);
  const primary = dedupeLineItems(rowsOf(primaryFiles));
  const primaryStated = (primaryFiles.length === 1 && Number.isFinite(Number(primaryFiles[0].statedTotal))) ? Number(primaryFiles[0].statedTotal) : null;
  const paidN = Number(paid);
  if (!Number.isFinite(paidN) || paidN <= 0) return { items: primary, statedTotal: primaryStated };
  const additive = dedupeLineItems(rowsOf(additiveBidCoFiles(candidates)));
  const dp = Math.abs(sumItems(primary) - paidN);
  const da = Math.abs(sumItems(additive) - paidN);
  if (da < dp) return { items: additive, statedTotal: null };
  return { items: primary, statedTotal: primaryStated };
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

module.exports = { chooseBidCoFiles, additiveBidCoFiles, selectBidItems, resolveBidSheetName, dedupeLineItems, parseOtherCell };
