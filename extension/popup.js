'use strict';

const BRIDGE = 'http://127.0.0.1:27843';

const DEFAULT_MAPPINGS = [
  { portal: 'Work Order Accepted',  tracker: 'In Progress' },
  { portal: 'Unscheduled',          tracker: 'Open' },
  { portal: 'Scheduled',            tracker: 'In Progress' },
  { portal: 'In Progress',          tracker: 'In Progress' },
  { portal: 'Parts on Order',       tracker: 'Parts Pending' },
  { portal: 'Pending Completion',   tracker: 'Pending-Complete' },
  { portal: 'Completed',            tracker: 'Pending-Complete' },
  { portal: 'Closed',               tracker: 'Closed' },
  { portal: 'Cancelled',            tracker: 'Closed' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
// Escapes for BOTH text nodes and quoted attribute values. The quote cases are not
// decorative: esc() is interpolated into value="${esc(...)}" for status mappings
// (see the map-portal-input and <option> rows below), so a status name containing a
// double quote would close the attribute early and mangle the row.
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmtDate(d) {
  if (!d) return '—';
  const [y,m,dy] = d.split('-');
  return `${m}/${dy}/${y.slice(2)}`;
}
function showStatus(elId, msg, type) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = 'status ' + type;
  setTimeout(() => { el.className = 'status'; }, 4000);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'saved')    renderSaved();
    if (btn.dataset.tab === 'mappings') renderMappings();
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
chrome.storage.local.get(['wo_mappings'], (res) => {
  if (!res.wo_mappings || !res.wo_mappings.length) {
    chrome.storage.local.set({ wo_mappings: DEFAULT_MAPPINGS });
  }
});

refreshSavedCount();
renderSaved();

// ── Saved count ───────────────────────────────────────────────────────────────
function refreshSavedCount() {
  chrome.storage.local.get(['wo_saved_list'], (res) => {
    const el = document.getElementById('savedCount');
    if (el) el.textContent = (res.wo_saved_list || []).length;
  });
}

// ── Sync ──────────────────────────────────────────────────────────────────────
async function syncWithTracker(statusElId) {
  const lbl = document.getElementById('sync-label');
  const lbl2 = document.getElementById('sync-label2');
  if (lbl) lbl.textContent = 'Syncing…';
  if (lbl2) lbl2.textContent = 'Syncing…';
  try {
    const r = await fetch(BRIDGE + '/config', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error('Bad response');
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Config error');
    chrome.storage.local.set({ wo_tracker_config: data.config }, () => {
      const msg = `Synced — ${data.config.statuses.length} statuses`;
      if (lbl)  lbl.textContent  = msg;
      if (lbl2) lbl2.textContent = msg;
      showStatus(statusElId, '✓ Synced with tracker.', 'ok');
      renderMappings();
    });
  } catch(e) {
    const msg = 'Sync failed — open tracker first';
    if (lbl)  lbl.textContent  = msg;
    if (lbl2) lbl2.textContent = msg;
    showStatus(statusElId, '✗ ' + msg, 'err');
  }
}

document.getElementById('btn-sync').addEventListener('click',  () => syncWithTracker('saved-status'));
document.getElementById('btn-sync2').addEventListener('click', () => syncWithTracker('mapping-status'));

// ── Saved list ────────────────────────────────────────────────────────────────
function renderSaved() {
  chrome.storage.local.get(['wo_saved_list'], (res) => {
    const list = (res.wo_saved_list || []).slice().reverse();
    const el = document.getElementById('saved-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = '<div class="empty">No captured work orders yet.<br>Click 📋 Capture WO on any AMH page.</div>';
      return;
    }
    el.innerHTML = list.map((wo, i) => {
      const realIdx = (res.wo_saved_list.length - 1) - i;
      return `<div class="saved-item">
        ${wo.woId ? `<div class="si-id">${esc(wo.woId)}</div>` : ''}
        <div class="si-addr">${esc(wo.address || 'No address')}</div>
        <div class="si-meta">${esc(wo.pm||'—')} · ${esc(wo.type||'—')} · ${esc(wo.status||'—')} · ${fmtDate(wo.dateCreated)}</div>
        ${wo.phone ? `<div class="si-meta" style="color:#6ba8f7">${esc(wo.phone)}</div>` : ''}
        ${wo.notes ? `<div class="si-meta" style="color:#555">${esc(wo.notes.slice(0,80))}</div>` : ''}
        <div class="si-acts">
          <button class="btn-delete-saved" data-idx="${realIdx}" style="color:#ef4444">✕ Remove</button>
        </div>
      </div>`;
    }).join('');
    // Attach delete listeners via delegation
    el.querySelectorAll('.btn-delete-saved').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        chrome.storage.local.get(['wo_saved_list'], (res2) => {
          const l = res2.wo_saved_list || [];
          l.splice(idx, 1);
          chrome.storage.local.set({ wo_saved_list: l }, () => { refreshSavedCount(); renderSaved(); });
        });
      });
    });
  });
}

