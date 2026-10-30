import React, { useMemo } from 'react';
import type { Q } from './types';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useStudentFees } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { feeTotals, sortFees, type PortalFee } from '../../services/studentPortal';
import { MONTH_NAMES, balanceOf, feeLabel, formatMoney, statusTone } from '../../services/feeCollect';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The student's own fee ledger. Paying happens at school: no payment gateway is live.
export function FeesView({ query }: { query: Q<PortalFee[]> }) {
  const refreshControl = useRefreshControl(query.refetch);
  const rows = useMemo(() => sortFees(query.data ?? []), [query.data]);
  const totals = useMemo(() => feeTotals(rows), [rows]);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(f) => String(f.id)}
      refreshControl={refreshControl}
      ListHeaderComponent={rows.length > 0 ? (
        <View>
          <Card style={styles.summary}>
            <Text style={styles.label}>Pending</Text>
            <Text style={[styles.pending, totals.pending === 0 && { color: Colors.success }]}>{formatMoney(totals.pending)}</Text>
            <Text style={styles.sub}>{formatMoney(totals.paid)} paid of {formatMoney(totals.due)}</Text>
          </Card>
          {totals.pending > 0 ? <Text style={styles.note}>Fees are paid at the school office.</Text> : null}
        </View>
      ) : null}
      ListEmptyComponent={<EmptyState title="No fee records" message="Nothing has been billed yet." />}
      renderItem={({ item: f }) => (
        <Card style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{MONTH_NAMES[f.month - 1] ?? f.month} {f.year}</Text>
            <Text style={styles.sub}>
              {feeLabel(f)}{f.handed_over ? '  ·  moved to new branch' : ''}
            </Text>
            <Text style={styles.sub}>
              {formatMoney(Number(f.amount_paid) || 0)} of {formatMoney(Number(f.amount_due) || 0)}
              {balanceOf(f) > 0 && !f.handed_over ? `  ·  ${formatMoney(balanceOf(f))} left` : ''}
            </Text>
          </View>
          <StatusPill label={f.status[0] + f.status.slice(1).toLowerCase()} tone={statusTone(f.status)} />
        </Card>
      )}
    />
  );
}

export default function StudentFeesScreen() {
  return <FeesView query={useStudentFees()} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  summary: { padding: Spacing.lg, alignItems: 'center' },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
  pending: { fontSize: FontSize.xxxl, fontWeight: '700', color: Colors.error },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  note: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginVertical: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, marginTop: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
