import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { transportApi } from '../../../services/api';
import { useScopedQuery } from '../../../hooks/useScopedQuery';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import Card from '../../../components/ui/Card';
import StatCard from '../../../components/StatCard';
import QueryBoundary from '../../../components/ui/QueryBoundary';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

interface Route {
  id: number;
  name: string;
  vehicle_number?: string;
  driver_name?: string;
  student_count: number;
}
interface Stats { total_routes: number; total_vehicles: number; total_students: number }

export default function Transport() {
  // Stats and routes are separate calls; a failed stats call should not hide the route list.
  const stats = useScopedQuery<Stats>('transport-stats', [], async () => (await transportApi.getDashboardStats()).data);
  const routes = useScopedQuery<Route[]>('transport-routes', [], async () => {
    const r = await transportApi.getRoutes();
    return r.data.results || r.data || [];
  });
  const refreshControl = useRefreshControl(stats.refetch, routes.refetch);
  const s = stats.data ?? { total_routes: 0, total_vehicles: 0, total_students: 0 };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.title}>Transport</Text>
      <View style={styles.statsRow}>
        <StatCard title="Routes" value={s.total_routes} color={Colors.primary} />
        <StatCard title="Vehicles" value={s.total_vehicles} color={Colors.success} />
        <StatCard title="Students" value={s.total_students} color={Colors.warning} />
      </View>
      <Text style={styles.sectionTitle}>Routes</Text>
      <QueryBoundary query={routes} emptyTitle="No Routes" emptyMessage="No transport routes found.">
        {(list) => list.map((route) => (
          <Card key={route.id} style={styles.routeCard}>
            <Text style={styles.routeName}>{route.name}</Text>
            {route.vehicle_number && <Text style={styles.routeDetail}>Vehicle: {route.vehicle_number}</Text>}
            {route.driver_name && <Text style={styles.routeDetail}>Driver: {route.driver_name}</Text>}
            <Text style={styles.routeStudents}>{route.student_count} students</Text>
          </Card>
        ))}
      </QueryBoundary>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  statsRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.xxl },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginBottom: Spacing.md },
  routeCard: { marginBottom: Spacing.sm },
  routeName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  routeDetail: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  routeStudents: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '500', marginTop: 4 },
});
