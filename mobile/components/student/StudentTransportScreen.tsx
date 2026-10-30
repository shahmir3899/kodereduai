import React from 'react';
import type { Q } from './types';
import { View, Text, ScrollView, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { useStudentTransport } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { formatSlotTime } from '../../services/teacher';
import type { PortalTransport } from '../../services/studentPortal';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The student's bus route, stop and vehicle. Static info: live tracking is not part of the student app.
export function TransportView({ query }: { query: Q<PortalTransport | null> }) {
  const refreshControl = useRefreshControl(query.refetch);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const t = query.data;
  if (!t) return <EmptyState title="No school transport" message="No bus route is assigned." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Card style={styles.card}>
        <Text style={styles.section}>Route</Text>
        <Text style={styles.title}>{t.route.name}</Text>
        <Text style={styles.meta}>{[t.route.start_location, t.route.end_location].filter(Boolean).join(' → ')}</Text>
        <Text style={styles.meta}>
          {[t.route.distance_km ? `${t.route.distance_km} km` : '', t.route.estimated_duration_minutes ? `${t.route.estimated_duration_minutes} min` : '', t.transport_type].filter(Boolean).join('  ·  ')}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Your stop</Text>
        <Text style={styles.title}>{t.stop.name}</Text>
        {t.stop.address ? <Text style={styles.meta}>{t.stop.address}</Text> : null}
        <View style={styles.times}>
          <View><Text style={styles.label}>Pickup</Text><Text style={styles.time}>{formatSlotTime(t.stop.pickup_time) || '–'}</Text></View>
          <View><Text style={styles.label}>Drop-off</Text><Text style={styles.time}>{formatSlotTime(t.stop.drop_time) || '–'}</Text></View>
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.section}>Vehicle</Text>
        <Text style={styles.title}>{t.vehicle.vehicle_number || '–'}</Text>
        <Text style={styles.meta}>{t.vehicle.vehicle_type}</Text>
        {t.vehicle.driver_name ? (
          <View style={styles.driver}>
            <Text style={styles.meta}>Driver: {t.vehicle.driver_name}</Text>
            {t.vehicle.driver_phone ? (
              <TouchableOpacity accessibilityRole="button" onPress={() => Linking.openURL(`tel:${t.vehicle.driver_phone}`)}>
                <Text style={styles.call}>Call {t.vehicle.driver_phone}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </Card>
    </ScrollView>
  );
}

export default function StudentTransportScreen() {
  return <TransportView query={useStudentTransport()} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { padding: Spacing.md, marginBottom: Spacing.md },
  section: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginBottom: Spacing.xs },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  times: { flexDirection: 'row', gap: Spacing.xxl, marginTop: Spacing.md },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary },
  time: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.primary },
  driver: { marginTop: Spacing.sm },
  call: { fontSize: FontSize.md, fontWeight: '600', color: Colors.primary, marginTop: Spacing.xs },
});
