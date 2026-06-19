'use strict';
// Live portal capture harness — drives the REAL scraper.js captureWO against a
// live AMH or MSR work order, with windows visible so you can sign in. Prints
// the scraped WO object. This exercises the full mechanism (BrowserWindow nav,
// login, inject scraper-extract.js, multi-tab extraction) that the unit tests
// cannot, because they run on saved DOM only.
//
// Run (Windows PowerShell — set env on its own line, then run):
//   $env:SCRAPER_DEBUG = "1"
//   npx electron test/live-capture.js --pm MSR --link "https://amherst.my.site.com/partner/s/workorder/<id>/<slug>"
//   npx electron test/live-capture.js --pm AMH --link "https://www.amh.com/my-amh/vendor-user-orders/<guid>?tabId=general"
//   npx electron test/live-capture.js --pm AMH --wonum 9723779
//
// AMH login: set $env:AMH_USER / $env:AMH_PASS for injected login, OR leave
// unset to sign in manually in the window (DEBUG manual-login fallback).
// MSR login: always manual in the window (Salesforce MFA/SSO).
const path = require('path');
const { app } = require('electron');

// Share userData with the live app so the harness reuses the app's
// persist:amh-scraper cookie. Sign in once via the app → harness auto-authes.
// Must run BEFORE require('../scraper') (which loads Electron BrowserWindow).
app.setPath('userData', path.join(app.getPath('appData'), 'work-order-tracker'));

const { captureWO } = require('../scraper');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return (i >= 0 && process.argv[i + 1]) ? process.argv[i + 1] : def;
}

// Keep the app alive when the scraper destroys its window mid-run.
app.on('window-all-closed', (e) => { e.preventDefault(); });

// Hard 6-min kill switch. If captureWO hangs (login timeout, frozen SPA, etc.)
// the process would otherwise survive as a zombie electron, eating session
// cookies and re-opening windows on next test. Force-exit to guarantee
// cleanup. AMH manual login is bounded to 5 min; 6 leaves a small margin.
setTimeout(() => {
  console.error('[live] hard timeout (6 min) — force exit');
  process.exit(1);
}, 6 * 60 * 1000).unref();

app.whenReady().then(async () => {
  const pm = (arg('pm', '') || '').toUpperCase();
  const link = arg('link', '');
  const wonum = arg('wonum', '');
  if (pm !== 'AMH' && pm !== 'MSR') {
    console.error('usage: --pm AMH|MSR --link <url> | --wonum <7-digit (AMH only)>');
    app.exit(2); return;
  }
  const wo = { pm, portalLink: link, id: wonum ? 'WO-' + wonum : 'WO-LIVE' };

  const getCredential = async (p) => {
    if (p === 'AMH' && process.env.AMH_USER && process.env.AMH_PASS)
      return { username: process.env.AMH_USER, password: process.env.AMH_PASS };
    return null;
  };

  console.log('[live] capturing', wo);
  let res;
  try {
    res = await captureWO(wo, getCredential);
  } catch (e) {
    res = { ok: false, error: 'threw: ' + e.message };
  }
  console.log('\n[live] RESULT:\n' + JSON.stringify(res, null, 2) + '\n');
  app.exit(res && res.ok ? 0 : 1);
});
