'use strict';
const { BrowserWindow, net } = require('electron');

const AMH_LOGIN_URL   = 'https://www.amh.com/login';
const AMH_WO_LIST_URL = 'https://www.amh.com/vendor-admin-orders?tabId=AllOpen';
const AMH_API_BASE    = 'https://app.amh.com/services-api/api';
const PARTITION       = 'persist:amh-scraper';

// Registry: PM name (uppercase) → scrape function.
const SCRAPERS = { AMH: scrapeAMH };

async function scrapeWO(wo, getCredential) {
  const pm = (wo.pm || '').toUpperCase();
  const fn = SCRAPERS[pm];
  if (!fn) return { ok: false, error: `No scraper registered for PM "${wo.pm}"` };
  return fn(wo, getCredential);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function makeWindow() {
  return new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false, partition: PARTITION }
  });
}

function todayApiValue() {
  return new Date().toISOString().replace(/T.*/, 'T04:00:00.000Z');
}

// ── Token capture ─────────────────────────────────────────────────────────────
// Attaches CDP to the window and listens for Network.requestWillBeSent events,
// which is the same mechanism Python Selenium uses (goog:loggingPrefs performance).
// This fires for all requests including Service Workers, unlike onSendHeaders.

function captureTokenViaCDP(win) {
  return new Promise(async (resolve) => {
    let resolved = false;
    const dbg = win.webContents.debugger;

    const cleanup = () => {
      resolved = true;
      try { dbg.removeAllListeners('message'); } catch(_) {}
    };

    const timer = setTimeout(() => { cleanup(); resolve(null); }, 60000);

    dbg.on('message', (event, method, params) => {
      if (resolved) return;
      if (method === 'Network.requestWillBeSent') {
        const headers = (params.request || {}).headers || {};
        const auth = headers['Authorization'] || headers['authorization'] || '';
        if (auth.startsWith('Bearer ')) {
          clearTimeout(timer);
          cleanup();
          resolve(auth);
        }
      }
    });

    try { dbg.attach('1.3'); } catch(_) {}
    try { await dbg.sendCommand('Network.enable'); } catch(e) {
      clearTimeout(timer);
      cleanup();
      resolve(null);
    }
  });
}

// ── Login ─────────────────────────────────────────────────────────────────────
// AMH uses Azure B2C: the login form lives inside an iframe on amh.com/login.
// Fields: id="signInName" (email), id="password", id="next" (submit button).

async function ensureLoggedIn(win, creds) {
  // Attach CDP and start listening for Bearer tokens before any navigation
  const tokenPromise = captureTokenViaCDP(win);

  // Navigate to WO list — already logged in if session cookie is active
  await win.loadURL(AMH_WO_LIST_URL);
  await sleep(4000);

  const url = win.webContents.getURL().toLowerCase();
  const needsLogin = url.includes('login') || url.includes('b2clogin');

  if (!needsLogin) {
    // Session still active; token will arrive from the page's API calls
    await sleep(8000);
  } else {
    if (!creds || !creds.username || !creds.password)
      throw new Error('AMH login required. Add credentials in Settings > Credentials.');

    // Navigate to login page and wait for B2C iframe to load
    await win.loadURL(AMH_LOGIN_URL);
    await sleep(5000);

    // The login form is inside a cross-origin B2C iframe.
    // Use WebFrameMain to execute JS inside it from the privileged main process.
    const loginFrame = win.webContents.mainFrame.frames
      .find(f => f.url.includes('b2clogin') || f.url.includes('microsoftonline'));

    if (!loginFrame) throw new Error('AMH B2C login iframe not found. The portal may have changed.');

    await loginFrame.executeJavaScript(`
      (function(){
        const u = document.querySelector('#signInName');
        const p = document.querySelector('#password');
        if (!u || !p) return;
        u.value = ${JSON.stringify(creds.username)};
        p.value = ${JSON.stringify(creds.password)};
        ['input','change'].forEach(ev => {
          u.dispatchEvent(new Event(ev, {bubbles:true}));
          p.dispatchEvent(new Event(ev, {bubbles:true}));
        });
        const btn = document.querySelector('#next') ||
          document.querySelector('button[type="submit"]');
        if (btn) btn.click();
      })()
    `);

    // Wait for redirect away from login/b2clogin (up to 25 s)
    let loggedIn = false;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      const cur = win.webContents.getURL().toLowerCase();
      if (!cur.includes('login') && !cur.includes('b2clogin')) { loggedIn = true; break; }
    }
    if (!loggedIn) throw new Error('AMH login failed. Check credentials in Settings > Credentials.');

    // Navigate to WO list to trigger API calls that carry the Bearer token
    await win.loadURL(AMH_WO_LIST_URL);
    await sleep(10000);
  }

  const token = await tokenPromise;
  if (!token) throw new Error('Could not capture AMH API Bearer token. Try re-saving credentials.');
  return token;
}

