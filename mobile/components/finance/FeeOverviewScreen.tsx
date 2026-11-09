import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Linking, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter, useLocalSearchParams, type Href } from 'expo-router';
import { BarChart, PieChart } from 'react-native-gifted-charts';
import { financeApi, studentsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { MONTH_NAMES, formatMoney, stepFeeMonth } from '../../services/feeCollect';
import { telUrl } from '../../services/admissions';
import {
  categoryRows, chartBars, classRows, groupByClass, overviewKpis, pendingStudents, screenParams, statusSlices,
  type FeeSummaryData, type OverviewFeeType, type StudentFee,
} from '../../services/feeOverview';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { useToast } from '../ui/Toast';
import Card from '../ui/Card';
import Select from '../ui/Select';
import SegmentedTabs from '../ui/SegmentedTabs';
import StatusPill from '../ui/StatusPill';
import Button from '../ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Summary = FeeSummaryData & { total_pending?: number | string; paid_count?: number; partial_count?: number; unpaid_count?: number; advance_count?: number };
const TONE = { UNPAID: 'error', PARTIAL: 'warning', PAID: 'success', ADVANCE: 'info' } as const;

// Port of the web Fee Overview page: monthly or annual fees with a category filter, totals,
// charts, the class-by-class breakdown with each student, and who still owes. Needs a connection;
// money is never cached on the phone.
export default function FeeOverviewScreen({ canCollect = false }: { canCollect?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ feeType?: string }>();
  const ay = useAcademicYear();
  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const [feeType, setFeeType] = useState<OverviewFeeType>(String(params.feeType).toUpperCase() === 'ANNUAL' ? 'ANNUAL' : 'MONTHLY');
  const [ym, setYm] = useState(current);
  const [categoryId, setCategoryId] = useState(0);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const monthly = feeType === 'MONTHLY';
  const yearId = ay.current?.id ?? null;
  const p = screenParams({ feeType, month: ym.month, year: ym.year, academicYearId: yearId, categoryId: categoryId || null });

  const summary = useScopedQuery('feeSummary', ['overview-screen', JSON.stringify(p)], async () =>
    (await financeApi.getFeeSummary(p)).data as Summary, { enabled: !ay.isLoading, staleTime: 0, retry: false });
  const payments = useScopedQuery('feePayments', ['overview-screen', JSON.stringify(p)], async () =>
    listOf<StudentFee>((await financeApi.getFeePayments({ ...p, page_size: 9999 })).data), { enabled: !ay.isLoading, staleTime: 0, retry: false });
  const cats = useScopedQuery('feeCategories', [feeType], async () =>
    listOf<{ id: number; name: string }>((await (monthly ? financeApi.getMonthlyCategories : financeApi.getAnnualCategories)({ page_size: 9999 })).data));
  const refreshControl = useRefreshControl(summary.refetch, payments.refetch, cats.refetch);

  const data = summary.data;
  const kpi = overviewKpis(data);
  const byCategory = categoryRows(data);
  const byClass = classRows(data);
  const classes = useMemo(() => groupByClass(payments.data ?? []), [payments.data]);
  const pending = useMemo(() => pendingStudents(payments.data ?? []), [payments.data]);
  const slices = statusSlices(data);
  const bars = chartBars(byClass);
  const chartWidth = Math.max(220, width - Spacing.lg * 4);
  const atCurrent = ym.year === current.year && (!monthly || ym.month === current.month);

  const changeType = (t: OverviewFeeType) => { setFeeType(t); setCategoryId(0); setOpen({}); };
  const step = (d: 1 | -1) => setYm(monthly ? stepFeeMonth(ym.year, ym.month, d, current) : { ...ym, year: Math.min(current.year, ym.year + d) });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));

  // The phone number is on the student, not on the fee record, so it is fetched when Call is tapped.
  const call = async (studentId: number) => {
    try {
      const s = (await studentsApi.getStudent(studentId)).data as { parent_phone?: string; guardian_phone?: string };
      const url = telUrl(s.parent_phone || s.guardian_phone || '');
      if (!url) { toast.error('No phone number on file for this student.'); return; }
      await Linking.openURL(url);
    } catch {
      toast.error('Could not look up the phone number.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Fee Overview</Text>
      <SegmentedTabs<OverviewFeeType> value={feeType} onChange={changeType} tabs={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'ANNUAL', label: 'Annual' }]} />

      <View style={styles.nav}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={monthly ? 'Previous month' : 'Previous year'} hitSlop={10} onPress={() => step(-1)}><Text style={styles.arrow}>‹</Text></TouchableOpacity>
        <Text style={styles.navTitle}>{monthly ? `${MONTH_NAMES[ym.month - 1]} ${ym.year}` : `Annual ${ym.year}`}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={monthly ? 'Next month' : 'Next year'} hitSlop={10} disabled={atCurrent} onPress={() => step(1)}>
          <Text style={[styles.arrow, atCurrent && styles.off]}>›</Text>
        </TouchableOpacity>
      </View>
      <Select label="Category" value={categoryId} onChange={setCategoryId}
        options={[{ value: 0, label: 'All categories' }, ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />

      {summary.isLoading ? <Text style={styles.muted}>Loading fee data…</Text> : summary.isError ? (
        <Text style={styles.muted}>Could not load the fee data. Pull down to retry.</Text>
      ) : !data || (kpi.due === 0 && kpi.students === 0) ? (
        <Card style={styles.card}><Text style={styles.muted}>No fee records for this {monthly ? 'month' : 'year'}.</Text></Card>
      ) : (
        <>
          <View style={styles.kpis}>
            <Kpi label="Students" value={String(kpi.students)} />
            <Kpi label="Total due" value={formatMoney(kpi.due)} />
            <Kpi label="Collected" value={formatMoney(kpi.collected)} color={Colors.success} />
            <Kpi label="Balance" value={formatMoney(kpi.balance)} color={Colors.error} />
          </View>

          <Card style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>Collection progress</Text>
              <Text style={styles.cardTitle}>{kpi.rate}%</Text>
            </View>
            <View style={styles.track}><View style={[styles.fill, { width: `${kpi.rate}%` }]} /></View>
            <View style={styles.rowBetween}>
              <Text style={styles.muted}>{formatMoney(kpi.collected)} collected</Text>
              <Text style={styles.muted}>{formatMoney(kpi.balance)} remaining</Text>
            </View>
          </Card>

          {slices.length > 0 ? (
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>Payment status</Text>
              <View style={styles.pie} accessible accessibilityLabel={slices.map((s) => `${s.text}: ${s.value}`).join('. ')}>
                <PieChart data={slices} donut radius={80} innerRadius={50} centerLabelComponent={() => (
                  <View style={styles.center}><Text style={styles.centerNum}>{slices.reduce((t, s) => t + s.value, 0)}</Text><Text style={styles.muted}>students</Text></View>
                )} />
              </View>
              <View style={styles.legend}>
                {slices.map((s) => (
                  <View key={s.text} style={styles.key}><View style={[styles.dot, { backgroundColor: s.color }]} /><Text style={styles.muted}>{s.text} {s.value}</Text></View>
                ))}
              </View>
            </Card>
          ) : null}

          {bars.length > 0 ? (
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>Collection by class</Text>
              <BarChart stackData={bars.map((b) => ({ label: b.label, stacks: b.stacks }))} width={chartWidth} height={140} noOfSections={3}
                barWidth={Math.max(18, Math.min(40, chartWidth / (bars.length * 2 + 1)))} spacing={Math.max(10, chartWidth / (bars.length * 3))}
                yAxisThickness={0} xAxisThickness={1} hideRules isAnimated={false} yAxisTextStyle={styles.axis} xAxisLabelTextStyle={styles.axis}
                formatYLabel={(v: string) => `${Math.round(Number(v) / 1000)}k`} />
            </Card>
          ) : null}

          {byCategory.length > 0 ? (
            <Card style={styles.card}>
              <View style={styles.rowBetween}><Text style={styles.cardTitle}>Category-wise collection</Text><Text style={styles.muted}>{byCategory.length} categories</Text></View>
              {byCategory.map((c) => (
                <View key={c.label} style={styles.cat}>
                  <View style={styles.rowBetween}><Text style={styles.name} numberOfLines={1}>{c.label}</Text><Text style={styles.muted}>{formatMoney(c.collected)} / {formatMoney(c.due)}</Text></View>
                  <View style={styles.track}><View style={[styles.fill, { width: `${c.rate}%` }]} /></View>
                  <View style={styles.rowBetween}><Text style={styles.muted}>{c.count} records</Text><Text style={styles.muted}>{c.rate}% collected</Text></View>
                </View>
              ))}
            </Card>
          ) : null}
        </>
      )}

      {classes.length > 0 ? (
        <>
          <Text style={styles.section}>Class by class</Text>
          {classes.map((c) => (
            <Card key={c.name} style={styles.card}>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: !!open[`c:${c.name}`] }} onPress={() => toggle(`c:${c.name}`)} style={styles.rowBetween}>
                <Text style={styles.name} numberOfLines={1}>{open[`c:${c.name}`] ? '▾' : '▸'} {c.name} ({c.rows.length})</Text>
                <Text style={styles.muted}>Balance {formatMoney(c.balance)}</Text>
              </TouchableOpacity>
              {open[`c:${c.name}`] ? c.rows.map((r) => (
                <View key={r.id} style={styles.student}>
                  <Text style={styles.name} numberOfLines={1}>#{r.student_roll ?? '-'} {r.student_name}</Text>
                  <StatusPill label={r.status} tone={TONE[r.status] ?? 'neutral'} />
                </View>
              )) : null}
            </Card>
          ))}
        </>
      ) : null}

      {pending.count > 0 ? (
        <>
          <View style={styles.rowBetween}>
            <Text style={styles.section}>Pending students</Text>
            <Text style={styles.muted}>{pending.count} · {formatMoney(pending.total)} due</Text>
          </View>
          {pending.groups.map((g) => (
            <Card key={g.name} style={styles.pendingCard}>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open[`p:${g.name}`] !== false }} onPress={() => setOpen((o) => ({ ...o, [`p:${g.name}`]: o[`p:${g.name}`] === false }))} style={styles.rowBetween}>
                <Text style={styles.name} numberOfLines={1}>{open[`p:${g.name}`] === false ? '▸' : '▾'} {g.name} ({g.rows.length})</Text>
                <Text style={styles.owed}>{formatMoney(g.balance)}</Text>
              </TouchableOpacity>
              {open[`p:${g.name}`] !== false ? g.rows.map((r) => (
                <View key={r.id} style={styles.student}>
                  <View style={styles.grow}>
                    <Text style={styles.name} numberOfLines={1}>#{r.student_roll ?? '-'} {r.student_name}</Text>
                    <Text style={styles.muted}>{r.status === 'UNPAID' ? 'Unpaid' : 'Partial'} · {formatMoney(Math.max(0, Number(r.amount_due) - Number(r.amount_paid)))}</Text>
                  </View>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Call parent of ${r.student_name}`} hitSlop={8} onPress={() => call(r.student)}>
                    <Text style={styles.call}>Call</Text>
                  </TouchableOpacity>
                </View>
              )) : null}
            </Card>
          ))}
        </>
      ) : null}

      {canCollect ? (
        <Button title="Collect fees" onPress={() => router.push('/(admin)/finance/fee-collection' as Href)} fullWidth style={styles.collect} />
      ) : null}
    </ScrollView>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.kpi} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={[styles.kpiValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: Spacing.md },
  arrow: { fontSize: 28, color: Colors.primary, paddingHorizontal: Spacing.md },
  off: { color: Colors.border },
  navTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  kpis: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginVertical: Spacing.lg },
  kpi: { width: '47%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  kpiValue: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginTop: 2 },
  card: { marginBottom: Spacing.md },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md },
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.border, marginVertical: Spacing.sm, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  cat: { marginTop: Spacing.md },
  name: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  pie: { alignItems: 'center', marginVertical: Spacing.md },
  center: { alignItems: 'center' },
  centerNum: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.lg, justifyContent: 'center' },
  key: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  axis: { fontSize: 10, color: Colors.textSecondary },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.lg, marginBottom: Spacing.md },
  student: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingTop: Spacing.md },
  grow: { flex: 1 },
  pendingCard: { marginBottom: Spacing.md, borderLeftWidth: 4, borderLeftColor: Colors.warning },
  owed: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.warningText },
  call: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary, minHeight: 44, textAlignVertical: 'center' },
  collect: { marginTop: Spacing.xl },
});
