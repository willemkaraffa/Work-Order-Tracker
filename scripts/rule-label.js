'use strict';
/*
 * rule-label.js: record that a rule fired, and whether that firing was RIGHT.
 *
 *   node scripts/rule-label.js <ruleId> "what actually happened when it fired"
 *
 * You describe the INCIDENT. The architect decides true positive or false
 * positive. Same no-verdict-from-caller discipline as review dispositions and
 * scope rulings, and here it is load-bearing for a specific reason the design doc
 * calls out: labelling authority must NOT sit with the coder, because the coder is
 * biased toward killing whichever rule constrains it most. A coder that could type
 * "fp" five times would retire any gate it disliked.
 *
 * This is the MEASURE step. Without it every count in the registry stays at
 * whatever a human last typed, and RETIRE can never trigger, which is exactly how
 * adaptivity loops rot into rule bloat.
 *
 * Exit: 0 labelled, 1 labelled AND the rule changed status, 2 no label recorded.
 */
const { spawnSync } = require('child_process');
const path = require('path');
const { readRegistry, recordFiring } = require('./rule-registry.js');

function main() {
  const [ruleId, ...rest] = process.argv.slice(2);
  const incident = rest.join(' ').trim();

  if (!ruleId || !incident) {
    console.error('usage: node scripts/rule-label.js <ruleId> "what happened when the rule fired"');
    return 2;
  }
  if (['tp', 'fp'].includes(incident.toLowerCase())) {
    console.error(`[rule-label] '${incident}' is a VERDICT, and you do not supply one.`);
    console.error('[rule-label] Describe what happened; the architect labels it.');
    return 2;
  }

  const doc = readRegistry();
  if (!doc) { console.error('[rule-label] no rule registry found.'); return 2; }
  const rule = doc.rules.find(r => r.id === ruleId);
  if (!rule) {
    console.error(`[rule-label] no rule '${ruleId}'. Known: ${doc.rules.map(r => r.id).join(', ')}`);
    return 2;
  }

  const prompt = `You are the ARCHITECT, judging whether an automated rule fired CORRECTLY.

You label firings because the coder cannot: a coder labelling the rules that constrain it will
retire whichever one annoys it most. Judge the incident on its merits.

=== THE RULE ===
${rule.id}: ${rule.name}
${rule.description || ''}

=== WHAT HAPPENED WHEN IT FIRED ===
${incident}

=== CURRENT EVIDENCE ===
true positives: ${rule.true_positive || 0}, false positives: ${rule.false_positive || 0}

Label it:
- "tp" (true positive): the rule fired on the thing it exists to catch. The block or nudge was
  correct and useful, even if inconvenient.
- "fp" (false positive): the rule fired on something it should not have. The work was legitimate
  and the rule got in the way for no benefit.

A rule being ANNOYING is not a false positive. A rule being WRONG about what it detected is.
Inconvenience is often the rule working as intended.

Output ONLY a JSON object, no prose, no fences:
{"label":"tp|fp","reason":"one sentence"}`;

  // Reuse architect.js's Gemini plumbing by shelling out to a tiny inline judge,
  // rather than duplicating the model-fallback chain here (rule B3).
  const r = spawnSync(process.execPath, ['-e', `
    const { callGemini, extractJson } = require(${JSON.stringify(path.join(__dirname, 'gemini-call.js'))});
    (async () => {
      const call = await callGemini(process.argv[1], { tag: 'architect' });
      if (!call.ok) { console.error('NOCALL ' + call.why); process.exitCode = 2; return; }
      try {
        const o = extractJson(call.text, 'object');
        const label = String(o.label || '').trim().toLowerCase();
        if (label !== 'tp' && label !== 'fp') throw new Error('unknown label ' + o.label);
        const reason = String(o.reason || '').trim();
        if (!reason) throw new Error('no reason');
        console.log(JSON.stringify({ label, reason, model: call.model }));
      } catch (e) { console.error('BADJSON ' + e.message); process.exitCode = 2; }
    })();
  `, prompt], { encoding: 'utf8' });

  if (r.status !== 0) {
    console.error(`[rule-label] architect did not rule: ${(r.stderr || '').trim()}`);
    console.error('[rule-label] NOTHING recorded. An unlabelled firing is better than a guessed one.');
    return 2;
  }

  let verdict;
  try { verdict = JSON.parse(r.stdout.trim().split('\n').pop()); }
  catch { console.error('[rule-label] unreadable architect output; nothing recorded.'); return 2; }

  const res = recordFiring(ruleId, verdict.label, `${verdict.reason} (architect, ${verdict.model})`);

  console.log(`\n[rule-label] ${verdict.model} labelled ${ruleId} firing: ${verdict.label.toUpperCase()}`);
  console.log(`[rule-label] reason: ${verdict.reason}`);
  console.log(`[rule-label] ${ruleId} now TP=${res.rule.true_positive} FP=${res.rule.false_positive}`);

  if (res.changed) {
    console.log(`\n[rule-label] STATUS CHANGE: ${res.before} -> ${res.after}`);
    if (res.after === 'retired') {
      console.log(`[rule-label] ${ruleId} is RETIRED. Its guard will now stand down and stop firing.`);
      console.log('[rule-label] This is a real change to what the system enforces. Tell the user.');
    }
    return 1;
  }
  return 0;
}

process.exitCode = main();