// ── API ───────────────────────────────────────────────────────────────────────

function apiGet(token, path, params) {
  const url = new URL(`${AMH_API_BASE}/${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'GET', url: url.toString(),
      headers: { Authorization: token, Accept: 'application/json',
        Origin: 'https://www.amh.com', Referer: 'https://www.amh.com/' } });
    let body = '';
    req.on('response', (resp) => {
      resp.on('data', c => { body += c.toString(); });
      resp.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch(e) { reject(new Error('Invalid JSON from AMH API: ' + body.slice(0, 120))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchOrderFromAPI(token, woNum) {
  const data = await apiGet(token, 'Order/Query', { today: todayApiValue(), loadFiles: 'false' });
  const list = Array.isArray(data) ? data : (data.orders || data.items || []);
  return list.find(item => {
    const name = String(((item.order || item).name) || '').replace(/^WO-/i, '').trim();
    return name === woNum.replace(/^WO-/i, '').trim();
  }) || null;
}

// ── Item extraction ───────────────────────────────────────────────────────────
// Mirrors the old scraper's choose_options_for_bid + service_display_name logic.

function extractItems(orderItem) {
  const order           = orderItem.order || orderItem;
  const remedyInstances = order.remedyInstances || {};
  const bids            = orderItem.bids || [];

  // Prefer approved bids; fall back to all bids
  const activeBids = bids.filter(b => (b.statusName || '').toLowerCase() === 'approved');
  const workBids   = activeBids.length ? activeBids : bids;

  const allItems   = [];
  let scrapedTotal = 0;

  for (const bid of workBids) {
    const opts = (bid.options || []);
    // Prefer approved options, then preferred, then all
    const approved  = opts.filter(o => o.isApproved);
    const preferred = opts.filter(o => o.isPreferred);
    const working   = approved.length ? approved : preferred.length ? preferred : opts;

    for (const opt of working) {
      for (const svc of (opt.services || [])) {
        const remedyId = svc.remedyInstanceId;
        const mapped   = remedyId ? (remedyInstances[remedyId] || {}) : {};
        const ri       = svc.remedyInstance || {};
        // Prefer description from remedyInstances map (fuller text), fall back to name
        const name = (
          mapped.description || mapped.name ||
          ri.description     || ri.name     ||
          svc.serviceId      || ''
        ).trim();

        const qty   = parseFloat(svc.quantity)   || 1;
        const price = parseFloat(svc.unitPrice)  || 0;
        const tax   = parseFloat(svc.vendorTax)  || 0;

        if (!name || price <= 0) continue;

        const dup = allItems.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (!dup) {
          allItems.push({ name, qty, price });
          scrapedTotal += qty * price + tax;
        }
      }
    }
  }

  return { items: allItems, scrapedTotal: Math.round(scrapedTotal * 100) / 100 };
}

// ── AMH scraper ───────────────────────────────────────────────────────────────

async function scrapeAMH(wo, getCredential) {
  const woNum = String(wo.id || '').replace(/^WO-/i, '').trim();
  if (!woNum) return { ok: false, error: 'WO ID is missing' };

  let win = null;
  try {
    const creds = await getCredential('AMH');
    win = makeWindow();
    const token = await ensureLoggedIn(win, creds);

    const orderItem = await fetchOrderFromAPI(token, woNum);
    if (!orderItem)
      return { ok: false, error: `WO ${woNum} not found via AMH API. Verify the WO number is correct.` };

    const bids = (orderItem.bids || []).filter(b => (b.statusName || '').toLowerCase() === 'approved');
    if (!bids.length)
      return { ok: true, items: [], scrapedTotal: 0, warning: 'No approved bids found. The bid may still be under review.' };

    const { items, scrapedTotal } = extractItems(orderItem);
    return { ok: true, items, scrapedTotal };

  } catch(err) {
    return { ok: false, error: err.message };
  } finally {
    if (win) try { win.destroy(); } catch(_) {}
  }
}

module.exports = { scrapeWO };
