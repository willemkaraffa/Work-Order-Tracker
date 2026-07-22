// Content script
(function() {
  'use strict';
  if (window.__woCaptureInjected) return;
  window.__woCaptureInjected = true;

  // ── Toast ──────────────────────────────────────────────────────────────────
  function showToast(title, color, lines) {
    const ex = document.getElementById('wo-capture-toast');
    if (ex) ex.remove();
    if (!document.getElementById('wo-anim-style')) {
      const s = document.createElement('style');
      s.id = 'wo-anim-style';
      s.textContent = `@keyframes woIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`;
      document.head.appendChild(s);
    }
    const t = document.createElement('div');
    t.id = 'wo-capture-toast';
    t.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#1c1c1c;color:#f0f0f0;border:1px solid ${color};border-left:4px solid ${color};border-radius:8px;padding:12px 16px;font-family:Consolas,monospace;font-size:13px;max-width:340px;box-shadow:0 8px 24px rgba(0,0,0,0.5);animation:woIn 0.2s ease`;
    t.innerHTML = `<div style="color:${color};font-weight:bold;margin-bottom:6px">${title}</div>${(lines||[]).map(l=>`<div style="color:#ccc;font-size:11px;margin-top:2px">${l}</div>`).join('')}`;
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove(); }, 5000);
  }

  // ── Portal detection ───────────────────────────────────────────────────────
  function isAMHPage() {
    const h = window.location.hostname;
    return h === 'www.amh.com' || h === 'amh.com' || h.endsWith('.amh.com');
  }

  function isMSRPage() {
    const h = window.location.hostname;
    const p = window.location.pathname;
    // amherst.my.site.com/partner/s/workorder/...
    return (h.includes('amherst.my.site.com') || h.includes('msrenewal')) && p.includes('workorder');
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
          if (i >= 0 && cells[i+1]) return cells[i+1].textContent.trim();
        }
      }
    }
    const re = new RegExp(labelText.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '[:\\s]+([^\\n]+)', 'i');
    const m = document.body.innerText.match(re);
    return m ? m[1].trim() : '';
  }

  // ── WO number extraction ───────────────────────────────────────────────────
  // AMH WO numbers are exactly 7 digits. AMH portal sometimes concatenates a
  // property nonce after the WO# (e.g. "9698891706" for WO 9698891 + 706).
  // For AMH we capture the leading 7 digits when context (label, heading, "Work
  // Order " keyword) flags the run as a WO#. For MSR / generic, fall back to
  // the original \d{5,}+ heuristics.
  function extractWONumber() {
    const onAMH = isAMHPage();
    const D = onAMH ? '\\d{7,}' : '\\d{5,}';
    const D7Plus = '\\d{7,}';
    const slice7 = onAMH ? (s => (s || '').slice(0, 7)) : (s => s);

    const reLabel       = new RegExp('Work Order\\s*[#:|\\-]?\\s*(' + D + ')', 'i');
    const reLabelHead   = new RegExp('Work Order\\s*[|\\-#:]\\s*(' + D + ')', 'i');
    const reBareHead    = new RegExp('^#?\\s*(' + D + ')\\s*$');
    const reUrlPath     = new RegExp('work-?order[s]?\\/(' + D + ')', 'i');
    const reUrlParam    = new RegExp('[?&]wo(?:Id|Number|num)?=(' + D + ')', 'i');
    const reUrlIdParam  = new RegExp('[?&]id=(' + D + ')', 'i');
    const reUrlBare     = new RegExp('\\/(' + D7Plus + ')(?:[\\/?#]|$)');
    const reBodyNear    = new RegExp('Work Order[^0-9]{0,20}(' + D + ')', 'i');
    const reTitleBare   = new RegExp('\\b(' + D7Plus + ')\\b');

    // Strategy 1: page title
    const title = document.title || '';
    const titleM = title.match(reLabel) || title.match(reTitleBare);
    if (titleM) return slice7(titleM[1]);

    // Strategy 2: headings
    const headings = document.querySelectorAll('h1,h2,h3,h4,[class*="title"],[class*="heading"],[class*="Header"],[class*="header"]');
    for (const h of headings) {
      const m = h.textContent.match(reLabelHead);
      if (m) return slice7(m[1].trim());
      const m2 = h.textContent.match(reBareHead);
      if (m2) return slice7(m2[1].trim());
    }
    // Strategy 3: explicit labels
    for (const lbl of ['Work Order #', 'Work Order Number', 'Work Order', 'WO #', 'WO Number', 'WO#']) {
      const v = findNear(lbl);
      if (v) {
        const mm = v.match(new RegExp('(' + D + ')'));
        if (mm) return slice7(mm[1]);
      }
    }
    // Strategy 4: URL
    const urlMatch = window.location.href.match(reUrlPath) ||
                     window.location.href.match(reUrlParam) ||
                     window.location.href.match(reUrlIdParam) ||
                     window.location.href.match(reUrlBare);
    if (urlMatch) return slice7(urlMatch[1]);
    // Strategy 5: page text — only when "Work Order" keyword is present nearby
    const bodyText = document.body.innerText;
    const bigNum = bodyText.match(reBodyNear);
    if (bigNum) return slice7(bigNum[1]);
    return '';
  }

  // ── City extraction (derived from a full street address) ──────────────────
  // Expected formats:
  //   "706 Midsummer Lane, Apex, NC 27502"
  //   "12404 Kendall Ridge Court, Durham, North Carolina 27703"
  //   "1036 Statler Drive, Durham, NC"
  // Returns the city segment, or '' if it can't be confidently identified.
  function extractCityFromAddress(addr) {
    if (!addr) return '';
    const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length < 2) return '';
    // Walk from the end: skip trailing zip-only or state-only or "STATE ZIP" segments
    // until we land on a city candidate.
    const stateZipRe = /^([A-Z]{2}|North Carolina|South Carolina)\s*\d{5}(-\d{4})?$/i;
    const zipOnlyRe  = /^\d{5}(-\d{4})?$/;
    const stateOnlyRe = /^([A-Z]{2}|North Carolina|South Carolina)$/i;
    let i = parts.length - 1;
    while (i >= 0 && (stateZipRe.test(parts[i]) || zipOnlyRe.test(parts[i]) || stateOnlyRe.test(parts[i]))) {
      i--;
    }
    if (i <= 0) return '';
    return parts[i];
  }

  // ── Address + city extraction (line-anchored, portal-agnostic) ─────────────
  // Robust replacement for the old inline suffix regex. Scans innerText lines
  // for a street line (starts with a number) and pairs it with the city/state/zip
  // segment, whether it sits on the SAME line (AMH: "36 Gregory Drive, Clayton,
  // 27520") or the NEXT line (MSR: "4112 Viewmont Dr" \n "Raleigh, North
  // Carolina 27610"). Returns { address, city }; both '' if nothing confident.
  const STREET_SUFFIX = /\b(St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ln|Lane|Blvd|Boulevard|Way|Ct|Court|Pl|Place|Cir|Circle|Loop|Trl|Trail|Pkwy|Parkway|Ter|Terrace|Hwy|Highway|Run|Path|Pt|Point|Cv|Cove|Xing|Crossing|Sq|Square|Walk|Row|Bnd|Bend|Knl|Knoll|Hollow|Holw|Ridge|Rdg)\b/i;
  // "City, North Carolina 27610" / "City, NC 27610" / "City, NC"
  const CITY_STATE_ZIP = /^(.+?),\s*(North Carolina|South Carolina|[A-Za-z]{2})\.?(?:\s+\d{5}(?:-\d{4})?)?$/i;
  // "City, 27520" (AMH omits state)
  const CITY_ZIP = /^(.+?),\s*\d{5}(?:-\d{4})?$/;

  function extractAddressCity(bodyText) {
    const lines = (bodyText || '').split('\n').map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (!/^\d+\s+\S/.test(L)) continue; // street lines start with a house number

      // address = STREET ONLY (city goes to its own field, never the street field).

      // Same-line: "street, city, STATE zip"
      let m = L.match(/^(.+?),\s*([^,]+?),\s*(North Carolina|South Carolina|[A-Za-z]{2})\.?(?:\s+\d{5}(?:-\d{4})?)?$/i);
      if (m && STREET_SUFFIX.test(m[1])) return { address: m[1].trim(), city: m[2].trim() };

      // Same-line: "street, city, zip" (AMH, no state)
      let m2 = L.match(/^(.+?),\s*([^,]+?),?\s*\d{5}(?:-\d{4})?$/);
      if (m2 && STREET_SUFFIX.test(m2[1])) return { address: m2[1].trim(), city: m2[2].trim() };

      // Two-line: street line, then "city, state zip" on the next line (MSR)
      if (STREET_SUFFIX.test(L) && lines[i + 1]) {
        const next = lines[i + 1];
        const c = next.match(CITY_STATE_ZIP) || next.match(CITY_ZIP);
        if (c) return { address: L.trim(), city: c[1].trim() };
      }
    }
    return { address: '', city: '' };
  }

  // ── Property ID extraction (AMH) ───────────────────────────────────────────
  function extractPropertyId() {
    // Try labeled fields first
    for (const lbl of ['Property ID', 'Property Id', 'Prop ID', 'Property #', 'Property Number', 'PropID']) {
      const v = findNear(lbl);
      if (v) {
        const mm = v.match(/([A-Z0-9\-]{4,})/i);
        if (mm) return mm[1].trim();
      }
    }
    // URL fallbacks
    const urlM = window.location.href.match(/[?&]propertyId=([^&#]+)/i) ||
                 window.location.href.match(/\/propert(?:y|ies)\/([A-Z0-9\-]{4,})/i);
    if (urlM) return decodeURIComponent(urlM[1]).trim();
    // Body text fallback — "Property ID: ABC123"
    const bodyText = document.body.innerText;
    const bm = bodyText.match(/Property\s*ID[:\s#]+([A-Z0-9\-]{4,})/i);
    if (bm) return bm[1].trim();
    return '';
  }

  // ── Map status via saved mappings ──────────────────────────────────────────
  function applyMappings(rawStatus, mappings) {
    if (!rawStatus) return 'Open';
    const r = rawStatus.toLowerCase().trim();
    // Check user-defined mappings first
    for (const m of (mappings || [])) {
      if (m.portal && r.includes(m.portal.toLowerCase())) return m.tracker;
    }
    // Fallback defaults
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

  function toISODate(raw) {
    if (!raw) return new Date().toISOString().slice(0,10);
    const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
    return new Date().toISOString().slice(0,10);
  }

  // ── MSR scraper (amherst.my.site.com) ────────────────────────────────────────
  // MSR renders its work-order fields as Lightning record-layout items, one per
  // field, each carrying its own label AND its Salesforce API name:
  //
  //   <records-record-layout-item field-label="Contact Phone"
  //       data-target-selection-name="sfdc:RecordField.WorkOrder.Contact_Phone__c">
  //     <span class="test-id__field-label">Contact Phone</span>
  //     <span class="test-id__field-value ...">+18632897039</span>
  //
  // Verified against a real dump of WO 03984243 (2026-07-22): all 21 items resolve,
  // including Contact Phone, Contact Mobile, Contact Email, Contact, Property,
  // Priority and Status.
  //
  // WHY NOT THE innerText REGEX. Reading label/value pairs out of body innerText
  // depends on the two sitting adjacent in the flattened text, which is a property of
  // the LAYOUT, not of the data. The contact-name regex here required the literal
  // "Open <name> Preview"; this page renders "<name>Preview" with no "Open", so it
  // matched nothing and the contact silently came back blank. A field query does not
  // care how the page is laid out.
  //
  // Lookup fields (Contact, Property, Work Type) append the hover-preview affordance
  // to their text, hence the trailing "Preview" strip.
  function msrField(doc, label) {
    const el = doc.querySelector(
      'records-record-layout-item[field-label="' + label + '"] .test-id__field-value');
    if (!el) return '';
    return String(el.textContent || '').replace(/Preview\s*$/, '').trim();
  }

  // True once the record-layout grid exists. Salesforce renders it progressively, so
  // a capture fired before it lands reads a page that HAS no contact fields yet and
  // reports success with them blank -- which is what WO 03984243 recorded.
  function msrFieldsReady(doc) {
    return !!(doc || document).querySelector('records-record-layout-item');
  }

  function scrapeMSR(mappings, doc) {
    doc = doc || document;   // doc = a hidden iframe's document during bulk capture
    const data = { pm: 'MSR' };

    // WO # from page title
    const titleMatch = doc.title.match(/Work Order[:\s]+(\w+)/i);
    if (titleMatch) data.woId = titleMatch[1].trim();
    if (!data.woId && doc === document) data.woId = extractWONumber();

    const bodyText = doc.body ? doc.body.innerText : '';

    // Address + city — line-anchored parser (handles MSR's multi-line
    // "street \n City, State ZIP" Address block). Falls back to old heuristics.
    const ac = extractAddressCity(bodyText);
    data.address = ac.address;
    data.city = ac.city;
    // The Property lookup carries the street on its own, independent of how the page
    // text flattens. Preferred when the line-anchored parser finds nothing. City is
    // left to the parser and the slug: the Property field does not carry one.
    if (!data.address) data.address = msrField(doc, 'Property');
    if (!data.address) {
      const addrMatch = bodyText.match(/Property\s+([^\n]+(?:Ct|St|Ave|Rd|Dr|Ln|Blvd|Way|Pl|Cir|Loop)[^\n]*)/i);
      if (addrMatch) data.address = addrMatch[1].replace(/\s*(Open|Preview).*$/i,'').trim();
      if (!data.city) data.city = extractCityFromAddress(data.address || '');
    }

    // Phone. Field query first (structural, layout-independent), innerText regex only
    // as a fallback for documents that have no record-layout grid (the bulk-capture
    // iframe path, and any future page shape).
    data.phone = msrField(doc, 'Contact Phone') || msrField(doc, 'Contact Mobile') || '';
    if (!data.phone) {
      const phoneMatch = bodyText.match(/Contact (?:Phone|Mobile)\s+(\+?[\d\s\-().]{10,})/i);
      if (phoneMatch) data.phone = phoneMatch[1].trim().replace(/\s+/g,' ');
    }
    const mobile = msrField(doc, 'Contact Mobile');
    const email  = msrField(doc, 'Contact Email');

    // Contact name — Salesforce renders the contact as a lookup link; in
    // innerText it reads "Contact \n <Name> \n Open <Name> Preview". The backref
    // anchors on that repeated name; fallback = first non-noise "Open X Preview".
    // The "Open <name> Preview" shape this regex needs is NOT what WO 03984243
    // rendered ("<name>Preview", no "Open"), so the field query leads and the regex
    // is the fallback.
    let contactName = msrField(doc, 'Contact');
    if (!contactName) {
      const cn = bodyText.match(/\bContact\s*\n\s*([^\n|]+?)\s*\n\s*Open\s+\1\s+Preview/);
      if (cn) contactName = cn[1].trim();
      else {
        const all = [...bodyText.matchAll(/Open\s+([^\n|]+?)\s+Preview/g)].map(x => x[1].trim());
        contactName = all.find(n => !/approved work|help|view all|preview/i.test(n)) || '';
      }
    }
    if (contactName) {
      data.contactName = contactName;
      // Mobile and email are carried as extra contact rows only when they add
      // something: mobile is frequently the same number as the main phone.
      data.contacts = [{ name: contactName, phone: data.phone || '', email: email || '' }];
      if (mobile && mobile !== data.phone) data.contacts.push({ name: contactName + ' (mobile)', phone: mobile });
    }

    // Priority
    const priMatch = bodyText.match(/Priority\s+(Urgent|High|Medium|Normal|Low|Routine)/i);
    data.priority = mapPriority(priMatch ? priMatch[1] : '');

    // Status
    const subStatusMatch = bodyText.match(/Sub-Status\n([^\n]+)/);
    const statusMatch = bodyText.match(/\bStatus\s+(Completed|In Progress|Open|Closed|Cancelled|Pending|Assigned|Scheduled|Approved)\b/i);
    data.status = applyMappings((subStatusMatch ? subStatusMatch[1].trim() : '') || (statusMatch ? statusMatch[1].trim() : ''), mappings);

    // Type + notes — the substantial job info (resident complaint + technician
    // notes) lives in Salesforce free-text cells (span.uiOutputTextArea) in the
    // Work Order Line Items grid, NOT the useless "Description" summary. Pull
    // those directly. Piped cells = Issue ("Trade | Category | Symptom");
    // non-piped cells = resident complaint / tech completion notes.
    const otCells = Array.from(doc.querySelectorAll('span.uiOutputTextArea'))
      .map(el => el.textContent.trim())
      .filter(t => t && t.length > 1);
    const issues = otCells.filter(t => t.includes('|'));
    const freeNotes = otCells.filter(t => !t.includes('|'));

    // Trade ONLY from each issue's "Trade | Category | Symptom" first segment —
    // the precise signal. NO slug / symptom-word guessing (those over-match and
    // mis-type). Dual only when issues genuinely span both trades. Undetermined
    // -> Plumbing (company primary); never 'Other'.
    let isH = false, isP = false;
    for (const iss of issues) {
      const t = (iss.split('|')[0] || '').toLowerCase();
      if (/hvac|heat|cool|furnace|air\s*condition|thermostat/.test(t)) isH = true;
      else if (/plumb/.test(t)) isP = true;
    }
    data.type = (isP && isH) ? 'Plumbing+HVAC' : isH ? 'HVAC' : isP ? 'Plumbing' : 'Plumbing';

    // Notes: issue summary lines first, then the substantial complaint/tech notes.
    data.notes = [...issues.map(s => s.replace(/\s*\|\s*/g, ' | ').trim()), ...freeNotes]
      .filter(Boolean).join('\n').slice(0, 1000);

    // Date
    const dateMatch = bodyText.match(/(?:Work Completed|Scheduled Start Time)\s+([\d\/]+)/i);
    if (dateMatch) {
      const m = dateMatch[1].match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      data.dateCreated = m ? m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0') : new Date().toISOString().slice(0,10);
    } else {
      data.dateCreated = new Date().toISOString().slice(0,10);
    }

    // Portal URL — this document's URL (the WO detail, even inside an iframe).
    data.portalLink = doc.location.href;

    return data;
  }

  // ── MSR list (bulk) scraper ──────────────────────────────────────────────────
  // The MSR work-order LIST pages (e.g. /partner/s/work-orders-in-assessment) are
  // Salesforce Lightning datatables: one <tr> per WO with the WO# in an <a
  // href*="/workorder/{id}/{slug}">. Each row already carries Priority, Status,
  // Sub-Status, and Street, so new WOs can be bulk-imported from the list alone
  // (no per-detail visit). Detailed complaint/phone come from a later per-WO
  // capture on the detail page (scrapeMSR).
  function isMSRListPage() {
    const h = location.hostname, p = location.pathname;
    return h.includes('amherst.my.site.com') && p.includes('/partner/s/')
      && !/\/workorder\//.test(p) && !!document.querySelector('a[href*="/workorder/"]');
  }

  // Trade from the URL slug (…/workorder/{id}/{slug}). Address-based slugs
  // (e.g. "412-sarazen-dr-1-issues") have no trade word -> '' (default later).
  function typeFromMsrSlug(href) {
    const slug = ((href || '').split('/workorder/')[1] || '').split('/')[1] || '';
    const s = slug.toLowerCase();
    if (/cool|hvac|\bair\b|airflow|ventilation|thermostat|heat|furnace/.test(s)) return 'HVAC';
    if (/shower|tub|toilet|plumb|water|drain|faucet|sink|sewer|leak/.test(s))    return 'Plumbing';
    if (/dryer|washer|appliance|refriger|oven|range|dishwasher|fridge/.test(s))  return 'Appliance';
    return '';
  }

  function scrapeMSRList(mappings, doc) {
    doc = doc || document;   // doc = the list loaded in a hidden iframe during bulk capture
    // Column map from the header row (aligned 1:1 with body row cells). Falls
    // back to the known assessment-list positions if no header is found.
    let headCells = [];
    const headRow = doc.querySelector('thead tr');
    if (headRow) headCells = Array.from(headRow.children).map(c => (c.innerText || '').trim().toLowerCase());
    const FALL = { 'work order number': 1, priority: 2, status: 3, 'sub-status': 4, street: 6 };
    const col = (name) => {
      const exact = headCells.indexOf(name);
      if (exact >= 0) return exact;
      const part = headCells.findIndex(t => t.includes(name));
      return part >= 0 ? part : (name in FALL ? FALL[name] : -1);
    };

    const seen = new Set();
    const orders = [];
    for (const a of Array.from(doc.querySelectorAll('a[href*="/workorder/"]'))) {
      const row = a.closest('tr'); if (!row) continue;
      const woId = (a.textContent || a.getAttribute('title') || '').trim();
      if (!woId || seen.has(woId)) continue;
      seen.add(woId);
      const cells = Array.from(row.children);
      const cell = (i) => (i >= 0 && cells[i]) ? cells[i].innerText.trim() : '';
      const rawStatus = cell(col('sub-status')) || cell(col('status'));
      orders.push({
        pm: 'MSR',
        woId,
        portalLink: a.href,
        address: cell(col('street')),
        city: '',
        type: typeFromMsrSlug(a.href) || '',
        priority: mapPriority(cell(col('priority'))),
        status: applyMappings(rawStatus, mappings),
      });
    }
    return orders;
  }

  // ── AMH scraper ────────────────────────────────────────────────────────────
  function scrapeAMH(mappings) {
    const data = { pm: 'AMH' };

    // WO number
    data.woId = extractWONumber();

    // Address + city — line-anchored parser first, then old fallbacks.
    const bodyText = document.body.innerText;
    const ac = extractAddressCity(bodyText);
    data.address = ac.address;
    data.city = ac.city;
    if (!data.address) {
      const addrMatch = bodyText.match(/(?:🏠|🏡|Address)[:\s]*\n?\s*([^\n]+(?:Way|St|Ave|Rd|Dr|Ln|Blvd|Ct|Pl|Cir|Loop|Trail|Pkwy)[^\n]*)/i);
      if (addrMatch) data.address = addrMatch[1].trim();
      if (!data.address) data.address = findNear('Address');
      if (!data.city) data.city = extractCityFromAddress(data.address || '');
    }

    // Date
    data.dateCreated = toISODate(findNear('Date Created'));

    // Priority
    data.priority = mapPriority(findNear('Priority'));

    // Status — use mappings
    const sub = findNear('Sub-Status');
    const sys = findNear('System Status');
    data.status = applyMappings(sub || sys, mappings);

    // Phone
    const tel = document.querySelector('a[href^="tel:"]');
    if (tel) data.phone = tel.textContent.replace(/\(W\)|\(M\)|\(H\)/gi,'').trim();
    if (!data.phone) {
      const pm = bodyText.match(/\b(\d{3}[\-.\s]\d{3}[\-.\s]\d{4})\b/);
      if (pm) data.phone = pm[1];
    }

    // Property ID (AMH only — drives the col J Notes write in sync_to_lookup.py)
    data.propertyId = extractPropertyId();

    // Portal URL — current tab URL, used by tracker's portalLink field
    data.portalLink = window.location.href;

    // Bid line items — captured for auto-population of Invoice Import sheet
    data.bidItems = extractAMHBidItems();

    // Type — read from Condition Issues category line on the WO page.
    // AMH now sends HVAC calls as well as Plumbing/Electrical/Appliance; the
    // category keyword (e.g. "MINOR PLUMBING", "HVAC", "ELECTRICAL") is the
    // most reliable trade signal on the General/Condition Issues view.
    const CAT_RE = /\b(PLUMBING|HVAC|HEATING|COOLING|AIR CONDITION|ELECTRICAL|APPLIANCE)\b/i;
    let trade = '';
    for (const l of bodyText.split('\n').map(s => s.trim()).filter(Boolean)) {
      if (l.length < 40 && CAT_RE.test(l)) { trade = l.toLowerCase(); break; }
    }
    {
      const isH = /hvac|heat|cool|furnace|air\s*condition|thermostat/.test(trade);
      const isP = /plumb/.test(trade);
      data.type = (isP && isH) ? 'Plumbing+HVAC' : isH ? 'HVAC' : isP ? 'Plumbing' : 'Plumbing';
    }

    data.notes = '';
    return data;
  }

  // ── AMH bid item extraction ────────────────────────────────────────────────
  // Tries multiple DOM strategies; returns [{name, price, qty}] or [].
  function extractAMHBidItems() {
    const items = [];
    const bodyText = document.body ? document.body.innerText : '';

    // Strategy 1: table whose headers contain description/scope + price/amount
    const tables = document.querySelectorAll('table');
    for (const tbl of tables) {
      const headerCells = Array.from(tbl.querySelectorAll('th, thead td'));
      const headerText  = headerCells.map(h => h.textContent.toLowerCase()).join(' ');
      const hasDesc  = /description|scope|item|service/.test(headerText);
      const hasPrice = /price|amount|cost|total/.test(headerText);
      if (!hasDesc || !hasPrice) continue;

      const bodyRows = tbl.querySelectorAll('tbody tr');
      for (const row of bodyRows) {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 2) continue;
        const name = cells[0].textContent.trim();
        if (!name || /description|scope|item/i.test(name)) continue;
        let price = 0, qty = 1;
        for (const cell of cells.slice(1)) {
          const t = cell.textContent.replace(/,/g, '');
          const m = t.match(/\$?\s*([\d]+(?:\.\d{1,2})?)/);
          if (m && !price) price = parseFloat(m[1]);
        }
        // look for qty column
        const qtyCell = cells.find(c => /qty|quantity|count/i.test(c.closest('table')
          ? (headerCells[cells.indexOf(c)] || { textContent: '' }).textContent : ''));
        if (qtyCell) { const q = parseInt(qtyCell.textContent); if (q > 0) qty = q; }
        if (name && price > 0) items.push({ name, price, qty });
      }
      if (items.length) return items;
    }

    // Strategy 2: labelled sections — look for a heading that says Bid/Scope/Assignment
    // then collect subsequent sibling rows / list items
    const headings = document.querySelectorAll('h1,h2,h3,h4,h5,[class*="section"],[class*="title"],[class*="heading"]');
    for (const h of headings) {
      if (!/bid|scope|assignment|line item|work item/i.test(h.textContent)) continue;
      let sibling = h.nextElementSibling;
      let found = 0;
      while (sibling && found < 30) {
        const rows = sibling.querySelectorAll('li, tr, [class*="row"], [class*="item"]');
        for (const r of rows) {
          const text = r.textContent.trim();
          const priceM = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
          if (!priceM) continue;
          const price = parseFloat(priceM[1].replace(/,/g, ''));
          const name  = text.replace(/\$[\d,.]+/g, '').trim().replace(/\s+/g, ' ');
          if (name && price > 0) { items.push({ name, price, qty: 1 }); found++; }
        }
        if (found) break;
        sibling = sibling.nextElementSibling;
      }
      if (items.length) return items;
    }

    // Strategy 3: bodyText scan for "$NNN description" patterns
    const lineRe = /\$\s*([\d,]+(?:\.\d{1,2})?)\s*[-–]\s*([^\n$]{3,80})/g;
    let m;
    while ((m = lineRe.exec(bodyText)) !== null) {
      const price = parseFloat(m[1].replace(/,/g, ''));
      const name  = m[2].trim();
      if (price > 0 && name) items.push({ name, price, qty: 1 });
    }

    return items;
  }

  // ── Floating capture button ────────────────────────────────────────────────
  function removeBtn() { const b = document.getElementById('wo-amh-btn'); if (b) b.remove(); }

  function injectButton() {
    if (document.getElementById('wo-amh-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'wo-amh-btn';
    btn.innerHTML = '📋 Capture WO';
    btn.style.cssText = 'position:fixed;top:14px;right:14px;z-index:2147483646;background:#10b981;color:#fff;border:none;border-radius:7px;padding:9px 16px;font-family:Consolas,monospace;font-size:13px;font-weight:bold;cursor:grab;box-shadow:0 4px 14px rgba(0,0,0,0.3);transition:background 0.15s;line-height:1;touch-action:none';
    btn.onmouseover = () => { btn.style.background = '#0d9e6e'; };
    btn.onmouseout  = () => { btn.style.background = '#10b981'; };

    // Restore a previously dragged position (persisted across pages/sites).
    chrome.storage.local.get(['wo_btn_pos'], (r) => {
      const p = r && r.wo_btn_pos;
      if (p && typeof p.left === 'number' && typeof p.top === 'number') {
        btn.style.left = p.left + 'px'; btn.style.top = p.top + 'px'; btn.style.right = 'auto';
      }
    });

    // Drag to reposition; a real drag suppresses the click-to-capture.
    (function makeDraggable(el) {
      let sx = 0, sy = 0, ox = 0, oy = 0, down = false, moved = false;
      el.addEventListener('pointerdown', (e) => {
        down = true; moved = false; sx = e.clientX; sy = e.clientY;
        const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
        el.style.cursor = 'grabbing';
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      });
      el.addEventListener('pointermove', (e) => {
        if (!down) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        if (!moved) return;
        const nl = Math.max(0, Math.min(window.innerWidth  - el.offsetWidth,  ox + dx));
        const nt = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, oy + dy));
        el.style.left = nl + 'px'; el.style.top = nt + 'px'; el.style.right = 'auto';
      });
      el.addEventListener('pointerup', () => {
        if (!down) return;
        down = false; el.style.cursor = 'grab';
        if (moved) {
          el.__dragged = true; // consumed by the onclick guard below
          const r = el.getBoundingClientRect();
          chrome.storage.local.set({ wo_btn_pos: { left: Math.round(r.left), top: Math.round(r.top) } });
        }
      });
    })(btn);

    btn.onclick = () => {
      if (btn.__dragged) { btn.__dragged = false; return; } // ignore click that ended a drag
      btn.innerHTML = '⏳ Reading…';
      btn.disabled = true;
      // Fetch current mappings then scrape using appropriate portal scraper
      // Read mappings and saved list directly from storage — no service worker needed
      // WAIT FOR THE FIELDS. Salesforce renders the record-layout grid after the rest
      // of the page, so a capture fired early reads a document with no contact fields
      // and saves them blank while reporting success. That is what WO 03984243
      // recorded: phone, contact, city and propertyId all empty, while the same page
      // dumped minutes later held every one of them.
      //
      // Bounded, and it never blocks the capture: on timeout it scrapes anyway (the
      // regex fallbacks still apply) rather than refusing to capture at all.
      whenMsrFieldsReady(() => {
      chrome.storage.local.get(['wo_mappings', 'wo_saved_list'], (res) => {
        const mappings = res.wo_mappings || [];
        const list     = res.wo_saved_list || [];
        const data     = isMSRPage() ? scrapeMSR(mappings) : scrapeAMH(mappings);
        // Assign an ID
        const nums = list.map(o => parseInt((o.id||'WO-000').replace('WO-',''))||0);
        data.id = 'WO-' + String(Math.max(0,...nums)+1).padStart(3,'0');
        data._savedAt = new Date().toISOString();
        list.push(data);
        chrome.storage.local.set({ wo_saved_list: list }, () => {
          btn.innerHTML = '✓ Captured';
          btn.style.background = '#1a73e8';
          setTimeout(() => { btn.innerHTML = '📋 Capture WO'; btn.style.background = '#10b981'; btn.disabled = false; }, 2500);
          showToast('✓ Work Order Captured!', '#10b981', [
            data.woId       ? 'WO #: '     + data.woId       : null,
            data.propertyId ? 'Prop ID: '  + data.propertyId : null,
            data.city       ? 'City: '     + data.city       : null,
            data.address    ? data.address                    : null,
            data.priority   ? 'Priority: ' + data.priority   : null,
            data.phone      ? 'Phone: '    + data.phone      : null,
            'Click "Send All to Tracker" in the extension'
          ].filter(Boolean));
        });
      });
      });
    };
    document.body.appendChild(btn);
  }

  // Calls `run` as soon as the MSR record-layout grid exists, or after the deadline
  // regardless. MutationObserver rather than a poll loop: the grid can appear between
  // polls and a capture that reads one tick too early is the bug being fixed.
  // Non-MSR pages (AMH) run immediately; this gate is about MSR's render order only.
  function whenMsrFieldsReady(run, timeoutMs) {
    if (!isMSRPage() || msrFieldsReady(document)) { run(); return; }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try { obs.disconnect(); } catch (_) {}
      clearTimeout(timer);
      run();
    };
    const obs = new MutationObserver(() => { if (msrFieldsReady(document)) finish(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    const timer = setTimeout(finish, timeoutMs || 8000);
  }

  // ── DOM dump for scraper rework ──────────────────────────────────────────────
  // Downloads a JSON snapshot of the current WO page so selectors can be built
  // against real structure. Triggered from the extension popup (Send tab) rather
  // than an on-page button, to keep the portal screen uncluttered.
  function doDumpDom() {
    const portal = isMSRPage() ? 'MSR' : (isAMHPage() ? 'AMH' : 'UNKNOWN');
    if (portal === 'UNKNOWN') {
      showToast('Not a WO page', '#ef4444', ['Open an AMH or MSR work order first']);
      return { ok: false, error: 'Not on an AMH/MSR work order page.' };
    }
    const snap = {
      portal,
      url: window.location.href,
      title: document.title,
      capturedAt: new Date().toISOString(),
      innerText: document.body ? document.body.innerText : '',
      html: document.documentElement.outerHTML,
    };
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wo-dump-' + snap.portal + '-' + Date.now() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    showToast('✓ DOM dumped', '#6b4fd8', ['Saved to Downloads', snap.portal + ' · ' + (document.title || '').slice(0, 40)]);
    return { ok: true, portal };
  }

  // ── Right-click field toast ────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'fieldCaptured') {
      const labels = { address:'Address', tech:'Tech', pm:'PM', phone:'Phone', notes:'Notes', type:'Type', status:'Status', woId:'WO #' };
      showToast('✓ Captured', '#10b981', [`${labels[msg.field]||msg.field}: ${msg.value.slice(0,60)}`]);
    }
    if (msg.action === 'dumpDom') {
      const r = doDumpDom();
      sendResponse(r);
    }
  });

  // ── Headless bulk MSR capture (hidden same-origin iframes) ───────────────────
  // MSR (amherst.my.site.com) allows self-framing, so this content script — when
  // it runs on any MSR tab — loads the WO list and each WO detail in OFF-SCREEN
  // iframes, scrapes their rendered documents, and never opens a window or tab.
  const MSR_ASSESSMENT_URL = 'https://amherst.my.site.com/partner/s/work-orders-in-assessment';

  // Detail wins; list stub fills gaps. Mirrors the tracker merge expectations.
  function mergeMsr(stub, detail) {
    const pick = (a, b) => (a && String(a).trim()) ? a : b;
    return {
      pm: 'MSR',
      woId:        pick(detail.woId, stub.woId),
      portalLink:  pick(detail.portalLink, stub.portalLink),
      address:     pick(detail.address, stub.address),
      city:        detail.city || '',
      phone:       detail.phone || '',
      type:        (detail.type && detail.type !== 'Other') ? detail.type : (stub.type || 'Plumbing'),
      priority:    pick(detail.priority, stub.priority),
      status:      pick(detail.status, stub.status),
      notes:       detail.notes || '',
      contactName: detail.contactName || '',
      contacts:    Array.isArray(detail.contacts) ? detail.contacts : [],
      dateCreated: detail.dateCreated || '',
    };
  }

  // Load a same-origin URL in a hidden iframe, wait for its Aura body to render,
  // resolve with its document (or null on failure/timeout). Iframe is removed.
  // Force Salesforce's lazy/virtual content to render: scroll the window AND any
  // inner scroll containers to the bottom (off-screen cells aren't in the DOM
  // until scrolled into view — the "scrollbar element" misses), then back to top.
  function scrollRender(win, doc) {
    try {
      const containers = [doc.scrollingElement || doc.documentElement,
        ...doc.querySelectorAll('.slds-scrollable, .slds-scrollable_y, .slds-scrollable_x, [class*="scroller"], [class*="scrollable"]')];
      containers.forEach(el => { try { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; } catch (_) {} });
      win.scrollTo(0, (doc.body && doc.body.scrollHeight) || 99999);
      setTimeout(() => { try { win.scrollTo(0, 0); containers.forEach(el => { try { el.scrollTop = 0; } catch (_) {} }); } catch (_) {} }, 700);
    } catch (_) {}
  }

  function loadInIframe(url) {
    return new Promise((resolve) => {
      const f = document.createElement('iframe');
      // Tall viewport so most content is "in view" and rendered without scrolling.
      f.style.cssText = 'position:fixed;left:-99999px;top:0;width:1280px;height:3000px;opacity:0;border:0';
      let settled = false;
      const finish = (doc) => { if (settled) return; settled = true; try { f.remove(); } catch (_) {} resolve(doc); };
      f.onload = () => {
        let n = 0;
        (function poll() {
          let doc = null;
          try { doc = f.contentDocument; } catch (e) { return finish(null); } // cross-origin (shouldn't happen)
          if (!doc) return finish(null);
          const txt = doc.body ? doc.body.innerText : '';
          const ready = doc.querySelectorAll('a[href*="/workorder/"]').length > 0   // list
            || doc.querySelectorAll('span.uiOutputTextArea').length > 0             // detail
            || /\bAddress\b/i.test(txt);
          // Once the core body is in: scroll to materialize lazy content, wait for
          // late lookups (Contact link) + the scrolled cells to render, then scrape.
          if (ready) { scrollRender(f.contentWindow, doc); setTimeout(() => finish(doc), 1600); return; }
          if (n++ >= 50) return finish(doc);
          setTimeout(poll, 500);
        })();
      };
      setTimeout(() => finish(null), 35000); // hard timeout
      f.src = url;
      document.body.appendChild(f);
    });
  }

  // Scan the CURRENT MSR list page (the live DOM the user is on — no iframe) for WO
  // numbers + street address. Returns [{ num, url, address }]. Used by "Find new MSR
  // WOs": the tracker diffs these against its orders and lists the ones not yet added.
  //
  // DETECTION MUST NOT DEPEND ON TABLE STRUCTURE. A prior version wrapped scrapeMSRList,
  // which drops any /workorder/ anchor not inside a <tr> (it needs the row cells for
  // status/priority). That regressed the CORE job: a WO whose anchor is not in a
  // datatable row stopped being detected (missed 03907321). So detection is the ORIGINAL
  // anchor scan (num+url, no row required); the street address is layered on best-effort
  // ONLY when the anchor sits in a row. Address never gates a WO out of the result.
  function scanMsrList() {
    // Street column index, resolved once from the header (fallback = the assessment-list
    // position 6). Mirrors scrapeMSRList's col('street'); kept separate BECAUSE that
    // function gates on <tr> and must not be the detection path.
    let headCells = [];
    const headRow = document.querySelector('thead tr');
    if (headRow) headCells = Array.from(headRow.children).map(c => (c.innerText || '').trim().toLowerCase());
    let streetIdx = headCells.indexOf('street');
    if (streetIdx < 0) streetIdx = headCells.findIndex(t => t.includes('street'));
    if (streetIdx < 0) streetIdx = 6;

    const seen = new Set();
    const items = [];
    for (const a of Array.from(document.querySelectorAll('a[href*="/workorder/"]'))) {
      const num = (a.textContent || a.getAttribute('title') || '').trim();
      if (!num || seen.has(num)) continue;
      seen.add(num);
      let address = '';
      const row = a.closest('tr');
      if (row) {
        const cells = Array.from(row.children);
        if (streetIdx >= 0 && cells[streetIdx]) address = cells[streetIdx].innerText.trim();
      }
      items.push({ num, url: a.href, address });
    }
    return items;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== 'scanMsrList') return;
    if (!location.hostname.includes('amherst.my.site.com')) {
      sendResponse({ ok: false, error: 'not on an MSR page' });
      return;
    }
    sendResponse({ ok: true, items: scanMsrList() });
  });

  // Full headless capture: list iframe -> row stubs -> per-WO detail iframes.
  async function captureMsrViaIframes(mappings) {
    const listDoc = await loadInIframe(MSR_ASSESSMENT_URL);
    const stubs = listDoc ? scrapeMSRList(mappings, listDoc) : [];
    const orders = [];
    // Progress events drive the app's capture banner counter (done / total).
    chrome.runtime.sendMessage({ action: 'msrProgress', done: 0, total: stubs.length });
    for (let i = 0; i < stubs.length; i++) {
      let detail = {};
      const doc = await loadInIframe(stubs[i].portalLink);
      if (doc) { try { detail = scrapeMSR(mappings, doc); } catch (_) {} }
      orders.push(mergeMsr(stubs[i], detail));
      chrome.runtime.sendMessage({ action: 'msrProgress', done: i + 1, total: stubs.length });
    }
    return orders;
  }

  // Single-WO capture: load just this WO's detail page in a hidden iframe.
  async function captureMsrOneViaIframe(mappings, one) {
    let detail = {};
    const doc = await loadInIframe(one.url);
    if (doc) { try { detail = scrapeMSR(mappings, doc); } catch (_) {} }
    return [mergeMsr({ woId: one.woId, portalLink: one.url }, detail)];
  }

  // Triggered by the background worker (from the app button, popup, or per-WO
  // capture). Acks immediately, then runs the headless capture and posts the
  // result back via a fresh message (so the service worker can sleep meanwhile
  // and wake on result). msg.one = { url, woId } -> single WO; absent -> full list.
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action !== 'startMsrCapture') return;
    if (!location.hostname.includes('amherst.my.site.com')) {
      sendResponse({ ok: false, error: 'not on an MSR tab' });
      return; // sync
    }
    sendResponse({ ok: true, started: true });
    chrome.storage.local.get(['wo_mappings'], (res) => {
      const mappings = res.wo_mappings || [];
      const job = (msg.one && msg.one.url)
        ? captureMsrOneViaIframe(mappings, msg.one)
        : captureMsrViaIframes(mappings);
      job
        .then(orders => chrome.runtime.sendMessage({ action: 'msrCaptureResult', orders }))
        .catch(e => chrome.runtime.sendMessage({ action: 'msrCaptureResult', orders: [], error: e.message }));
    });
    // sendResponse already called synchronously; no async response needed.
  });

  // ── Init + SPA watch ──────────────────────────────────────────────────────
  function tryInject() {
    if (isAMHPage() || isMSRPage()) { injectButton(); }
    else { removeBtn(); }
  }
  tryInject(); setTimeout(tryInject, 1000); setTimeout(tryInject, 3000);

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href; removeBtn(); setTimeout(tryInject, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

  // Test hook only: lets a node+jsdom harness drive the REAL extraction against a
  // captured DOM dump, instead of hand-copying logic into a test (which drifts).
  // Guarded on `module` so it is inert in the browser (extension) context.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { scrapeMSR, scrapeMSRList, scanMsrList, extractAddressCity, typeFromMsrSlug };
  }

})();
