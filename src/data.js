// Data layer, carved out of app.jsx: useWorkOrders -- loads/validates the
// wo_data envelope from window.storage and returns [data, ...mutators]. Sole
// consumer is App. Pure helpers import from constants.js/utils.js; nextWOId
// (id minting) imports from app.jsx (live-binding cycle, eval-safe -- the hook
// body runs only when App calls it, never at module-init).
import React from 'react';
import {
  DEFAULT_PHASES, DEFAULT_STATUS_COLORS, DEFAULT_MORE_INFO_COLOR,
  DEFAULT_PMS, DEFAULT_TYPES, DEFAULT_TECHS, isCompletionStatusName,
} from './constants.js';
import { formatPhone } from './utils.js';
import { nextWOId, DEFAULT_STATUSES } from './app.jsx';

// Returns [data, updateOrder]; data is null while loading.
// data is the full wo_data envelope { orders, presets, pms, settings, ... }.
export function useWorkOrders() {
  const [data, setData] = React.useState(null);
  const dataRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const fresh = () => ({
        orders: [], presets: [], inboxes: [],
        statuses: DEFAULT_STATUSES.slice(),
        phases: DEFAULT_PHASES.map(p => ({ ...p })),
        statusColors: { ...DEFAULT_STATUS_COLORS },
        moreInfoColor: DEFAULT_MORE_INFO_COLOR,
        pms:   DEFAULT_PMS.slice(),
        types: DEFAULT_TYPES.slice(),
        techs: DEFAULT_TECHS.slice(),
        settings: {},
      });
      if (!window.storage || !window.storage.get) {
        const empty = fresh();
        if (!cancelled) { setData(empty); dataRef.current = empty; }
        return;
      }
      try {
        const r = await window.storage.get('wo_data');
        if (cancelled) return;
        let parsed = fresh();
        if (r && r.value) {
          try {
            const p = JSON.parse(r.value);
            parsed = p && typeof p === 'object' ? p : fresh();
          } catch { parsed = fresh(); }
        }
        if (!Array.isArray(parsed.orders))   parsed.orders   = [];
        // 'Other' is no longer a valid job type — migrate legacy rows to Plumbing
        // (the company's primary trade). Idempotent.
        for (const o of parsed.orders) {
          if (o && String(o.type).toLowerCase() === 'other') o.type = 'Plumbing';
        }
        if (!Array.isArray(parsed.presets))  parsed.presets  = [];
        if (!Array.isArray(parsed.inboxes))  parsed.inboxes  = [];
        if (!Array.isArray(parsed.statuses) || !parsed.statuses.length) parsed.statuses = DEFAULT_STATUSES.slice();
        if (!Array.isArray(parsed.phases))   parsed.phases   = DEFAULT_PHASES.map(p => ({ ...p }));
        // change11: do NOT strip the legacy `complete` flag here — the
        // reconciler and migrateOrders both consume it to decide which active
        // WOs flip to tab='complete'. The flag is removed only AFTER those
        // consumers run (inside migrateSettingsForChange11).
        if (!parsed.statusColors || typeof parsed.statusColors !== 'object') parsed.statusColors = {};
        parsed.statusColors = { ...DEFAULT_STATUS_COLORS, ...parsed.statusColors };
        if (typeof parsed.moreInfoColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(parsed.moreInfoColor)) {
          parsed.moreInfoColor = DEFAULT_MORE_INFO_COLOR;
        }
        if (!parsed.settings || typeof parsed.settings !== 'object') parsed.settings = {};
        if (!parsed.settings.viewSorts || typeof parsed.settings.viewSorts !== 'object') parsed.settings.viewSorts = {};
        if (!Array.isArray(parsed.pms)   || !parsed.pms.length)   parsed.pms   = DEFAULT_PMS.slice();
        if (!Array.isArray(parsed.types) || !parsed.types.length) parsed.types = DEFAULT_TYPES.slice();
        parsed.types = parsed.types.filter(t => String(t).toLowerCase() !== 'other');
        if (!Array.isArray(parsed.techs) || !parsed.techs.length) parsed.techs = DEFAULT_TECHS.slice();
        setData(parsed);
        dataRef.current = parsed;
      } catch {
        const empty = fresh();
        if (!cancelled) { setData(empty); dataRef.current = empty; }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const updateOrder = React.useCallback((id, mutator) => {
    const cur = dataRef.current;
    if (!cur) return;
    const orders = cur.orders.map(o => o.id === id ? mutator(o) : o);
    // v2.6.0 parity: editing a WO and typing a new tech name into the field
    // should add it to the techs list so future dropdowns include it.
    const edited = orders.find(o => o.id === id);
    let techs = cur.techs;
    if (edited && edited.tech && !techs.includes(edited.tech)) {
      techs = [...techs, edited.tech];
    }
    const next = { ...cur, orders, techs };
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
  }, []);

  // Patch top-level settings object (e.g. density, theme).
  const updateSettings = React.useCallback((patchOrFn) => {
    const cur = dataRef.current;
    if (!cur) return;
    const curSettings = cur.settings || {};
    const patch = typeof patchOrFn === 'function' ? patchOrFn(curSettings) : patchOrFn;
    const next = { ...cur, settings: { ...curSettings, ...patch } };
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
  }, []);

  // Apply mutator to every order matching predicate, single render + single save.
  const batchUpdate = React.useCallback((predicate, mutator) => {
    const cur = dataRef.current;
    if (!cur) return;
    const orders = cur.orders.map(o => predicate(o) ? mutator(o) : o);
    // v2.6.0 parity: bulk-edit can assign a new tech name; ensure it lands in techs.
    const techsSet = new Set(cur.techs || []);
    let techsChanged = false;
    for (const o of orders) {
      if (o.tech && !techsSet.has(o.tech)) { techsSet.add(o.tech); techsChanged = true; }
    }
    const next = { ...cur, orders };
    if (techsChanged) next.techs = Array.from(techsSet);
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
  }, []);

  // Append a new order. Returns the assigned id.
  const addOrder = React.useCallback((record) => {
    const cur = dataRef.current;
    if (!cur) return null;
    const id = nextWOId(cur.orders, record.id);
    // change11: auto-flip new WOs that already carry a completion status into
    // tab='complete' with hardcoded Pending Approval. Mirrors the import path.
    const recStatus = record.status || 'Open';
    const recIsCompletion = isCompletionStatusName(recStatus);
    const o = {
      ...record,
      id,
      deleted: false,
      tab: recIsCompletion ? 'complete' : (record.tab || 'active'),
      status: recIsCompletion ? 'Complete - Pending Approval' : recStatus,
      ...(recIsCompletion ? { prevStatus: recStatus } : {}),
      history: recIsCompletion
        ? [{ ts: Date.now(), action: 'created', detail: '' },
           { ts: Date.now(), action: 'auto-flipped to Complete', detail: 'status=' + recStatus + ' → Complete - Pending Approval' }]
        : [{ ts: Date.now(), action: 'created', detail: '' }],
    };
    const techs = (record.tech && !cur.techs.includes(record.tech)) ? [...cur.techs, record.tech] : cur.techs;
    const next = { ...cur, orders: [...cur.orders, o], techs };
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
    return id;
  }, []);

  // Permanent delete (used by trash → "Delete permanently").
  const deleteOrderHard = React.useCallback((id) => {
    const cur = dataRef.current;
    if (!cur) return;
    const orders = cur.orders.filter(o => o.id !== id);
    const next = { ...cur, orders };
    dataRef.current = next;
    setData(next);
    if (window.storage && window.storage.set) {
      window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    }
  }, []);

  const addPreset = React.useCallback((preset) => {
    const cur = dataRef.current;
    if (!cur) return null;
    const id = 'pv_' + Date.now().toString(36);
    const next = { ...cur, presets: [...(cur.presets || []), { id, ...preset }] };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    return id;
  }, []);

  const updatePreset = React.useCallback((id, patch) => {
    const cur = dataRef.current;
    if (!cur) return;
    const presets = (cur.presets || []).map(p => p.id === id ? { ...p, ...patch } : p);
    const next = { ...cur, presets };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  }, []);

  const deletePreset = React.useCallback((id) => {
    const cur = dataRef.current;
    if (!cur) return;
    const presets = (cur.presets || []).filter(p => p.id !== id);
    const next = { ...cur, presets };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  }, []);

  // --- Custom inboxes (manual-membership, ordered WO lists) ---
  const persistInboxes = (cur, inboxes) => {
    const next = { ...cur, inboxes };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  };
  const addInbox = React.useCallback((name) => {
    const cur = dataRef.current;
    if (!cur) return null;
    const id = 'ib_' + Date.now().toString(36);
    persistInboxes(cur, [...(cur.inboxes || []), { id, name, woIds: [] }]);
    return id;
  }, []);
  const renameInbox = React.useCallback((id, name) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).map(b => b.id === id ? { ...b, name } : b));
  }, []);
  const deleteInbox = React.useCallback((id) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).filter(b => b.id !== id));
  }, []);
  const addToInbox = React.useCallback((id, woId) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).map(b => {
      if (b.id !== id) return b;
      const have = new Set(b.woIds || []);
      const incoming = (Array.isArray(woId) ? woId : [woId]).filter(w => !have.has(w));
      return { ...b, woIds: [...(b.woIds || []), ...incoming] };
    }));
  }, []);
  const removeFromInbox = React.useCallback((id, woId) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).map(b =>
      b.id === id ? { ...b, woIds: (b.woIds || []).filter(w => w !== woId) } : b));
  }, []);
  const reorderInbox = React.useCallback((id, woIds) => {
    const cur = dataRef.current;
    if (!cur) return;
    persistInboxes(cur, (cur.inboxes || []).map(b => b.id === id ? { ...b, woIds } : b));
  }, []);

  const deleteOrdersHard = React.useCallback((ids) => {
    const cur = dataRef.current;
    if (!cur) return;
    const set = new Set(ids);
    const orders = cur.orders.filter(o => !set.has(o.id));
    const next = { ...cur, orders };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  }, []);

  // Mechanism ported from v2.6.0 import handler: extension payload uses
  // sequential WO-### as `inc.id` and the real portal WO# as `inc.woId`.
  // v3.0.0's previous spread-only upsert ignored woId, so MSR/AMH captures
  // landed under WO-### instead of the portal number, and propertyId from a
  // prior AMH spread leaked onto unrelated rows. Behavior here:
  //   id := inc.woId when present and not colliding; else honor matching
  //   inc.id; else mint sequential WO-###. Address/propertyId/phone dedup
  //   silently skips re-captures. Explicit field map prevents stale fields
  //   from one payload contaminating another row.
  const upsertOrders = React.useCallback((incoming) => {
    const cur = dataRef.current;
    if (!cur || !Array.isArray(incoming) || !incoming.length) {
      return { imported: 0, dupSkipped: 0, batch: [] };
    }
    const byId = new Map((cur.orders || []).map(o => [o.id, o]));

    // Normalized WO number (digits only, no leading zeros) -> existing record id.
    // Lets a re-import match a WO however it was keyed: id = portal # (e.g.
    // "02105363"), id = "WO-NNN" with the # in a woId field, or the # embedded in
    // the id ("WO-2199912"). Without this, those re-import as bogus new WOs.
    const woNum = (s) => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
    const byWoNum = new Map();
    for (const o of (cur.orders || [])) {
      if (o.deleted) continue;
      const n = woNum(o.woId) || woNum(o.id);
      if (n) byWoNum.set(n, o.id);
    }

    const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const digits = (s) => String(s || '').replace(/\D/g, '');
    const findDuplicate = (item) => {
      const addr = norm(item.address);
      const pid  = norm(item.propertyId);
      const ph   = digits(item.phone);
      for (const o of byId.values()) {
        if (o.deleted) continue;
        if (pid && norm(o.propertyId) === pid) return o;
        if (addr && norm(o.address) === addr) return o;
        if (ph && ph.length >= 10 && digits(o.phone) === ph) return o;
      }
      return null;
    };

    const idNum = (o) => parseInt(String(o.id || '').replace(/[^0-9]/g, ''), 10) || 0;
    let nextNum = Math.max(0, ...Array.from(byId.values()).map(idNum)) + 1;
    let imported = 0, dupSkipped = 0;
    const batch = []; // ids of WOs that were created or updated this call
    const techsSet = new Set(cur.techs || []);
    let techsChanged = false;

    for (const inc of incoming) {
      if (!inc) continue;

      const portalWo = String(inc.woId || '').trim();
      const incNum = woNum(portalWo);
      let id;
      // stableId = the incoming row carries a real portal WO#. Such rows must NOT
      // be address/phone-deduped: a genuinely new WO# at a known address is a
      // distinct order, not a duplicate. (inc.id is only a local WO-NNN sequence
      // from the extension, so it does NOT count as stable.)
      let stableId = false;
      if (portalWo && byId.has(portalWo))               { id = portalWo; stableId = true; }
      else if (incNum && byWoNum.has(incNum))           { id = byWoNum.get(incNum); stableId = true; } // same WO, keyed differently
      else if (portalWo)                                { id = portalWo; stableId = true; }
      else if (inc.id && byId.has(inc.id))              id = inc.id;
      else {
        const dup = findDuplicate(inc);
        if (dup) { dupSkipped++; continue; }
        id = 'WO-' + String(nextNum++).padStart(3, '0');
      }

      if (byId.has(id)) {
        const old = byId.get(id);
        // change11: WOs on tab='complete' / 'trash' carry a HARDCODED status
        // (Complete - Pending Approval / Cancelled). A re-import from the
        // scraper must NOT overwrite that with the raw portal status; only
        // active WOs accept status updates from import.
        const hardcoded = old.tab === 'complete' || old.tab === 'trash' || old.deleted;
        const merged = {
          ...old,
          pm:          inc.pm          || old.pm,
          type:        inc.type        || old.type,
          address:     inc.address     || old.address,
          phone:       inc.phone       ? formatPhone(inc.phone) : old.phone,
          tech:        inc.tech        || old.tech,
          status:      hardcoded ? old.status : (inc.status || old.status),
          priority:    inc.priority    || old.priority,
          notes:       inc.notes       || old.notes,
          dateCreated: inc.dateCreated || old.dateCreated,
          propertyId:  inc.propertyId  || old.propertyId,
          city:        inc.city        || old.city,
          portalLink:  inc.portalLink  || old.portalLink,
          contactName: inc.contactName || old.contactName,
          contacts:    (Array.isArray(inc.contacts) && inc.contacts.length) ? inc.contacts : old.contacts,
          bidItems:    (Array.isArray(inc.bidItems) && inc.bidItems.length) ? inc.bidItems : old.bidItems,
        };
        // Silent update ONLY when something actually changed — no-op re-imports
        // add no history and are not reported.
        const scalars = ['pm', 'type', 'address', 'phone', 'status', 'priority', 'notes', 'propertyId', 'city', 'portalLink', 'contactName'];
        const changed = scalars.some(k => (merged[k] || '') !== (old[k] || ''))
          || JSON.stringify(merged.bidItems || []) !== JSON.stringify(old.bidItems || [])
          || JSON.stringify(merged.contacts || []) !== JSON.stringify(old.contacts || []);
        if (changed) {
          merged.history = [...(old.history || []), { ts: Date.now(), action: 'updated from import', detail: '' }];
          byId.set(id, merged);
          batch.push({ id, isNew: false });
          imported++;
        }
        continue; // handled (changed or no-op); skip the shared imported++ below
      } else {
        // New row. Address/phone/propertyId dedup only for rows WITHOUT a stable
        // portal WO# — a real new WO# at a known address must still import.
        if (!stableId) {
          const dup = findDuplicate(inc);
          if (dup) { dupSkipped++; continue; }
        }
        // change11: detect completion status on import. If the scraper / import
        // sees a status that signals tech-done ('Pending-Complete', 'Closed',
        // or any string containing 'Job Complete'), the new row lands on
        // Complete tab with status hardcoded and prevStatus saved — matches
        // the auto-flip behavior on manual status changes.
        const incStatus = inc.status || 'Open';
        const importIsCompletion = isCompletionStatusName(incStatus);
        const wo = {
          id,
          pm:            inc.pm || '',
          type:          inc.type || 'Plumbing',
          address:       inc.address || '',
          phone:         formatPhone(inc.phone || ''),
          tech:          inc.tech || '',
          status:        importIsCompletion ? 'Complete - Pending Approval' : incStatus,
          ...(importIsCompletion ? { prevStatus: incStatus } : {}),
          priority:      inc.priority || 'Medium',
          notes:         inc.notes || '',
          dateCreated:   inc.dateCreated || new Date().toISOString().slice(0, 10),
          tab:           importIsCompletion ? 'complete' : 'active',
          deleted:       false,
          propertyId:    inc.propertyId || '',
          bidAmount:     inc.bidAmount || '',
          dateOfService: '',
          portalLink:    inc.portalLink || '',
          city:          inc.city || '',
          contactName:   inc.contactName || '',
          contacts:      Array.isArray(inc.contacts) ? inc.contacts : [],
          emergency:     !!inc.emergency,
          warranty:      !!inc.warranty,
          bidItems:      Array.isArray(inc.bidItems) ? inc.bidItems : [],
          history:       importIsCompletion
            ? [{ ts: Date.now(), action: 'imported', detail: '' },
               { ts: Date.now(), action: 'auto-flipped to Complete', detail: 'import status=' + incStatus + ' → Complete - Pending Approval' }]
            : [{ ts: Date.now(), action: 'imported', detail: '' }],
        };
        byId.set(id, wo);
        batch.push({ id, isNew: true });
        if (wo.tech && !techsSet.has(wo.tech)) { techsSet.add(wo.tech); techsChanged = true; }
      }
      imported++;
    }

    const next = { ...cur, orders: Array.from(byId.values()) };
    if (techsChanged) next.techs = Array.from(techsSet);
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
    return { imported, dupSkipped, batch };
  }, []);

  const updateData = React.useCallback((patch) => {
    const cur = dataRef.current;
    if (!cur) return;
    const next = { ...cur, ...patch };
    dataRef.current = next; setData(next);
    if (window.storage && window.storage.set) window.storage.set('wo_data', JSON.stringify(next)).catch(() => {});
  }, []);

  return [data, updateOrder, batchUpdate, updateSettings, addOrder, deleteOrderHard, addPreset, updatePreset, deletePreset, deleteOrdersHard, upsertOrders, updateData,
          addInbox, renameInbox, deleteInbox, addToInbox, removeFromInbox, reorderInbox];
}
