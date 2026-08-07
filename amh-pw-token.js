'use strict';
// Phase 2 AMH auth (Playwright path): headless REAL Edge (channel:'msedge') +
// a persisted storageState recaptures the AMH Bearer with NO login. AMH blocks
// generic Chromium/Electron but accepts branded Edge. The token is the
// `authorization: Bearer ...` header on any app.amh.com request. Ported from the
// proven spike (amh-token-test.js); the REST API call itself stays in scrape_amh.py.
const { chromium } = require('playwright');

const WO_LIST_URL = 'https://www.amh.com/vendor-admin-orders?tabId=AllOpen';

async function getAmhToken(statePath) {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const ctx = await browser.newContext({ storageState: statePath });
    const page = await ctx.newPage();
    let token = null;
    page.on('request', r => {
      const a = r.headers()['authorization'] || '';
      if (!token && a.startsWith('Bearer ')) token = a;
    });
    // Re-hit the WO list to fire authed API requests (cold-load race, same as
    // scrape_amh.py). Stop as soon as a Bearer surfaces.
    for (let i = 0; i < 5 && !token; i++) {
      await page.goto(WO_LIST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(5000);
    }
    if (!token) {
      throw new Error('AMH Playwright: no Bearer captured (session expired or AMH blocked headless)');
    }
    // getAmhToken must return a WORKING token or throw, so amh-runner falls back to Selenium; a stale session yields a capturable-but-dead Bearer otherwise.
    // Liveness probe: Reference/User returns 200 for any valid vendor token and
    // 401/403 for a stale one. Do NOT probe Order/Query -- AMH retired it (now 403s
    // for valid tokens), which was rejecting good tokens and forcing Selenium.
    const probeUrl = 'https://app.amh.com/services-api/api/Reference/User';
    const headers = { 'Authorization': token, 'Accept': 'application/json',
      'Origin': 'https://www.amh.com', 'Referer': 'https://www.amh.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
    let resp;
    try { resp = await fetch(probeUrl, { headers }); }
    catch (e) { throw new Error('AMH Playwright token probe failed (' + e.message + '); fall back to Selenium.'); }
    if (!resp.ok) throw new Error('AMH Playwright token rejected by API (http=' + resp.status + '); session stale, fall back to Selenium.');
    return token;
  } finally {
    await browser.close();
  }
}

module.exports = { getAmhToken };
