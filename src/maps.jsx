// Maps module, carved out of app.jsx. Leaflet + OpenStreetMap. Shared WO
// helpers import from app.jsx (live ES bindings; the app.jsx <-> maps.jsx
// cycle is safe -- nothing here runs at module-eval time). Leaflet is a CDN
// global (window.L), used as a bare global inside the component.
import React from 'react';
import { DEFAULT_MAP_MARKER_COLORS, TYPE_COLORS, DEFAULT_MORE_INFO_COLOR, hexToRgba, normalizeHex, LOCKED_STATUSES } from './constants.js';
import { formatPhone, openMapsRoute } from './utils.js';
import {
  splitAddress, isOverdueSched, fmtSchedule, typeLetter,
  itinTodayStr, itinShiftDay, useCollapsedSection, HeaderChips, Modal, toDetailData,
} from './app.jsx';
import { NoteCard } from './detail.jsx';

// Build the teardrop divIcon for a WO marker. Extracted from the MapsModule
// render loop so the command-center MapInset draws an identical marker (single
// source of marker appearance). Color scheme (swapped): the status pill color
// FILLS the droplet body; the job-type color is the BORDER, drawn bold so
// categories stay easy to tell apart against any fill. suspect location
// overrides the fill as a warning. Precedence for the fill: onsite-tag (tech
// live on site) > overdue > status color > legacy scheduled-gold / white.
export function woMarkerIcon(L, o, g, cfg) {
  const { statusColors, statusTags, typeColors, markerColors, overdueCfg } = cfg;
  const suspect = !!(g && g.suspect);
  const isScheduled = !!(o.schedule && o.schedule.date);
  const isOverdue = isScheduled && isOverdueSched(o.schedule.date, o.schedule.start);
  const tag = statusTags[o.status];
  const statusPill = statusColors && statusColors[o.status];
  const statusComposite =
    tag === 'onsite'   ? (statusPill || '#3b82f6')
    : isOverdue        ? overdueCfg.borderColor
    : (statusPill || (isScheduled ? '#facc15' : '#fff'));
  const fillColor = suspect ? markerColors.suspect : statusComposite;
  const strokeColor = typeColors[o.type] || markerColors.fallback;
  const emphasize = tag === 'onsite' || isScheduled;
  const strokeWidth = emphasize ? 4 : 3;
  const centerR     = emphasize ? 5 : 4;
  const centerFill  = strokeColor;
  return L.divIcon({
    className: '',
    // viewBox padded 2px each side so the stroke is not clipped; anchor at the tip.
    html: '<svg viewBox="-2 -2 28 40" width="24" height="34" style="display:block;overflow:visible">'
      + '<path d="M12 0C5.4 0 0 5.4 0 12c0 8.5 12 24 12 24s12-15.5 12-24c0-6.6-5.4-12-12-12z" '
      + 'fill="' + fillColor + '" stroke="' + strokeColor + '" stroke-width="' + strokeWidth + '"/>'
      + '<circle cx="12" cy="12" r="' + centerR + '" fill="' + centerFill + '"/>'
      + '</svg>',
    iconSize: [24, 34], iconAnchor: [12, 32], popupAnchor: [0, -30],
  });
}

