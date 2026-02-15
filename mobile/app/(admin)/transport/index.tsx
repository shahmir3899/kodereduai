import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { transportApi } from '../../../services/api';
import Card from '../../../components/ui/Card';
import StatCard from '../../../components/StatCard';
import Spinner from '../../../components/ui/Spinner';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Route {
  id: number;
  name: string;
  vehicle_number?: string;
  driver_name?: string;
  student_count: number;
}

export default function Transport() {
  const [routes, setRoutes] = useState<Route[]>([]);
  const [stats, setStats] = useState<{ total_routes: number; total_vehicles: number; total_students: number }>({ total_routes: 0, total_vehicles: 0, total_students: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    try {
      const [statsRes, routesRes] = await Promise.allSettled([
        transportApi.getDashboardStats(),
        transportApi.getRoutes(),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
      if (routesRes.status === 'fulfilled') setRoutes(routesRes.value.data.results || routesRes.value.data || []);
    } catch (error) { console.error('Failed to fetch transport data:', error); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchData(); }, []);
  const onRefresh = () => { setRefreshing(true); fetchData(); };

  if (loading) return <Spinner fullScreen message="Loading transport..." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Transport</Text>
      <View style={styles.statsRow}>
        <StatCard title="Routes" value={stats.total_routes} color={Colors.primary} />
        <StatCard title="Vehicles" value={stats.total_vehicles} color={Colors.success} />
        <StatCard title="Students" value={stats.total_students} color={Colors.warning} />
      </View>
      <Text style={styles.sectionTitle}>Routes</Text>
      {routes.length === 0 ? (
        <EmptyState title="No Routes" message="No transport routes found." />
      ) : (
        routes.map((route) => (
          <Card key={route.id} style={styles.routeCard}>
            <Text style={styles.routeName}>{route.name}</Text>
            {route.vehicle_number && <Text style={styles.routeDetail}>Vehicle: {route.vehicle_number}</Text>}
            {route.driver_name && <Text style={styles.routeDetail}>Driver: {route.driver_name}</Text>}
            <Text style={styles.routeStudents}>{route.student_count} students</Text>
          </Card>
        ))
      )}
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
