'use strict';
const { BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

// SCRAPER_DEBUG=1: write a {tag, url, innerText, html} dump to ~/Downloads at
// every key extraction point so post-mortem analysis doesn't require live
// reproduction. No-op when DEBUG is false.
async function dumpPageState(win, tag) {
  if (!process.env.SCRAPER_DEBUG) return;
  try {
    const url = win.webContents.getURL();
    const html = await win.webContents.executeJavaScript('document.documentElement.outerHTML');
    const text = await win.webContents.executeJavaScript('document.body ? document.body.innerText : ""');
    const file = path.join(os.homedir(), 'Downloads',
      'wo-scraper-' + tag + '-' + Date.now() + '.json');
    await fs.promises.writeFile(file, JSON.stringify({ tag, url, capturedAt: new Date().toISOString(), innerText: text, html }, null, 2));
    console.log('[scraper] DUMP', tag, '->', file);
  } catch (e) { console.log('[scraper] dumpPageState err', e.message); }
}

const AMH_BASE    = 'https://www.amh.com';
const AMH_WO_LIST = AMH_BASE + '/my-amh/vendor-user-orders?tabId=all';

// Proven DOM/innerText extraction core, injected into each loaded page. New
// document on every navigation wipes window.__woExtract, so re-inject after
// every loadURL via injectExtract().
const EXTRACT_SRC = fs.readFileSync(path.join(__dirname, 'scraper-extract.js'), 'utf8');

// Registry: PM name (uppercase) → capture function.
// HYBRID: MSR is intentionally NOT in-app. MSR is Salesforce partner SSO, which
// cannot authenticate inside a fresh Electron BrowserWindow (SSO blocks embedded
// browsers / no live profile session). MSR keeps the proven path: the Chrome
// extension running in the user's authenticated Chrome POSTs to the /import
// bridge (main.js). Only AMH (injected login works in-app) is captured here.
const SCRAPERS = { AMH: captureAMH };

// Entry point called from main.js IPC handler. Drives a BrowserWindow through
// every tab of the WO and returns a full WO object ready for upsertOrders.
// getCredential(pm) → { username, password } | null.
async function captureWO(wo, getCredential) {
  const pm = (wo.pm || '').toUpperCase();
  if (pm === 'MSR') {
    return { ok: false, error: 'MSR capture runs through the Chrome extension (authenticated Chrome session), not in-app. Use the extension to import MSR work orders.' };
  }
  const fn = SCRAPERS[pm];
  if (!fn) return { ok: false, error: `No scraper registered for PM "${wo.pm}"` };
  return fn(wo, getCredential);
}

// ── Utility ───────────────────────────────────────────────────────────────────

// SCRAPER_DEBUG=1 shows the BrowserWindow and logs each step — used by the live
// portal test harness (test/live-capture.js). No effect in normal app use.
const DEBUG = !!process.env.SCRAPER_DEBUG;
function dlog(...a) { if (DEBUG) console.log('[scraper]', ...a); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Standard desktop Chrome UA. Some portals reject Electron's default UA
// ("Work Order Tracker/x.y.z Electron/…") with "browser not supported" pages
// or by silently refusing the login form. Spoofing a current Chrome UA is the
// least-invasive workaround.
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function makeWindow(partition, show) {
  const win = new BrowserWindow({
    show: !!show || DEBUG, width: 1280, height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Dedicated persistent partition so the portal session cookie survives
      // app restarts — user only logs in once per machine.
      partition,
    }
  });
  try { win.webContents.setUserAgent(CHROME_UA); } catch (_) {}
  return win;
}

function exec(win, js) { return win.webContents.executeJavaScript(js); }

// Poll a boolean JS predicate until true or timeout. AMH/MSR are SPAs that
// render the WO body asynchronously after navigation, so a fixed sleep races
// the render — extracting the page shell instead of the WO. Wait for a content
// marker before extracting.
async function waitFor(win, predicateJs, tries = 48, gap = 400) {
  for (let i = 0; i < tries; i++) {
    let ok = false;
    try { ok = await exec(win, '!!(' + predicateJs + ')'); } catch (_) {}
    if (ok) return true;
    await sleep(gap);
  }
  return false;
}

// Re-inject the extraction core into the current document, then return
// window.__woExtract is available for subsequent exec calls.
async function injectExtract(win) {
  await exec(win, EXTRACT_SRC + '\n;true');
}

// ── AMH portal ──────────────────────────────────────────────────────────────

// URL-only authed check. NOT sufficient on its own — AMH may keep an expired
// session cookie that lands the browser on `/my-amh/<page>` (passing this
// check) but redirects subsequent vendor data fetches to `/login`. Use
// isAMHAuthedFull(win) for the real session test.
function isAMHAuthed(url) {
  const u = String(url || '');
  return /\/my-amh\//i.test(u) && !/\/sign-?in|\/login|\/auth/i.test(u);
}

// Real session test: URL is on /my-amh/* AND the page contains vendor-only
// DOM markers (a vendor-user-orders WO link or a Logout control). Cookie
// present but session expired → no vendor anchors render → returns false.
async function isAMHAuthedFull(win) {
  if (!isAMHAuthed(win.webContents.getURL())) return false;
  try {
    return !!(await exec(win, `
      !!document.querySelector('a[href*="/my-amh/vendor-user-orders/"]')
      || /\\b(Log\\s*out|Sign\\s*out)\\b/i.test(document.body.innerText || '')
    `));
  } catch (_) { return false; }
}

// AMH auth strategy: load the WO list. If vendor markers render, we're really
// in. URL alone can lie (expired cookie still on /my-amh/*). On miss, show the
// window for manual sign-in — AMH login can be a multi-step / IdP flow that
// scripted fills miss, and the user only has to do it once per machine.
// Stored credentials are intentionally NOT scripted in here anymore (rule:
// don't keep iterating on a brittle approach).
async function ensureLoggedInAMH(win) {
  await win.loadURL(AMH_WO_LIST);
  // Wait for either vendor-anchor render (authed) or login redirect (un-authed).
  await waitFor(
    win,
    'document.querySelector(\'a[href*="/my-amh/vendor-user-orders/"]\') || /\\/login|\\/sign-?in/i.test(location.href) || /(Log\\s*in|Sign\\s*in)/i.test(document.body.innerText || \'\')',
    20, 300
  );
  if (await isAMHAuthedFull(win)) { dlog('AMH session live'); return; }

  win.show(); win.focus();
  dlog('AMH manual login — sign in to the window (5 min)…');
  const deadline = Date.now() + 300000; // 5 min for manual login (+ MFA if any)
  let last = '';
  while (Date.now() < deadline) {
    await sleep(2000);
    if (win.isDestroyed()) throw new Error('AMH login window was closed before sign-in completed.');
    const u = win.webContents.getURL();
    if (u !== last) { dlog('AMH url', u); last = u; }
    if (await isAMHAuthedFull(win)) { dlog('AMH login ok'); if (!DEBUG) win.hide(); await sleep(500); return; }
  }
  throw new Error('AMH login timed out. Sign in to the AMH portal window and try again.');
}

// Pull the WO GUID from a stored portalLink if present.
function amhGuidFromLink(link) {
  const m = String(link || '').match(/vendor-user-orders\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/i);
  return m ? m[1] : null;
}

// Paginate the "All" WO list until the WO number is found. Returns GUID or null.
async function findWOGuid(win, woNum) {
  for (let page = 1; page <= 40; page++) {
    const guid = await exec(win, `
      (function(){
        const GUID_RE = /vendor-user-orders\\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/i;
        const links = Array.from(document.querySelectorAll('a[href*="vendor-user-orders/"]'));
        for (const link of links) {
          const m = link.href.match(GUID_RE);
          if (!m) continue;
          const container = link.closest('tr,[class*="row"],[class*="card"],[class*="item"]') || link.parentElement?.parentElement || link.parentElement;
          if (container && container.textContent.includes(${JSON.stringify(woNum)})) return m[1];
        }
        return null;
      })()
    `);
    if (guid) return guid;
    const nextPage = page + 1;
    const clicked = await exec(win, `
      (function(){
        const all = Array.from(document.querySelectorAll('button,a'));
        const btn = all.find(b => b.textContent.trim() === ${JSON.stringify(String(nextPage))});
        if (btn) { btn.click(); return true; }
        return false;
      })()
    `);
    if (!clicked) break;
    await sleep(1800);
  }
  return null;
}

// CDP-click an <a href="/my-amh/bids/{guid}"> on the current page. On the bid
// LIST the real anchor exists; on a bid DETAIL we inject a tiny anchor and
// click it — React Router's delegated click handler on document catches any
// same-origin <a> click. JS `a.click()` does NOT reliably trigger AMH's React
// Router (same failure family as the row-expand click), so we use CDP mouse
// events at the anchor's screen coords. Returns true if click dispatched.
async function clickBidAnchor(win, guid) {
  const anchor = await exec(win, `
    (function(){
      let a = document.querySelector('a[href*="/my-amh/bids/${guid}"]');
      if (!a) {
        a = document.createElement('a');
        a.href = '/my-amh/bids/${guid}';
        a.setAttribute('data-wo-injected','1');
        a.textContent = 'next-bid';
        a.style.cssText = 'position:fixed;left:8px;bottom:8px;padding:6px 10px;background:#fff;color:#000;border:1px solid #000;z-index:99999;font:12px sans-serif;';
        document.body.appendChild(a);
      }
      a.scrollIntoView({ block:'center' });
      const r = a.getBoundingClientRect();
      if (r.width<=0 || r.height<=0) return null;
      return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
    })()
  `);
  if (!anchor) return false;
  const dbg = win.webContents.debugger;
  let dbgAttached = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); dbgAttached = true; }
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved',    x: anchor.x, y: anchor.y, button: 'none' });
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed',  x: anchor.x, y: anchor.y, button: 'left', clickCount: 1 });
    await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: anchor.x, y: anchor.y, button: 'left', clickCount: 1 });
  } catch (e) {
    dlog('bid CDP click error', e.message);
    return false;
  } finally {
    if (dbgAttached) { try { dbg.detach(); } catch (_) {} }
  }
  return true;
}

