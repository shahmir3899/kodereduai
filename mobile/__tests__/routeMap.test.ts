import {
  buildRoutePayload, buildStopPayload, centreOf, DEFAULT_CENTRE, emptyRouteForm, emptyStopForm, mapHtml, nextStopOrder, parseMapMessage, parsePinText, pinText,
  portalMarkers, routeCounts, routeLine, routeMarkers, routeToForm, stopLine, stopToForm, studentsByStop, toPin, unpinnedStops,
  validateRoute, validateStop, withBus, type RouteRow, type StopRow,
} from '../services/routeMap';

const route = (over: Partial<RouteRow> = {}): RouteRow => ({
  id: 1, name: 'North', start_location: 'Depot', end_location: 'School', start_latitude: '31.520000', start_longitude: '74.350000',
  end_latitude: '31.560000', end_longitude: '74.380000', distance_km: '12.50', estimated_duration_minutes: 40, is_active: true, stops_count: 2, students_count: 3, ...over,
});
const stop = (over: Partial<StopRow> = {}): StopRow => ({ id: 10, route: 1, name: 'Gate', stop_order: 1, pickup_time: '07:00:00', drop_time: '14:00:00', latitude: '31.53', longitude: '74.36', ...over });

describe('pins', () => {
  it('reads coordinates, and refuses missing, out-of-range and 0,0', () => {
    expect(toPin('31.5', '74.3')).toEqual({ lat: 31.5, lng: 74.3 });
    expect(toPin(null, '74.3')).toBeNull();
    expect(toPin('', '')).toBeNull();
    expect(toPin(95, 10)).toBeNull();
    expect(toPin(10, 190)).toBeNull();
    expect(toPin(0, 0)).toBeNull();
  });
  it('parses typed coordinates', () => {
    expect(parsePinText('', '')).toEqual({ pin: null, error: null });
    expect(parsePinText('31.5', '74.3').pin).toEqual({ lat: 31.5, lng: 74.3 });
    expect(parsePinText('31.5', '').error).toMatch(/both/);
    expect(parsePinText('abc', '74').error).toMatch(/numbers/);
    expect(parsePinText('120', '74').error).toMatch(/between/);
    expect(pinText({ lat: 31.52, lng: 74.35 })).toBe('31.52000, 74.35000');
    expect(pinText(null)).toBe('No pin set');
  });
  it('centres on the average, else the default', () => {
    expect(centreOf([{ lat: 10, lng: 20 }, { lat: 20, lng: 40 }])).toEqual({ lat: 15, lng: 30 });
    expect(centreOf([])).toEqual(DEFAULT_CENTRE);
  });
});

describe('route markers', () => {
  it('draws start, stops in order, then end, skipping what has no pin', () => {
    const stops = [stop({ id: 12, name: 'Third', stop_order: 3 }), stop({ id: 11, name: 'Second', stop_order: 2, latitude: null }), stop({ id: 10, name: 'First', stop_order: 1 })];
    const m = routeMarkers(route(), stops);
    expect(m.map((x) => x.id)).toEqual(['start', 'stop-10', 'stop-12', 'end']);
    expect(m[1]).toMatchObject({ kind: 'stop', label: 'First', order: 1 });
    expect(unpinnedStops(stops)).toBe(1);
  });
  it('counts the students at each stop from active assignments only', () => {
    const people = [{ id: 1, student: 5, student_name: 'Zed', stop: 10 }, { id: 2, student: 6, student_name: 'Ali', stop: 10 }, { id: 3, student: 7, student_name: 'Out', stop: 10, is_active: false }, { id: 4, student: 8, stop: null }];
    expect(studentsByStop(people)).toEqual({ 10: ['Ali', 'Zed'] });
    expect(routeMarkers(route(), [stop()], people)[1].detail).toBe('Pickup 07:00  ·  Drop 14:00  ·  2 students');
  });
  it('shows the bus on top and replaces an older bus marker', () => {
    const base = routeMarkers(route(), [stop()]);
    const once = withBus(base, { latitude: '31.5', longitude: '74.3' }, 'Seen 1 min ago');
    expect(once[once.length - 1]).toMatchObject({ kind: 'bus', label: 'School bus', detail: 'Seen 1 min ago' });
    expect(withBus(once, { latitude: 31.6, longitude: 74.4 }).filter((x) => x.kind === 'bus')).toHaveLength(1);
    expect(withBus(base, null)).toBe(base);
    expect(withBus(base, { latitude: 'x', longitude: 'y' })).toBe(base);
  });
  it('marks the student own stop for a parent or student', () => {
    const m = portalMarkers({
      start: { name: 'Depot', latitude: 31.5, longitude: 74.3 }, end: { name: 'School', latitude: null, longitude: null },
      stops: [{ id: 2, name: 'B', stop_order: 2, latitude: 31.6, longitude: 74.4, is_mine: true }, { id: 1, name: 'A', stop_order: 1, latitude: 31.55, longitude: 74.35, is_mine: false, pickup_time: '07:10:00' }],
    });
    expect(m.map((x) => `${x.id}:${x.kind}`)).toEqual(['start:start', 'stop-1:stop', 'stop-2:mine']);
    expect(m[2].label).toBe('B (your stop)');
    expect(portalMarkers(null)).toEqual([]);
  });
});

