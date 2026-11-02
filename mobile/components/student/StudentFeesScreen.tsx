import React, { useMemo, useState } from 'react';
import type { Q } from './types';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useStudentFees } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { defaultFeeYear, feeTotals, feeYears, filterFeesByYear, sortFees, type FeeYear, type PortalFee } from '../../services/studentPortal';
import { MONTH_NAMES, balanceOf, feeLabel, formatMoney, statusTone } from '../../services/feeCollect';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import SegmentedTabs from '../ui/SegmentedTabs';
import StatusPill from '../ui/StatusPill';
import KuickpayReceivedLabel from '../finance/KuickpayReceivedLabel';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The student's own fee ledger. Paying happens at school: no payment gateway is live.
export function FeesView({ query }: { query: Q<PortalFee[]> }) {
  const refreshControl = useRefreshControl(query.refetch);
  const all = useMemo(() => sortFees(query.data ?? []), [query.data]);
  const years = useMemo(() => feeYears(all), [all]);
  const [picked, setPicked] = useState<FeeYear | null>(null);
  const year: FeeYear = picked !== null && (picked === 'ALL' || years.includes(picked)) ? picked : defaultFeeYear(years);
  const rows = useMemo(() => filterFeesByYear(all, year), [all, year]);
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
      ListHeaderComponent={all.length > 0 ? (
        <View>
          {years.length > 1 ? (
            <SegmentedTabs<string> scrollable value={String(year)} onChange={(v) => setPicked(v === 'ALL' ? 'ALL' : Number(v))}
              tabs={[{ value: 'ALL', label: 'All' }, ...years.map((y) => ({ value: String(y), label: String(y) }))]} />
          ) : null}
          <View style={styles.tiles}>
            <Card style={styles.tile}><Text style={styles.label}>Total due</Text><Text style={styles.tileValue}>{formatMoney(totals.due)}</Text></Card>
            <Card style={styles.tile}><Text style={styles.label}>Total paid</Text><Text style={[styles.tileValue, { color: Colors.success }]}>{formatMoney(totals.paid)}</Text></Card>
            <Card style={styles.tile}>
              <Text style={styles.label}>Outstanding</Text>
              <Text style={[styles.tileValue, { color: totals.pending > 0 ? Colors.error : Colors.success }]}>{formatMoney(totals.pending)}</Text>
            </Card>
          </View>
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
            <KuickpayReceivedLabel kuickpay={f.kuickpay} />
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
  tiles: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  tile: { flex: 1, padding: Spacing.md },
  tileValue: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginTop: 2 },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  note: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginVertical: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, marginTop: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
