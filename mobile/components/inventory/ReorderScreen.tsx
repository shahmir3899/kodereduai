import React from 'react';
import { FlatList, View, Text, StyleSheet, type RefreshControlProps } from 'react-native';
import { useReorderPrediction } from '../../hooks/useInventory';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { SEVERITY_TONE, stockoutText } from '../../services/inventory';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of ReorderPredictionPage.jsx. The server works this out from past usage on each request, so
// the phone keeps the last result for five minutes and "Refresh" asks for a new one.
export default function ReorderScreen() {
  const q = useReorderPrediction();
  const refreshControl = useRefreshControl(q.refetch) as React.ReactElement<RefreshControlProps>;
  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={d.items}
      keyExtractor={(i) => String(i.item_id)}
      refreshControl={refreshControl}
      ListHeaderComponent={
        <View style={styles.head}>
          <Text style={styles.summary}>{d.at_risk_count} of {d.total_items} items may run out soon</Text>
          <Button title="Refresh prediction" size="sm" variant="outline" onPress={() => q.refetch()} loading={q.isFetching} disabled={q.isFetching} />
        </View>
      }
      ListEmptyComponent={<EmptyState title="Nothing at risk" message="No item is expected to run out soon." />}
      renderItem={({ item: i }) => (
        <View style={styles.row}>
          <View style={styles.top}>
            <Text style={styles.name} numberOfLines={1}>{i.item_name}</Text>
            <StatusPill label={i.severity} tone={SEVERITY_TONE[i.severity]} />
          </View>
          <Text style={styles.sub}>
            {[i.category_name, `${i.current_stock} left (alert at ${i.minimum_stock})`, stockoutText(i.days_until_stockout)].filter(Boolean).join('  ·  ')}
          </Text>
          {i.avg_weekly_consumption ? <Text style={styles.sub}>Uses about {i.avg_weekly_consumption} a week{i.consumption_trend ? `, ${i.consumption_trend.toLowerCase()}` : ''}</Text> : null}
          {i.suggested_action ? <Text style={styles.action}>{i.suggested_action}</Text> : null}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  head: { marginBottom: Spacing.md, gap: Spacing.sm },
  summary: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: 2 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  action: { fontSize: FontSize.sm, color: Colors.primary, marginTop: 4 },
});
