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
// SELF-HEALING: armed at TOP LEVEL, which runs on every service-worker wake, not just on
// install/startup. MV3 alarms are persistent so the two listeners below normally suffice,
// but a LOST alarm could not re-arm until a browser restart -- a failure this project has
// already hit once, and one that silently kills "Find new MSR WOs" with no error anywhere.
// GUARDED with get(): create() on an existing name REPLACES it and RESETS its schedule, and the
// worker wakes on many events (content-script messages, menu clicks, the alarm itself). An
// unguarded top-level create would push the next fire back on every wake, so a busy worker would
// starve the very alarm this is meant to protect. Only re-arm when the alarm is actually gone.
chrome.alarms.get('woCommandPoll', (a) => { if (!a) chrome.alarms.create('woCommandPoll', { periodInMinutes: 0.5 }); });
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('woCommandPoll', { periodInMinutes: 0.5 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('woCommandPoll', { periodInMinutes: 0.5 }));
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

// Scan the open MSR list tab for WO numbers and POST them to the tracker, which
// diffs them and lists the ones not yet added. (Replaces the unreliable
// off-screen batch capture.)
const MSR_TAB_MATCH = '*://amherst.my.site.com/*';

// WHICH Amherst tab the scan runs in.
//
// The scan reads the HOST TAB's OWN DOM (content.js scanMsrList), so the tab has to
// BE a work order list page. Picking any amherst tab was only safe while the scan
// loaded MSR_ASSESSMENT_URL into its own hidden iframe; that iframe path is gone, so
// a detail tab now either reports "not a list page" or, worse, wins on being active
// while a real list tab sits open in the same window.
//
// URL-ONLY, deliberately the same rule as isMSRListPage() in content.js: /partner/s/
// and not /workorder/. There is no DOM check to mirror any more -- readiness is judged
// downstream from the item count, not from whether Aura has painted yet.
//
// Preference: the active tab if it IS a list page, then the first list-page tab.
function isMsrListUrl(url) {
  // tab.url can be undefined (no host permission yet) or a non-http scheme; a tab we
  // cannot parse is simply not a candidate.
  try {
    const u = new URL(url || '');
    return u.hostname.includes('amherst.my.site.com')
      && u.pathname.includes('/partner/s/')
      && !u.pathname.includes('/workorder/');
  } catch (_) { return false; }
}

async function pickMsrTab() {
  const all = (await chrome.tabs.query({ url: MSR_TAB_MATCH })) || [];
  // matches = the tabs the scan could actually use, so the caller's "N tabs open"
  // never counts detail tabs it would refuse anyway.
  const lists = all.filter((t) => isMsrListUrl(t.url));
  if (!lists.length) return { tab: null, matches: [] };
  const active = (await chrome.tabs.query({ url: MSR_TAB_MATCH, active: true, currentWindow: true })) || [];
  const activeList = active.find((t) => isMsrListUrl(t.url));
  return { tab: activeList || lists[0], matches: lists };
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
  if (!tab) {
    // No LIST tab. Name which of the two it is: an amherst tab that is open but sitting
    // on a WO detail page is the case the user hits after clicking through from a list,
    // and telling them "open amherst" when amherst is already open reads as a bug.
    const anyAmherst = (await chrome.tabs.query({ url: MSR_TAB_MATCH })) || [];
    const msg = anyAmherst.length
      ? 'Amherst is open but not on a work order LIST page. Go to an MSR list (e.g. work orders in assessment), then try again.'
      : 'Open an MSR list page (amherst.my.site.com) first.';
    notify('Find new MSR WOs', msg);
    await postFound([], { error: msg, tabCount: anyAmherst.length });
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

let msrInFlight = false;
let msrInFlightTimer = null;

// Find an open MSR tab and tell its content script to start the headless
// capture. `one` = { url, woId } captures just that WO; null = the full list.
async function backgroundStartMsr(one) {
  if (msrInFlight) return { ok: false, error: 'An MSR capture is already running.' };
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
  msrInFlight = true;
  // Safety: clear the guard if no result arrives (e.g. user navigated the tab).
  if (msrInFlightTimer) clearTimeout(msrInFlightTimer);
  msrInFlightTimer = setTimeout(() => { msrInFlight = false; }, 12 * 60 * 1000);
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
      if (result.ok) chrome.storage.local.set({ wo_saved_list: [] });
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
  if (msg.action === 'captureMsrAll') {
    backgroundStartMsr().then(sendResponse);
    return true;
  }

  // Result posted back by the content script after the iframe capture finishes.
  if (msg.action === 'msrCaptureResult') {
    msrInFlight = false;
    if (msrInFlightTimer) { clearTimeout(msrInFlightTimer); msrInFlightTimer = null; }
    (async () => {
      const orders = Array.isArray(msg.orders) ? msg.orders : [];
      if (!orders.length) {
        notify('MSR capture', msg.error ? ('Failed: ' + msg.error) : 'No work orders captured.');
        return;
      }
      const result = await sendOrdersToTracker(orders);
      notify('MSR capture complete',
        result.ok ? `${orders.length} work order(s) sent to the tracker.`
                  : `Import failed: ${result.error || 'tracker not running'}.`);
    })();
    return false; // no response expected
  }

  // Result posted back by the content script after the hidden find-new list scan.
  if (msg.action === 'foundWosResult') {
    console.log('[wo] find-new: foundWosResult items=' + ((msg.items && msg.items.length) || 0) + ' error=' + (msg.error || ''));
    postFound(Array.isArray(msg.items) ? msg.items : [], { error: msg.error || '' });
    return false; // no response expected
  }

  // Per-WO progress from the content loop -> forward to the tracker for its banner.
  if (msg.action === 'msrProgress') {
    fetch(BRIDGE_URL + '/progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: msg.done, total: msg.total }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
    return false;
  }
});

// Desktop notification (best-effort; ignored if permission/icon unavailable).
function notify(title, message) {
  try {
    chrome.notifications.create('', {
      type: 'basic', iconUrl: 'icons/icon48.png', title, message, priority: 1,
    });
  } catch (_) {}
}
