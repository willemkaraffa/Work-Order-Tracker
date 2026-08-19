'use strict';
const BRIDGE_URL = 'http://127.0.0.1:27843';

// ── Context menus ─────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  const fields = [
    { id: 'wo_address', title: 'WO Capture → Set as Address' },
    { id: 'wo_tech',    title: 'WO Capture → Set as Technician' },
    { id: 'wo_pm',      title: 'WO Capture → Set as PM / Client' },
    { id: 'wo_phone',   title: 'WO Capture → Set as Phone' },
    { id: 'wo_notes',   title: 'WO Capture → Set as Notes' },
    { id: 'wo_type',    title: 'WO Capture → Set as Type' },
    { id: 'wo_status',  title: 'WO Capture → Set as Status' },
  ];
  // Menus survive extension reloads; a bare create() throws duplicate-id on reload.
  chrome.contextMenus.removeAll(() => {
    fields.forEach(f => chrome.contextMenus.create({ id: f.id, title: f.title, contexts: ['selection'] }));
  });
});

// ── Command polling (app-triggered capture) ───────────────────────────────────
// The tracker app queues commands at GET /command (e.g. "Capture all MSR" button).
// Poll on a chrome.alarm so the service worker wakes to check even after idle.
// ARM THE ALARM AT TOP LEVEL, ON EVERY WORKER SPAWN. This was the "find new does not
// see my open Pending tab" failure, and it is not a detection bug at all: backgroundFindNew
// has exactly ONE caller (pollCommand), pollCommand has exactly ONE trigger (this alarm),
// and the alarm used to be created ONLY from onInstalled/onStartup.
//
// Reloading the extension CLEARS its alarms, and neither of those events fires on a plain
// reload (Chrome did not start; nothing was installed or updated). So after a reload the
// poll was dead: the app queued findNewMsr at /command, nothing ever dequeued it, and the
// app just spun until its 2-minute banner timeout. It stayed dead until Chrome restarted
// or the extension updated, which is why this came back day after day.
//
// A service worker respawns constantly and event listeners fire only in their own narrow
// circumstances, so alarm state must never depend on them. create() with an existing name
// overwrites, so this is idempotent.
// GET-THEN-CREATE, never a bare create: create() on an existing alarm RESETS its
// scheduled time, and this runs on every worker spawn, so a bare create would let
// frequent spawns postpone the alarm forever. Same bug class, opposite direction.
// Chrome CLAMPS alarm periods to a 1-minute floor in a released extension, so a smaller
// number is silently ignored rather than honoured. Stating the real floor keeps the
// worst-case latency of an app-queued command honest: up to ~60s, inside the app's
// 2-minute banner timeout. The spawn-time drain below covers the common case, since any
// worker wake (popup, content-script message) picks a queued command up at once.
const POLL_MINUTES = 1;

chrome.alarms.get('woCommandPoll').then(a => {
  if (!a) chrome.alarms.create('woCommandPoll', { periodInMinutes: POLL_MINUTES });
});
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('woCommandPoll', { periodInMinutes: POLL_MINUTES }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('woCommandPoll', { periodInMinutes: POLL_MINUTES }));
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'woCommandPoll') pollCommand(); });

let commandRunning = false;
async function pollCommand() {
  if (commandRunning) return;
  commandRunning = true;
  try {
    let cmd = null;
    try {
      const r = await fetch(BRIDGE_URL + '/command', { signal: AbortSignal.timeout(3000) });
      if (r.ok) cmd = (await r.json()).command;
    } catch (_) { return; } // tracker not running
    if (!cmd || !cmd.action) return;
    if (cmd.action === 'findNewMsr') {
      await backgroundFindNew();
    }
  } finally {
    commandRunning = false;
  }
}

// Drain any command already queued when this worker spawned. Without it a reload
// stranded a waiting command for up to a full alarm period.
pollCommand();

// Scan the open MSR list tab for WO numbers and POST them to the tracker, which
// diffs them and lists the ones not yet added. (Replaces the unreliable
// off-screen batch capture.)
const MSR_TAB_MATCH = '*://amherst.my.site.com/*';

