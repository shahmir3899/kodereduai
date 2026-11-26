import React from 'react';
import { View, Text, StyleSheet, type RefreshControlProps } from 'react-native';
import { useReorderPrediction } from '../../hooks/useInventory';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { SEVERITY_TONE, stockoutText } from '../../services/inventory';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import AppList from '../ui/AppList';
import RecordCard from '../ui/RecordCard';

// Port of ReorderPredictionPage.jsx. The server works this out from past usage on each request, so
// the phone keeps the last result for five minutes and "Refresh" asks for a new one.
export default function ReorderScreen() {
  const q = useReorderPrediction();
  const refreshControl = useRefreshControl(q.refetch) as React.ReactElement<RefreshControlProps>;
  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <AppList
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
        <RecordCard
          icon="cube-outline"
          title={i.item_name}
          status={{ label: i.severity, tone: SEVERITY_TONE[i.severity] }}
          subtitle={[i.category_name, `${i.current_stock} left (alert at ${i.minimum_stock})`, stockoutText(i.days_until_stockout)].filter(Boolean).join('  ·  ')}
          meta={i.avg_weekly_consumption ? `Uses about ${i.avg_weekly_consumption} a week${i.consumption_trend ? `, ${i.consumption_trend.toLowerCase()}` : ''}` : undefined}
          footer={i.suggested_action ? <Text style={styles.action}>{i.suggested_action}</Text> : undefined}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  head: { marginBottom: Spacing.md, gap: Spacing.sm },
  summary: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  action: { fontSize: FontSize.sm, color: Colors.primary, marginTop: 4 },
});
