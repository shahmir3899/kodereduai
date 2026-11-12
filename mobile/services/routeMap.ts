// Transport routes on a map: the route and stop forms, the markers and the map page itself. Port of the
// web Routes page (frontend/src/pages/transport/RoutesPage.jsx, LocationPickerMap.jsx) and of
// backend/transport (models, serializers, map_data.py). Pure logic: the map is Leaflet with
// OpenStreetMap tiles inside a WebView, like the web, so no map key is needed.

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface Pin { lat: number; lng: number }

export const toPin = (lat: number | string | null | undefined, lng: number | string | null | undefined): Pin | null => {
  const a = num(lat); const b = num(lng);
  return a === null || b === null || !validPin(a, b) ? null : { lat: a, lng: b };
};

export const validPin = (lat: number, lng: number) => lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && !(lat === 0 && lng === 0);

// ── Rows the server sends ─────────────────────────────────────────────────────────────────────

export interface RouteRow {
  id: number; name: string; description?: string | null; start_location?: string | null; end_location?: string | null;
  start_latitude?: number | string | null; start_longitude?: number | string | null; end_latitude?: number | string | null; end_longitude?: number | string | null;
  distance_km?: number | string | null; estimated_duration_minutes?: number | null; is_active: boolean;
  stops_count?: number; vehicles_count?: number; students_count?: number;
}
export interface StopRow {
  id: number; route: number; name: string; address?: string | null; latitude?: number | string | null; longitude?: number | string | null;
  stop_order: number; pickup_time: string; drop_time: string;
}
export interface AssignmentRow { id: number; student: number; student_name?: string; stop?: number | null; stop_name?: string; transport_type?: string; is_active?: boolean }

// What a student or parent gets (backend/transport/map_data.py): places only.
export interface PortalMap {
  start: { name?: string | null; latitude: number | null; longitude: number | null };
  end: { name?: string | null; latitude: number | null; longitude: number | null };
  stops: Array<{ id: number; name: string; stop_order: number; latitude: number | null; longitude: number | null; pickup_time?: string | null; drop_time?: string | null; is_mine: boolean }>;
}

// ── Markers ───────────────────────────────────────────────────────────────────────────────────

export type MarkerKind = 'start' | 'end' | 'stop' | 'mine' | 'bus' | 'pin';
export interface MapMarker { id: string; kind: MarkerKind; lat: number; lng: number; label: string; detail?: string; order?: number }

export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

const stopDetail = (s: { pickup_time?: string | null; drop_time?: string | null }, students?: number) =>
  [s.pickup_time ? `Pickup ${hhmm(s.pickup_time)}` : '', s.drop_time ? `Drop ${hhmm(s.drop_time)}` : '', students !== undefined ? `${students} student${students === 1 ? '' : 's'}` : ''].filter(Boolean).join('  ·  ');

// Students per stop, from the active assignments.
export function studentsByStop(assignments: AssignmentRow[]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const a of assignments) {
    if (a.is_active === false || a.stop == null) continue;
    (out[a.stop] ||= []).push(a.student_name ?? `Student ${a.student}`);
  }
  for (const k of Object.keys(out)) out[Number(k)].sort((x, y) => x.localeCompare(y));
  return out;
}

export function routeMarkers(route: RouteRow, stops: StopRow[], assignments: AssignmentRow[] = []): MapMarker[] {
  const by = studentsByStop(assignments);
  const markers: MapMarker[] = [];
  const start = toPin(route.start_latitude, route.start_longitude);
  const end = toPin(route.end_latitude, route.end_longitude);
  if (start) markers.push({ id: 'start', kind: 'start', ...start, label: route.start_location || 'Start', detail: 'Route start' });
  [...stops].sort((a, b) => a.stop_order - b.stop_order || a.id - b.id).forEach((s) => {
    const p = toPin(s.latitude, s.longitude);
    if (p) markers.push({ id: `stop-${s.id}`, kind: 'stop', ...p, label: s.name, order: s.stop_order, detail: stopDetail(s, (by[s.id] ?? []).length) });
  });
  if (end) markers.push({ id: 'end', kind: 'end', ...end, label: route.end_location || 'End', detail: 'Route end' });
  return markers;
}