// WHICH Amherst tab to host the hidden list iframe.
//
// The 2026-07-22 wrong-tab hazard (scanning a stale WORK ORDER DETAIL tab's own
// /workorder/ anchors instead of the pending-bid list) is gone: the scan now loads
// the canonical MSR_ASSESSMENT_URL in a same-origin iframe rather than reading the
// host tab's DOM, so which page the tab happens to show no longer matters and
// multi-tab ambiguity is no longer a failure.
//
// Preference order: the tab the user is on, then any match.
async function pickMsrTab() {
  const active = await chrome.tabs.query({ url: MSR_TAB_MATCH, active: true, currentWindow: true });
  if (active && active[0]) return { tab: active[0], matches: active };
  const all = await chrome.tabs.query({ url: MSR_TAB_MATCH });
  if (!all || !all.length) return { tab: null, matches: [] };
  // Any amherst tab can host the hidden list iframe (the scan loads
  // MSR_ASSESSMENT_URL itself rather than reading the host tab's own DOM),
  // so ambiguity no longer matters: pick the first match.
  return { tab: all[0], matches: all };
}

// POST scan result to the tracker. `source.error`, when set, tells the app the
// scan could not run (no/ambiguous tab) so it clears its in-flight banner and
// shows the reason, instead of the app spinning for 2 min then silently
// clearing, which read as "nothing happened" (the Chrome notify below is the
// ONLY prior feedback, and it is invisible when the app has focus).
async function postFound(items, source) {
  try {
    await fetch(BRIDGE_URL + '/found-wos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, source }), signal: AbortSignal.timeout(3000),
    });
  } catch (_) {}
}

async function backgroundFindNew() {
  const { tab, matches } = await pickMsrTab();
  if (!tab && !matches.length) {
    // LOG BEFORE RETURNING. This bail printed nothing, so a Chrome restart (whose
    // restored tabs materialize late) produced an unexplainable empty console.
    console.log('[wo] find-new: BAIL, chrome.tabs.query found 0 amherst tabs');
    const msg = 'Open an MSR list page (amherst.my.site.com) first.';
    notify('Find new MSR WOs', msg);
    await postFound([], { error: msg, tabCount: 0 });
    return;
  }
  if (!tab) {
    console.log('[wo] find-new: BAIL, ' + matches.length + ' amherst tabs, none active');
    const msg = matches.length + ' Amherst tabs are open and none is active. Click the tab showing the list you want scanned, then run this again.';
    notify('Find new MSR WOs', msg);
    await postFound([], { error: msg, tabCount: matches.length });
    return;
  }
  console.log('[wo] find-new: dequeued, host tab', tab.id, tab.url);
  let r = await sendTabMsgRetry(tab.id, { action: 'scanMsrList' });
  if (!r) {
    console.log('[wo] find-new: no ack, reviving content script in tab', tab.id);
    if (await reviveContentScript(tab)) r = await sendTabMsgRetry(tab.id, { action: 'scanMsrList' }, 3, 1000);
  }
  if (!r || !r.ok) {
    const msg = 'MSR page not ready, keep an amherst tab open and loaded, then try again.';
    notify('Find new MSR WOs', msg);
    await postFound([], { url: tab.url || '', title: tab.title || '', tabCount: matches.length, error: msg });
    return;
  }
  // Scan runs in the content script; its result arrives later via foundWosResult.
  console.log('[wo] find-new: scan started, awaiting foundWosResult');
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const fieldMap = {
    wo_address: 'address', wo_tech: 'tech', wo_pm: 'pm',
    wo_phone: 'phone', wo_notes: 'notes', wo_type: 'type', wo_status: 'status',
  };
  const field = fieldMap[info.menuItemId];
  if (field && info.selectionText) {
    chrome.storage.local.get(['wo_draft'], (res) => {
      const draft = res.wo_draft || {};
      draft[field] = info.selectionText.trim();
      chrome.storage.local.set({ wo_draft: draft });
      // sendTabMsg, not a bare sendMessage: the draft is already saved above, so a
      // tab with no live content script (discarded/orphaned) must not reject.
      if (tab && tab.id != null) sendTabMsg(tab.id, { action: 'fieldCaptured', field, value: info.selectionText.trim() });
    });
  }
});

// ── HTTP bridge to tracker app ────────────────────────────────────────────────
async function pingTracker() {
  try {
    const r = await fetch(BRIDGE_URL + '/ping', { signal: AbortSignal.timeout(3000) });
    if (r.ok) { const d = await r.json(); return { ok: true, status: d.status }; }
    return { ok: false, error: 'Bad response' };
  } catch(e) {
    return { ok: false, error: 'Tracker app not running or not open' };
  }
}

