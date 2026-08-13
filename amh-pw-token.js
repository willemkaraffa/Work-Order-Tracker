'use strict';
// Phase 2 AMH auth (Playwright path): headless REAL Edge (channel:'msedge') +
// a persisted storageState recaptures the AMH Bearer with NO login. AMH blocks
// generic Chromium/Electron but accepts branded Edge. The token is the
// `authorization: Bearer ...` header on any app.amh.com request. Ported from the
// proven spike (amh-token-test.js); the REST API call itself stays in scrape_amh.py.
const { chromium } = require('playwright');

// The vendor order list lives under /my-amh/. The bare /vendor-admin-orders path
// bounces to the PUBLIC marketing site and fires NO authed app.amh.com request, so
// no Bearer surfaces (proven live 2026-08-11). The /my-amh/ prefix is required.
const WO_LIST_URL = 'https://www.amh.com/my-amh/vendor-admin-orders?tabId=AllOpen';

async function getAmhToken(statePath) {
  // Electron injects CHROME_CRASHPAD_PIPE_NAME; it leaks into the child msedge and
  // crashes it ("Chrome instance exited") while a BrowserWindow is open. Strip it from
  // a COPY (never mutate the Electron process env) before launching.
  const launchEnv = { ...process.env };
  delete launchEnv.CHROME_CRASHPAD_PIPE_NAME;
  const browser = await chromium.launch({ headless: true, channel: 'msedge', env: launchEnv });
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
    // getAmhToken must return a WORKING token or throw, so amh-runner can surface
    // AMH_RELOGIN_REQUIRED; a stale session yields a capturable-but-dead Bearer otherwise.
    // Liveness probe: Reference/User returns 200 for any valid vendor token and
    // 401/403 for a stale one. Do NOT probe Order/Query -- AMH retired it (now 403s
    // for valid tokens), which was rejecting good tokens and forcing a needless re-login.
    const probeUrl = 'https://app.amh.com/services-api/api/Reference/User';
    const headers = { 'Authorization': token, 'Accept': 'application/json',
      'Origin': 'https://www.amh.com', 'Referer': 'https://www.amh.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
    let resp;
    try { resp = await fetch(probeUrl, { headers }); }
    catch (e) { throw new Error('AMH Playwright token probe failed (' + e.message + '); re-login required.'); }
    if (!resp.ok) throw new Error('AMH Playwright token rejected by API (http=' + resp.status + '); session stale, re-login required.');
    return token;
  } finally {
    await browser.close();
  }
}

// CLI mode: `node amh-pw-token.js <statePath>` prints the Bearer to stdout, or exits
// non-zero with the reason on stderr. This is how the Electron app uses it -- Electron
// 28 bundles Node 18, but Playwright needs Node 20+, so it must run in a spawned SYSTEM
// node process, never required into the Electron (Node 18) process.
if (require.main === module) {
  // Exit from the write callback, not right after write(): process.exit() does not
  // wait for a piped stdout to flush, so exiting inline truncates the token in the
  // parent. The callback fires once the write has drained to the OS.
  getAmhToken(process.argv[2])
    .then(t => { process.stdout.write(t, () => process.exit(0)); })
    .catch(e => { process.stderr.write(String(e && e.message || e), () => process.exit(1)); });
}

module.exports = { getAmhToken };
