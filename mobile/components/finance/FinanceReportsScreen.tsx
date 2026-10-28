import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { routeFor } from '../../navigation/routes';
import { useFinanceSummary } from '../../hooks/useAccountant';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { incomeVsExpense, type Period } from '../../services/accountant';
import { formatMoney } from '../../services/feeCollect';
import SegmentedTabs from '../ui/SegmentedTabs';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'MONTH', label: 'This month' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'YEAR', label: 'This year' },
];

// Income against expenses for a period, with links to the read-only ledgers.
export default function FinanceReportsScreen() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('MONTH');
  const q = useFinanceSummary(period);
  const refreshControl = useRefreshControl(q.refetch);

  const income = Number(q.data?.total_income ?? 0) || 0;
  const expenses = Number(q.data?.total_expenses ?? 0) || 0;
  const { net, incomePct, expensePct } = incomeVsExpense(income, expenses);

  const links = [
    { label: 'Account balances', route: routeFor('accountant', '/finance/accounts') },
    { label: 'Fee records', route: routeFor('accountant', '/finance/fees') },
    { label: 'Other income', route: routeFor('accountant', '/finance/income') },
    { label: 'Expenses', route: routeFor('accountant', '/finance/expenses') },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <SegmentedTabs tabs={PERIODS} value={period} onChange={setPeriod} />
      {q.isLoading ? <Skeleton /> : q.isError && !q.data ? <ErrorState onRetry={() => q.refetch()} /> : (
        <Card>
          <Bar label="Income" value={income} pct={incomePct} color={Colors.success} />
          <Bar label="Expenses" value={expenses} pct={expensePct} color={Colors.error} />
          <View style={styles.net}>
            <Text style={styles.netLabel}>Net</Text>
            <Text style={[styles.netValue, { color: net >= 0 ? Colors.success : Colors.error }]}>{formatMoney(net)}</Text>
          </View>
        </Card>
      )}

      <Text style={styles.section}>Details</Text>
      {links.map((l) => (
        <TouchableOpacity key={l.label} style={styles.link} onPress={() => l.route && router.push(l.route as Href)}>
          <Text style={styles.linkText}>{l.label}</Text>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
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
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  bar: { marginBottom: Spacing.md },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  barLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  barValue: { fontSize: FontSize.sm, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5 },
  net: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.md },
  netLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  netValue: { fontSize: FontSize.lg, fontWeight: '700' },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  linkText: { fontSize: FontSize.md, color: Colors.text },
  arrow: { fontSize: FontSize.xxl, color: Colors.textTertiary },
});