// Returns [{ url }] for each APPROVED bid on the WO's Bids tab. The list-page
// "Amount" column is intentionally NOT read — it shows ranges ("$0.00 -
// $269.06") and zeros that don't reflect the approved total. The real amount
// + line items come from each bid's detail page via amhBidDetail.
async function getApprovedBidUrls(win, woGuid) {
  await win.loadURL(AMH_BASE + '/my-amh/vendor-user-orders/' + woGuid + '?tabId=bids');
  await waitFor(win, 'document.querySelectorAll(\'[role="tab"]\').length > 0', 30, 300);
  await exec(win, `
    (function(){
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const bt = tabs.find(t => /^bids/i.test(t.textContent.trim()));
      if (bt) bt.click();
    })()
  `);
  await waitFor(win, 'document.querySelector(\'a[href*="/my-amh/bids/"]\') || /no bids/i.test(document.body.innerText)', 30, 400);
  return exec(win, `
    (function(){
      const BID_RE = /\\/my-amh\\/bids\\/([a-f0-9-]{36})/i;
      const links = Array.from(document.querySelectorAll('a[href*="/my-amh/bids/"]'));
      const seen = new Set();
      const urls = [];
      for (const link of links) {
        if (!BID_RE.test(link.href)) continue;
        if (seen.has(link.href)) continue;
        const row = link.closest('tr,[class*="row"],[class*="card"]') || link.parentElement;
        if (!row) continue;
        // Status pill is a separate element ("<span class=pill-label>Approved</span>").
        // textContent on the whole row crams cells with no whitespace so word-
        // boundary matches fail ("ApprovedToilet"). Read the pill directly.
        const pill = row.querySelector('.pill-label, .pill .pill-label, [class*="pill-label"]');
        const statusText = pill ? pill.textContent : row.textContent;
        if (!/approved/i.test(statusText)) continue;
        seen.add(link.href);
        urls.push(link.href);
      }
      return urls;
    })()
  `);
}