document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (!confirm('Remove all saved work orders?')) return;
  chrome.storage.local.set({ wo_saved_list: [] }, () => { refreshSavedCount(); renderSaved(); });
});

// ── Mappings ──────────────────────────────────────────────────────────────────
function renderMappings() {
  chrome.storage.local.get(['wo_mappings', 'wo_tracker_config'], (res) => {
    const mappings = res.wo_mappings || DEFAULT_MAPPINGS;
    const config   = res.wo_tracker_config || {};
    const statuses = config.statuses || ['Open','In Progress','Parts Pending','Pending-Complete','Closed'];

    // Populate the "add new" tracker status dropdown
    const addSel = document.getElementById('new-tracker-status');
    if (addSel) {
      addSel.innerHTML = statuses.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    }

    const el = document.getElementById('mapping-list');
    if (!el) return;

    if (!mappings.length) {
      el.innerHTML = '<div class="empty" style="padding:8px 0">No mappings yet. Add one below.</div>';
      return;
    }

    // Build rows — NO inline handlers
    el.innerHTML = mappings.map((m, i) => `
      <div class="mapping-row-wrap" data-idx="${i}">
        <div class="mapping-row">
          <input type="text" class="map-portal-input" data-idx="${i}" value="${esc(m.portal)}" placeholder="AMH status text…">
          <div class="arrow">→</div>
          <select class="map-tracker-select" data-idx="${i}">
            ${statuses.map(s => `<option value="${esc(s)}"${s === m.tracker ? ' selected' : ''}>${esc(s)}</option>`).join('')}
            ${!statuses.includes(m.tracker) ? `<option value="${esc(m.tracker)}" selected>${esc(m.tracker)}</option>` : ''}
          </select>
        </div>
        <div style="text-align:right;margin-bottom:6px">
          <button class="btn-del-mapping" data-idx="${i}" style="color:#ef4444;font-size:10px;padding:2px 8px">✕ Delete</button>
        </div>
      </div>`).join('');

    // Attach listeners — event delegation, no inline handlers
    el.querySelectorAll('.map-portal-input').forEach(input => {
      input.addEventListener('change', () => {
        const idx = parseInt(input.dataset.idx);
        chrome.storage.local.get(['wo_mappings'], (r) => {
          const m = r.wo_mappings || [];
          if (m[idx] !== undefined) {
            m[idx].portal = input.value;
            chrome.storage.local.set({ wo_mappings: m }, () => showStatus('mapping-status', 'Saved.', 'ok'));
          }
        });
      });
    });

    el.querySelectorAll('.map-tracker-select').forEach(sel => {
      sel.addEventListener('change', () => {
        const idx = parseInt(sel.dataset.idx);
        chrome.storage.local.get(['wo_mappings'], (r) => {
          const m = r.wo_mappings || [];
          if (m[idx] !== undefined) {
            m[idx].tracker = sel.value;
            chrome.storage.local.set({ wo_mappings: m }, () => showStatus('mapping-status', 'Saved.', 'ok'));
          }
        });
      });
    });

    el.querySelectorAll('.btn-del-mapping').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        chrome.storage.local.get(['wo_mappings'], (r) => {
          const m = r.wo_mappings || [];
          m.splice(idx, 1);
          chrome.storage.local.set({ wo_mappings: m }, renderMappings);
        });
      });
    });
  });
}