export function portalMarkers(m: PortalMap | null | undefined): MapMarker[] {
  if (!m) return [];
  const markers: MapMarker[] = [];
  const start = toPin(m.start.latitude, m.start.longitude);
  const end = toPin(m.end.latitude, m.end.longitude);
  if (start) markers.push({ id: 'start', kind: 'start', ...start, label: m.start.name || 'Start', detail: 'Route start' });
  [...m.stops].sort((a, b) => a.stop_order - b.stop_order).forEach((s) => {
    const p = toPin(s.latitude, s.longitude);
    if (p) markers.push({ id: `stop-${s.id}`, kind: s.is_mine ? 'mine' : 'stop', ...p, label: s.is_mine ? `${s.name} (your stop)` : s.name, order: s.stop_order, detail: stopDetail(s) });
  });
  if (end) markers.push({ id: 'end', kind: 'end', ...end, label: m.end.name || 'End', detail: 'Route end' });
  return markers;
}

export function withBus(markers: MapMarker[], point: { latitude: number | string; longitude: number | string; timestamp?: string } | null | undefined, when?: string): MapMarker[] {
  const p = point ? toPin(point.latitude, point.longitude) : null;
  return p ? [...markers.filter((m) => m.kind !== 'bus'), { id: 'bus', kind: 'bus', ...p, label: 'School bus', detail: when }] : markers;
}

// How many places are missing a pin (a stop with no coordinates is not drawn).
export const unpinnedStops = (stops: Array<{ latitude?: number | string | null; longitude?: number | string | null }>) =>
  stops.filter((s) => !toPin(s.latitude, s.longitude)).length;

export const googleMapsUrl = (p: Pin) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

// ── Route form ────────────────────────────────────────────────────────────────────────────────

export interface RouteForm {
  name: string; description: string; startLocation: string; endLocation: string; startPin: Pin | null; endPin: Pin | null;
  distance: string; duration: string; active: boolean;
}
export const emptyRouteForm = (): RouteForm => ({ name: '', description: '', startLocation: '', endLocation: '', startPin: null, endPin: null, distance: '', duration: '', active: true });
export const routeToForm = (r: RouteRow): RouteForm => ({
  name: r.name, description: r.description ?? '', startLocation: r.start_location ?? '', endLocation: r.end_location ?? '',
  startPin: toPin(r.start_latitude, r.start_longitude), endPin: toPin(r.end_latitude, r.end_longitude),
  distance: r.distance_km != null ? String(Number(r.distance_km)) : '', duration: r.estimated_duration_minutes != null ? String(r.estimated_duration_minutes) : '', active: r.is_active,
});

export function validateRoute(f: RouteForm): string | null {
  if (!f.name.trim()) return 'Enter the route name.';
  if (!f.startLocation.trim()) return 'Enter where the route starts.';
  if (!f.endLocation.trim()) return 'Enter where the route ends.';
  if (!/^\d+(\.\d{1,2})?$/.test(f.distance.trim())) return 'Enter the distance in km, for example 12.5.';
  if (!/^\d+$/.test(f.duration.trim()) || Number(f.duration) < 1) return 'Enter the trip time in whole minutes.';
  return null;
}

// Coordinates go as six decimals, like the column; a route with no pin sends nulls so an old pin can be cleared.
const six = (n: number | null | undefined) => (n === null || n === undefined ? null : Number(n.toFixed(6)));

export const buildRoutePayload = (f: RouteForm) => ({
  name: f.name.trim(), description: f.description.trim(), start_location: f.startLocation.trim(), end_location: f.endLocation.trim(),
  start_latitude: six(f.startPin?.lat), start_longitude: six(f.startPin?.lng), end_latitude: six(f.endPin?.lat), end_longitude: six(f.endPin?.lng),
  distance_km: Number(f.distance), estimated_duration_minutes: Number(f.duration), is_active: f.active,
});

