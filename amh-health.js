'use strict';
// Run-on-demand health check for the AMH capture chain, so a portal or browser change
// names itself in seconds instead of surfacing as a blank Edge window mid-job.
// CHECK 1 proves the SEEDER still lands a logged-out user on a real login form (the
// branch that silently rotted for six days -- nobody exercises it until a session dies).
// CHECK 2 proves the PERSISTED session still mints a token the AMH API accepts.
// Needs network + real Edge, so it is NOT part of npm test. `npm run amh:health`.
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { VENDOR_ORDERS_URL, LOGIN_PATH_MARKER } = require('./amh-urls');
const { getAmhToken } = require('./amh-pw-token');

// Same resolution order as amh-pw-login.js / amh-pw-token.js so all three agree.
const PROFILE_DIR = process.argv[2]
  || process.env.AMH_PROFILE_DIR
  || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
               'work-order-tracker', 'amh-edge-profile');

function launchEnv() {
  // Electron leaks CHROME_CRASHPAD_PIPE_NAME into the child msedge and crashes it.
  // Strip it from a COPY, never mutate process.env.
  const env = { ...process.env };
  delete env.CHROME_CRASHPAD_PIPE_NAME;
  return env;
}

// CHECK 1: a FRESH empty profile has no session, so the vendor route must bounce to
// /login?state=... If AMH serves anything else, the seeder would show a blank window.
async function checkLoggedOutBounce() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'amh-health-'));
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(dir, {
      channel: 'msedge', headless: true, env: launchEnv(),
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await page.goto(VENDOR_ORDERS_URL, { waitUntil: 'domcontentloaded' });
    const url = page.url();
    const title = await page.title().catch(() => '(title unavailable)');
    if (url.includes(LOGIN_PATH_MARKER)) return { ok: true, detail: 'bounced to ' + url };
    return { ok: false, detail: 'no login bounce; AMH served ' + url + ' -- "' + title + '"' };
  } catch (e) {
    return { ok: false, detail: String(e && e.message || e) };
  } finally {
    if (ctx) { try { await ctx.close(); } catch { /* already gone */ } }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir, ignore */ }
  }
}

// CHECK 2: getAmhToken already probes Reference/User and throws on a stale session,
// so a resolved Bearer IS the pass. No second probe.
async function checkSessionMint() {
  try {
    const token = await getAmhToken(PROFILE_DIR);
    return { ok: true, detail: 'minted a Bearer (' + token.length + ' chars) from ' + PROFILE_DIR };
  } catch (e) {
    return { ok: false, detail: String(e && e.message || e) + ' -- run `npm run amh:login` to re-seed the session' };
  }
}

async function main() {
  // Both checks always run, so one invocation reports the whole chain.
  const bounce = await checkLoggedOutBounce();
  console.log((bounce.ok ? 'PASS' : 'FAIL') + ' logged-out bounce: ' + bounce.detail);
  const mint = await checkSessionMint();
  console.log((mint.ok ? 'PASS' : 'FAIL') + ' session mint: ' + mint.detail);
  process.exit(bounce.ok && mint.ok ? 0 : 1);
}

main().catch(e => { console.log('FAIL amh-health: ' + String(e && e.message || e)); process.exit(1); });
