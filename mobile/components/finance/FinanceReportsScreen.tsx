import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import { reportsApi } from '../../services/api';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useExpenseCategories, useFinanceSummary, useMonthlyTrend } from '../../hooks/useAccountant';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  categoryShares, incomeVsExpense, PERIOD_LABELS, rangeFor, trendBars, type DateRange, type Period,
} from '../../services/accountant';
import { formatMoney } from '../../services/feeCollect';
import {
  exportErrorMessage, feeReportFileName, feeReportRequest, financeSummaryFileName, financeSummaryRequest,
} from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import SegmentedTabs from '../ui/SegmentedTabs';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'MONTH', label: 'Month' },
  { value: 'LAST_MONTH', label: 'Last' },
  { value: 'QUARTER', label: 'Quarter' },
  { value: 'YEAR', label: 'Year' },
  { value: 'CUSTOM', label: 'Custom' },
];

// Port of the web Financial Reports page (period presets plus custom range, summary, six-month
// trend, expense breakdown). The PDF export is the server's own FINANCE_SUMMARY report, the file
// the web downloads. Read-only for every role; export is admin and principal only, as on the web.
export default function FinanceReportsScreen() {
  const router = useRouter();
  const toast = useToast();
  const { persona, isSchoolAdminNav, activeSchool } = useAuth();
  const { current: year } = useAcademicYear();
  const [period, setPeriod] = useState<Period>('MONTH');
  const [custom, setCustom] = useState<DateRange>({ from: '', to: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const range = rangeFor(period, custom);
  const summary = useFinanceSummary(range);
  const trend = useMonthlyTrend(6);
  const cats = useExpenseCategories(range);
  const refreshControl = useRefreshControl(summary.refetch, trend.refetch, cats.refetch);

  const income = Number(summary.data?.total_income ?? 0) || 0;
  const expenses = Number(summary.data?.total_expenses ?? 0) || 0;
  const { net, incomePct, expensePct } = incomeVsExpense(income, expenses);
  const bars = trendBars(trend.data ?? []);
  const shares = categoryShares(cats.data?.categories ?? [], cats.data?.total ?? 0);

  const links = [
    { label: 'Account balances', route: routeFor(persona, '/finance/accounts') },
    { label: 'Fee records', route: routeFor(persona, '/finance/fees') },
    { label: 'Collect payments', route: routeFor(persona, '/finance/fees/collect') },
    { label: 'Other income', route: routeFor(persona, '/finance/income') },
    { label: 'Expenses', route: routeFor(persona, '/finance/expenses') },
  ].filter((l) => l.route);

  const runExport = async (key: string, fetchBytes: () => Promise<{ data: ArrayBuffer }>, fileName: string) => {
    setBusy(key);
    try {
      await shareReportFile(fetchBytes, fileName, 'pdf');
    } catch (e) {
      toast.error((e as Error)?.message && !(e as { response?: unknown }).response ? (e as Error).message : exportErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const now = new Date();
  const month = now.getMonth() + 1;
  const fullYear = now.getFullYear();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <SegmentedTabs tabs={PERIODS} value={period} onChange={setPeriod} />
      {period === 'CUSTOM' ? (
        <View style={styles.dates}>
          <View style={styles.date}><DateField label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} /></View>
          <View style={styles.date}><DateField label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} /></View>
        </View>
      ) : null}
      {period === 'CUSTOM' && !range ? <Text style={styles.hint}>Pick both dates (From must not be after To).</Text> : null}

      {range ? (
        summary.isLoading ? <Skeleton /> : summary.isError && !summary.data ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : (
          <Card>
            <Bar label="Income" value={income} pct={incomePct} color={Colors.success} />
            <Bar label="Expenses" value={expenses} pct={expensePct} color={Colors.error} />
            <View style={styles.net}>
              <Text style={styles.netLabel}>Net balance</Text>
              <Text style={[styles.netValue, { color: net >= 0 ? Colors.success : Colors.error }]}>{formatMoney(net)}</Text>
            </View>
          </Card>
        )
      ) : null}

      <Text style={styles.section}>Monthly trend (last 6 months)</Text>
      <Card>
        {trend.isLoading ? <Text style={styles.muted}>Loading…</Text> : bars.length === 0 ? <Text style={styles.muted}>No data yet.</Text> : (
          <>
            {bars.map((b) => (
              <View key={b.label} style={styles.trendRow} accessible accessibilityLabel={`${b.label}: income ${formatMoney(b.income)}, expenses ${formatMoney(b.expenses)}`}>
                <Text style={styles.trendLabel}>{b.label}</Text>
                <View style={styles.trendBars}>
                  <View style={[styles.trendBar, { width: `${b.incomePct}%`, backgroundColor: Colors.success }]} />
                  <View style={[styles.trendBar, { width: `${b.expensePct}%`, backgroundColor: Colors.error }]} />
                </View>
                <Text style={styles.trendValue}>{formatMoney(b.income - b.expenses)}</Text>
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

      {range ? (
        <>
          <Text style={styles.section}>Expense breakdown</Text>
          <Card>
            {cats.isLoading ? <Text style={styles.muted}>Loading…</Text> : shares.length === 0 ? <Text style={styles.muted}>No expenses in this period.</Text> : (
              shares.map((c) => (
                <View key={c.name} style={styles.catRow}>
                  <View style={styles.catHead}>
                    <Text style={styles.catName} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.catAmount}>{formatMoney(c.amount)} · {c.pct}%</Text>
                  </View>
                  <View style={styles.track}><View style={[styles.fill, { width: `${c.pct}%`, backgroundColor: Colors.error }]} /></View>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}

      {isSchoolAdminNav ? (
        <>
          <Text style={styles.section}>Export PDF</Text>
          <Text style={styles.hint}>Same files as the web app. They open in your phone's share sheet.</Text>
          <View style={styles.exports}>
            <Button
              title={`Finance report${range ? '' : ' (pick dates)'}`} variant="outline" disabled={!range || busy !== null}
              loading={busy === 'summary'}
              onPress={() => range && runExport('summary',
                () => reportsApi.generateInstant(financeSummaryRequest(range, PERIOD_LABELS[period], year?.id)),
                financeSummaryFileName(activeSchool?.name ?? '', range))}
            />
            <Button
              title="Fee collection, this month" variant="outline" disabled={busy !== null} loading={busy === 'collection'}
              onPress={() => runExport('collection',
                () => reportsApi.generateInstant(feeReportRequest('FEE_COLLECTION', month, fullYear, year?.id)),
                feeReportFileName('FEE_COLLECTION', month, fullYear))}
            />
            <Button
              title="Fee defaulters, this month" variant="outline" disabled={busy !== null} loading={busy === 'defaulters'}
              onPress={() => runExport('defaulters',
                () => reportsApi.generateInstant(feeReportRequest('FEE_DEFAULTERS', month, fullYear, year?.id)),
                feeReportFileName('FEE_DEFAULTERS', month, fullYear))}
            />
          </View>
        </>
      ) : null}

      <Text style={styles.section}>Details</Text>
      {links.map((l) => (
        <TouchableOpacity accessibilityRole="button" key={l.label} style={styles.link} onPress={() => router.push(l.route as Href)}>
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
  dates: { flexDirection: 'row', gap: Spacing.md },
  date: { flex: 1 },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
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
  trendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  trendLabel: { width: 52, fontSize: FontSize.xs, color: Colors.textSecondary },
  trendBars: { flex: 1, gap: 2 },
  trendBar: { height: 6, borderRadius: 3 },
  trendValue: { width: 84, textAlign: 'right', fontSize: FontSize.xs, color: Colors.text },
  legend: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xs },
  legendText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  catRow: { marginBottom: Spacing.md },
  catHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4, gap: Spacing.sm },
  catName: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  catAmount: { fontSize: FontSize.sm, color: Colors.textSecondary },
  exports: { gap: Spacing.sm },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  linkText: { fontSize: FontSize.md, color: Colors.text },
  arrow: { fontSize: FontSize.xxl, color: Colors.textTertiary },
});
