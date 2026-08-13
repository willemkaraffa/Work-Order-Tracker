'use strict';
// AMH session seeder. Opens REAL Edge (channel:'msedge' -- AMH blocks generic
// Chromium/Electron) headed, lets the human log into AMH, then saves the Playwright
// storageState (cookies + tokens) so getAmhToken (amh-pw-token.js) can later mint a
// Bearer headlessly with NO login. Run standalone via `npm run amh:login`, or spawned
// by the app when a capture reports the session is stale/missing.
//
// AMH sessions expire (~1hr), so re-running this is expected and is the whole point of
// the "prompt re-login" design -- it replaces the fragile per-run Selenium login.
//
// State path: 1st CLI arg, else AMH_STATE_PATH env, else %APPDATA%/work-order-tracker/
// amh-pw-state.json (the app passes its own userData path so both sides agree).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const LOGIN_URL = 'https://www.amh.com/let-yourself-in';   // vendor login entry
const STATE_PATH = process.argv[2]
  || process.env.AMH_STATE_PATH
  || path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
               'work-order-tracker', 'amh-pw-state.json');

async function seed(statePath) {
  // Strip Electron's CHROME_CRASHPAD_PIPE_NAME from a COPY so it does not leak into the
  // child msedge and crash it (only bites when spawned under a running app).
  const launchEnv = { ...process.env };
  delete launchEnv.CHROME_CRASHPAD_PIPE_NAME;
  const browser = await chromium.launch({ headless: false, channel: 'msedge', env: launchEnv });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let bearer = null;
    page.on('request', r => {
      const a = r.headers()['authorization'] || '';
      if (!bearer && a.startsWith('Bearer ')) bearer = a;
    });

    console.error('[amh:login] Edge opening. Log into AMH. Waiting up to 4 min for sign-in...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});

    // Authenticated once the SPA fires an authed API request (a Bearer appears).
    for (let i = 0; i < 48 && !bearer; i++) await page.waitForTimeout(5000);
    if (!bearer) throw new Error('no sign-in detected within the timeout (no Bearer seen)');

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    await ctx.storageState({ path: statePath });
    console.error('[amh:login] session saved -> ' + statePath);
    return true;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  seed(STATE_PATH)
    .then(() => process.exit(0))
    .catch(e => { console.error('[amh:login] FAILED: ' + e.message); process.exit(1); });
}

module.exports = { seed };
