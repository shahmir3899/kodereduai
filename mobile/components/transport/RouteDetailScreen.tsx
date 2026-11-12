import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useActiveJourneys, useRouteAssignments, useRouteStops, useRoutes, useTransportActions } from '../../hooks/useTransport';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildStopPayload, deleteStopText, emptyStopForm, mapHtml, nextStopOrder, pinText, routeCounts, routeLine, routeMarkers, stopLine, stopToForm, studentsByStop,
  unpinnedStops, validateStop, withBus, type MapMessage, type StopForm, type StopRow,
} from '../../services/routeMap';
import { timeAgo } from '../../services/messaging';
import { inventoryErrorMessage } from '../../services/inventory';
import RouteMap from '../map/RouteMap';
import LocationPickerSheet from '../map/LocationPickerSheet';
import RouteFormSheet from './RouteFormSheet';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// One route: its map (start, numbered stops, end, and the bus while it is on the road), the students at
// each stop, and (admin and principal) add, edit or delete a stop. A teacher sees it read-only.
export default function RouteDetailScreen() {
  const router = useRouter();
  const toast = useToast();
  const { isSchoolAdminNav: canManage } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const routeId = Number(id) || null;
  const routes = useRoutes();
  const stops = useRouteStops(routeId);
  const people = useRouteAssignments(routeId);
  const journeys = useActiveJourneys(true);
  const actions = useTransportActions();
  const refreshControl = useRefreshControl(routes.refetch, stops.refetch, people.refetch);

  const route = (routes.data ?? []).find((r) => r.id === routeId) ?? null;
  const stopRows = stops.data ?? [];
  const byStop = useMemo(() => studentsByStop(people.data ?? []), [people.data]);
  const bus = (journeys.data ?? []).find((j) => j.route === routeId);

  const markers = useMemo(() => {
    if (!route) return [];
    const base = routeMarkers(route, stopRows, people.data ?? []);
    const loc = bus?.latest_location;
    return withBus(base, loc, loc?.timestamp ? `Seen ${timeAgo(loc.timestamp)} ago` : undefined);
  }, [route, stopRows, people.data, bus]);
  const html = useMemo(() => mapHtml({ markers }), [markers]);

  const [editRoute, setEditRoute] = useState(false);
  const [stop, setStop] = useState<StopRow | 'new' | null>(null);
  const [form, setForm] = useState<StopForm>(emptyStopForm(1));
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [openStop, setOpenStop] = useState<number | null>(null);
  const set = <K extends keyof StopForm>(k: K, v: StopForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const existing = stop && stop !== 'new' ? stop : null;

  const openForm = (s: StopRow | 'new') => { setError(null); setForm(s === 'new' ? emptyStopForm(nextStopOrder(stopRows)) : stopToForm(s)); setStop(s); };

  const save = async () => {
    const problem = validateStop(form);
    if (problem || !routeId) return setError(problem ?? 'No route.');
    setError(null);
    try {
      if (existing) await actions.updateStop.mutateAsync({ id: existing.id, data: buildStopPayload(routeId, form) });
      else await actions.createStop.mutateAsync(buildStopPayload(routeId, form));
      toast.success(existing ? 'Stop saved.' : 'Stop added.');
      setStop(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const removeStop = async () => {
    if (!existing) return;
    if (!(await confirm({ title: 'Delete this stop?', message: deleteStopText(existing), confirmLabel: 'Delete', destructive: true }))) return;
    try { await actions.deleteStop.mutateAsync(existing.id); toast.success('Stop deleted.'); setStop(null); }
    catch (e) { setError(inventoryErrorMessage(e, 'Could not delete the stop.')); }
  };

  const onMarker = (m: MapMessage) => { if (m.type === 'marker' && m.id.startsWith('stop-')) setOpenStop(Number(m.id.slice(5))); };

  if (routes.isLoading || stops.isLoading) return <Skeleton />;
  if (routes.isError && !routes.data) return <ErrorState error={routes.error} onRetry={() => routes.refetch()} />;
  if (!route) return <EmptyState title="Route not found" message="It may have been deleted." />;

  const missing = unpinnedStops(stopRows);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <Card style={styles.card}>
        <View style={styles.head}>
          <Text style={styles.name}>{route.name}</Text>
          {!route.is_active ? <StatusPill label="Inactive" tone="neutral" /> : bus ? <StatusPill label="On the road" tone="success" /> : null}
        </View>
        <Text style={styles.sub}>{routeLine(route)}</Text>
        <Text style={styles.sub}>{routeCounts(route)}</Text>
        {canManage ? <Button title="Edit route" size="sm" variant="outline" onPress={() => setEditRoute(true)} /> : null}
      </Card>

      {markers.length === 0 ? (
        <Card><Text style={styles.sub}>{canManage ? 'No place on this route has a pin yet. Set the start and end on the route, and a location on each stop, to see the map.' : 'No place on this route has a pin yet, so there is no map to show.'}</Text></Card>
      ) : <RouteMap html={html} height={320} onMessage={onMarker} />}
      {markers.length > 0 && missing > 0 ? <Text style={styles.warn}>{`${missing} stop${missing === 1 ? ' has' : 's have'} no pin and ${missing === 1 ? 'is' : 'are'} not drawn.`}</Text> : null}

      <Text style={styles.section}>Stops</Text>
      {canManage ? <Button title="+ Add a stop" size="sm" onPress={() => openForm('new')} /> : null}
      {stopRows.length === 0 ? <Text style={styles.sub}>No stops yet.</Text> : null}
      {[...stopRows].sort((a, b) => a.stop_order - b.stop_order).map((s) => (
        <Card key={s.id} style={styles.stop}>
          <TouchableOpacity accessibilityRole="button" onPress={() => setOpenStop(openStop === s.id ? null : s.id)}>
            <Text style={styles.stopName}>{s.name}</Text>
            <Text style={styles.sub}>{stopLine(s, (byStop[s.id] ?? []).length)}</Text>
          </TouchableOpacity>
          {openStop === s.id ? (
            <View style={styles.people}>
              {(byStop[s.id] ?? []).length === 0 ? <Text style={styles.sub}>No students at this stop.</Text> : (byStop[s.id] ?? []).map((n) => <Text key={n} style={styles.person}>{n}</Text>)}
              {canManage ? <Button title="Edit stop" size="sm" variant="outline" onPress={() => openForm(s)} /> : null}
            </View>
          ) : null}
        </Card>
      ))}
      <Button title="Back to routes" size="sm" variant="ghost" onPress={() => router.back()} />

      <RouteFormSheet visible={editRoute} route={route} onClose={() => setEditRoute(false)} onDeleted={() => router.back()} />

      <FormSheet visible={stop !== null && !picking} title={existing ? 'Edit stop' : 'Add a stop'} onClose={() => setStop(null)} onSubmit={save} submitLabel="Save"
        busy={actions.createStop.isPending || actions.updateStop.isPending} error={error}>
        <Input label="Stop name" value={form.name} onChangeText={(v) => set('name', v)} />
        <Input label="Address (optional)" value={form.address} onChangeText={(v) => set('address', v)} multiline />
        <Input label="Order on the route" value={form.order} onChangeText={(v) => set('order', v)} keyboardType="number-pad" />
        <Input label="Pickup time (24-hour, HH:MM)" value={form.pickup} onChangeText={(v) => set('pickup', v)} placeholder="07:00" />
        <Input label="Drop time (24-hour, HH:MM)" value={form.drop} onChangeText={(v) => set('drop', v)} placeholder="14:00" />
        <View style={styles.pinRow}><Text style={styles.sub}>{pinText(form.pin)}</Text><Button title="Set on map" size="sm" variant="outline" onPress={() => setPicking(true)} /></View>
        {existing ? <Button title="Delete stop" variant="danger" size="sm" onPress={removeStop} loading={actions.deleteStop.isPending} /> : null}
      </FormSheet>

      <LocationPickerSheet visible={stop !== null && picking} title="Where the stop is" initial={form.pin}
        context={markers.filter((m) => m.kind !== 'bus' && m.id !== (existing ? `stop-${existing.id}` : ''))}
        onClose={() => setPicking(false)} onUse={(p) => { set('pin', p); setPicking(false); }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  warn: { fontSize: FontSize.sm, color: Colors.warning },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  stop: { gap: Spacing.xs },
  stopName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  people: { gap: Spacing.xs, marginTop: Spacing.xs },
  person: { fontSize: FontSize.sm, color: Colors.text, paddingVertical: 2 },
  pinRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, borderRadius: BorderRadius.md },
});
