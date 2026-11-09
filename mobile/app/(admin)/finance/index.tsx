import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../../contexts/AuthContext';
import { reportsApi } from '../../../services/api';
import { routeFor } from '../../../navigation/routes';
import { useAcademicYear } from '../../../hooks/useAcademicYear';
import {
  useAccountBalances, useAccountBalancesAll, useAnnualFeeSummary, useExpenseCategories, useFinanceSummary,
  useMonthlyCollection, useMonthlyTrend, useRecentEntries, useRecentTransfers,
} from '../../../hooks/useAccountant';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import { PERIOD_LABELS, rangeFor, totalBalance, type AccountBalance, type DateRange, type Period } from '../../../services/accountant';
import { canSeeRecentEntries, hasMultipleSchools } from '../../../services/financeDashboard';
import { formatMoney } from '../../../services/feeCollect';
import { exportErrorMessage, financeSummaryFileName, financeSummaryRequest } from '../../../services/reports';
import { shareReportFile } from '../../../services/reportShare';
import FeeOverviewCard from '../../../components/finance/FeeOverviewCard';
import MonthlyFeeCollectionCard from '../../../components/finance/MonthlyFeeCollectionCard';
import AnnualFeeCard from '../../../components/finance/AnnualFeeCard';
import AccountBalancesCard from '../../../components/finance/AccountBalancesCard';
import LedgerPreviewSheet from '../../../components/finance/LedgerPreviewSheet';
import TrendCard from '../../../components/finance/TrendCard';
import ExpenseBreakdownCard from '../../../components/finance/ExpenseBreakdownCard';
import { RecentEntriesCard, RecentTransfersCard } from '../../../components/finance/RecentActivityCards';
import SegmentedTabs from '../../../components/ui/SegmentedTabs';
import DateField from '../../../components/ui/DateField';
import Button from '../../../components/ui/Button';
import Card from '../../../components/ui/Card';
import { useToast } from '../../../components/ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'MONTH', label: 'Month' },
  { value: 'LAST_MONTH', label: 'Last' },
  { value: 'QUARTER', label: 'Quarter' },
  { value: 'YEAR', label: 'Year' },
  { value: 'CUSTOM', label: 'Custom' },
];

