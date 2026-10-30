import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { feeBreakdown, money } from '../../services/dashboardView';
import type { FinanceSection } from '../../services/adminDashboard';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// This month's monthly-fee collection: collected, pending, and how many are paid, partly paid and unpaid.
export default function MonthlyFeeCard({ fee, onDetails }: { fee: FinanceSection | null | undefined; onDetails?: () => void }) {
  const b = feeBreakdown(fee);
  if (!b) return null;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Monthly fees this month</Text>
        {onDetails ? (
          <TouchableOpacity accessibilityRole="button" onPress={onDetails} style={styles.linkBox}>
            <Text style={styles.link}>View details</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.track} accessibilityRole="progressbar" accessibilityLabel="Fees collected"
        accessibilityValue={b.rate == null ? undefined : { min: 0, max: 100, now: b.rate }}>
        <View style={[styles.fill, { width: `${b.rate ?? 0}%` }]} />
      </View>
      <Text style={styles.rate}>{b.rate == null ? 'Nothing due this month' : `${b.rate}% collected of ${money(b.due)}`}</Text>
      <View style={styles.cells}>
        <View style={[styles.cell, { backgroundColor: Colors.successLight }]}>
          <Text style={[styles.cellLabel, { color: Colors.successText }]}>Collected</Text>
          <Text style={[styles.cellValue, { color: Colors.successText }]}>{money(b.collected)}</Text>
        </View>
        <View style={[styles.cell, { backgroundColor: Colors.warningLight }]}>
          <Text style={[styles.cellLabel, { color: Colors.warningText }]}>Pending</Text>
          <Text style={[styles.cellValue, { color: Colors.warningText }]}>{money(b.pending)}</Text>
        </View>
      </View>
      <Text style={styles.counts}>Paid {b.paid}  ·  Partial {b.partial}  ·  Unpaid {b.unpaid}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  linkBox: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },
  track: { height: 10, borderRadius: 5, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden', marginTop: Spacing.xs },
  fill: { height: 10, backgroundColor: Colors.success },
  rate: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4 },
  cells: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  cell: { flex: 1, borderRadius: BorderRadius.md, padding: Spacing.sm },
  cellLabel: { fontSize: FontSize.xs },
  cellValue: { fontSize: FontSize.md, fontWeight: '700', marginTop: 2 },
  counts: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm },
});