async function sendOrdersToTracker(orders) {
  try {
    const r = await fetch(BRIDGE_URL + '/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orders),
      signal: AbortSignal.timeout(5000)
    });
    if (r.ok) {
      const d = await r.json();
      return { ok: true, count: d.count };
    }
    return { ok: false, error: 'Tracker returned error' };
  } catch(e) {
    return { ok: false, error: 'Tracker app not running. Open the tracker first.' };
  }
}

// ── Headless bulk MSR capture (driven inside an open MSR tab) ──────────────────
// MSR is locked to the authenticated Chrome profile and allows self-framing, so
// the content script on an MSR tab does the actual capture via hidden iframes
// (no window/tab churn — verified self-framing works). The background just finds
// that tab, kicks it off, and imports the result the content script posts back.
function sendTabMsg(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (r) => { resolve(chrome.runtime.lastError ? null : r); });
  });
}
async function sendTabMsgRetry(tabId, message, tries = 5, gap = 1000) {
  for (let i = 0; i < tries; i++) {
    const r = await sendTabMsg(tabId, message);
    if (r) return r;
    await new Promise(s => setTimeout(s, gap));
  }
  return null;
}

// A tab can appear in tabs.query results yet have NO live content script: Chrome
// Memory Saver DISCARDED it, an extension reload orphaned the injected copy, or a
// silent update replaced the extension. sendTabMsg then never acks and the capture
// bails with "page not ready" (seen live 2026-08-14). Revive before giving up.
async function waitTabComplete(tabId, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    let t = null;
    try { t = await chrome.tabs.get(tabId); } catch (_) { return false; }
    if (t && !t.discarded && t.status === 'complete') return true;
    await new Promise(s => setTimeout(s, 500));
  }
  return false;
}

async function reviveContentScript(tab) {
  try {
    if (tab.discarded) {
      // No renderer to inject into; a reload re-runs the declarative injection.
      await chrome.tabs.reload(tab.id);
      const ok = await waitTabComplete(tab.id);
      if (ok) await new Promise(s => setTimeout(s, 1500)); // content.js runs at document_idle
      return ok;
    }
    // content.js self-guards with window.__woCaptureInjected; an ORPHANED copy leaves
    // that flag set in the isolated world, which would make re-injection a silent
    // no-op. Clear it first (func: runs in the same ISOLATED world), then inject.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { try { window.__woCaptureInjected = false; } catch (_) {} } });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    return true;
  } catch (e) {
    console.log('[wo] revive failed:', e && e.message);
    return false;
  }
}

// PERSISTED, NOT IN MEMORY. An MV3 service worker terminates when idle, so a module
// variable and a setTimeout both die mid-capture: the guard silently cleared itself and
// the 12-minute safety timer never fired. Stored as a START TIMESTAMP with a TTL, which
// needs no timer at all -- an expired stamp simply stops counting as in flight.
const MSR_INFLIGHT_KEY = 'wo_msr_inflight_at';
const MSR_INFLIGHT_MS = 12 * 60 * 1000;

async function msrInFlight() {
  const at = (await chrome.storage.local.get(MSR_INFLIGHT_KEY))[MSR_INFLIGHT_KEY];
  return !!at && (Date.now() - at) < MSR_INFLIGHT_MS;
}

// Find an open MSR tab and tell its content script to start the headless
// capture. `one` = { url, woId } captures just that WO; null = the full list.
async function backgroundStartMsr(one) {
  if (await msrInFlight()) return { ok: false, error: 'An MSR capture is already running.' };
  const tabs = await chrome.tabs.query({ url: '*://amherst.my.site.com/*' });
  const tab = tabs && tabs[0];
  if (!tab) {
    notify('MSR capture', 'Open an MSR tab (amherst.my.site.com) first, then try again.');
    return { ok: false, error: 'No MSR tab open.' };
  }
  let r = await sendTabMsgRetry(tab.id, { action: 'startMsrCapture', one: one || null });
  if (!r) {
    console.log('[wo] msr-capture: no ack, reviving content script in tab', tab.id);
    if (await reviveContentScript(tab)) r = await sendTabMsgRetry(tab.id, { action: 'startMsrCapture', one: one || null }, 3, 1000);
  }
  if (!r || !r.ok) {
    notify('MSR capture', 'Could not start — make sure an MSR page is fully loaded.');
    return { ok: false, error: (r && r.error) || 'content script not ready' };
  }
  // Stamp the start. If no result ever arrives (user navigated the tab, worker died),
  // the stamp ages out after MSR_INFLIGHT_MS instead of needing a timer to survive.
  await chrome.storage.local.set({ [MSR_INFLIGHT_KEY]: Date.now() });
  return { ok: true, started: true };
}

