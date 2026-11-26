import React from 'react';
import { useRouter, type Href } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { transportApi } from '../../services/api';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import StatCard from '../../components/StatCard';
import QueryList from '../../components/ui/QueryList';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Route {
  id: number;
  name: string;
  vehicle_number?: string;
  driver_name?: string;
  students_count?: number;
  stops_count?: number;
}
// The server sends students_assigned (active assignments), not total_students.
interface Stats { total_routes: number; total_vehicles: number; students_assigned: number }

export default function TransportDashboardScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  // Stats and routes are separate calls; a failed stats call should not hide the route list.
  const stats = useScopedQuery<Stats>('transport-stats', [], async () => (await transportApi.getDashboardStats()).data);
  const routes = useScopedQuery<Route[]>('transport-routes', [], async () => {
    const r = await transportApi.getRoutes();
    return r.data.results || r.data || [];
  });
  const refreshControl = useRefreshControl(stats.refetch, routes.refetch);
  const s = stats.data ?? { total_routes: 0, total_vehicles: 0, students_assigned: 0 };

  return (
    <QueryList
      query={routes}
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={refreshControl}
      emptyTitle="No Routes"
      emptyMessage="No transport routes found."
      keyExtractor={(route) => String(route.id)}
      header={<>
      <Text style={styles.title}>Transport</Text>
      <View style={styles.statsRow}>
        <StatCard title="Routes" value={s.total_routes} color={Colors.primary} />
        <StatCard title="Vehicles" value={s.total_vehicles} color={Colors.success} />
        <StatCard title="Students" value={s.students_assigned ?? 0} color={Colors.warning} />
      </View>
      <View style={styles.links}>
        <Button title="Routes and map" onPress={() => router.push(`${base}/transport/routes` as Href)} />
        <Button title="Vehicles" variant="outline" onPress={() => router.push(`${base}/transport/vehicles` as Href)} />
        <Button title="Student transport" variant="outline" onPress={() => router.push(`${base}/transport/assignments` as Href)} />
        <Button title="Boarding" variant="outline" onPress={() => router.push(`${base}/transport/attendance` as Href)} />
      </View>
      <Text style={styles.sectionTitle}>Routes</Text>
      </>}
      renderItem={(route) => (
          <Card style={styles.routeCard}>
            <Text style={styles.routeName}>{route.name}</Text>
            {route.vehicle_number && <Text style={styles.routeDetail}>Vehicle: {route.vehicle_number}</Text>}
            {route.driver_name && <Text style={styles.routeDetail}>Driver: {route.driver_name}</Text>}
            <Text style={styles.routeStudents}>{route.students_count ?? 0} students</Text>
          </Card>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  links: { gap: Spacing.sm, marginBottom: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  statsRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.xxl },
  sectionTitle: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginBottom: Spacing.md },
  routeCard: { marginBottom: Spacing.sm },
  routeName: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  routeDetail: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  routeStudents: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '500', marginTop: 4 },
});
