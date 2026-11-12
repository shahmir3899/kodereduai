import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useRoutes, useTransportActions } from '../../hooks/useTransport';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { routeCounts, routeLine, type RouteRow } from '../../services/routeMap';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Card from '../ui/Card';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import RouteFormSheet from './RouteFormSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The school's bus routes: add one, duplicate one, or open it to see its map and stops. Admin and
// principal manage; a teacher sees the routes and their maps read-only.
export default function TransportRoutesScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  const { isSchoolAdminNav: canManage } = useAuth();
  const toast = useToast();
  const routes = useRoutes();
  const actions = useTransportActions();
  const refreshControl = useRefreshControl(routes.refetch);
  const [adding, setAdding] = useState(false);

  const duplicate = async (r: RouteRow) => {
    if (!(await confirm({ title: 'Duplicate this route?', message: `A copy of ${r.name} is made with its stops, without its students.`, confirmLabel: 'Duplicate' }))) return;
    try { await actions.duplicateRoute.mutateAsync(r.id); toast.success('Route duplicated.'); }
    catch (e) { toast.error(inventoryErrorMessage(e, 'Could not duplicate the route.')); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {canManage ? <Button title="+ Add a route" size="sm" onPress={() => setAdding(true)} /> : null}
      <QueryBoundary query={routes} emptyTitle="No routes" emptyMessage="Add the first route, then its stops.">
        {(list) => list.map((r) => (
          <Card key={r.id} style={styles.card}>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: `${base}/transport/route`, params: { id: String(r.id) } } as unknown as Href)}>
              <View style={styles.head}>
                <Text style={styles.name}>{r.name}</Text>
                {!r.is_active ? <StatusPill label="Inactive" tone="neutral" /> : null}
              </View>
              <Text style={styles.sub}>{routeLine(r)}</Text>
              <Text style={styles.sub}>{routeCounts(r)}</Text>
            </TouchableOpacity>
            <View style={styles.row}>
              <Button title="Map and stops" size="sm" style={styles.flex} onPress={() => router.push({ pathname: `${base}/transport/route`, params: { id: String(r.id) } } as unknown as Href)} />
              {canManage ? <Button title="Duplicate" size="sm" variant="outline" onPress={() => duplicate(r)} disabled={actions.duplicateRoute.isPending} /> : null}
            </View>
          </Card>
        ))}
      </QueryBoundary>
      <RouteFormSheet visible={adding} route={null} onClose={() => setAdding(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  card: { gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
});