// Single-marker mini map for the command-center right rail. ONE Leaflet instance,
// mounted only while the overlay is open and torn down on WO change (effect keyed
// on wo.id), so there is never more than one live inset map. High zoom on the
// WO's geocoded point; reuses woMarkerIcon so the marker matches the full Maps
// module. No cached location -> placeholder + jump to the full Maps module (where
// the geocode worker runs).
export function MapInset({ wo, geocache, statusColors, statusTags, mapMarkerColors, mapTypeColors, overdueCfg, onOpenMaps }) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const g = wo && geocache && geocache[wo.id];
  const hasLoc = !!(g && !g.error && g.lat != null);
  React.useEffect(() => {
    if (!hasLoc || !window.L || !containerRef.current || mapRef.current) return;
    const L = window.L;
    const markerColors = { ...DEFAULT_MAP_MARKER_COLORS, ...(mapMarkerColors || {}) };
    const typeColors = { HVAC: TYPE_COLORS.H, Plumbing: TYPE_COLORS.P, Electrical: TYPE_COLORS.E, ...(mapTypeColors || {}) };
    const m = L.map(containerRef.current, { zoomControl: true, boxZoom: false, attributionControl: false })
      .setView([g.lat, g.lon], 11); // RDU-area zoom: see the location at a glance
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(m);
    L.marker([g.lat, g.lon], { icon: woMarkerIcon(L, wo, g, { statusColors, statusTags, typeColors, markerColors, overdueCfg }) }).addTo(m);
    mapRef.current = m;
    // The overlay sizes its rail after mount; invalidate once so tiles fill in.
    const t = setTimeout(() => { try { m.invalidateSize(); } catch (_) {} }, 60);
    return () => { clearTimeout(t); m.remove(); mapRef.current = null; };
  }, [hasLoc, wo && wo.id]);
  const labelStyle = { fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={labelStyle}>Location</span>
        {onOpenMaps && wo && (
          <button onClick={() => onOpenMaps(wo.id)} style={{
            height: 22, padding: '0 8px', border: '1px solid var(--border-2)', borderRadius: 6,
            background: 'var(--bg-surface-2)', color: 'var(--accent)', fontFamily: 'inherit',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>Open in Maps →</button>
        )}
      </div>
      {hasLoc
        ? <div ref={containerRef} style={{ height: 220, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-1)' }} />
        : <div style={{ height: 220, borderRadius: 8, border: '1px dashed var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 12, color: 'var(--text-3)', fontSize: 12 }}>
            No mapped location yet. Open in Maps to geocode this address.
          </div>}
    </div>
  );
}

// Read-only notes view for the Maps right-click menu. Reuses toDetailData
// (same notes shape as the detail pane) + NoteCard with no handlers (-> no
// edit/pin/delete affordances). Shows the "More Information" misc note (o.notes)
// plus every note card, so a tech can read a WO without leaving the map.
function NotesViewModal({ order, onClose }) {
  if (!order) return null;
  const d = toDetailData(order);
  const accent = DEFAULT_MORE_INFO_COLOR;
  const misc = (d.raw && d.raw.notes) || '';
  return (
    <Modal open onClose={onClose} title={order.id + ' — Notes'} width={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{
          border: '1px solid var(--border-2)', borderLeft: '3px solid ' + accent,
          background: 'color-mix(in srgb, ' + accent + ' 14%, transparent)',
          borderRadius: 8, padding: '10px 14px',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--text-1)', fontSize: 13, marginBottom: misc ? 6 : 0 }}>More Information</div>
          {misc
            ? <div style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--text-1)', whiteSpace: 'pre-wrap' }}>{misc}</div>
            : <div style={{ fontSize: 14, color: 'var(--text-3)', fontStyle: 'italic' }}>empty</div>}
        </div>
        {d.notes.length === 0
          ? <div style={{ color: 'var(--text-3)', fontSize: 13, fontStyle: 'italic' }}>No notes.</div>
          : d.notes.map(n => <NoteCard key={n.id} {...n} />)}
      </div>
    </Modal>
  );
}

export function MapsModule({ activeOrders, geocache, defaultView, selected, setSelected, routeStops, setRouteStops, techs, onSendRoute, progress, onOpenWO, onWoAction, mapsHomeState, mapsHomeAddress, mapsHomeCity, locationIqKey, mapMarkerColors, mapTypeColors, overdueCfg, overdueTick, statusTags, statusColors, techColors, statuses, hiddenTypes, setHiddenTypes }) {
  const [query, setQuery] = React.useState('');
  // WO id whose read-only notes modal is open, or null.
  const [notesWO, setNotesWO] = React.useState(null);
  // Slice 5 (#10): route polylines track one day at a time. Default today.
  const [routeDay, setRouteDay] = React.useState(itinTodayStr());
  // change10 queue item #4: multi-stop driving directions. Ordered list of WO
  // ids the user has staged for a route. "Open in Google Maps" passes them as
  // waypoints to /maps/dir; origin defaults to the home address from settings.
  // State is session-local (does not persist) so it never blocks normal use.
  // routeStops/setRouteStops are now App-owned props (shared with Itinerary).
  // Route panel collapse: always visible at the panel bottom, collapsed by
  // default. Reuses the sidebar-section collapse store.
  const [routeOpen, toggleRoutePanel] = useCollapsedSection('maps-route', false);
  // Target tech for "Send to Itinerary" (commits the staged route to a day).
  const [sendTech, setSendTech] = React.useState('');
  const inRoute = React.useCallback((id) => routeStops.includes(id), [routeStops]);
  const toggleRoute = React.useCallback((id) => {
    setRouteStops(cur => cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]);
  }, []);
  const moveStop = React.useCallback((id, dir) => {
    setRouteStops(cur => {
      const i = cur.indexOf(id);
      if (i < 0) return cur;
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }, []);
  const clearRoute = React.useCallback(() => setRouteStops([]), []);
  const launchRoute = React.useCallback(() => {
    const byId = new Map((activeOrders || []).map(o => [o.id, o]));
    const stops = routeStops
      .map(id => byId.get(id))
      .filter(Boolean)
      .map(o => {
        const { addr, city } = splitAddress(o);
        if (!addr) return '';
        return addr + (city ? ', ' + city : '');
      })
      .filter(Boolean);
    if (!stops.length) return;
    const homeAddr = (mapsHomeAddress || '').trim();
    const homeFull = homeAddr ? (homeAddr + (mapsHomeCity ? ', ' + mapsHomeCity : '')) : '';
    openMapsRoute(stops, homeFull);
  }, [routeStops, activeOrders, mapsHomeAddress, mapsHomeCity]);
  // Marker color settings with defaults baked in.
  const markerColors = React.useMemo(() => ({
    ...DEFAULT_MAP_MARKER_COLORS,
    ...(mapMarkerColors || {}),
  }), [mapMarkerColors]);
  const typeColors = React.useMemo(() => {
    // Hardcoded defaults map by type name (full); merge user overrides.
    const def = {
      HVAC:       TYPE_COLORS.H,
      Plumbing:   TYPE_COLORS.P,
      Electrical: TYPE_COLORS.E,
    };
    return { ...def, ...(mapTypeColors || {}) };
  }, [mapTypeColors]);
  // Maps-specific right-click menu. Small set of actions (no full WO menu).
  const [ctxMenu, setCtxMenu] = React.useState(null); // { woId, x, y }
  // Status submenu open state for the marker/sidebar right-click menu (N1).
  const [ctxStatus, setCtxStatus] = React.useState(false);
  // Job-type visibility filter (lifted to App so it persists across module
  // switches). Key by typeLetter ('P'/'H'/'PH'); true = hidden. Filters both the
  // sidebar list and the markers (markers iterate `list`).
  const closeCtxMenu = React.useCallback(() => { setCtxMenu(null); setCtxStatus(false); }, []);
  React.useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e) => { if (e.key === 'Escape') closeCtxMenu(); };
    const onClick = () => closeCtxMenu();
    const onCtx = () => closeCtxMenu();
    const t = setTimeout(() => {
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      document.addEventListener('contextmenu', onCtx, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('contextmenu', onCtx, true);
    };
  }, [ctxMenu, closeCtxMenu]);
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const markersLayerRef = React.useRef(null);
  const markerByIdRef = React.useRef({});
  // One-time auto-fit so the map does not keep jumping while the App-level
  // worker streams geocode results in. After the first non-empty fit, user
  // controls pan/zoom; subsequent marker draws preserve it.
  const fittedRef = React.useRef(false);
  // Tracks the WO id whose popup we have auto-opened. Combined with the
  // pre-clearLayers isPopupOpen capture below, this lets the popup:
  //   - auto-open on first marker arrival for a newly-selected WO,
  //   - persist if the user kept it open through a marker re-render,
  //   - STAY CLOSED if the user manually dismissed it (until a different
  //     WO is selected).
  const popupShownForRef = React.useRef(null);
  // Reset the auto-open guard when the user picks a different WO so the
  // new selection's popup opens on its next render.
  React.useEffect(() => { popupShownForRef.current = null; }, [selected]);
  const list = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return (activeOrders || [])
      .filter(o => !o.deleted)
      .filter(o => !hiddenTypes[typeLetter(o.type)])
      .filter(o => {
        if (!q) return true;
        const { addr, city } = splitAddress(o);
        return String(o.id).toLowerCase().includes(q)
          || (addr || '').toLowerCase().includes(q)
          || (city || '').toLowerCase().includes(q);
      })
      .sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  }, [activeOrders, query, hiddenTypes]);

  // Init Leaflet map once on mount; tear down on unmount.
  // Initial center/zoom: settings.mapsDefaultView if set, else US-wide fallback.
  React.useEffect(() => {
    if (!window.L || !containerRef.current || mapRef.current) return;
    const L = window.L;
    const v = defaultView;
    const center = (v && isFinite(v.lat) && isFinite(v.lon)) ? [v.lat, v.lon] : [39.8283, -98.5795];
    const zoom   = (v && isFinite(v.zoom)) ? v.zoom : 4;
    // boxZoom off: Shift+drag/click is reserved for route chaining (Shift+click
    // markers), so don't let Leaflet's shift box-zoom interfere on empty map.
    const m = L.map(containerRef.current, { zoomControl: true, boxZoom: false }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(m);
    markersLayerRef.current = L.layerGroup().addTo(m);
    mapRef.current = m;
    return () => {
      m.remove();
      mapRef.current = null;
      markersLayerRef.current = null;
      markerByIdRef.current = {};
    };
  }, []);

  // Render markers for every WO that has a cached lat/lon. Re-runs when
  // the filtered list or geocache changes. Auto-fits bounds when nothing
  // is selected so all markers are visible.
  React.useEffect(() => {
    if (!mapRef.current || !markersLayerRef.current || !window.L) return;
    const L = window.L;
    // Capture whether the selected WO's popup was open BEFORE we tear
    // down the marker layer, so we can restore it after re-creating
    // markers (instead of having geocode-driven re-renders dismiss the
    // user's popup or, worse, reopen one they just closed).
    const prevSelMarker = selected ? markerByIdRef.current[selected] : null;
    const selWasOpen = !!(prevSelMarker && typeof prevSelMarker.isPopupOpen === 'function' && prevSelMarker.isPopupOpen());
    markersLayerRef.current.clearLayers();
    markerByIdRef.current = {};
    const points = [];
    for (const o of list) {
      const g = geocache && geocache[o.id];
      if (!g || g.error || g.lat == null) continue;
      // Slice 4 (#9): `offmap`-tagged status (field work done, bid entry only)
      // drops the marker. All other active WOs stay, incl. unscheduled.
      if (statusTags[o.status] === 'offmap') continue;
      const { addr, city } = splitAddress(o);
      const isSel = o.id === selected;
      const suspect = !!g.suspect;
      const reasons = Array.isArray(g.reasons) ? g.reasons.join('; ') : '';
      // Returned address (from geocoder) shown when it differs from the
      // WO's stored city. Helps catch scraper bugs that mislabel cities.
      const ncity = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const retCity = String(g.returnedCity || '').trim();
      const showResolved = retCity && city && ncity(retCity) !== ncity(city)
        && !ncity(retCity).includes(ncity(city))
        && !ncity(city).includes(ncity(retCity));
      const resolvedHtml = showResolved
        ? '<div style="margin-top:4px;font-size:11px;color:#9333ea">Resolved as: ' + retCity + '</div>'
        : '';
      const warnHtml = suspect
        ? '<div style="margin-top:4px;padding:4px 6px;background:#a14400;color:#fff;border-radius:3px;font-size:11px">'
          + 'Suspect location' + (reasons ? ' - ' + reasons : '')
          + '<br/>Right-click the marker to re-geocode or dismiss the flag.'
          + '</div>'
        : '';
      // Phones: every unique number across o.phone + all contacts, digits-
      // normalized for dedup, rendered number-only (no names) one per line.
      const phoneNums = [];
      const seenPhone = new Set();
      const addPhone = (raw) => {
        if (!raw) return;
        const norm = String(raw).replace(/\D/g, '');
        if (!norm || seenPhone.has(norm)) return;
        seenPhone.add(norm);
        phoneNums.push(formatPhone(raw));
      };
      addPhone(o.phone);
      (Array.isArray(o.contacts) ? o.contacts : []).forEach(c => c && addPhone(c.phone));
      const schedHtml = (o.schedule && o.schedule.date)
        ? '<div style="color:#facc15;margin-top:2px">◷ ' + fmtSchedule(o.schedule.date, o.schedule.start) + '</div>'
        : '';
      const phoneHtml = phoneNums.length
        ? '<div style="border-top:1px solid #555;margin-top:4px;padding-top:4px">'
          + phoneNums.map(p => '<div>' + p + '</div>').join('')
          + '</div>'
        : '';
      const html = (
        '<div style="font-size:12px;line-height:1.4">'
          + '<div style="font-weight:600">' + String(o.id) + '</div>'
          + '<div>' + (addr || '') + (city ? '<br/>' + city : '') + '</div>'
          + (o.pm ? '<div style="color:#888;margin-top:2px">Client: ' + o.pm + '</div>' : '')
          + (o.tech ? '<div style="color:#888;margin-top:2px">Tech: ' + o.tech + '</div>' : '')
          + schedHtml
          + phoneHtml
          + resolvedHtml
          + warnHtml
        + '</div>'
      );
      // Marker appearance (status-fill, type-border, overdue/onsite/scheduled
      // emphasis) is built by the shared woMarkerIcon so the inset map matches.
      const icon = woMarkerIcon(L, o, g, { statusColors, statusTags, typeColors, markerColors, overdueCfg });
      const marker = L.marker([g.lat, g.lon], { icon, opacity: isSel ? 1 : 0.9 })
        .addTo(markersLayerRef.current);
      marker.bindPopup(html);
      // Hover preview uses the SAME popup bubble (no separate tooltip).
      // _hoverOpen marks a popup opened by hover; mouseout closes only
      // those. Click clears the flag so the popup turns sticky.
      marker.on('mouseover', () => {
        // While any popup is click-sticky (open and not hover-opened),
        // hover on other markers must not steal it -- Leaflet auto-closes
        // the existing popup when another openPopup() fires.
        const stickyOpen = Object.values(markerByIdRef.current)
          .some((m) => m !== marker && m.isPopupOpen() && !m._hoverOpen);
        if (stickyOpen) return;
        if (!marker.isPopupOpen()) { marker._hoverOpen = true; marker.openPopup(); }
      });
      marker.on('mouseout', () => {
        if (marker._hoverOpen) { marker._hoverOpen = false; marker.closePopup(); }
      });
      marker.on('click', (ev) => {
        marker._hoverOpen = false;
        // Shift+click chains the WO into the route (click order), in addition
        // to the right-click "Add to route" item. Plain click = sticky select.
        const oe = ev && ev.originalEvent;
        if (oe && oe.shiftKey) {
          if (oe.preventDefault) oe.preventDefault();
          toggleRoute(o.id);
          return;
        }
        setSelected(o.id);
        // Leaflet's default click handler toggles (closes) a popup that the
        // hover already opened; force it back open so click = sticky.
        marker.openPopup();
      });
      marker.on('contextmenu', (ev) => {
        const oe = ev && ev.originalEvent;
        if (oe) { oe.preventDefault(); oe.stopPropagation(); }
        console.log('[maps-ctx] marker right-click', o.id, oe && oe.clientX, oe && oe.clientY);
        setSelected(o.id);
        setCtxMenu({ woId: o.id, x: oe ? oe.clientX : 200, y: oe ? oe.clientY : 200 });
      });
      markerByIdRef.current[o.id] = marker;
      points.push([g.lat, g.lon]);
    }
    // Slice 5 (#10): per-tech route polylines. Group the rendered, geocoded,
    // scheduled WOs by tech, order each tech's stops by schedule date+time, and
    // draw a straight-line polyline in the tech's color (settings.techColors).
    // Added to the same markers layer so it clears/redraws with the markers.
    {
      const byTech = {};
      for (const o of list) {
        if (!o.tech || !(o.schedule && o.schedule.date)) continue;
        if (o.schedule.date !== routeDay) continue; // only the selected day's route
        const g = geocache && geocache[o.id];
        if (!g || g.error || g.lat == null) continue;
        (byTech[o.tech] = byTech[o.tech] || []).push(o);
      }
      for (const techName of Object.keys(byTech)) {
        const stops = byTech[techName]
          .sort((a, b) => (a.schedule.date + (a.schedule.start || '')).localeCompare(b.schedule.date + (b.schedule.start || '')))
          .map(o => { const g = geocache[o.id]; return [g.lat, g.lon]; });
        if (stops.length < 2) continue;
        const color = (techColors && techColors[techName]) || '#6b7280';
        L.polyline(stops, { color, weight: 3, opacity: 0.7, dashArray: '6 6' }).addTo(markersLayerRef.current);
      }
    }
    // Draft route polyline: dotted accent line through the staged routeStops in
    // click order (home origin first if a home view is set). Same mechanism as
    // the scheduled per-tech lines above, but dotted to read as "tentative".
    {
      const accent = (getComputedStyle(containerRef.current).getPropertyValue('--accent') || '').trim() || '#2563eb';
      const coords = [];
      if (defaultView && isFinite(defaultView.lat)) coords.push([defaultView.lat, defaultView.lon]);
      for (const id of routeStops) {
        const g = geocache && geocache[id];
        if (!g || g.error || g.lat == null) continue;
        coords.push([g.lat, g.lon]);
      }
      if (coords.length >= 2) {
        L.polyline(coords, { color: accent, weight: 3, opacity: 0.9, dashArray: '1 8', lineCap: 'round' }).addTo(markersLayerRef.current);
      }
    }
    // Auto-fit only when the user has NOT configured a home view. With a
    // home set, startup centers on home and stays there until the user
    // pans or clicks "Go to home".
    const hasHome = !!(defaultView && isFinite(defaultView.lat));
    if (!hasHome && !fittedRef.current && !selected && points.length > 1) {
      mapRef.current.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
      fittedRef.current = true;
    } else if (!hasHome && !fittedRef.current && !selected && points.length === 1) {
      mapRef.current.setView(points[0], 14);
      fittedRef.current = true;
    }
    // Popup open / preserve / first-arrival logic for the selected WO.
    if (selected && markerByIdRef.current[selected]) {
      const m = markerByIdRef.current[selected];
      if (selWasOpen) {
        // User had the popup open before this re-render; restore it.
        m.openPopup();
        popupShownForRef.current = selected;
      } else if (popupShownForRef.current !== selected) {
        // First marker arrival for the current selection (e.g. Jump to
        // Map fired before the address was geocoded). Auto-open once.
        m.openPopup();
        popupShownForRef.current = selected;
      }
      // Otherwise: popup was previously dismissed by the user. Leave it
      // closed until they pick a different WO.
    }
  }, [list, geocache, selected, overdueCfg, overdueTick, statusTags, statusColors, techColors, routeDay, routeStops]);

  // Pan to the selected WO when selection changes. Does NOT touch the
  // popup - that is handled by the render-markers effect above so a
  // geocache update never resurrects a popup the user closed.
  React.useEffect(() => {
    if (!selected || !mapRef.current) return;
    const m = markerByIdRef.current[selected];
    if (m) mapRef.current.panTo(m.getLatLng());
  }, [selected]);

  // Geocoder lives at the App level (runs at startup + after imports). The
  // Maps module only reads the cache + progress here.
  const markersOnMap = list.reduce((n, o) => (geocache && geocache[o.id] && !geocache[o.id].error ? n + 1 : n), 0);

  return (
    <div style={{ gridColumn: '2 / 4', display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '14px 18px 10px', borderBottom: '1px solid var(--border-1)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontWeight: 700, fontSize: 20, letterSpacing: '-0.02em' }}>
              Maps
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              Route to a work order
            </div>
          </div>
          <div style={{ flex: 1 }} />
          {/* Slice 5 (#10): route polylines track one day. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Route lines show only this day's scheduled stops per tech">
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Route day</span>
            <button onClick={() => setRouteDay(d => itinShiftDay(d, -1))} style={{ height: 28, width: 24, border: '1px solid var(--border-1)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>‹</button>
            <input type="date" value={routeDay} onChange={(e) => e.target.value && setRouteDay(e.target.value)}
              style={{ height: 28, padding: '0 6px', border: '1px solid var(--border-1)', borderRadius: 6, background: 'var(--bg-canvas)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12 }} />
            <button onClick={() => setRouteDay(d => itinShiftDay(d, 1))} style={{ height: 28, width: 24, border: '1px solid var(--border-1)', borderRadius: 6, background: 'var(--bg-surface)', color: 'var(--text-1)', cursor: 'pointer', fontSize: 13 }}>›</button>
            <button onClick={() => setRouteDay(itinTodayStr())} style={{ height: 28, padding: '0 8px', border: '1px solid ' + (routeDay === itinTodayStr() ? 'var(--accent)' : 'var(--border-1)'), borderRadius: 6, background: routeDay === itinTodayStr() ? 'var(--bg-row-sel)' : 'var(--bg-surface)', color: 'var(--text-1)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>Today</button>
          </div>
          <button
            onClick={() => {
              if (!mapRef.current || !defaultView || !isFinite(defaultView.lat)) return;
              mapRef.current.setView([defaultView.lat, defaultView.lon], defaultView.zoom || 11);
            }}
            disabled={!defaultView || !isFinite(defaultView.lat)}
            title="Recenter the map on the home address (set in Settings -> Maps)"
            style={{
              height: 28, padding: '0 10px',
              border: '1px solid var(--border-1)', borderRadius: 8,
              background: 'var(--bg-surface)', color: 'var(--text-1)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
              cursor: (!defaultView || !isFinite(defaultView.lat)) ? 'default' : 'pointer',
              opacity: (!defaultView || !isFinite(defaultView.lat)) ? 0.5 : 1,
            }}
          >Go to home</button>
          <HeaderChips />
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '280px 1fr' }}>
        <aside style={{
          borderRight: '1px solid var(--border-1)',
          background: 'var(--bg-surface)',
          display: 'flex', flexDirection: 'column',
          minHeight: 0,
        }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border-1)', flexShrink: 0 }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search WO #, address, city..."
              style={{
                width: '100%', height: 30, padding: '0 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-canvas)', color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 12,
                boxSizing: 'border-box',
              }}
            />
            {/* Job-type show/hide. Click toggles a type off the list + map. */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[['H', 'HVAC'], ['P', 'Plumbing'], ['PH', 'Dual']].map(([k, label]) => {
                const hidden = !!hiddenTypes[k];
                const c = k === 'PH' ? 'var(--text-2)' : (TYPE_COLORS[k] || 'var(--text-2)');
                return (
                  <button key={k}
                    onClick={() => setHiddenTypes(s => ({ ...s, [k]: !s[k] }))}
                    title={hidden ? 'Show ' + label : 'Hide ' + label}
                    style={{
                      flex: 1, height: 24, borderRadius: 6, cursor: 'pointer',
                      border: '1px solid ' + (hidden ? 'var(--border-2)' : c),
                      background: hidden ? 'transparent' : hexToRgba(normalizeHex(c.startsWith('#') ? c : '#6b7280'), 0.16),
                      color: hidden ? 'var(--text-3)' : c,
                      fontFamily: 'inherit', fontSize: 11, fontWeight: 700,
                      textDecoration: hidden ? 'line-through' : 'none',
                      opacity: hidden ? 0.6 : 1,
                    }}>{label}</button>
                );
              })}
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
            {list.length === 0 && (
              <div style={{ padding: '20px 14px', fontSize: 13, color: 'var(--text-3)', fontStyle: 'italic' }}>
                No active work orders.
              </div>
            )}
            {list.map(o => {
              const { addr, city } = splitAddress(o);
              const isSel = o.id === selected;
              return (
                <div
                  key={o.id}
                  onClick={() => setSelected(o.id)}
                  onContextMenu={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    setSelected(o.id);
                    setCtxMenu({ woId: o.id, x: e.clientX, y: e.clientY });
                  }}
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border-2)',
                    background: isSel ? 'var(--bg-row-sel)' : 'transparent',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      {(() => { const i = routeStops.indexOf(o.id); return i < 0 ? null : (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 18, height: 18, borderRadius: 9,
                          background: 'var(--accent)', color: 'var(--accent-fg)',
                          fontSize: 11, fontWeight: 700,
                        }}>{i + 1}</span>
                      ); })()}
                      {o.id}
                    </span>
                    {o.tech && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{o.tech}</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {addr || '(no address)'}
                  </div>
                  {city && (
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{city}</div>
                  )}
                </div>
              );
            })}
          </div>
          {/* Route stop panel. Always visible at the panel bottom, collapsed by
              default (chevron toggles). Stage stops via Shift+click on a marker
              or right-click → Add to route; reorder, clear, or open the chain in
              Google Maps directions. */}
          {(() => {
            const byId = new Map((activeOrders || []).map(o => [o.id, o]));
            const homeAddr = (mapsHomeAddress || '').trim();
            const n = routeStops.length;
            return (
              <div style={{
                flexShrink: 0, borderTop: '1px solid var(--border-1)',
                background: 'var(--bg-surface-2)',
                display: 'flex', flexDirection: 'column',
              }}>
                <div onClick={toggleRoutePanel} title={routeOpen ? 'Collapse route' : 'Expand route'} style={{
                  display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                  padding: '8px 10px', userSelect: 'none',
                }}>
                  <span style={{ fontSize: 10, color: 'var(--text-3)', width: 10 }}>{routeOpen ? '▾' : '▸'}</span>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    Route · {n}
                  </div>
                  <div style={{ flex: 1 }} />
                  {n > 0 && (
                    <span onClick={(e) => { e.stopPropagation(); clearRoute(); }} title="Clear all stops" style={{
                      height: 22, padding: '0 8px', display: 'inline-flex', alignItems: 'center',
                      border: '1px solid var(--border-1)', borderRadius: 4,
                      background: 'transparent', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer',
                    }}>Clear</span>
                  )}
                </div>
                {routeOpen && (
                <div style={{
                  padding: '0 10px 8px', display: 'flex', flexDirection: 'column', gap: 6,
                  maxHeight: 260, overflowY: 'auto',
                }}>
                {n === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
                    Shift-click a marker (or right-click → Add to route) to stage stops.
                  </div>
                )}
                {n > 0 && !homeAddr && (
                  <div style={{ fontSize: 11, color: 'var(--text-3)', fontStyle: 'italic' }}>
                    Tip: set a home address in Settings → Maps to use as the route origin.
                  </div>
                )}
                {routeStops.map((id, i) => {
                  const o = byId.get(id);
                  const { addr, city } = o ? splitAddress(o) : { addr: '(missing)', city: '' };
                  return (
                    <div key={id} style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '4px 6px', borderRadius: 4,
                      background: 'var(--bg-surface)', border: '1px solid var(--border-1)',
                    }}>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 18, height: 18, borderRadius: 9,
                        background: 'var(--accent)', color: 'var(--accent-fg)',
                        fontSize: 11, fontWeight: 700, flexShrink: 0,
                      }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {addr || '(no address)'}
                        </div>
                        {city && <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{city}</div>}
                      </div>
                      <button onClick={() => moveStop(id, -1)} disabled={i === 0}
                        title="Move up" style={{
                          height: 20, width: 20, padding: 0, border: 'none', background: 'transparent',
                          color: i === 0 ? 'var(--text-3)' : 'var(--text-2)', cursor: i === 0 ? 'default' : 'pointer',
                          fontSize: 12, opacity: i === 0 ? 0.4 : 1,
                        }}>{'▲'}</button>
                      <button onClick={() => moveStop(id, 1)} disabled={i === routeStops.length - 1}
                        title="Move down" style={{
                          height: 20, width: 20, padding: 0, border: 'none', background: 'transparent',
                          color: i === routeStops.length - 1 ? 'var(--text-3)' : 'var(--text-2)',
                          cursor: i === routeStops.length - 1 ? 'default' : 'pointer',
                          fontSize: 12, opacity: i === routeStops.length - 1 ? 0.4 : 1,
                        }}>{'▼'}</button>
                      <button onClick={() => toggleRoute(id)} title="Remove from route" style={{
                        height: 20, width: 20, padding: 0, border: 'none', background: 'transparent',
                        color: 'var(--text-3)', cursor: 'pointer', fontSize: 12,
                      }}>{'✕'}</button>
                    </div>
                  );
                })}
                {n > 0 && (
                  <button onClick={launchRoute} style={{
                    marginTop: 4, height: 32, padding: '0 12px',
                    border: 'none', borderRadius: 6,
                    background: 'var(--accent)', color: 'var(--accent-fg)',
                    fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}>Open in Google Maps</button>
                )}
                {n > 0 && (() => {
                  const tech = sendTech || (techs && techs[0]) || '';
                  return (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
                      <select value={tech} onChange={(e) => setSendTech(e.target.value)} title="Assign route to this tech"
                        style={{
                          flexShrink: 0, height: 32, padding: '0 6px', borderRadius: 6,
                          border: '1px solid var(--border-1)', background: 'var(--bg-canvas)',
                          color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12,
                        }}>
                        {(techs || []).map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button
                        onClick={() => { if (tech) onSendRoute && onSendRoute(tech, routeDay); }}
                        disabled={!tech}
                        title={'Schedule these stops for ' + (tech || '—') + ' on ' + routeDay + ' (overwrites that day)'}
                        style={{
                          flex: 1, height: 32, padding: '0 10px',
                          border: '1px solid var(--accent)', borderRadius: 6,
                          background: 'transparent', color: 'var(--accent)',
                          fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
                          cursor: tech ? 'pointer' : 'default', opacity: tech ? 1 : 0.5,
                        }}>Send to Itinerary</button>
                    </div>
                  );
                })()}
                </div>
                )}
              </div>
            );
          })()}
        </aside>
        {/* isolation:isolate contains Leaflet's panes (z 200-700) in their own
            stacking context so they can't hoist above the header's notification
            dropdown (same fix as the command-center MapInset). */}
        <div style={{ minWidth: 0, position: 'relative', isolation: 'isolate' }}>
          <div
            ref={containerRef}
            style={{ position: 'absolute', inset: 0, background: 'var(--bg-surface-2)' }}
          />
          {progress && (
            <div style={{
              position: 'absolute', top: 12, left: 12, right: 12,
              maxWidth: 360,
              padding: '8px 12px',
              background: 'rgba(0,0,0,0.75)', color: '#fff',
              borderRadius: 8, fontSize: 12,
              pointerEvents: 'none', zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span>Geocoding addresses...</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <div style={{ height: 4, background: 'rgba(255,255,255,0.2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  width: Math.round((progress.done / Math.max(1, progress.total)) * 100) + '%',
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 240ms ease',
                }} />
              </div>
            </div>
          )}
          {!progress && markersOnMap === 0 && list.length > 0 && (
            <div style={{
              position: 'absolute', top: 12, left: 12,
              padding: '6px 10px',
              background: 'rgba(0,0,0,0.65)', color: '#fff',
              borderRadius: 6, fontSize: 12,
              pointerEvents: 'none', zIndex: 1000,
            }}>
              No addresses could be located.
            </div>
          )}
        </div>
      </div>

      {ctxMenu && (() => {
        const o = (activeOrders || []).find(x => x.id === ctxMenu.woId);
        const g = geocache && geocache[ctxMenu.woId];
        const pad = 8;
        const w = 220;
        const h = 200;
        let top = ctxMenu.y;
        let left = ctxMenu.x;
        if (left + w > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - w - pad);
        if (top + h > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - h - pad);
        const item = (label, onClick, danger) => (
          <div
            onClick={() => { onClick(); closeCtxMenu(); }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            style={{
              padding: '7px 12px', fontSize: 13,
              color: danger ? 'var(--flag-emergency)' : 'var(--text-1)',
              cursor: 'pointer', userSelect: 'none',
            }}
          >{label}</div>
        );
        return (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', top, left,
              minWidth: w, background: 'var(--bg-surface)',
              border: '1px solid var(--border-2)', borderRadius: 8,
              boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
              padding: '4px 0', zIndex: 1100,
            }}
          >
            <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {ctxMenu.woId}
            </div>
            <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />
            {ctxStatus ? (<>
              <div style={{ padding: '4px 12px', fontSize: 11, color: 'var(--text-3)' }}>Set status</div>
              {(statuses || []).filter(s => !LOCKED_STATUSES.has(s)).map(s => React.cloneElement(item(s, () => onWoAction(ctxMenu.woId, 'setStatus', s)), { key: s }))}
              <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />
              <div onClick={(e) => { e.stopPropagation(); setCtxStatus(false); }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                style={{ padding: '7px 12px', fontSize: 13, color: 'var(--text-2)', cursor: 'pointer', userSelect: 'none' }}>← Back</div>
            </>) : (<>
              {o && item('View notes', () => setNotesWO(o.id))}
              <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />
              {onOpenWO && item('Open WO details', () => onOpenWO(ctxMenu.woId))}
              {onWoAction && item(o && o.schedule && o.schedule.date ? 'Reschedule' : 'Schedule', () => onWoAction(ctxMenu.woId, 'openScheduleForm'))}
              {onWoAction && statuses && statuses.length > 0 && (
                <div onClick={(e) => { e.stopPropagation(); setCtxStatus(true); }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{ padding: '7px 12px', fontSize: 13, color: 'var(--text-1)', cursor: 'pointer', userSelect: 'none' }}>Change status ▸</div>
              )}
              {onWoAction && item('Jump to itinerary', () => onWoAction(ctxMenu.woId, 'jumpItinerary'))}
              <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />
              {item(inRoute(ctxMenu.woId) ? 'Remove from route' : 'Add to route', () => toggleRoute(ctxMenu.woId))}
              <div style={{ height: 1, background: 'var(--border-1)', margin: '4px 0' }} />
              {onWoAction && item('Re-geocode address', () => onWoAction(ctxMenu.woId, 'regeocode'))}
              {onWoAction && g && g.suspect && item('Dismiss suspect flag', () => onWoAction(ctxMenu.woId, 'dismissSuspect'))}
            </>)}
          </div>
        );
      })()}

      {notesWO && (
        <NotesViewModal
          order={(activeOrders || []).find(o => o.id === notesWO)}
          onClose={() => setNotesWO(null)}
        />
      )}
    </div>
  );
}
