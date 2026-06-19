// Pure, dependency-free helpers carved out of app.jsx (no React, no app state).
// Dep direction: app/sections import from here.

export function formatPhone(v) {
  if (!v) return '';
  const d = String(v).replace(/\D/g, '');
  if (d.length === 10) return '(' + d.slice(0,3) + ')-' + d.slice(3,6) + '-' + d.slice(6);
  if (d.length === 11 && d[0] === '1') return '(' + d.slice(1,4) + ')-' + d.slice(4,7) + '-' + d.slice(7);
  return v;
}

// Slice 5 (#10): routing. Great-circle km between two lat/lon points (hoisted
// from the geocoder so routing + suspect-distance share one implementation).
export function haversineKm(la1, lo1, la2, lo2) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(la2 - la1);
  const dLon = toRad(lo2 - lo1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Straight-line km scaled by a flat road factor (no OSRM/true ETA — locked).
const ROAD_FACTOR = 1.3;
export function roadKm(la1, lo1, la2, lo2) { return haversineKm(la1, lo1, la2, lo2) * ROAD_FACTOR; }

// Open a single address in Google Maps search (default browser / Electron shell).
export function openMaps(addr) {
  if (!addr || !addr.trim()) return;
  const url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr.trim());
  if (window.shell && window.shell.openExternal) window.shell.openExternal(url);
  else window.open(url, '_blank');
}

// Multi-stop driving directions via Google's public /maps/dir URL (no API key).
// origin -> ordered waypoints -> destination; `originAddr` is the trip start
// (typically settings.mapsHomeAddress). Last stop becomes the destination.
export function openMapsRoute(stops, originAddr) {
  const clean = (stops || []).map(s => (s || '').trim()).filter(Boolean);
  if (clean.length === 0) return;
  const destination = clean[clean.length - 1];
  const waypoints = clean.slice(0, -1);
  const origin = (originAddr || '').trim() || (waypoints.shift() || destination);
  const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'driving' });
  if (waypoints.length) params.set('waypoints', waypoints.join('|'));
  const url = 'https://www.google.com/maps/dir/?' + params.toString();
  if (window.shell && window.shell.openExternal) window.shell.openExternal(url);
  else window.open(url, '_blank');
}
