import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { incomeVsExpense } from '../../services/financeManager';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Income against expenses as two bars with the net underneath. Shared by the finance reports
// and the finance manager home so the two read the same.
export default function IncomeExpenseCard({ income, expenses }: { income: number; expenses: number }) {
  const { net, incomePct, expensePct } = incomeVsExpense(income, expenses);
  return (
    <Card>
      <Bar label="Income" value={income} pct={incomePct} color={Colors.success} />
      <Bar label="Expenses" value={expenses} pct={expensePct} color={Colors.error} />
      <View style={styles.net}>
        <Text style={styles.netLabel}>Net balance</Text>
        <Text style={[styles.netValue, { color: net >= 0 ? Colors.success : Colors.error }]}>{formatMoney(net)}</Text>
      </View>
    </Card>
  );
}

function Bar({ label, value, pct, color }: { label: string; value: number; pct: number; color: string }) {
  return (
    <View style={styles.bar}>
      <View style={styles.barHead}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={[styles.barValue, { color }]}>{formatMoney(value)}</Text>
      </View>
      <View style={styles.track}><View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { marginBottom: Spacing.md },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  barValue: { fontSize: FontSize.sm, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
  net: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.md },
  netLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  netValue: { fontSize: FontSize.lg, fontWeight: '700' },
});
