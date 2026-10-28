import React from 'react';
import { View, Text, ScrollView, Linking, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useBusTracking } from '../../hooks/useParent';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { latestPoint, mapUrl } from '../../services/parentPortal';
import { timeAgo } from '../../services/messaging';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Where the child's bus is while a journey is running. Refreshes every 15 seconds while open;
// the position opens in the phone's maps app (no in-app map yet).
export default function TrackBusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useBusTracking(Number(id), true);
  const refreshControl = useRefreshControl(query.refetch);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const t = query.data;
  if (!t || !t.active) {
    return <EmptyState title="Bus not on the road" message={t?.message || 'There is no active journey on your child\'s route right now.'} />;
  }

  const point = latestPoint(t.locations);
  const url = mapUrl(point);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Card style={styles.card}>
        <View style={styles.top}>
          <Text style={styles.title}>{t.journey?.route_name || 'Route'}</Text>
          <StatusPill label={t.journey?.status_display || 'Active'} tone="success" />
        </View>
        <Text style={styles.meta}>
          {[t.journey?.journey_type_display, t.journey?.vehicle_number, t.journey?.driver_name].filter(Boolean).join('  ·  ')}
        </Text>
        {t.student_stop?.name ? <Text style={styles.meta}>Your child's stop: {t.student_stop.name}</Text> : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>Last position</Text>
        {point ? (
          <>
            <Text style={styles.title}>{timeAgo(point.timestamp)} ago</Text>
            <Text style={styles.meta}>{Number(point.latitude).toFixed(5)}, {Number(point.longitude).toFixed(5)}{point.speed ? `  ·  ${Math.round(Number(point.speed) * 3.6)} km/h` : ''}</Text>
            {url ? <Button title="Open in Maps" onPress={() => Linking.openURL(url)} style={{ marginTop: Spacing.md }} /> : null}
          </>
        ) : <Text style={styles.meta}>The bus has not sent a position yet.</Text>}
      </Card>
      <Text style={styles.note}>Updates every 15 seconds while this screen is open.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { padding: Spacing.md, marginBottom: Spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  label: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  note: { fontSize: FontSize.xs, color: Colors.textTertiary, textAlign: 'center' },
});
