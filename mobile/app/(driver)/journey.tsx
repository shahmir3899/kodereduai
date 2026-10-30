import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { transportApi } from '../../services/api';
import { getCurrentLocation, reportPosition, requestPermissionState, stopBackgroundLocationUpdates } from '../../services/location';
import { classifySendError, formatElapsed, isStale } from '../../services/tracking';
import { apiErrorMessage } from '../../services/parentPortal';
import { JOURNEY_LABELS, type JourneyType } from '../../services/driver';
import { useTrackedJourney } from '../../hooks/useTrackedJourney';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import StatusPill from '../../components/ui/StatusPill';
import Skeleton from '../../components/ui/Skeleton';
import EmptyState from '../../components/ui/EmptyState';
import { useToast } from '../../components/ui/Toast';
import { confirm } from '../../components/ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

export default function ActiveJourney() {
  const router = useRouter();
  const toast = useToast();
  const { journey, lastOk, queued, permission, loaded, refresh } = useTrackedJourney();
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);
  const [sending, setSending] = useState(false);

  // One tick a second for the clock; the stored state is re-read every 10 seconds because the
  // background task updates it while this screen is open.
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => { refresh(); }, 10_000);
    return () => { clearInterval(clock); clearInterval(poll); };
  }, [refresh]);

  if (!loaded) return <Skeleton />;
  if (!journey) {
    return (
      <EmptyState title="No active journey" message="Start a journey from Home and it will show here."
        actionLabel="Go to Home" onAction={() => router.replace('/(driver)/dashboard')} />
    );
  }

  const stale = isStale(lastOk, now);
  const lastText = lastOk ? `${Math.max(0, Math.round((now - lastOk) / 1000))}s ago` : 'Not yet';
  const background = permission === 'granted';

  const sendNow = async () => {
    setSending(true);
    try {
      const fix = await getCurrentLocation();
      if (!fix) { toast.error('Could not get your location.'); return; }
      const alive = await reportPosition(fix);
      if (!alive) { toast.error('The server says this journey has ended.'); await refresh(); return; }
      await refresh();
      toast.success('Position sent.');
    } finally {
      setSending(false);
    }
  };

  const fixPermission = async () => {
    const state = await requestPermissionState();
    if (state !== 'granted') Linking.openSettings();
    refresh();
  };

  const end = async () => {
    const yes = await confirm({ title: 'End this journey?', message: 'Parents will stop seeing the bus.', confirmLabel: 'End journey', destructive: true });
    if (!yes) return;
    setEnding(true);
    try {
      let location: { latitude: number; longitude: number } | undefined;
      const fix = await getCurrentLocation();
      if (fix) location = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
      try {
        await transportApi.endRouteJourney({ journey_id: journey.id, ...location });
      } catch (error) {
        const outcome = classifySendError(error);
        // 404 = already ended on the server, which is what we wanted. No signal is different: the
        // journey would stay open for parents, so say so before giving up on it.
        if (outcome !== 'gone') {
          const stop = await confirm({
            title: 'Could not reach the school',
            message: outcome === 'retry'
              ? 'The journey is still open on the server. Stop sharing on this phone anyway? Ask the office to close it, or end it again when you have signal.'
              : apiErrorMessage((error as { response?: { data?: unknown } })?.response?.data, 'The server refused to end the journey.'),
            confirmLabel: 'Stop sharing', destructive: true,
          });
          if (!stop) return;
        }
      }
      await stopBackgroundLocationUpdates();
      toast.success('Journey ended.');
      router.replace('/(driver)/dashboard');
    } finally {
      setEnding(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <Text style={styles.title}>{journey.routeName || 'Route journey'}</Text>
          <StatusPill label={stale ? 'Not reporting' : 'Sharing'} tone={stale ? 'error' : 'success'} />
        </View>
        <Text style={styles.meta}>{journey.journeyType ? JOURNEY_LABELS[journey.journeyType as JourneyType] ?? journey.journeyType : ''}</Text>
        <Text style={styles.clock}>{formatElapsed(journey.startedAt, now)}</Text>
      </Card>

      {permission && !background ? (
        <Card style={styles.warnCard}>
          <Text style={styles.warnTitle}>Location is not set to &quot;Allow all the time&quot;</Text>
          <Text style={styles.meta}>The bus will stop updating when the screen is locked.</Text>
          <Button title="Fix permission" onPress={fixPermission} fullWidth style={styles.gap} />
        </Card>
      ) : null}

      {stale ? (
        <Card style={styles.warnCard}>
          <Text style={styles.warnTitle}>Parents may be seeing an old position</Text>
          <Text style={styles.meta}>No position has reached the school for over two minutes. Check GPS and mobile data.</Text>
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Text style={styles.label}>Reporting</Text>
        <View style={styles.row}><Text style={styles.meta}>Last position sent</Text><Text style={styles.value}>{lastText}</Text></View>
        <View style={styles.row}><Text style={styles.meta}>Waiting for signal</Text><Text style={styles.value}>{queued}</Text></View>
        <Button title="Send position now" onPress={sendNow} loading={sending} variant="outline" fullWidth style={styles.gap} />
      </Card>

      <Button title="End journey" onPress={end} loading={ending} variant="danger" fullWidth size="lg" />
      <Text style={styles.note}>Keep this phone charged and mobile data on. Positions are sent about every 30 seconds.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  card: { padding: Spacing.md, marginBottom: Spacing.md },
  warnCard: { padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.error },
  warnTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.error },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: 2 },
  gap: { marginTop: Spacing.md },
  title: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  clock: { fontSize: FontSize.xxxl, fontWeight: '700', color: Colors.primary, marginTop: Spacing.sm },
  label: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginBottom: Spacing.xs },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary },
  value: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  note: { fontSize: FontSize.xs, color: Colors.textTertiary, textAlign: 'center', marginTop: Spacing.md },
});
