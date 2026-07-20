'use strict';
/*
 * gemini-call.js: the shared REST call to Gemini. EXTRACTED from gemini-review.js
 * (which had it inline) so the architect can reuse it instead of re-deriving it.
 *
 * Extraction, not duplication, on purpose (rule B3): the model-fallback chain is
 * hard-won knowledge, not boilerplate. A single hardcoded model id failed three
 * distinct ways in one session (429 quota, 404 retired-but-still-listed, 503
 * capacity), and the no-process.exit rule below is a Windows-specific libuv bug.
 * A second hand-written copy in architect.js would have relearned all of it.
 *
 * KEY: GEMINI_API_KEY env var, or a gitignored `.gemini-key` at the repo root.
 */
const fs = require('fs');
const path = require('path');

// Free-tier availability is a moving target, so try a chain, newest first, and use
// whichever answers. GEMINI_MODEL overrides the chain entirely.
const MODELS = process.env.GEMINI_MODEL
  ? [process.env.GEMINI_MODEL]
  : ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];

const endpointFor = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;

// This model is unusable right now -> fall through to the next. Anything else is a
// real error worth surfacing immediately.
const TRY_NEXT = new Set([429, 404, 503]);

function loadKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    const k = fs.readFileSync(path.join(__dirname, '..', '.gemini-key'), 'utf8').trim();
    if (k) return k;
  } catch { /* file absent -> no key */ }
  return null;
}

// Calls Gemini with `prompt`. Returns { ok: true, text, model } or
// { ok: false, why } -- NEVER throws, and never exits the process.
//
// Callers map !ok to their own "DID NOT RUN" exit code. A failed call must never
// read as a clean pass; that is the false-confidence failure this whole layer
// exists to prevent.
//
// `tag` only labels log lines so a caller's messages stay recognizable.
async function callGemini(prompt, { tag = 'gemini', json = true } = {}) {
  const key = loadKey();
  if (!key) {
    return { ok: false, why: 'no key (set GEMINI_API_KEY or create .gemini-key)' };
  }

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: json
      ? { temperature: 0, responseMimeType: 'application/json' }
      : { temperature: 0 },
  };

  for (const m of MODELS) {
    let res;
    try {
      res = await fetch(endpointFor(m), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error(`[${tag}] ${m}: network error: ${e.message}: trying next model.`);
      continue;
    }

    // Reading the BODY can throw too (truncated/malformed JSON, a socket dying
    // mid-read), and a throw here would break the never-throws contract above and
    // crash the caller instead of returning a clean "did not run". A body we cannot
    // read is a failed call, not a pass.
    if (res.ok) {
      let data;
      try {
        data = await res.json();
      } catch (e) {
        return { ok: false, why: `${m}: unreadable response body: ${e.message}` };
      }
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return { ok: false, why: `${m}: empty/blocked response` };
      return { ok: true, text, model: m };
    }
    if (TRY_NEXT.has(res.status)) {
      console.error(`[${tag}] ${m}: ${res.status} ${res.statusText}: trying next model.`);
      continue;
    }
    let detail;
    try {
      detail = (await res.text()).slice(0, 500);
    } catch (e) {
      detail = `(error body unreadable: ${e.message})`;
    }
    return { ok: false, why: `${m}: API ${res.status} ${res.statusText}: ${detail}` };
  }
  return { ok: false, why: `no model in [${MODELS.join(', ')}] was available` };
}

// Gemini may wrap JSON in ```json fences or add stray prose. Extract the first
// balanced-looking JSON value of the requested kind.
// `kind` is 'array' or 'object'.
function extractJson(text, kind = 'object') {
  const stripped = String(text).replace(/```(?:json)?/gi, '').trim();
  const [open, close] = kind === 'array' ? ['[', ']'] : ['{', '}'];
  const start = stripped.indexOf(open);
  const end = stripped.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) throw new Error(`no JSON ${kind} in response`);
  return JSON.parse(stripped.slice(start, end + 1));
}

module.exports = { callGemini, loadKey, extractJson, MODELS, endpointFor, TRY_NEXT };
