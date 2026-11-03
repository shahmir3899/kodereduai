import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { categoryShares, type ExpenseCategory } from '../../services/accountant';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Each expense category's amount and share of the period's total, with a bar. Shared by the
// finance reports and the finance dashboard.
export default function ExpenseBreakdownCard({ categories, total, loading }: { categories: ExpenseCategory[] | undefined; total: number | string | undefined; loading?: boolean }) {
  const shares = categoryShares(categories ?? [], total ?? 0);
  return (
    <Card>
      {loading ? <Text style={styles.muted}>Loading…</Text> : shares.length === 0 ? <Text style={styles.muted}>No expenses in this period.</Text> : (
        shares.map((c) => (
          <View key={c.name} style={styles.row}>
            <View style={styles.head}>
              <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.amount}>{formatMoney(c.amount)} · {c.pct}%</Text>
            </View>
            <View style={styles.track}><View style={[styles.fill, { width: `${c.pct}%`, backgroundColor: Colors.error }]} /></View>
          </View>
        ))
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { marginBottom: Spacing.md },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  amount: { fontSize: FontSize.sm, color: Colors.textSecondary },
  track: { height: 10, borderRadius: 5, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
});