document.getElementById('btn-add-mapping').addEventListener('click', () => {
  const portalInput  = document.getElementById('new-portal-status');
  const trackerSel   = document.getElementById('new-tracker-status');
  const portal  = portalInput.value.trim();
  const tracker = trackerSel.value;
  if (!portal) { showStatus('mapping-status', 'Enter AMH status text first.', 'err'); return; }
  chrome.storage.local.get(['wo_mappings'], (res) => {
    const mappings = res.wo_mappings || [];
    mappings.push({ portal, tracker });
    chrome.storage.local.set({ wo_mappings: mappings }, () => {
      portalInput.value = '';
      showStatus('mapping-status', '✓ Mapping added.', 'ok');
      renderMappings();
    });
  });
});

// ── Send to tracker ───────────────────────────────────────────────────────────
function doSendToTracker(statusElId) {
  showStatus(statusElId, 'Sending…', 'ok');
  chrome.runtime.sendMessage({ action: 'sendToTracker' }, (res) => {
    if (res && res.ok) {
      showStatus(statusElId, `✓ Sent ${res.count || ''} orders to tracker.`, 'ok');
      refreshSavedCount(); renderSaved();
    } else {
      const err = (res && res.error) || 'Unknown error';
      showStatus(statusElId, err.includes('running') ? '✗ Open the tracker app first.' : '✗ ' + err, 'err');
    }
  });
}

document.getElementById('btn-send-tracker').addEventListener('click',  () => doSendToTracker('saved-status'));
document.getElementById('btn-send-tracker2').addEventListener('click', () => doSendToTracker('export-status'));

document.getElementById('btn-test-host').addEventListener('click', () => {
  showStatus('export-status', 'Testing…', 'ok');
  chrome.runtime.sendMessage({ action: 'pingHost' }, (res) => {
    if (res && res.ok) showStatus('export-status', '✓ Tracker is open and connected.', 'ok');
    else showStatus('export-status', '✗ Tracker not detected. Open the tracker app.', 'err');
  });
});

// ── CSV export ────────────────────────────────────────────────────────────────
document.getElementById('btn-dl-csv').addEventListener('click', () => {
  chrome.storage.local.get(['wo_saved_list'], (res) => {
    const list = res.wo_saved_list || [];
    if (!list.length) { showStatus('export-status', 'No saved work orders.', 'err'); return; }
    const cols = ['id','woId','address','pm','type','priority','status','phone','dateCreated','notes'];
    const csv  = [cols.join(','), ...list.map(wo => cols.map(c => `"${String(wo[c]||'').replace(/"/g,'""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'captured_work_orders.csv'; a.click();
    showStatus('export-status', 'CSV downloaded.', 'ok');
  });
});

document.getElementById('btn-copy-json').addEventListener('click', () => {
  chrome.storage.local.get(['wo_saved_list'], (res) => {
    const list = res.wo_saved_list || [];
    if (!list.length) { showStatus('export-status', 'No saved work orders.', 'err'); return; }
    navigator.clipboard.writeText(JSON.stringify(list, null, 2))
      .then(() => showStatus('export-status', '✓ JSON copied.', 'ok'));
  });
});

document.getElementById('btn-dump-dom').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) { showStatus('export-status', 'No active tab.', 'err'); return; }
    chrome.tabs.sendMessage(tab.id, { action: 'dumpDom' }, (res) => {
      if (chrome.runtime.lastError) {
        showStatus('export-status', '✗ Open an AMH/MSR work order tab first.', 'err');
      } else if (res && res.ok) {
        showStatus('export-status', '✓ DOM dumped (' + res.portal + ') to Downloads.', 'ok');
      } else {
        showStatus('export-status', '✗ ' + ((res && res.error) || 'Dump failed.'), 'err');
      }
    });
  });
});

// One-shot MSR diagnosis. Renders the whole result as SELECTABLE TEXT, never a
// screenshot: images ride along in every later model call and cost far more than the
// same facts as text.
document.getElementById('btn-diag').addEventListener('click', () => {
  const box = document.getElementById('diag-out');
  box.style.display = 'block';
  box.value = 'Running…';
  chrome.runtime.sendMessage({ action: 'woDiag' }, (res) => {
    box.value = chrome.runtime.lastError
      ? ('Service worker did not answer: ' + chrome.runtime.lastError.message)
      : JSON.stringify(res, null, 2);
  });
});
