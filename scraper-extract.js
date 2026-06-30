// Browser-context WO extraction core.
//
// Ported from the Chrome extension content.js (the proven DOM/innerText
// extraction mechanism). Runs in two places, unchanged:
//   1. Injected into the in-app scraper BrowserWindow via executeJavaScript
//      (scraper.js) — the real capture path.
//   2. Loaded into jsdom over saved DOM dumps (test/extract.test.js) — the
//      resilience test. Testing the exact code that ships.
//
// No chrome.* / extension APIs here. Pure DOM + innerText. Exposes
// window.__woExtract = { detectPortal, amhGeneral, amhIssues, amhContacts, msr }.
// Bid line-item extraction stays in scraper.js (navigates per-bid pages).
(function () {
  'use strict';

  // ── Portal detection ───────────────────────────────────────────────────────
  function isAMHPage() {
    const h = location.hostname;
    return h === 'www.amh.com' || h === 'amh.com' || h.endsWith('.amh.com');
  }
  function isMSRPage() {
    const h = location.hostname, p = location.pathname;
    return (h.includes('amherst.my.site.com') || h.includes('msrenewal')) && p.includes('workorder');
  }
  function detectPortal() {
    if (isMSRPage()) return 'MSR';
    if (isAMHPage()) return 'AMH';
    return 'UNKNOWN';
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────
  function findNear(labelText) {
    const all = Array.from(document.querySelectorAll('td,th,dt,dd,div,span,p,label,li'));
    for (const el of all) {
      if (el.children.length === 0 && el.textContent.trim() === labelText) {
        let sib = el.nextElementSibling;
        if (sib) { const v = sib.textContent.trim(); if (v && v !== labelText) return v; }
        if (el.parentElement) {
          sib = el.parentElement.nextElementSibling;
          if (sib) { const v = sib.textContent.trim(); if (v) return v; }
        }
        const row = el.closest('tr');
        if (row) {
          const cells = Array.from(row.querySelectorAll('td,th'));
          const i = cells.indexOf(el);
          if (i >= 0 && cells[i + 1]) return cells[i + 1].textContent.trim();
        }
      }
    }
    const re = new RegExp(labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[:\\s]+([^\\n]+)', 'i');
    const m = document.body.innerText.match(re);
    return m ? m[1].trim() : '';
  }

  // ── WO number extraction ───────────────────────────────────────────────────
  // AMH WO numbers are exactly 7 digits and may have a property nonce appended;
  // slice the leading 7 when a WO context flags the run. MSR / generic: \d{5,}.
  function extractWONumber() {
    const onAMH = isAMHPage();
    const D = onAMH ? '\\d{7,}' : '\\d{5,}';
    const D7Plus = '\\d{7,}';
    const slice7 = onAMH ? (s => (s || '').slice(0, 7)) : (s => s);

    const reLabel     = new RegExp('Work Order\\s*[#:|\\-]?\\s*(' + D + ')', 'i');
    const reLabelHead = new RegExp('Work Order\\s*[|\\-#:]\\s*(' + D + ')', 'i');
    const reBareHead  = new RegExp('^#?\\s*(' + D + ')\\s*$');
    const reUrlPath   = new RegExp('work-?order[s]?\\/(' + D + ')', 'i');
    const reUrlParam  = new RegExp('[?&]wo(?:Id|Number|num)?=(' + D + ')', 'i');
    const reUrlIdParam = new RegExp('[?&]id=(' + D + ')', 'i');
    const reUrlBare   = new RegExp('\\/(' + D7Plus + ')(?:[\\/?#]|$)');
    const reBodyNear  = new RegExp('Work Order[^0-9]{0,20}(' + D + ')', 'i');
    const reTitleBare = new RegExp('\\b(' + D7Plus + ')\\b');

    const title = document.title || '';
    const titleM = title.match(reLabel) || title.match(reTitleBare);
    if (titleM) return slice7(titleM[1]);

    const headings = document.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="heading"],[class*="Header"],[class*="header"]');
    for (const h of headings) {
      const m = h.textContent.match(reLabelHead);
      if (m) return slice7(m[1].trim());
      const m2 = h.textContent.match(reBareHead);
      if (m2) return slice7(m2[1].trim());
    }
    for (const lbl of ['Work Order #', 'Work Order Number', 'Work Order', 'WO #', 'WO Number', 'WO#']) {
      const v = findNear(lbl);
      if (v) {
        const mm = v.match(new RegExp('(' + D + ')'));
        if (mm) return slice7(mm[1]);
      }
    }
    const urlMatch = location.href.match(reUrlPath) ||
                     location.href.match(reUrlParam) ||
                     location.href.match(reUrlIdParam) ||
                     location.href.match(reUrlBare);
    if (urlMatch) return slice7(urlMatch[1]);
    const bodyText = document.body.innerText;
    const bigNum = bodyText.match(reBodyNear);
    if (bigNum) return slice7(bigNum[1]);
    return '';
  }

  // ── City from a full street address ────────────────────────────────────────
  function extractCityFromAddress(addr) {
    if (!addr) return '';
    const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return '';
    const stateZipRe = /^([A-Z]{2}|North Carolina|South Carolina)\s*\d{5}(-\d{4})?$/i;
    const zipOnlyRe = /^\d{5}(-\d{4})?$/;
    const stateOnlyRe = /^([A-Z]{2}|North Carolina|South Carolina)$/i;
    let i = parts.length - 1;
    while (i >= 0 && (stateZipRe.test(parts[i]) || zipOnlyRe.test(parts[i]) || stateOnlyRe.test(parts[i]))) i--;
    if (i <= 0) return '';
    return parts[i];
  }

  // ── Address + city (line-anchored, portal-agnostic) ────────────────────────
  const STREET_SUFFIX = /\b(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Way|Ct|Court|Pl|Place|Cir|Circle|Loop|Trl|Trail|Pkwy|Parkway|Ter|Terrace|Hwy|Highway|Run|Path|Pt|Point|Cv|Cove|Xing|Crossing|Sq|Square|Walk|Row|Bnd|Bend|Knl|Knoll|Hollow|Holw|Ridge|Rdg)\b/i;
  const CITY_STATE_ZIP = /^(.+?),\s*(North Carolina|South Carolina|[A-Za-z]{2})\.?(?:\s+\d{5}(?:-\d{4})?)?$/i;
  const CITY_ZIP = /^(.+?),\s*\d{5}(?:-\d{4})?$/;

  function extractAddressCity(bodyText) {
    const lines = (bodyText || '').split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!/^\d+\s+\S/.test(L)) continue; // street lines start with a house number

      // Same-line: "street, city, STATE zip"
      let m = L.match(/^(.+?),\s*([^,]+?),\s*(North Carolina|South Carolina|[A-Za-z]{2})\.?(?:\s+\d{5}(?:-\d{4})?)?$/i);
      if (m && STREET_SUFFIX.test(m[1])) return { address: m[1].trim(), city: m[2].trim() };

      // Same-line: "street, city, zip" (AMH, no state)
      let m2 = L.match(/^(.+?),\s*([^,]+?),?\s*\d{5}(?:-\d{4})?$/);
      if (m2 && STREET_SUFFIX.test(m2[1])) return { address: m2[1].trim(), city: m2[2].trim() };

      // Two-line: street line, then "city, state zip" on next line (MSR)
      if (STREET_SUFFIX.test(L) && lines[i + 1]) {
        const next = lines[i + 1];
        const c = next.match(CITY_STATE_ZIP) || next.match(CITY_ZIP);
        if (c) return { address: L.trim(), city: c[1].trim() };
      }
    }
    return { address: '', city: '' };
  }

  // ── Property ID (AMH) ──────────────────────────────────────────────────────
  function extractPropertyId() {
    for (const lbl of ['Property ID', 'Property Id', 'Prop ID', 'Property #', 'Property Number', 'PropID']) {
      const v = findNear(lbl);
      if (v) {
        const mm = v.match(/([A-Z0-9\-]{4,})/i);
        if (mm) return mm[1].trim();
      }
    }
    const urlM = location.href.match(/[?&]propertyId=([^&#]+)/i) ||
                 location.href.match(/\/propert(?:y|ies)\/([A-Z0-9\-]{4,})/i);
    if (urlM) return decodeURIComponent(urlM[1]).trim();
    const bm = document.body.innerText.match(/Property\s*ID[:\s#]+([A-Z0-9\-]{4,})/i);
    if (bm) return bm[1].trim();
    return '';
  }

  // ── Mappers ────────────────────────────────────────────────────────────────
  function applyMappings(rawStatus, mappings) {
    if (!rawStatus) return 'Open';
    const r = rawStatus.toLowerCase().trim();
    for (const m of (mappings || [])) {
      if (m.portal && r.includes(m.portal.toLowerCase())) return m.tracker;
    }
    if (r.includes('accept') || r.includes('progress') || r.includes('assign') || r.includes('schedul')) return 'In Progress';
    if (r.includes('part')) return 'Parts Pending';
    if (r.includes('complet') || r.includes('done') || r.includes('finish')) return 'Pending-Complete';
    if (r.includes('closed') || r.includes('cancel')) return 'Closed';
    return 'Open';
  }
  function mapPriority(raw) {
    if (!raw) return 'Medium';
    const r = raw.toLowerCase();
    if (r.includes('1') || r.includes('high') || r.includes('urgent') || r.includes('emergency')) return 'High';
    if (r.includes('4') || r.includes('low') || r.includes('routine')) return 'Low';
    if (r.includes('warrant')) return 'Warranty';
    return 'Medium';
  }
  function mapTradeToType(trade) {
    const t = (trade || '').toLowerCase();
    if (/heat|cool|hvac|\bair\b|furnace/.test(t)) return 'HVAC';
    if (/plumb/.test(t)) return 'Plumbing';
    if (/electric/.test(t)) return 'Electrical';
    if (/appliance/.test(t)) return 'Appliance';
    return 'Other';
  }
  function toISODate(raw) {
    if (!raw) return new Date().toISOString().slice(0, 10);
    const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return m[3] + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0');
    return new Date().toISOString().slice(0, 10);
  }

  // ── AMH General tab ────────────────────────────────────────────────────────
  // Core identity + location + status fields. Type/notes come from amhIssues();
  // bidItems are gathered by scraper.js across the per-bid detail pages.
  function amhGeneral(mappings) {
    const data = { pm: 'AMH' };
    const bodyText = document.body.innerText;

    data.woId = extractWONumber();

    const ac = extractAddressCity(bodyText);
    data.address = ac.address;
    data.city = ac.city;
    if (!data.address) {
      const addrMatch = bodyText.match(/(?:Address)[:\s]*\n?\s*([^\n]+(?:Way|St|Ave|Rd|Dr|Ln|Blvd|Ct|Pl|Cir|Loop|Trail|Pkwy)[^\n]*)/i);
      if (addrMatch) data.address = addrMatch[1].trim();
      if (!data.address) data.address = findNear('Address');
      if (!data.city) data.city = extractCityFromAddress(data.address || '');
    }

    data.dateCreated = toISODate(findNear('Date Created'));
    data.priority = mapPriority(findNear('Priority'));
    // Raw sub-status is exposed so the tracker can auto-advance tabs (e.g.
    // "Pending Validation" → tab='sent'); the mapped `status` is kept for UI display.
    data.subStatus = findNear('Sub-Status') || '';
    data.status = applyMappings(data.subStatus || findNear('System Status'), mappings);

    const tel = document.querySelector('a[href^="tel:"]');
    if (tel) data.phone = tel.textContent.replace(/\(W\)|\(M\)|\(H\)/gi, '').trim();
    if (!data.phone) {
      const pm = bodyText.match(/\b(\d{3}[\-.\s]\d{3}[\-.\s]\d{4})\b/);
      if (pm) data.phone = pm[1];
    }

    data.propertyId = extractPropertyId();
    data.portalLink = location.href;
    return data;
  }

  // ── AMH Condition Issues tab ───────────────────────────────────────────────
  // Type (from the category line, e.g. "MINOR PLUMBING") + notes (issue title +
  // the Description complaint text). AMH now has HVAC WOs, so map by keyword;
  // do NOT default to Plumbing.
  // Handles BOTH AMH layouts: the condition-issues LIST/grid (live default,
  // e.g. "Bathtub is leaking" / "MINOR PLUMBING", no complaint) and the issue
  // DETAIL view (has a "Description" complaint block). Anchors on the category
  // line (present in both) instead of scanning from the top, so the page's nav
  // chrome ("Rent", "Communities", "Work Order | …") can't leak into notes.
  // Walks EVERY condition issue on the Condition Issues tab (not just the
  // first). Each issue's category line anchors discovery; per-issue title sits
  // a few lines above, and complaint text follows a per-issue "Description"
  // label. Returns:
  //   { type, notes, issues:[{title, complaint, category}] }
  // notes = "Title — Complaint" pairs joined by newlines, capped at 2000 chars.
  function amhIssues() {
    const lines = document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    const CAT = /\b(PLUMBING|HVAC|HEATING|COOLING|AIR CONDITION|ELECTRICAL|APPLIANCE)\b/i;
    const headerish = (l) =>
      /Condition Issue\/Asset/i.test(l) || (/Status/i.test(l) && /Category/i.test(l)) ||
      /^(Status|Category|Prio\.?|Location|Photos|Remedy|Date Created|Approved Remedies|Schedule|General|Condition Issues|Bids|Service Tasks|Invoices|Notes|Add Condition Issue|myAMH|ONLINE|Rent|Communities|Description)$/i.test(l);

    // Indices of every category line.
    const catIdxs = [];
    for (let i = 0; i < lines.length; i++) {
      if (CAT.test(lines[i]) && lines[i].length < 40) catIdxs.push(i);
    }

    const issues = [];
    for (let k = 0; k < catIdxs.length; k++) {
      const ci = catIdxs[k];
      const prevCi = k === 0 ? -1 : catIdxs[k - 1];
      const nextCi = k + 1 < catIdxs.length ? catIdxs[k + 1] : lines.length;

      // Title: nearest sentence-like line above this category, bounded by the
      // previous category (so we don't reach back across an earlier issue).
      const titleFloor = Math.max(prevCi + 1, ci - 10);
      let title = '';
      for (let i = ci - 1; i >= titleFloor; i--) {
        const l = lines[i];
        if (!/\s/.test(l)) continue;
        if (headerish(l)) continue;
        if (/^\d/.test(l) || /\d{1,2}\/\d{1,2}\/\d{4}/.test(l)) continue;
        if (/^[A-Z0-9\s\-]+$/.test(l)) continue;
        if (/^Work Order\b/i.test(l)) continue;
        title = l; break;
      }

      // Complaint: between this category and the next, find "Description" and
      // take the next line unless it's "Location" (means no complaint).
      let complaint = '';
      for (let i = ci + 1; i < nextCi; i++) {
        if (/^Description$/i.test(lines[i]) && lines[i + 1] && !/^Location$/i.test(lines[i + 1])) {
          complaint = lines[i + 1];
          break;
        }
      }
      if (title || complaint) issues.push({ title, complaint, category: lines[ci] });
    }

    // Primary type comes from the first issue's category (most WOs are
    // single-trade; if mixed, the user can correct in the form).
    const type = issues.length ? mapTradeToType(issues[0].category) : 'Other';
    const notes = issues
      .map(x => (x.title && x.complaint) ? (x.title + ' — ' + x.complaint) : (x.title || x.complaint))
      .filter(Boolean)
      .join('\n')
      .slice(0, 2000);
    return { type, notes, issues };
  }

  // Parses an AMH bid DETAIL page. Returns the approved option's line items
  // and the structured Approved Amount, NOT the bid-list page's unreliable
  // "Amount" column which shows ranges or zeros.
  //
  //   { amount: 269.06, items: [{name, desc, qty, price}, …] }
  //
  // A bid detail page can render multiple Option N cards (e.g. UPDATED +
  // APPROVED); we keep only the APPROVED card's table.
  function amhBidDetail() {
    const result = { amount: 0, items: [] };
    if (!document.body) return result;

    // 1) Approved Amount from the "Approved Amount" description-item.
    const descItems = document.querySelectorAll('.description-item');
    for (const di of descItems) {
      const lbl = di.querySelector('.description-item__label');
      if (lbl && /Approved Amount/i.test(lbl.textContent || '')) {
        const m = (di.textContent || '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
        if (m) result.amount = parseFloat(m[1].replace(/,/g, '')) || 0;
        break;
      }
    }

    // 2) Find each collapsable-card with an "Option N" heading + APPROVED pill;
    //    collect rows from that card's first <table>.
    const cards = document.querySelectorAll('.collapsable-card, .app-mf-vendor-exp-card');
    for (const card of cards) {
      const head = card.querySelector('.app-mf-vendor-exp-card-head, .header--AZpNp') || card;
      const headText = (head.textContent || '');
      if (!/Option\s*\d/i.test(headText)) continue;
      // Status pill: look in the head for a pill element containing APPROVED.
      const pills = head.querySelectorAll('[class*="pill"]');
      let approved = false;
      for (const p of pills) {
        if (/^\s*APPROVED\s*$/i.test(p.textContent || '')) { approved = true; break; }
      }
      if (!approved) continue;

      const table = card.querySelector('table');
      if (!table) continue;
      const rows = table.querySelectorAll('tbody tr');
      for (const tr of rows) {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => (td.textContent || '').trim());
        if (cells.length < 5) continue;
        const name = cells[0];
        const desc = cells[1] || '';
        const qtyStr = cells[2] || '';
        const unitStr = cells[3] || '';
        if (!name || /^(remedy|description|total|item)$/i.test(name)) continue;
        const m = unitStr.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)/);
        if (!m) continue;
        const price = parseFloat(m[1].replace(/,/g, ''));
        if (!(price >= 0)) continue;
        const qty = parseFloat(qtyStr) || 1;
        result.items.push({ name, desc, qty, price });
      }
    }
    return result;
  }

  // ── MSR (amherst.my.site.com, Salesforce Aura) ─────────────────────────────
  function msr(mappings) {
    const data = { pm: 'MSR' };
    const bodyText = document.body ? document.body.innerText : '';

    const titleMatch = (document.title || '').match(/Work Order[:\s]+(\w+)/i);
    if (titleMatch) data.woId = titleMatch[1].trim();
    if (!data.woId) data.woId = extractWONumber();

    const ac = extractAddressCity(bodyText);
    data.address = ac.address;
    data.city = ac.city;
    if (!data.address) {
      const addrMatch = bodyText.match(/Property\s+([^\n]+(?:Ct|St|Ave|Rd|Dr|Ln|Blvd|Way|Pl|Cir|Loop)[^\n]*)/i);
      if (addrMatch) data.address = addrMatch[1].replace(/\s*(Open|Preview).*$/i, '').trim();
      if (!data.city) data.city = extractCityFromAddress(data.address || '');
    }

    const phoneMatch = bodyText.match(/Contact (?:Phone|Mobile)\s+(\+?[\d\s\-().]{10,})/i);
    if (phoneMatch) data.phone = phoneMatch[1].trim().replace(/\s+/g, ' ');

    const priMatch = bodyText.match(/Priority\s+(Urgent|High|Medium|Normal|Low|Routine)/i);
    data.priority = mapPriority(priMatch ? priMatch[1] : '');

    // Sub-Status line, but reject Salesforce grid column-header noise
    // (e.g. "Show Sub-Status Column Actions", "Sorted Ascending").
    const subStatusMatch = bodyText.match(/Sub-Status\n([^\n]+)/);
    let subStatus = subStatusMatch ? subStatusMatch[1].trim() : '';
    if (/\b(Show|Sort|Sorted|Column Actions)\b/i.test(subStatus)) subStatus = '';
    const statusMatch = bodyText.match(/\bStatus\s+(Completed|In Progress|Open|Closed|Cancelled|Pending|Assigned|Scheduled|Approved)\b/i);
    data.status = applyMappings(subStatus || (statusMatch ? statusMatch[1].trim() : ''), mappings);

    // Type + notes live in Salesforce free-text cells (span.uiOutputTextArea),
    // NOT the "Description" summary. Piped cell = Issue (Trade|Cat|Symptom);
    // non-piped = resident complaint / tech completion notes.
    const otCells = Array.from(document.querySelectorAll('span.uiOutputTextArea'))
      .map(el => el.textContent.trim()).filter(t => t && t.length > 1);
    const issues = otCells.filter(t => t.includes('|'));
    const freeNotes = otCells.filter(t => !t.includes('|'));

    const trade = ((issues[0] || '').split('|')[0] || '');
    data.type = mapTradeToType(trade);

    data.notes = [...issues.map(s => s.replace(/\s*\|\s*/g, ' | ').trim()), ...freeNotes]
      .filter(Boolean).join('\n').slice(0, 1000);

    // MSR exposes no accept/created date in the captured DOM. The old code used
    // "Work Completed" / "Scheduled Start Time" — neither is when the WO was
    // accepted, so dateCreated came out as the scheduled date (e.g. a WO never
    // visited read as created on its schedule day). Use the capture date instead
    // (round5 A3 / #12b); revisit if a real accept-date field is found.
    data.dateCreated = new Date().toISOString().slice(0, 10);

    data.portalLink = location.href;
    return data;
  }

  // AMH Household block contacts. Returns ordered list (index 0 = primary):
  //   [{ role:'PRIMARY CONTACT', name:'…', phone:'…' }, …]
  //
  // Format varies per WO:
  //   - Some contacts have a role label line ("PRIMARY CONTACT"), some don't.
  //   - Multiple roles can be concatenated with no separator ("PRIMARY CONTACTSUBMITTER").
  //   - Primary may NOT be first in the list; we promote whichever entry is
  //     tagged PRIMARY CONTACT to index 0.
  //
  // Strategy: anchor on phone lines (most reliable). For each phone, walk
  // backward up to 4 lines to find a name + any role labels, skipping email
  // and section markers.
  function amhContacts() {
    const text = document.body ? document.body.innerText : '';
    const hi = text.search(/^\s*Household\s*$/im);
    if (hi < 0) return [];
    let block = text.slice(hi);
    const endIdx = block.search(/^(?:Email all residents|Copy all emails|©|All graphics)/im);
    if (endIdx > 0) block = block.slice(0, endIdx);
    const lines = block.split('\n').map(s => s.trim()).filter(Boolean);

    const ROLE_TOKENS_RE = /(PRIMARY CONTACT|SUBMITTER|SECONDARY CONTACT|CO[- ]?RESIDENT|OCCUPANT|GUARANTOR|EMERGENCY CONTACT|RESIDENT)/gi;
    const PHONE_RE = /\+?1?[\s().-]*\d{3}[\s().-]*\d{3}[\s().-]*\d{4}/;
    const EMAIL_RE = /@/;
    const STOP = (l) => /^(Household|Email all residents|Copy all emails|©|All graphics)/i.test(l);
    const isRoleLineOnly = (l) => {
      const matches = (l.match(ROLE_TOKENS_RE) || []).join('');
      // Allow concatenated labels with no separator. Compare ignoring spaces.
      return matches.length > 0 && matches.replace(/\s/g, '').length === l.replace(/\s/g, '').length;
    };

    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      const pm = l.match(PHONE_RE);
      if (!pm) continue;
      const phone = pm[0].replace(/[^\d+]/g, '');
      let name = '', role = '';
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const p = lines[j];
        if (STOP(p)) break;
        if (EMAIL_RE.test(p)) continue;
        if (isRoleLineOnly(p)) {
          const toks = (p.match(ROLE_TOKENS_RE) || []).map(s => s.toUpperCase());
          role = toks.join(' / ');
          if (name) break;
          continue;
        }
        if (!name) { name = p; continue; }
        break;
      }
      out.push({ role, name, phone });
    }
    // Promote PRIMARY CONTACT (or SUBMITTER, in that order) to index 0.
    let pIdx = out.findIndex(c => /PRIMARY CONTACT/i.test(c.role));
    if (pIdx < 0) pIdx = out.findIndex(c => /SUBMITTER/i.test(c.role));
    if (pIdx > 0) { const [p] = out.splice(pIdx, 1); out.unshift(p); }
    return out;
  }

  const api = { detectPortal, amhGeneral, amhIssues, amhContacts, amhBidDetail, msr,
    // exported for unit tests
    _internals: { extractWONumber, extractAddressCity, extractCityFromAddress, extractPropertyId, applyMappings, mapPriority, mapTradeToType, toISODate } };

  if (typeof window !== 'undefined') window.__woExtract = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
