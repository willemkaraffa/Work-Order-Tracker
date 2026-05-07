'use strict';
// One-shot script: scrape bidItems for all already-Invoiced AMH WOs that have none.
// Calls scrape_amh_bids.py (Selenium/Chrome) which uses the same proven login
// approach as the remittance scraper.
// Run with: npx electron scrape-existing-amh.js
const { app } = require('electron');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

app.setName('work-order-tracker');

const dataPath = path.join(app.getPath('userData'), 'wo-data.json');
const SCRIPT   = path.join(__dirname, 'scrape_amh_bids.py');

function readStore() {
  try { return JSON.parse(fs.readFileSync(dataPath, 'utf8')); } catch(e) { return {}; }
}
function writeStore(s) {
  fs.writeFileSync(dataPath, JSON.stringify(s, null, 2), 'utf8');
}

function runPython(woNumbers) {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', [SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => {
      const line = d.toString();
      process.stderr.write(line);   // forward Python progress to console
      stderr += line;
    });
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`Python exited ${code}: ${stderr.slice(-200)}`));
      try { resolve(JSON.parse(stdout)); }
      catch(e) { reject(new Error('Could not parse Python output: ' + stdout.slice(0, 200))); }
    });
    proc.stdin.write(JSON.stringify(woNumbers));
    proc.stdin.end();
  });
}

app.whenReady().then(async () => {
  const store  = readStore();
  const data   = store['wo_data'] ? JSON.parse(store['wo_data']) : {};
  const orders = data.orders || [];

  const targets = orders.filter(o =>
    !o.deleted &&
    o.tab === 'invoiced' &&
    (o.pm || '').toUpperCase() === 'AMH' &&
    !(o.bidItems && o.bidItems.length)
  );

  console.log(`\nFound ${targets.length} AMH Invoiced WO(s) without bidItems\n`);
  if (!targets.length) { console.log('Nothing to do.'); app.quit(); return; }

  const woIds = targets.map(o => o.id);

  let results;
  try {
    results = await runPython(woIds);
  } catch(e) {
    console.error('Python scrape failed:', e.message);
    app.quit();
    return;
  }

  let saved = 0;
  for (const wo of targets) {
    const r = results[wo.id];
    if (!r) {
      console.log(`  ${wo.id} ... MISSING from Python output`);
      continue;
    }
    if (r.ok && r.items && r.items.length) {
      const idx = orders.findIndex(o => o.id === wo.id);
      orders[idx].bidItems = r.items;
      saved++;
      console.log(`  ${wo.id} ... ${r.items.length} item(s) saved`);
    } else if (r.warning) {
      console.log(`  ${wo.id} ... WARN: ${r.warning}`);
    } else {
      console.log(`  ${wo.id} ... FAIL: ${r.error}`);
    }
  }

  if (saved > 0) {
    data.orders      = orders;
    store['wo_data'] = JSON.stringify(data);
    writeStore(store);
    console.log(`\n${saved} WO(s) updated. Run sync_to_lookup.py to update the workbook.`);
  } else {
    console.log('\nNo WOs updated.');
  }

  app.quit();
});