// Ask the APP to capture an AMH work order with its own scraper, so the extension
// never runs a second, divergent AMH extractor (see main.js /capture-amh). The app
// captures via the live-verified GET Order/{orderGuid}; pass orderGuid through.
async function captureAmhViaApp(woId, orderGuid) {
  try {
    const r = await fetch(BRIDGE_URL + '/capture-amh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ woId, orderGuid }), signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, error: 'tracker returned HTTP ' + r.status };
    return await r.json();
  } catch (e) {
    return { ok: false, error: 'Work Order Tracker is not reachable. Open the app, then capture again. (' + e.message + ')' };
  }
}

// ── Message handlers ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'captureAmhViaApp') {
    captureAmhViaApp(msg.woId, msg.orderGuid).then(sendResponse);
    return true;   // async response
  }

  if (msg.action === 'getDraft') {
    chrome.storage.local.get(['wo_draft'], (res) => sendResponse({ draft: res.wo_draft || {} }));
    return true;
  }

  if (msg.action === 'setDraftField') {
    chrome.storage.local.get(['wo_draft'], (res) => {
      const draft = res.wo_draft || {};
      draft[msg.field] = msg.value;
      chrome.storage.local.set({ wo_draft: draft });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.action === 'clearDraft') {
    chrome.storage.local.set({ wo_draft: {} }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'saveDraft') {
    chrome.storage.local.set({ wo_draft: msg.draft }, () => sendResponse({ ok: true }));
    return true;
  }

  if (msg.action === 'saveToList') {
    chrome.storage.local.get(['wo_saved_list'], (res) => {
      const list = res.wo_saved_list || [];
      const nums = list.map(o => parseInt((o.id||'WO-000').replace('WO-',''))||0);
      const wo = Object.assign({ id: 'WO-' + String(Math.max(0,...nums)+1).padStart(3,'0'), _savedAt: new Date().toISOString() }, msg.data);
      list.push(wo);
      chrome.storage.local.set({ wo_saved_list: list }, () => sendResponse({ ok: true, id: wo.id }));
    });
    return true;
  }

  if (msg.action === 'sendToTracker') {
    chrome.storage.local.get(['wo_saved_list'], async (res) => {
      const list = res.wo_saved_list || [];
      if (!list.length) { sendResponse({ ok: false, error: 'No saved work orders.' }); return; }
      const result = await sendOrdersToTracker(list);
      if (result.ok) {
        // REMOVE WHAT WAS SENT, never blank the list. A capture made while the POST was
        // in flight lands in wo_saved_list after this handler read it, and a blanket
        // reset silently threw that work order away. Re-read and subtract by id.
        const sent = new Set(list.map(o => o.id));
        const fresh = (await chrome.storage.local.get(['wo_saved_list'])).wo_saved_list || [];
        await chrome.storage.local.set({ wo_saved_list: fresh.filter(o => !sent.has(o.id)) });
      }
      sendResponse(result);
    });
    return true;
  }

  if (msg.action === 'getMappings') {
    chrome.storage.local.get(['wo_mappings'], (res) => {
      sendResponse({ mappings: res.wo_mappings || [] });
    });
    return true;
  }

  if (msg.action === 'getConfig') {
    chrome.storage.local.get(['wo_tracker_config'], (res) => {
      sendResponse({ config: res.wo_tracker_config || null });
    });
    return true;
  }

  if (msg.action === 'pingHost') {
    pingTracker().then(sendResponse);
    return true;
  }

  // Bulk import a given orders array straight to the tracker (used by the MSR
  // list capture — does NOT touch the saved_list staging area).
  if (msg.action === 'importOrders') {
    (async () => {
      if (!Array.isArray(msg.orders) || !msg.orders.length) {
        sendResponse({ ok: false, error: 'No work orders to import.' });
        return;
      }
      sendResponse(await sendOrdersToTracker(msg.orders));
    })();
    return true;
  }

  // Start headless MSR capture in an open MSR tab (from popup or app trigger).
  if (msg.action === 'woDiag') {
    woDiag().then(sendResponse).catch(e => sendResponse({ error: String(e && e.message || e) }));
    return true;
  }

  if (msg.action === 'captureMsrAll') {
    backgroundStartMsr().then(sendResponse);
    return true;
  }

  // RETURN TRUE AND ANSWER WHEN DONE, even though the sender wants no reply. Returning
  // false closes the message channel at once, and an MV3 worker with no open channel and
  // no pending event may be terminated mid-flight -- killing the storage write, the
  // tracker POST, or the progress fetch these handlers depend on. The ack is what keeps
  // the worker alive until the work finishes.
  if (msg.action === 'msrCaptureResult') {
    (async () => {
      await chrome.storage.local.remove(MSR_INFLIGHT_KEY);
      const orders = Array.isArray(msg.orders) ? msg.orders : [];
      if (!orders.length) {
        notify('MSR capture', msg.error ? ('Failed: ' + msg.error) : 'No work orders captured.');
        return;
      }
      const result = await sendOrdersToTracker(orders);
      notify('MSR capture complete',
        result.ok ? `${orders.length} work order(s) sent to the tracker.`
                  : `Import failed: ${result.error || 'tracker not running'}.`);
    })().finally(() => sendResponse({ ok: true }));
    return true;
  }

  // Result posted back by the content script after the hidden find-new list scan.
  if (msg.action === 'foundWosResult') {
    console.log('[wo] find-new: foundWosResult items=' + ((msg.items && msg.items.length) || 0) + ' error=' + (msg.error || ''));
    postFound(Array.isArray(msg.items) ? msg.items : [], { error: msg.error || '' })
      .finally(() => sendResponse({ ok: true }));
    return true;
  }

  // Per-WO progress from the content loop -> forward to the tracker for its banner.
  if (msg.action === 'msrProgress') {
    fetch(BRIDGE_URL + '/progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: msg.done, total: msg.total }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {}).finally(() => sendResponse({ ok: true }));
    return true;
  }
});

// ── One-shot diagnosis ────────────────────────────────────────────────────────
// Returns EVERY fact a find-new failure depends on, in one pass, as plain text.
//
// Why: MSR faults live in browser state, not in the repo (which tab exists, whether a
// content script answers, whether the bridge is up, whether the list renders). Each of
// those facts used to cost one round trip of screenshots and theories; one session burned
// ~4M tokens on twelve such trips. Read-only: no import, no WO writes, and it must NOT
// GET /command (that queue is one-shot and consuming it breaks a real run).
async function woDiag() {
  const out = { version: chrome.runtime.getManifest().version, ts: new Date().toISOString() };
  const tabs = await chrome.tabs.query({ url: MSR_TAB_MATCH });
  out.tabCount = tabs.length;
  out.tabs = tabs.map(t => ({ id: t.id, url: (t.url || '').slice(0, 120), status: t.status, discarded: !!t.discarded, active: !!t.active }));
  const picked = await pickMsrTab();
  out.picked = picked.tab ? { id: picked.tab.id, url: (picked.tab.url || '').slice(0, 120) } : null;
  out.bridge = await pingTracker();
  // THE load-bearing fact: no alarm means pollCommand never runs, which means find-new
  // never runs at all, no matter how healthy the tabs and the content script look.
  const alarm = await chrome.alarms.get('woCommandPoll');
  out.pollAlarm = alarm ? { periodInMinutes: alarm.periodInMinutes, scheduledIn: Math.round((alarm.scheduledTime - Date.now()) / 1000) + 's' } : 'MISSING (find-new cannot fire)';

  if (picked.tab) {
    // One try, not the 5-try retry: the point is to observe whether the script is
    // alive RIGHT NOW, not to paper over it.
    let ack = await sendTabMsg(picked.tab.id, { action: 'ping' });
    out.ack = ack ? { ok: true, url: (ack.url || '').slice(0, 120), onList: !!ack.onList } : false;
    if (!ack) {
      out.revived = await reviveContentScript(picked.tab);
      ack = out.revived ? await sendTabMsgRetry(picked.tab.id, { action: 'ping' }, 3, 1000) : null;
      out.ackAfterRevive = ack ? { ok: true, onList: !!ack.onList } : false;
    }
    // NO scanMsrList HERE. Triggering a scan is not read-only: the content script
    // posts foundWosResult, which postFound sends to the tracker and the app turns
    // into a "new MSR WOs" notification. A diagnosis must not manufacture one. The
    // scan path is observed from a REAL run instead, which logs
    // "[wo] find-new: via=<live tab|iframe> items=N".
  } else {
    out.ack = 'skipped (no tab)';
  }
  console.log('[wo] diag', JSON.stringify(out, null, 2));
  return out;
}

// Desktop notification (best-effort; ignored if permission/icon unavailable).
function notify(title, message) {
  try {
    chrome.notifications.create('', {
      type: 'basic', iconUrl: 'icons/icon48.png', title, message, priority: 1,
    });
  } catch (_) {}
}
