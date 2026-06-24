'use strict';
// Smoke test for amh-runner.js inside a real Electron main process (proves the
// IPC-side spawn + path resolution + JSON parse). Dev path: system python.
// Run: $env:AMH_EMAIL=...; $env:AMH_PASSWORD=...; npx electron test/runner-smoke.js [woNum]
const { app } = require('electron');
const { runAmhCapture } = require('../amh-runner');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const woNum = process.argv.find(a => /^\d{6,}$/.test(a)) || '9765734';
  const creds = { username: process.env.AMH_EMAIL, password: process.env.AMH_PASSWORD };
  console.log('[smoke] capturing', woNum, 'isPackaged=', app.isPackaged);
  try {
    const results = await runAmhCapture([woNum], creds);
    const r = results[woNum];
    console.log('[smoke] ok=', r && r.ok, 'type=', r && r.wo && r.wo.type,
      'items=', r && r.wo && r.wo.bidItems && r.wo.bidItems.length,
      'amount=', r && r.wo && r.wo.bidAmount, 'warnings=', r && r.warnings);
    if (!r || !r.ok) console.log('[smoke] FULL:', JSON.stringify(results));
  } catch (e) {
    console.error('[smoke] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
