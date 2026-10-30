import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import { useInventoryDashboard } from '../../hooks/useInventory';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { movementTone, STOCK_LABEL, STOCK_TONE, stockStatus } from '../../services/inventory';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of InventoryDashboard.jsx: totals, stock value, low stock and the latest movements.
export default function InventoryDashboardScreen() {
  const router = useRouter();
  const { persona } = useAuth();
  const q = useInventoryDashboard();
  const refreshControl = useRefreshControl(q.refetch);
  const go = (path: string) => {
    const route = routeFor(persona, path);
    if (route) router.push(route as Href);
  };

  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;

  const tiles = [
    { label: 'Items', value: String(d.total_items), path: '/inventory/items' },
    { label: 'Stock value', value: formatMoney(d.total_value), path: '/inventory/items' },
    { label: 'Low stock', value: String(d.low_stock_count), path: '/inventory/items' },
    { label: 'With people', value: String(d.active_assignments), path: '/inventory/assignments' },
  ];
  const links = [
    { label: 'Items', path: '/inventory/items' },
    { label: 'Stock movements', path: '/inventory/transactions' },
    { label: 'Assignments', path: '/inventory/assignments' },
    { label: 'Reorder prediction', path: '/inventory/reorder-prediction' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <View style={styles.tiles}>
        {tiles.map((t) => (
          <TouchableOpacity accessibilityRole="button" key={t.label} style={styles.tile} onPress={() => go(t.path)}>
            <Text style={[styles.tileValue, t.label === 'Low stock' && d.low_stock_count > 0 && { color: Colors.warning }]} numberOfLines={1} adjustsFontSizeToFit>{t.value}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.meta}>{d.total_categories} categories · {d.total_vendors} vendors</Text>

      <View style={styles.links}>
        {links.map((l) => (
          <TouchableOpacity accessibilityRole="button" key={l.label} style={styles.link} onPress={() => go(l.path)}>
            <Text style={styles.linkText}>{l.label}</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.section}>Needs attention</Text>
      <Card style={styles.list}>
        {d.low_stock_items.length === 0 ? <Text style={styles.muted}>Nothing is running low.</Text> : d.low_stock_items.map((i) => {
          const s = stockStatus(i);
          return (
            <View key={i.id} style={styles.line}>
              <Text style={styles.lineTitle} numberOfLines={1}>{i.name}</Text>
              <Text style={styles.lineSub}>{i.current_stock} / {i.minimum_stock}</Text>
              <StatusPill label={STOCK_LABEL[s]} tone={STOCK_TONE[s]} />
            </View>
          );
        })}
      </Card>

      <Text style={styles.section}>Recent movements</Text>
      <Card style={styles.list}>
        {d.recent_transactions.length === 0 ? <Text style={styles.muted}>No movements yet.</Text> : d.recent_transactions.map((m) => (
          <View key={m.id} style={styles.line}>
            <View style={styles.lineBody}>
              <Text style={styles.lineTitle} numberOfLines={1}>{m.item_name}</Text>
              <Text style={styles.lineSub}>{m.date}</Text>
            </View>
            <StatusPill label={m.transaction_type_display ?? m.transaction_type} tone={movementTone(m.transaction_type)} />
            <Text style={[styles.qty, { color: m.quantity < 0 ? Colors.error : Colors.success }]}>{m.quantity > 0 ? '+' : ''}{m.quantity}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  tile: { width: '47%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  tileValue: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.primary },
  tileLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.sm },
  links: { marginTop: Spacing.lg },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, minHeight: 48 },
  linkText: { fontSize: FontSize.md, color: Colors.text },
  arrow: { fontSize: FontSize.xxl, color: Colors.textTertiary },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  list: { padding: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6 },
  lineBody: { flex: 1 },
  lineTitle: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  lineSub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  qty: { width: 48, textAlign: 'right', fontSize: FontSize.sm, fontWeight: '700' },
});