describe('route form', () => {
  const ok = { ...emptyRouteForm(), name: 'North', startLocation: 'Depot', endLocation: 'School', distance: '12.5', duration: '40' };
  it('needs a name, both ends, a distance and a whole number of minutes', () => {
    expect(validateRoute({ ...ok, name: ' ' })).toMatch(/name/i);
    expect(validateRoute({ ...ok, startLocation: '' })).toMatch(/starts/);
    expect(validateRoute({ ...ok, endLocation: '' })).toMatch(/ends/);
    expect(validateRoute({ ...ok, distance: 'x' })).toMatch(/distance/i);
    expect(validateRoute({ ...ok, duration: '0' })).toMatch(/minutes/);
    expect(validateRoute(ok)).toBeNull();
  });
  it('sends six-decimal coordinates, and nulls to clear a pin', () => {
    const p = buildRoutePayload({ ...ok, startPin: { lat: 31.52, lng: 74.3500004 }, endPin: null });
    expect(p).toMatchObject({ start_latitude: 31.52, start_longitude: 74.35, end_latitude: null, end_longitude: null, distance_km: 12.5, estimated_duration_minutes: 40, is_active: true });
  });
  it('reads a saved route back into the form and describes it', () => {
    const f = routeToForm(route());
    expect(f).toMatchObject({ name: 'North', distance: '12.5', duration: '40', startPin: { lat: 31.52, lng: 74.35 } });
    expect(routeLine(route())).toBe('Depot → School  ·  12.5 km  ·  40 min');
    expect(routeCounts(route({ stops_count: 1, students_count: 1 }))).toBe('1 stop  ·  1 student');
  });
});

describe('stop form', () => {
  const ok = { ...emptyStopForm(3), name: 'Gate' };
  it('starts after the last stop', () => {
    expect(nextStopOrder([])).toBe(1);
    expect(nextStopOrder([{ stop_order: 2 }, { stop_order: 5 }])).toBe(6);
    expect(emptyStopForm(4).order).toBe('4');
  });
  it('needs a name, an order and 24-hour times', () => {
    expect(validateStop({ ...ok, name: '' })).toMatch(/name/i);
    expect(validateStop({ ...ok, order: '0' })).toMatch(/order/i);
    expect(validateStop({ ...ok, pickup: '7am' })).toMatch(/HH:MM/);
    expect(validateStop({ ...ok, drop: '25:00' })).toMatch(/HH:MM/);
    expect(validateStop(ok)).toBeNull();
  });
  it('builds the request and shows the stop on one line', () => {
    expect(buildStopPayload(1, { ...ok, pin: { lat: 31.5, lng: 74.3 } })).toEqual({
      route: 1, name: 'Gate', address: '', stop_order: 3, pickup_time: '07:00', drop_time: '14:00', latitude: 31.5, longitude: 74.3,
    });
    expect(buildStopPayload(1, ok)).toMatchObject({ latitude: null, longitude: null });
    expect(stopToForm(stop())).toMatchObject({ pickup: '07:00', drop: '14:00', pin: { lat: 31.53, lng: 74.36 } });
    expect(stopLine(stop(), 2)).toBe('#1  ·  Pickup 07:00  ·  Drop 14:00  ·  2 students');
    expect(stopLine(stop({ latitude: null }), 1)).toContain('no pin');
  });
});

describe('the map page', () => {
  it('reads only the messages the page posts', () => {
    expect(parseMapMessage('{"type":"pick","lat":31.5,"lng":74.3}')).toEqual({ type: 'pick', lat: 31.5, lng: 74.3 });
    expect(parseMapMessage({ type: 'marker', id: 'stop-3' })).toEqual({ type: 'marker', id: 'stop-3' });
    expect(parseMapMessage('{"type":"ready"}')).toEqual({ type: 'ready' });
    expect(parseMapMessage('{"type":"pick","lat":999,"lng":1}')).toBeNull();
    expect(parseMapMessage('not json')).toBeNull();
    expect(parseMapMessage(null)).toBeNull();
  });
  it('embeds the markers safely and turns picking on only when asked', () => {
    const html = mapHtml({ markers: [{ id: 'stop-1', kind: 'stop', lat: 31.5, lng: 74.3, label: '</script><b>x</b>', order: 1 }] });
    expect(html).toContain('leaflet@1.9.4');
    expect(html).toContain('tile.openstreetmap.org');
    expect(html).not.toContain('</script><b>');
    expect(html).toContain('\\u003c/script\\u003e');
    expect(html).toContain('"picking":false');
    expect(mapHtml({ markers: [], picking: true, pick: { lat: 31.5, lng: 74.3 } })).toContain('"picking":true');
  });
});
