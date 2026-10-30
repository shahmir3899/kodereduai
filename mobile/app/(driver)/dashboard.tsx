import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { transportApi } from '../../services/api';
import {
  getCurrentLocation, getPermissionState, requestPermissionState, resumeTracking, startBackgroundLocationUpdates,
  stopBackgroundLocationUpdates,
} from '../../services/location';
import { existingJourneyId, type PermissionState } from '../../services/tracking';
import {
  JOURNEY_LABELS, activeJourneyOf, durationLabel, isToday, journeyStateFromHistory, type JourneyType,
} from '../../services/driver';
import { apiErrorMessage } from '../../services/parentPortal';
import { useMyVehicle, useRouteDetail, useRouteHistory } from '../../hooks/useDriver';
import { useTrackedJourney } from '../../hooks/useTrackedJourney';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { formatSlotTime } from '../../services/teacher';
import LocationDisclosure from '../../components/driver/LocationDisclosure';
import SchoolSwitcher from '../../components/nav/SchoolSwitcher';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import SegmentedTabs from '../../components/ui/SegmentedTabs';
import StatusPill from '../../components/ui/StatusPill';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import { useToast } from '../../components/ui/Toast';
import { confirm } from '../../components/ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

export default function DriverHome() {
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const vehicle = useMyVehicle();
  const routeId = vehicle.data?.assigned_route ?? null;
  const detail = useRouteDetail(routeId);
  const history = useRouteHistory(routeId);
  const tracked = useTrackedJourney();
  const refreshControl = useRefreshControl(vehicle.refetch, detail.refetch, history.refetch, tracked.refresh);

  const [type, setType] = useState<JourneyType>('TO_SCHOOL');
  const [starting, setStarting] = useState(false);
  const [disclosure, setDisclosure] = useState(false);
  const [asking, setAsking] = useState(false);
  const [denied, setDenied] = useState(false);

  const serverActive = activeJourneyOf(history.data, routeId);

  // On opening: put the location task back if this phone still remembers a journey (the app may
  // have been killed), and forget it if the server has already closed it.
  useFocusEffect(useCallback(() => {
    (async () => {
      const remembered = await resumeTracking();
      if (!remembered) return;
      const state = journeyStateFromHistory(history.data, remembered.id);
      if (state === 'ENDED') {
        await stopBackgroundLocationUpdates();
        tracked.refresh();
        toast.show('That journey was already ended, so tracking was stopped.');
      }
    })();
  }, [history.data])); // eslint-disable-line react-hooks/exhaustive-deps

  const begin = async () => {
    setStarting(true);
    try {
      const location = await getCurrentLocation();
      if (!location) { toast.error('Could not get your location. Check that GPS is on and try again.'); return; }
      try {
        const res = await transportApi.startRouteJourney({
          journey_type: type, latitude: location.coords.latitude, longitude: location.coords.longitude,
        });
        const j = res.data;
        await startBackgroundLocationUpdates(j.id, 'route', undefined, {
          routeName: detail.data?.route?.name, journeyType: j.journey_type, startedAt: j.started_at,
        });
        await tracked.refresh();
        history.refetch();
        router.push('/(driver)/journey');
      } catch (error) {
        const existing = existingJourneyId(error);
        if (existing) {
          const yes = await confirm({ title: 'A journey is already running', message: 'Your route already has an active journey, probably one this phone lost track of. Resume sharing the bus location for it?', confirmLabel: 'Resume' });
          if (yes) await attach(existing);
        } else {
          toast.error(apiErrorMessage((error as { response?: { data?: unknown } })?.response?.data, 'Could not start the journey.'));
        }
      }
    } finally {
      setStarting(false);
    }
  };

  // Re-attach this phone to a journey the server already has (started earlier by this driver).
  const attach = async (journeyId: number) => {
    const row = (history.data ?? []).find((j) => j.id === journeyId);
    await startBackgroundLocationUpdates(journeyId, 'route', undefined, {
      routeName: detail.data?.route?.name, journeyType: row?.journey_type, startedAt: row?.started_at ?? new Date().toISOString(),
    });
    await tracked.refresh();
    router.push('/(driver)/journey');
  };

  const start = async () => {
    if (!routeId) { toast.error('Your vehicle has no route yet. Ask the school office.'); return; }
    const state: PermissionState = await getPermissionState().catch(() => 'denied' as PermissionState);
    if (state !== 'granted') { setDenied(false); setDisclosure(true); return; }
    begin();
  };

  const askPermission = async () => {
    setAsking(true);
    try {
      const state = await requestPermissionState();
      if (state === 'granted') { setDisclosure(false); begin(); } else setDenied(true);
    } finally {
      setAsking(false);
    }
  };

  if (vehicle.isLoading) return <Skeleton />;
  if (vehicle.isError && !vehicle.data) return <ErrorState error={vehicle.error} onRetry={() => vehicle.refetch()} />;

  const v = vehicle.data;
  const route = detail.data?.route;
  const stops = detail.data?.stops ?? [];
  const today = (history.data ?? []).filter((j) => isToday(j.started_at));
  const name = user?.first_name || user?.username || 'Driver';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.greeting}>Hello, {name}</Text>
      <SchoolSwitcher />

      {!v ? (
        <Card style={styles.card}>
          <Text style={styles.title}>No vehicle assigned</Text>
          <Text style={styles.meta}>Ask the school office to assign a vehicle to your account.</Text>
        </Card>
      ) : (
        <>
          {tracked.journey ? (
            <Card style={styles.liveCard}>
              <View style={styles.row}>
                <Text style={styles.title}>Journey in progress</Text>
                <StatusPill label="Sharing location" tone="success" />
              </View>
              <Text style={styles.meta}>{[tracked.journey.routeName, tracked.journey.journeyType ? JOURNEY_LABELS[tracked.journey.journeyType as JourneyType] : ''].filter(Boolean).join('  ·  ')}</Text>
              <Button title="Open journey" onPress={() => router.push('/(driver)/journey')} fullWidth style={styles.gap} />
            </Card>
          ) : serverActive ? (
            <Card style={styles.liveCard}>
              <Text style={styles.title}>A journey is active on your route</Text>
              <Text style={styles.meta}>This phone is not sharing its location for it. Resume so parents can see the bus.</Text>
              <Button title="Resume sharing" onPress={() => attach(serverActive.id)} fullWidth style={styles.gap} />
            </Card>
          ) : (
            <Card style={styles.card}>
              <Text style={styles.title}>Start a journey</Text>
              <SegmentedTabs<JourneyType> value={type} onChange={setType}
                tabs={[{ value: 'TO_SCHOOL', label: JOURNEY_LABELS.TO_SCHOOL }, { value: 'FROM_SCHOOL', label: JOURNEY_LABELS.FROM_SCHOOL }]} />
              <Button title="Start journey" onPress={start} loading={starting} disabled={!routeId} fullWidth size="lg" />
              {!routeId ? <Text style={styles.meta}>Your vehicle has no route yet.</Text> : null}
            </Card>
          )}

          <Card style={styles.card}>
            <Text style={styles.label}>My vehicle</Text>
            <Text style={styles.title}>{v.vehicle_number}</Text>
            <Text style={styles.meta}>{[v.vehicle_type, `${v.capacity} seats`].filter(Boolean).join('  ·  ')}</Text>
          </Card>

          {route ? (
            <Card style={styles.card}>
              <Text style={styles.label}>Route</Text>
              <Text style={styles.title}>{route.name}</Text>
              <Text style={styles.meta}>{[route.start_location, route.end_location].filter(Boolean).join(' → ')}</Text>
              <Text style={styles.meta}>{[route.distance_km ? `${route.distance_km} km` : '', route.estimated_duration_minutes ? `${route.estimated_duration_minutes} min` : ''].filter(Boolean).join('  ·  ')}</Text>
            </Card>
          ) : null}

          {stops.length > 0 ? (
            <Card style={styles.card}>
              <Text style={styles.label}>Stops</Text>
              {stops.map((s) => (
                <View key={s.id} style={styles.stop}>
                  <Text style={styles.order}>{s.stop_order}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stopName}>{s.name}</Text>
                    <Text style={styles.meta}>
                      {[s.pickup_time ? `Pickup ${formatSlotTime(s.pickup_time)}` : '', s.drop_time ? `Drop ${formatSlotTime(s.drop_time)}` : ''].filter(Boolean).join('  ·  ')}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          ) : null}

          {today.length > 0 ? (
            <Card style={styles.card}>
              <Text style={styles.label}>Today&apos;s trips</Text>
              {today.map((j) => (
                <View key={j.id} style={styles.stop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stopName}>{j.journey_type_display || JOURNEY_LABELS[j.journey_type as JourneyType] || j.journey_type}</Text>
                    <Text style={styles.meta}>{[formatClock(j.started_at), durationLabel(j.started_at, j.ended_at)].filter(Boolean).join('  ·  ')}</Text>
                  </View>
                  <StatusPill label={j.status_display || j.status} tone={j.status === 'ACTIVE' ? 'success' : 'neutral'} />
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}

      <LocationDisclosure visible={disclosure} onClose={() => setDisclosure(false)} onContinue={askPermission} busy={asking} denied={denied} />
    </ScrollView>
  );
}

const formatClock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  card: { padding: Spacing.md, marginTop: Spacing.md },
  liveCard: { padding: Spacing.md, marginTop: Spacing.md, borderWidth: 1, borderColor: Colors.success },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  gap: { marginTop: Spacing.md },
  label: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginBottom: Spacing.xs },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.xs },
  order: { width: 24, textAlign: 'center', fontWeight: '700', color: Colors.primary },
  stopName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