async function captureAMH(wo /*, getCredential */) {
  let win = null;
  try {
    win = makeWindow('persist:amh-scraper', false);
    await ensureLoggedInAMH(win);

    // Resolve the WO GUID: prefer the stored portalLink, else search the list.
    let woGuid = amhGuidFromLink(wo.portalLink);
    if (!woGuid) {
      const woNum = String(wo.id || '').replace(/^WO-/i, '').trim();
      if (!woNum) return { ok: false, error: 'WO has no portal link or WO number to locate it on AMH.' };
      woGuid = await findWOGuid(win, woNum);
      if (!woGuid) return { ok: false, error: `WO ${woNum} not found on AMH portal.` };
    }

    dlog('AMH guid', woGuid);
    // General tab — identity, location, status. Wait for the WO body to render
    // (SPA loads it async after navigation) before extracting.
    await win.loadURL(AMH_BASE + '/my-amh/vendor-user-orders/' + woGuid + '?tabId=general');
    const genReady = await waitFor(win, '/Work Order #/i.test(document.body.innerText) || /Property ID/i.test(document.body.innerText)');
    dlog('general ready', genReady);
    if (DEBUG) dlog('general innerText[0:600]', (await exec(win, 'document.body.innerText')).slice(0, 600));
    await injectExtract(win);
    const general = await exec(win, 'window.__woExtract.amhGeneral([])');
    dlog('general', general);
    const contacts = await exec(win, 'window.__woExtract.amhContacts()');
    dlog('contacts', contacts);

    // Condition Issues tab — type + complaint notes. The tab is a same-document
    // SPA route, so a direct ?tabId= load may not switch it; click the tab too.
    await win.loadURL(AMH_BASE + '/my-amh/vendor-user-orders/' + woGuid + '?tabId=condition-issues');
    await waitFor(win, 'document.querySelectorAll(\'[role="tab"]\').length > 0', 30, 300);
    await exec(win, `
      (function(){
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
        const t = tabs.find(x => /condition issues/i.test(x.textContent.trim()));
        if (t) t.click();
      })()
    `);
    // Wait for issue content (Description block or a category line) to render.
    const issReady = await waitFor(win, '/Description/i.test(document.body.innerText) || /\\b(PLUMBING|HVAC|ELECTRICAL|APPLIANCE|HEATING|COOLING)\\b/.test(document.body.innerText)');
    dlog('issues ready', issReady);
    // ALSO wait until the issue table rows have actually rendered their expand
    // icons. We require BOTH the level-0 rows AND the expand-icon-cell td
    // (where the caret lives) so the click target is real before we try to hit it.
    const rowReady = await waitFor(
      win,
      'document.querySelectorAll(\'tr[class*="scoping-table-row-level-0"]\').length > 0 && document.querySelectorAll(\'td.app-mf-scoping-table-row-expand-icon-cell\').length > 0',
      15, 800
    );
    dlog('issues rows ready', rowReady);
    await dumpPageState(win, 'issues-before-expand');
    // Expand each AMH Condition Issue row so the per-issue Description (which
    // lives in an Ant-design "expanded row" injected on demand) is rendered
    // into innerText for the extractor. AMH's React/Ant onClick does NOT fire
    // for synthetic dispatchEvent clicks — we use webContents.sendInputEvent
    // to simulate a real OS-level mouse click at the icon's screen coordinates,
    // which is indistinguishable from a real user click.
    // Headless click via Chrome DevTools Protocol. webContents.sendInputEvent
    // is unreliable on hidden BrowserWindows (Chromium throttles input events
    // to invisible windows). CDP's Input.dispatchMouseEvent is what Puppeteer
    // and Playwright use to drive truly-headless Chrome and bypasses the
    // visibility check entirely. The window stays hidden.
    // Icon-AGNOSTIC: live AMH uses caret-down on collapsed rows (not caret-right
    // as the user-clicked dump suggested). The expand-icon CELL (td) is the
    // stable target — exists regardless of icon state. Skip rows whose next
    // sibling is the expanded-row marker (already open).
    const targets = await exec(win, `
      (function(){
        const out = [];
        const rows = document.querySelectorAll('tr[class*="scoping-table-row-level-0"]');
        for (const tr of rows) {
          const next = tr.nextElementSibling;
          if (next && /scoping-table-expanded-row/.test(next.className || '')) continue;
          const cell = tr.querySelector('td.app-mf-scoping-table-row-expand-icon-cell');
          if (!cell) continue;
          cell.scrollIntoView({ block: 'center' });
          const r = cell.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            out.push({ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) });
          }
        }
        return { rows: rows.length, targets: out };
      })()
    `);
    dlog('expand targets', targets);
    const descBefore = await exec(win, '(document.body.innerText.match(/\\bDescription\\b/g) || []).length');
    dlog('descs before', descBefore);

    const dbg = win.webContents.debugger;
    let dbgAttached = false;
    try {
      if (!dbg.isAttached()) { dbg.attach('1.3'); dbgAttached = true; }
      for (const t of (targets.targets || [])) {
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved',   x: t.x, y: t.y, button: 'none' });
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: t.x, y: t.y, button: 'left', clickCount: 1 });
        await dbg.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased',x: t.x, y: t.y, button: 'left', clickCount: 1 });
        await sleep(100);
      }
    } catch (e) {
      dlog('CDP click error', e.message);
    } finally {
      if (dbgAttached) { try { dbg.detach(); } catch (_) {} }
    }

    // Poll up to ~8s for ALL clicked rows to render their Description panel.
    // Previously we broke as soon as ANY row expanded, losing 2 of 3 issues on
    // multi-issue WOs. Target = caret count (each click opens one row).
    const targetDesc = descBefore + (targets.targets ? targets.targets.length : 0);
    let descAfter = descBefore;
    for (let i = 0; i < 32; i++) {
      descAfter = await exec(win, '(document.body.innerText.match(/\\bDescription\\b/g) || []).length');
      if (descAfter >= targetDesc) break;
      await sleep(250);
    }
    dlog('descs after CDP click', descAfter, '/ target', targetDesc);

    // Synthetic-event fallback whenever ANY row is still collapsed (not only
    // when zero opened). Targets the expand-icon-cell directly (icon-agnostic;
    // live AMH uses caret-down on collapsed rows, not caret-right).
    if (descAfter < targetDesc) {
      dlog('CDP click left rows collapsed — falling back to synthetic dispatch');
      await exec(win, `
        (async function(){
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const fire = (el) => ['pointerdown','mousedown','pointerup','mouseup','click'].forEach(t => {
            try { el.dispatchEvent(new MouseEvent(t, { bubbles:true, cancelable:true, view:window, button:0 })); } catch(_){}
          });
          document.querySelectorAll('td.app-mf-scoping-table-row-expand-icon-cell').forEach(td => {
            const tr = td.closest('tr');
            if (tr && tr.nextElementSibling && /scoping-table-expanded-row/.test(tr.nextElementSibling.className || '')) return;
            fire(td);
            const inner = td.firstElementChild; if (inner) fire(inner);
            if (tr) fire(tr);
          });
          await sleep(1200);
        })()
      `);
      // Re-poll after fallback in case any rows opened.
      for (let i = 0; i < 8; i++) {
        descAfter = await exec(win, '(document.body.innerText.match(/\\bDescription\\b/g) || []).length');
        if (descAfter >= targetDesc) break;
        await sleep(400);
      }
      dlog('descs after synthetic fallback', descAfter, '/ target', targetDesc);
    }
    if (DEBUG) dlog('issues innerText[0:1200]', (await exec(win, 'document.body.innerText')).slice(0, 1200));
    await sleep(400);
    await injectExtract(win);
    const issues = await exec(win, 'window.__woExtract.amhIssues()');
    dlog('issues', issues);

    // Bids — line items + approved total. Direct win.loadURL() to a bid detail
    // URL leaves AMH's React app in a "custom-loader" spinner state (the SPA
    // expects an in-app navigation to trigger its data fetch). Instead we keep
    // the BIDS LIST as the navigation anchor: locate each bid <a> by href and
    // dispatch a click — that triggers React Router + the API call. We wait
    // for the loader to vanish AND for "Approved Amount" text to appear
    // before extracting, then go back to the list for the next iteration.
    const bidsListUrl = AMH_BASE + '/my-amh/vendor-user-orders/' + woGuid + '?tabId=bids';
    const approvedBidUrls = await getApprovedBidUrls(win, woGuid);
    dlog('approvedBidUrls', approvedBidUrls.length);
    const bidItems = [];
    let bidTotal = 0;
    const bidErrors = [];
    for (let bidIdx = 0; bidIdx < approvedBidUrls.length; bidIdx++) {
      const url = approvedBidUrls[bidIdx];
      const guid = (url.match(/\/my-amh\/bids\/([a-f0-9-]{36})/) || [])[1];
      if (!guid) { dlog('bid skip — bad guid', url); bidErrors.push({ url, reason: 'bad guid' }); continue; }

      // Fast path: click an anchor for this bid's guid on the CURRENT page.
      // On bid LIST the anchor already exists (first iteration). On a previous
      // bid DETAIL we inject a hidden <a>; React Router's delegated click handler
      // catches it and triggers the in-app navigation that fetches detail data.
      // If the fast path fails to navigate within ~3s we fall back to reloading
      // the bid list and clicking the real list anchor (proven path).
      const startUrl = win.webContents.getURL();
      let bidReady = await clickBidAnchor(win, guid) && await waitFor(
        win,
        'location.href !== ' + JSON.stringify(startUrl) + ' && /\\/my-amh\\/bids\\/' + guid + '/i.test(location.href)',
        10, 300
      ) && await waitFor(
        win,
        '!document.querySelector(\'[data-testid="custom-loader"]\') && /Approved Amount/i.test(document.body.innerText)',
        30, 400
      );
      if (!bidReady) {
        dlog('bid fast-path failed; falling back to list reload', url);
        await win.loadURL(bidsListUrl);
        await waitFor(win, 'document.querySelector(\'a[href*="/my-amh/bids/"]\')', 30, 400);
        const listUrl = win.webContents.getURL();
        bidReady = await clickBidAnchor(win, guid) && await waitFor(
          win,
          'location.href !== ' + JSON.stringify(listUrl) + ' && /\\/my-amh\\/bids\\/' + guid + '/i.test(location.href)',
          15, 400
        ) && await waitFor(
          win,
          '!document.querySelector(\'[data-testid="custom-loader"]\') && /Approved Amount/i.test(document.body.innerText)',
          30, 400
        );
      }
      dlog('bid ready', bidReady, win.webContents.getURL());
      if (!bidReady) {
        bidErrors.push({ url, reason: 'detail page never loaded (loader/Approved Amount not visible)' });
        await dumpPageState(win, 'bid-detail-empty');
        continue;
      }

      await injectExtract(win);
      const detail = await exec(win, 'window.__woExtract.amhBidDetail()');
      dlog('bid detail', url, detail && { amount: detail.amount, items: detail.items.length });
      if (!detail || (detail.amount === 0 && !detail.items.length)) {
        bidErrors.push({ url, reason: 'extractor returned empty' });
        await dumpPageState(win, 'bid-detail-empty');
      }
      if (detail) {
        if (typeof detail.amount === 'number') bidTotal += detail.amount;
        for (const item of (detail.items || [])) {
          if (!item.name) continue;
          // Dedup key includes the source bid index so identical line-item
          // names appearing in TWO different bids are both preserved.
          const key = (item.name + '|' + bidIdx).toLowerCase();
          if (!bidItems.find(x => x._key === key)) {
            bidItems.push({ name: item.name, desc: item.desc || '', qty: item.qty, price: item.price, _key: key });
          }
        }
      }
      // No inter-iteration list reload: next iteration's fast path injects an
      // anchor on the current bid detail and CDP-clicks it.
    }
    // Strip dedup helper key before merge.
    for (const it of bidItems) delete it._key;
    if (bidErrors.length) dlog('bidErrors', bidErrors);

    // Primary contact (PRIMARY CONTACT / SUBMITTER row) feeds the WO phone +
    // contactName fields. Full ordered list is preserved on `contacts` so the
    // UI can show secondary contacts on hover.
    const primary = (contacts && contacts[0]) || null;
    const merged = {
      ...general,
      type:  issues.type || general.type || 'Other',
      notes: issues.notes || '',
      bidItems,
      bidAmount: bidTotal ? String(bidTotal.toFixed(2)) : '',
      phone:       primary && primary.phone ? primary.phone : (general.phone || ''),
      contactName: primary && primary.name  ? primary.name  : '',
      contacts:    Array.isArray(contacts) ? contacts : [],
    };
    const warnings = [];
    if (bidErrors.length) {
      warnings.push(bidErrors.length + ' bid(s) failed to load: ' + bidErrors.map(e => e.reason).join('; '));
    }
    if (issues.issues && issues.issues.length && issues.issues.some(i => !i.complaint)) {
      const missing = issues.issues.filter(i => !i.complaint).map(i => i.title || '?').join(', ');
      warnings.push('description missing for: ' + missing);
    }
    return { ok: true, wo: merged, warnings };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (win) try { win.destroy(); } catch (_) {}
  }
}

// MSR portal: handled by the Chrome extension (authenticated Chrome) -> /import
// bridge in main.js. Deliberately not implemented in-app; see SCRAPERS note.

module.exports = { captureWO };
