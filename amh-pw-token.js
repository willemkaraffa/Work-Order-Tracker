'use strict';
// Phase 2 AMH auth (Playwright path): headless REAL Edge (channel:'msedge') on the
// PERSISTENT profile dir seeded by amh-pw-login.js recaptures the AMH Bearer with NO
// login. AMH blocks generic Chromium/Electron but accepts branded Edge. The token is
// the `authorization: Bearer ...` header on any app.amh.com request. The REST API call
// itself stays in scrape_amh.py.
//
// The profile dir replaced the old storageState json: AMH rotates its refresh cookie on
// every real login, so a frozen snapshot died within about a day. The live Edge profile
// keeps the rotated cookie, so this keeps minting until the login itself truly expires.
const { chromium } = require('playwright');
const path = require('path');

// The vendor order list lives under /my-amh/. The bare /vendor-admin-orders path
// bounces to the PUBLIC marketing site and fires NO authed app.amh.com request, so
// no Bearer surfaces (proven live 2026-08-11). The /my-amh/ prefix is required.
const { VENDOR_ORDERS_URL: WO_LIST_URL } = require('./amh-urls');
const MINT_CEILING_MS = 45000;   // whole capture-the-Bearer race; a healthy mint is seconds

// Same resolution order as amh-pw-login.js so both sides land on ONE profile dir.
function profileDirFor(arg) {
  return arg
    || process.env.AMH_PROFILE_DIR
    || path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
                 'work-order-tracker', 'amh-edge-profile');
}

async function getAmhToken(profileDirArg) {
  const profileDir = profileDirFor(profileDirArg);
  // Electron injects CHROME_CRASHPAD_PIPE_NAME; it leaks into the child msedge and
  // crashes it ("Chrome instance exited") while a BrowserWindow is open. Strip it from
  // a COPY (never mutate the Electron process env) before launching.
  const launchEnv = { ...process.env };
  delete launchEnv.CHROME_CRASHPAD_PIPE_NAME;
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge', headless: true, env: launchEnv,
  });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    let token = null;
    let onToken;
    // Race, not a fixed sleep loop: the Bearer usually appears within a second or two of
    // the SPA booting, and the old `goto + waitForTimeout(5000)` x5 loop paid 5s every
    // time and up to 25s on a dead session. Resolve the instant the first authed request
    // is seen; only re-goto if the ceiling has not been hit and nothing arrived.
    const tokenSeen = new Promise(res => { onToken = res; });
    page.on('request', r => {
      const a = r.headers()['authorization'] || '';
      if (!token && a.startsWith('Bearer ')) { token = a; onToken(a); }
    });
    const deadline = Date.now() + MINT_CEILING_MS;
    while (!token && Date.now() < deadline) {
      await page.goto(WO_LIST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const left = Math.max(1000, Math.min(15000, deadline - Date.now()));
      // .catch: the pending timeout rejects with "Target closed" when the context is
      // torn down after a win, and an unhandled rejection would kill the CLI exit code.
      await Promise.race([tokenSeen, page.waitForTimeout(left).catch(() => {})]);
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
    // Close the context (not a browser: launchPersistentContext owns both) so the
    // profile's SingletonLock is released for the next mint/capture.
    await ctx.close();
  }
}

// CLI mode: `node amh-pw-token.js <profileDir>` prints the Bearer to stdout, or exits
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