// Port of the web Finance Dashboard: a period picker that drives the income, expense and net
// figures and the expense breakdown, balances you can open as a ledger preview, annual and monthly
// fee collection, the six-month trend and the latest transfers and entries. The detailed Reports
// screen stays for the full export set. Every query here is a money root, so none of it is cached.
export default function FinanceDashboard() {
  const router = useRouter();
  const toast = useToast();
  const { user, isPrincipal, activeSchool } = useAuth();
  const { current: year } = useAcademicYear();
  const multi = hasMultipleSchools(user?.schools?.length ?? 0, !!user?.is_super_admin);
  const showEntries = canSeeRecentEntries(isPrincipal);

  const [period, setPeriod] = useState<Period>('MONTH');
  const [custom, setCustom] = useState<DateRange>({ from: '', to: '' });
  const [preview, setPreview] = useState<{ account: AccountBalance; schoolId: number | null } | null>(null);
  const [exporting, setExporting] = useState(false);

  const range = rangeFor(period, custom);
  const summary = useFinanceSummary(range);
  const cats = useExpenseCategories(range);
  const trend = useMonthlyTrend(6);
  const single = useAccountBalances(!multi);
  const all = useAccountBalancesAll(multi);
  const fee = useMonthlyCollection(multi);
  const annual = useAnnualFeeSummary(multi);
  const transfers = useRecentTransfers(5);
  const entries = useRecentEntries(15);
  const refreshControl = useRefreshControl(
    summary.refetch, cats.refetch, trend.refetch, single.refetch, all.refetch, fee.refetch, annual.refetch, transfers.refetch, entries.refetch,
  );

  const go = (route?: string) => route && router.push(route as Href);
  const balanceTotal = multi ? (all.data?.grandTotal ?? 0) : totalBalance(single.data ?? []);
  const balanceReady = multi ? !!all.data : !!single.data;
  const income = Number(summary.data?.total_income ?? 0) || 0;
  const expenses = Number(summary.data?.total_expenses ?? 0) || 0;
  const net = Number(summary.data?.balance ?? income - expenses) || 0;
  const loadingSummary = !!range && summary.isLoading;
  const money = (v: number) => (loadingSummary ? '…' : formatMoney(v));

  const exportPdf = async () => {
    if (!range) return;
    setExporting(true);
    try {
      await shareReportFile(
        () => reportsApi.generateInstant(financeSummaryRequest(range, PERIOD_LABELS[period], year?.id)),
        financeSummaryFileName(activeSchool?.name ?? '', range), 'pdf',
      );
    } catch (e) {
      toast.error((e as Error)?.message && !(e as { response?: unknown }).response ? (e as Error).message : exportErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  const openFullLedger = (a: AccountBalance) => {
    setPreview(null);
    router.push({ pathname: '/(admin)/finance/account-ledger', params: { id: a.id, name: a.name } } as Href);
  };

  // An account of another branch can be previewed (its school is named on the call) but not opened in the full ledger.
  const otherSchool = !!preview?.schoolId && preview.schoolId !== activeSchool?.id;

  const kpis = [
    { label: 'Account balance', value: balanceReady ? formatMoney(balanceTotal) : '—', color: Colors.text },
    { label: 'Total income', value: money(income), color: Colors.success },
    { label: 'Total expenses', value: money(expenses), color: Colors.error },
    { label: 'Net balance', value: money(net), color: net >= 0 ? Colors.info : Colors.error },
    { label: 'Monthly fee rate', value: fee.data?.rate != null ? `${fee.data.rate}%` : '—', color: Colors.info },
  ];

  const actions = [
    { title: 'Record fee payment', route: routeFor('admin', '/finance/fees/collect'), color: Colors.primary },
    { title: 'Add expense', route: routeFor('admin', '/finance/expenses'), color: Colors.error },
    { title: 'Record income', route: routeFor('admin', '/finance/income'), color: Colors.success },
    { title: 'Record transfer', route: '/(admin)/finance/transfers', color: Colors.secondary },
    { title: 'Transaction history', route: '/(admin)/finance/transactions', color: Colors.info },
    { title: 'Financial reports and exports', route: '/(admin)/finance/reports', color: Colors.info },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Finance Dashboard</Text>
      <Text style={styles.sub}>{PERIOD_LABELS[period]} overview</Text>

      <SegmentedTabs tabs={PERIODS} value={period} onChange={setPeriod} />
      {period === 'CUSTOM' ? (
        <View style={styles.dates}>
          <View style={styles.date}><DateField label="From" value={custom.from} onChange={(v) => setCustom((c) => ({ ...c, from: v }))} /></View>
          <View style={styles.date}><DateField label="To" value={custom.to} onChange={(v) => setCustom((c) => ({ ...c, to: v }))} /></View>
        </View>
      ) : null}
      {period === 'CUSTOM' && !range ? <Text style={styles.hint}>Pick both dates (From must not be after To).</Text> : null}

      <View style={styles.kpis}>
        {kpis.map((k) => (
          <View key={k.label} style={styles.kpi} accessible accessibilityLabel={`${k.label}: ${k.value}`}>
            <Text style={styles.kpiLabel}>{k.label}</Text>
            <Text style={[styles.kpiValue, { color: k.color }]} numberOfLines={1} adjustsFontSizeToFit>{k.value}</Text>
          </View>
        ))}
      </View>
      {range && summary.isError && !summary.data ? <Text style={styles.hint}>Could not load the period totals. Pull down to retry.</Text> : null}
      <Button title="Export PDF" variant="outline" size="sm" onPress={exportPdf} loading={exporting} disabled={!range || exporting} />

      <View style={styles.gap} />
      <MonthlyFeeCollectionCard summary={fee.data} loading={fee.isLoading} onDetails={() => go(routeFor('admin', '/finance/fees'))} />
      <FeeOverviewCard />
      <AnnualFeeCard summary={annual.data} loading={annual.isLoading} onDetails={() => router.push({ pathname: '/(admin)/finance/fee-overview', params: { feeType: 'ANNUAL' } } as Href)} />

      <AccountBalancesCard
        accounts={multi ? undefined : single.data}
        groups={multi ? all.data?.groups : undefined}
        total={balanceTotal}
        loading={multi ? all.isLoading : single.isLoading}
        onOpen={(account, schoolId) => setPreview({ account, schoolId: schoolId ?? null })}
        onManage={!isPrincipal ? () => go(routeFor('admin', '/finance/accounts')) : undefined}
      />

      <Text style={styles.section}>Expense breakdown</Text>
      {range ? <ExpenseBreakdownCard categories={cats.data?.categories} total={cats.data?.total} loading={cats.isLoading} /> : <Card><Text style={styles.hint}>Pick a period.</Text></Card>}

      <Text style={styles.section}>Monthly trend (last 6 months)</Text>
      <TrendCard trend={trend.data} loading={trend.isLoading} />

      <View style={styles.gap} />
      <RecentTransfersCard transfers={transfers.data} loading={transfers.isLoading} onAll={() => go('/(admin)/finance/transfers')} />
      {showEntries ? <RecentEntriesCard entries={entries.data} /> : null}

      <Text style={styles.section}>Quick actions</Text>
      {actions.filter((a) => a.route).map((a) => (
        <TouchableOpacity key={a.title} accessibilityRole="button" activeOpacity={0.7} onPress={() => go(a.route)}>
          <Card style={styles.nav}>
            <View style={[styles.indicator, { backgroundColor: a.color }]} />
            <Text style={styles.navTitle}>{a.title}</Text>
            <Text style={styles.arrow}>›</Text>
          </Card>
        </TouchableOpacity>
      ))}

      <LedgerPreviewSheet account={preview?.account ?? null} schoolId={otherSchool ? preview?.schoolId : null} canOpenFull={!otherSchool}
        onClose={() => setPreview(null)} onFull={openFullLedger} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  dates: { flexDirection: 'row', gap: Spacing.md },
  date: { flex: 1 },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginVertical: Spacing.sm },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginVertical: Spacing.lg },
  kpi: { width: '47%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  kpiLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  kpiValue: { fontSize: FontSize.lg, fontWeight: '700', marginTop: 2 },
  gap: { height: Spacing.lg },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.sm, marginBottom: Spacing.md },
  nav: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  indicator: { width: 4, height: 28, borderRadius: BorderRadius.full, marginRight: Spacing.md },
  navTitle: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  arrow: { fontSize: FontSize.xxl, color: Colors.textTertiary, fontWeight: '300' },
});
