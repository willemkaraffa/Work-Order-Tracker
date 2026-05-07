'use strict';
const { BrowserWindow } = require('electron');

const AMH_BASE     = 'https://www.amh.com';
const AMH_WO_LIST  = AMH_BASE + '/my-amh/vendor-user-orders?tabId=all';

// Registry: PM name (uppercase) → scrape function.
// Add new PMs here to extend scraping support.
const SCRAPERS = { AMH: scrapeAMH };

// Entry point called from main.js IPC handler.
// getCredential(pm) is an async fn that returns { username, password } or null.
async function scrapeWO(wo, getCredential) {
  const pm = (wo.pm || '').toUpperCase();
  const fn = SCRAPERS[pm];
  if (!fn) return { ok: false, error: `No scraper registered for PM "${wo.pm}"` };
  return fn(wo, getCredential);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function makeWindow() {
  return new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Dedicated persistent partition so the AMH session cookie survives
      // app restarts — user only needs to log in once per machine.
      partition: 'persist:amh-scraper',
    }
  });
}

function exec(win, js) { return win.webContents.executeJavaScript(js); }

// ── AMH portal helpers ────────────────────────────────────────────────────────

async function ensureLoggedIn(win, creds) {
  await win.loadURL(AMH_WO_LIST);
  await sleep(3500);
  const url = win.webContents.getURL();
  if (url.includes('/vendor-user-orders')) return; // session still active

  if (!creds || !creds.username || !creds.password)
    throw new Error('AMH login required. Add credentials in Settings > Credentials.');

  // Try likely sign-in pages in order.
  const loginCandidates = [
    AMH_BASE + '/my-amh/sign-in',
    AMH_BASE + '/login',
    AMH_BASE + '/auth',
  ];
  for (const loginUrl of loginCandidates) {
    await win.loadURL(loginUrl);
    await sleep(2500);

    const filled = await exec(win, `
      (function(){
        const u = document.querySelector(
          'input[type="email"],input[name*="email"],input[name*="username"],input[id*="email"]'
        );
        const p = document.querySelector('input[type="password"]');
        if (!u || !p) return false;
        function fire(el, val) {
          el.value = val;
          ['input','change'].forEach(ev => el.dispatchEvent(new Event(ev, {bubbles:true})));
        }
        fire(u, ${JSON.stringify(creds.username)});
        fire(p, ${JSON.stringify(creds.password)});
        const btn = document.querySelector('button[type="submit"],input[type="submit"]')
                 || Array.from(document.querySelectorAll('button'))
                        .find(b => /sign.?in|log.?in|submit/i.test(b.textContent));
        if (btn) { btn.click(); return true; }
        return false;
      })()
    `);

    if (filled) {
      await sleep(5000);
      await win.loadURL(AMH_WO_LIST);
      await sleep(3500);
      if (win.webContents.getURL().includes('/vendor-user-orders')) return;
    }
  }
  throw new Error('AMH login failed. Check credentials in Settings > Credentials.');
}

// Paginate the "All" WO list until the WO number is found.
// Returns the portal GUID string, or null if not found.
async function findWOGuid(win, woNum) {
  for (let page = 1; page <= 40; page++) {
    const guid = await exec(win, `
      (function(){
        const GUID_RE = /vendor-user-orders\\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/i;
        const links = Array.from(document.querySelectorAll('a[href*="vendor-user-orders/"]'));
        for (const link of links) {
          const m = link.href.match(GUID_RE);
          if (!m) continue;
          const container = link.closest('tr,[class*="row"],[class*="card"],[class*="item"]')
                         || link.parentElement?.parentElement
                         || link.parentElement;
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

// Returns array of { url, amount } for each approved bid on the WO's Bids tab.
async function getApprovedBids(win, woGuid) {
  await win.loadURL(AMH_BASE + '/my-amh/vendor-user-orders/' + woGuid);
  await sleep(3000);

  // Click the Bids tab
  await exec(win, `
    (function(){
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const bt = tabs.find(t => /^bids/i.test(t.textContent.trim()));
      if (bt) bt.click();
    })()
  `);
  await sleep(2500);

  return exec(win, `
    (function(){
      const BID_RE = /\\/my-amh\\/bids\\/([a-f0-9-]{36})/i;
      const links = Array.from(document.querySelectorAll('a[href*="/my-amh/bids/"]'));
      const results = [];
      for (const link of links) {
        if (!BID_RE.test(link.href)) continue;
        const row = link.closest('tr,[class*="row"],[class*="card"]') || link.parentElement;
        if (!row || !/approved/i.test(row.textContent)) continue;
        // Extract dollar amount from the row text
        const amtMatch = row.textContent.match(/\\$\\s*([\\d,]+\\.?\\d*)/);
        const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g,'')) : 0;
        results.push({ url: link.href, amount });
      }
      return results;
    })()
  `);
}

// Returns array of { name, qty, price } for line items on a bid detail page.
async function extractLineItems(win, bidUrl) {
  await win.loadURL(bidUrl);
  await sleep(2500);
  return exec(win, `
    (function(){
      const items = [];
      let pastHeader = false;
      const rows = Array.from(document.querySelectorAll('tr'));
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td,th')).map(c => c.textContent.trim());
        if (cells.length < 4) continue;
        // Detect header row by column labels
        if (/^remedy$/i.test(cells[0]) && /description/i.test(cells[1])) {
          pastHeader = true;
          continue;
        }
        if (!pastHeader) continue;
        const remedy = cells[0];
        const desc   = cells[1];
        const qtyStr = cells[2];
        const upStr  = cells[3]; // Unit Price

        if (!remedy || !upStr) continue;
        if (/^(remedy|description|total|item)$/i.test(remedy)) continue;

        const priceM = upStr.match(/\\$?([\\d,]+\\.\\d{1,2})/);
        if (!priceM) continue;
        const price = parseFloat(priceM[1].replace(/,/g,''));
        if (!price || price <= 0) continue;
        const qty = parseFloat(qtyStr) || 1;
        // Prefer Description (longer name) over Remedy (short code)
        const name = (desc && desc !== '-' && desc.length > 2) ? desc : remedy;
        items.push({ name, qty, price });
      }
      return items;
    })()
  `);
}

// ── AMH scraper ───────────────────────────────────────────────────────────────

async function scrapeAMH(wo, getCredential) {
  const woNum = String(wo.id || '').replace(/^WO-/i, '').trim();
  if (!woNum) return { ok: false, error: 'WO ID is missing' };

  let win = null;
  try {
    win = makeWindow();
    const creds = await getCredential('AMH');
    await ensureLoggedIn(win, creds);

    const woGuid = await findWOGuid(win, woNum);
    if (!woGuid)
      return { ok: false, error: `WO ${woNum} not found on AMH portal. Verify WO number is correct.` };

    const approvedBids = await getApprovedBids(win, woGuid);
    if (!approvedBids.length)
      return { ok: true, items: [], scrapedTotal: 0, woGuid, warning: 'No approved bids found. The bid may still be under review.' };

    // Aggregate line items across all approved bids; dedup by name (case-insensitive)
    const allItems = [];
    let scrapedTotal = 0;
    for (const bid of approvedBids) {
      scrapedTotal += bid.amount;
      const items = await extractLineItems(win, bid.url);
      for (const item of items) {
        const dup = allItems.find(x => x.name.toLowerCase() === item.name.toLowerCase());
        if (!dup) allItems.push(item);
      }
    }

    return { ok: true, items: allItems, scrapedTotal, woGuid };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (win) try { win.destroy(); } catch (_) {}
  }
}

module.exports = { scrapeWO };
