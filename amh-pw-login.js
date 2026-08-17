'use strict';
// AMH session seeder. Opens REAL Edge (channel:'msedge' -- AMH blocks generic
// Chromium/Electron) headed on a PERSISTENT profile dir, and lets the human log into
// AMH. Nothing is exported afterwards: the profile dir IS the session, so the later
// headless mint (amh-pw-token.js) reuses the same dir and gets a Bearer with NO login.
//
// WHY a persistent profile and not storageState: AMH rotates the at-ah4r_refresh_token
// cookie on every real login, so a frozen storageState snapshot went stale within about
// a day and the mint then loaded the PUBLIC marketing page with zero authed requests
// (proven live 2026-08-13). A live Edge profile keeps the rotated cookie itself.
//
// Profile dir: 1st CLI arg, else AMH_PROFILE_DIR env, else %APPDATA%/work-order-tracker/
// amh-edge-profile (the app passes its own userData path so both sides agree).
const { chromium } = require('playwright');
const path = require('path');
// Land on the VENDOR order list, not on a login path: a dead session bounces this to
// /login?state=<this url> (the real sign-in form) and a live one renders the list and
// fires the authed request the Bearer sniffer below needs. Route lives in amh-urls.js.
const { VENDOR_ORDERS_URL } = require('./amh-urls');
const PROFILE_DIR = process.argv[2]
  || process.env.AMH_PROFILE_DIR
  || path.join(process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
               'work-order-tracker', 'amh-edge-profile');

async function seed(profileDir) {
  // Strip Electron's CHROME_CRASHPAD_PIPE_NAME from a COPY so it does not leak into the
  // child msedge and crash it (only bites when spawned under a running app).
  const launchEnv = { ...process.env };
  delete launchEnv.CHROME_CRASHPAD_PIPE_NAME;
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'msedge', headless: false, env: launchEnv,
  });
  try {
    const page = ctx.pages()[0] || await ctx.newPage();
    let bearer = null;
    page.on('request', r => {
      const a = r.headers()['authorization'] || '';
      if (!bearer && a.startsWith('Bearer ')) bearer = a;
    });

    console.error('[amh:login] Edge opening. Log into AMH. Waiting up to 4 min for sign-in...');
    // Never swallow the goto silently: a wrong/dead page used to look exactly like "the
    // human has not logged in yet". Log the error, then name the page actually landed on.
    await page.goto(VENDOR_ORDERS_URL, { waitUntil: 'domcontentloaded' })
      .catch(e => { console.error('[amh:login] navigation error: ' + (e && e.message || e)); });
    const landedUrl = page.url();
    const landedTitle = await page.title().catch(() => '(title unavailable)');
    console.error('[amh:login] landed on ' + landedUrl + ' -- "' + landedTitle + '"');

    // Authenticated once the SPA fires an authed API request (a Bearer appears).
    for (let i = 0; i < 48 && !bearer; i++) await page.waitForTimeout(5000);
    if (!bearer) {
      throw new Error('no sign-in detected within the timeout (no Bearer seen); page was '
        + landedUrl + ' -- "' + landedTitle + '"');
    }

    console.error('[amh:login] signed in; profile persisted -> ' + profileDir);
    return true;
  } finally {
    // Closing the context flushes the profile's cookie jar to disk -- skip it and the
    // next headless mint reads a half-written profile.
    await ctx.close();
  }
}

if (require.main === module) {
  seed(PROFILE_DIR)
    .then(() => process.exit(0))
    .catch(e => { console.error('[amh:login] FAILED: ' + e.message); process.exit(1); });
}

module.exports = { seed };
