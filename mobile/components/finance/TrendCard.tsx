import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { trendBars, type TrendMonth } from '../../services/accountant';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Income and expenses per month as paired bars with the net on the right. Shared by the finance
// reports and the finance dashboard so the two read the same.
export default function TrendCard({ trend, loading }: { trend: TrendMonth[] | undefined; loading?: boolean }) {
  const bars = trendBars(trend ?? []);
  return (
    <Card>
      {loading ? <Text style={styles.muted}>Loading…</Text> : bars.length === 0 ? <Text style={styles.muted}>No data yet.</Text> : (
        <>
          {bars.map((b) => (
            <View key={b.label} style={styles.row} accessible accessibilityLabel={`${b.label}: income ${formatMoney(b.income)}, expenses ${formatMoney(b.expenses)}`}>
              <Text style={styles.label}>{b.label}</Text>
              <View style={styles.bars}>
                <View style={[styles.bar, { width: `${b.incomePct}%`, backgroundColor: Colors.success }]} />
                <View style={[styles.bar, { width: `${b.expensePct}%`, backgroundColor: Colors.error }]} />
              </View>
              <Text style={styles.value}>{formatMoney(b.income - b.expenses)}</Text>
            </View>
          ))}
          <View style={styles.legend}>
            <Text style={[styles.legendText, { color: Colors.success }]}>■ Income</Text>
            <Text style={[styles.legendText, { color: Colors.error }]}>■ Expenses</Text>
            <Text style={styles.legendText}>Right: net</Text>
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  label: { width: 52, fontSize: FontSize.xs, color: Colors.textSecondary },
  bars: { flex: 1, gap: 2 },
  bar: { height: 6, borderRadius: 3 },
  value: { width: 84, textAlign: 'right', fontSize: FontSize.xs, color: Colors.text },
  legend: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xs },
  legendText: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