export const routeLine = (r: RouteRow) => [
  [r.start_location, r.end_location].filter(Boolean).join(' → '),
  r.distance_km != null ? `${Number(r.distance_km)} km` : '', r.estimated_duration_minutes ? `${r.estimated_duration_minutes} min` : '',
].filter(Boolean).join('  ·  ');

export const routeCounts = (r: RouteRow) => `${r.stops_count ?? 0} stop${r.stops_count === 1 ? '' : 's'}  ·  ${r.students_count ?? 0} student${r.students_count === 1 ? '' : 's'}`;

export const deleteRouteText = (r: Pick<RouteRow, 'name'>) =>
  `Delete ${r.name}? Its stops are deleted with it. A route with students assigned cannot be deleted: reassign them first, or mark the route inactive.`;

// ── Stop form ─────────────────────────────────────────────────────────────────────────────────

export interface StopForm { name: string; address: string; order: string; pickup: string; drop: string; pin: Pin | null }
export const emptyStopForm = (nextOrder: number): StopForm => ({ name: '', address: '', order: String(nextOrder), pickup: '07:00', drop: '14:00', pin: null });
export const stopToForm = (s: StopRow): StopForm => ({
  name: s.name, address: s.address ?? '', order: String(s.stop_order), pickup: hhmm(s.pickup_time), drop: hhmm(s.drop_time), pin: toPin(s.latitude, s.longitude),
});

export const nextStopOrder = (stops: Array<{ stop_order: number }>) => stops.reduce((m, s) => Math.max(m, s.stop_order), 0) + 1;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateStop(f: StopForm): string | null {
  if (!f.name.trim()) return 'Enter the stop name.';
  if (!/^\d+$/.test(f.order.trim()) || Number(f.order) < 1) return 'The stop order is a whole number, 1 or more.';
  if (!TIME.test(f.pickup.trim()) || !TIME.test(f.drop.trim())) return 'Enter the pickup and drop times as 24-hour HH:MM, for example 07:30.';
  return null;
}

export const buildStopPayload = (routeId: number, f: StopForm) => ({
  route: routeId, name: f.name.trim(), address: f.address.trim(), stop_order: Number(f.order), pickup_time: f.pickup.trim(), drop_time: f.drop.trim(),
  latitude: six(f.pin?.lat), longitude: six(f.pin?.lng),
});

export const stopLine = (s: StopRow, students = 0) => [`#${s.stop_order}`, `Pickup ${hhmm(s.pickup_time)}`, `Drop ${hhmm(s.drop_time)}`, `${students} student${students === 1 ? '' : 's'}`, toPin(s.latitude, s.longitude) ? '' : 'no pin'].filter(Boolean).join('  ·  ');
export const deleteStopText = (s: Pick<StopRow, 'name'>) => `Delete the stop ${s.name}? A stop with students assigned cannot be deleted: reassign them first.`;

// ── Typed coordinates ─────────────────────────────────────────────────────────────────────────

export function parsePinText(lat: string, lng: string): { pin: Pin | null; error: string | null } {
  if (!lat.trim() && !lng.trim()) return { pin: null, error: null };
  const a = Number(lat); const b = Number(lng);
  if (!lat.trim() || !lng.trim() || !Number.isFinite(a) || !Number.isFinite(b)) return { pin: null, error: 'Enter both latitude and longitude as numbers.' };
  if (!validPin(a, b)) return { pin: null, error: 'Latitude is between -90 and 90, and longitude between -180 and 180.' };
  return { pin: { lat: a, lng: b }, error: null };
}

export const pinText = (p: Pin | null) => (p ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : 'No pin set');

// ── The map page ──────────────────────────────────────────────────────────────────────────────

export type MapMessage = { type: 'pick'; lat: number; lng: number } | { type: 'marker'; id: string } | { type: 'ready' };

// Reads what the map page posts back; anything else is ignored.
export function parseMapMessage(raw: unknown): MapMessage | null {
  try {
    const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!m || typeof m !== 'object') return null;
    const o = m as Record<string, unknown>;
    if (o.type === 'pick' && typeof o.lat === 'number' && typeof o.lng === 'number' && validPin(o.lat, o.lng)) return { type: 'pick', lat: o.lat, lng: o.lng };
    if (o.type === 'marker' && typeof o.id === 'string') return { type: 'marker', id: o.id };
    if (o.type === 'ready') return { type: 'ready' };
  } catch { /* not ours */ }
  return null;
}

// JSON that is safe inside a <script> tag.
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export interface MapOptions { markers: MapMarker[]; pick?: Pin | null; picking?: boolean; line?: boolean }

// A fallback centre (Lahore) when nothing has a pin yet; the picker then starts wide.
export const DEFAULT_CENTRE: Pin = { lat: 31.5204, lng: 74.3587 };

export function centreOf(points: Pin[]): Pin {
  if (points.length === 0) return DEFAULT_CENTRE;
  return { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: points.reduce((s, p) => s + p.lng, 0) / points.length };
}

const COLOURS: Record<MarkerKind, string> = { start: '#16a34a', end: '#dc2626', stop: '#2563eb', mine: '#f59e0b', bus: '#111827', pin: '#7c3aed' };

// The whole page: Leaflet from a CDN, OpenStreetMap tiles, numbered markers, the route line, and (when
// `picking`) a tap that drops a pin and reports it. It talks to the app through postMessage.
export function mapHtml(o: MapOptions): string {
  const data = safeJson({ markers: o.markers, pick: o.pick ?? null, picking: !!o.picking, line: o.line !== false, colours: COLOURS, centre: DEFAULT_CENTRE });
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>html,body,#map{height:100%;margin:0}.pin{border-radius:50%;color:#fff;font:700 12px/24px sans-serif;text-align:center;width:24px;height:24px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)}#err{position:absolute;top:8px;left:8px;right:8px;z-index:1000;background:#fef2f2;color:#991b1b;font:13px sans-serif;padding:8px;border-radius:6px;display:none}</style></head>
<body><div id="err">The map could not load. Check your internet connection.</div><div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
(function(){
  var D=${data};
  function post(m){var s=JSON.stringify(m);if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(s)}else if(window.parent!==window){window.parent.postMessage(s,'*')}}
  if(typeof L==='undefined'){document.getElementById('err').style.display='block';return}
  var map=L.map('map',{zoomControl:true}).setView([D.centre.lat,D.centre.lng],12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  function icon(m){var c=D.colours[m.kind]||'#2563eb';var t=m.kind==='bus'?'\\u{1F68C}':(m.kind==='start'?'S':(m.kind==='end'?'E':(m.order!=null?String(m.order):'\\u2022')));return L.divIcon({className:'',html:'<div class="pin" style="background:'+c+'">'+t+'</div>',iconSize:[24,24],iconAnchor:[12,12]})}
  var pts=[];
  D.markers.forEach(function(m){var mk=L.marker([m.lat,m.lng],{icon:icon(m)}).addTo(map);var h=document.createElement('div');var b=document.createElement('b');b.textContent=m.label;h.appendChild(b);if(m.detail){h.appendChild(document.createElement('br'));h.appendChild(document.createTextNode(m.detail))}mk.bindPopup(h);mk.on('click',function(){post({type:'marker',id:m.id})});if(m.kind!=='bus')pts.push([m.lat,m.lng])});
  if(D.line&&pts.length>1)L.polyline(pts,{color:'#2563eb',weight:4,opacity:.7}).addTo(map);
  var all=D.markers.map(function(m){return [m.lat,m.lng]});
  if(D.pick)all.push([D.pick.lat,D.pick.lng]);
  var pin=null;
  function setPin(lat,lng){if(pin)map.removeLayer(pin);pin=L.marker([lat,lng],{icon:icon({kind:'pin'})}).addTo(map)}
  if(D.pick)setPin(D.pick.lat,D.pick.lng);
  if(all.length>1)map.fitBounds(all,{padding:[40,40],maxZoom:16});else if(all.length===1)map.setView(all[0],15);
  if(D.picking){map.on('click',function(e){setPin(e.latlng.lat,e.latlng.lng);post({type:'pick',lat:e.latlng.lat,lng:e.latlng.lng})})}
  post({type:'ready'});
})();
</script></body></html>`;
}
