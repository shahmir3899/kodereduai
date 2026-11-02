import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, StyleSheet } from 'react-native';
import { stepFeeMonth } from '../../services/feeCollect';
import { BarChart } from 'react-native-gifted-charts';
import { financeApi } from '../../services/api';
import { categoryRows, chartBars, classRows, hasOverview, overviewParams, type FeeSummaryData, type OverviewRow } from '../../services/feeOverview';
import { formatMoney, MONTH_NAMES } from '../../services/feeCollect';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Card from '../ui/Card';
import SegmentedTabs from '../ui/SegmentedTabs';
import { Colors, FontSize, Spacing } from '../../constants/colors';

type By = 'category' | 'class';

// This month's monthly-fee collection, by category or by class, as a stacked chart (collected and
// still pending) with the figures under it. Same server summary the web Fee Overview uses. Shows
// nothing while loading, on a failure, or when there are no fee records yet.
export default function FeeOverviewCard() {
  const { width } = useWindowDimensions();
  const year = useAcademicYear();
  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const [ym, setYm] = useState(current);
  const { month, year: fullYear } = ym;
  const [by, setBy] = useState<By>('category');
  // 'feeSummary' is a money root: always fetched fresh, never cached on the phone.
  const q = useScopedQuery('feeSummary', ['overview', month, fullYear, year.current?.id ?? null], async () =>
    (await financeApi.getFeeSummary(overviewParams(month, fullYear, year.current?.id ?? null))).data as FeeSummaryData,
  { enabled: !year.isLoading, staleTime: 0, retry: false });

  const rows: OverviewRow[] = useMemo(() => (by === 'category' ? categoryRows(q.data) : classRows(q.data)), [q.data, by]);
  // Nothing while loading or on a failure. With no records the card stays, so an earlier month can be chosen.
  if (q.isLoading || q.isError) return null;
  const empty = !hasOverview(q.data);

  const bars = chartBars(rows);
  const chartWidth = Math.max(220, width - Spacing.lg * 4);

  return (
    <Card style={styles.card}>
      <View style={styles.nav}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} onPress={() => setYm(stepFeeMonth(ym.year, ym.month, -1, current))}><Text style={styles.arrow}>‹</Text></TouchableOpacity>
        <Text style={styles.title}>Fee collection, {MONTH_NAMES[month - 1]} {fullYear}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10} disabled={ym.year === current.year && ym.month === current.month} onPress={() => setYm(stepFeeMonth(ym.year, ym.month, 1, current))}><Text style={[styles.arrow, ym.year === current.year && ym.month === current.month && styles.off]}>›</Text></TouchableOpacity>
      </View>
      {empty ? <Text style={styles.axis}>No fee records for this month.</Text> : <>
      <SegmentedTabs<By> value={by} onChange={setBy} tabs={[{ value: 'category', label: 'By category' }, { value: 'class', label: 'By class' }]} />
      <View accessible accessibilityLabel={rows.map((r) => `${r.label}: ${r.rate} percent collected`).join('. ')}>
        <BarChart
          stackData={bars.map((b) => ({ label: b.label, stacks: b.stacks }))}
          width={chartWidth}
          height={140}
          barWidth={Math.max(18, Math.min(40, chartWidth / (rows.length * 2 + 1)))}
          spacing={Math.max(10, chartWidth / (rows.length * 3))}
          noOfSections={3}
          yAxisThickness={0}
          xAxisThickness={1}
          hideRules
          yAxisTextStyle={styles.axis}
          xAxisLabelTextStyle={styles.axis}
          isAnimated={false}
          formatYLabel={(v: string) => `${Math.round(Number(v) / 1000)}k`}
        />
      </View>
      <View style={styles.legend}>
        <View style={styles.key}><View style={[styles.dot, { backgroundColor: '#16a34a' }]} /><Text style={styles.axis}>Collected</Text></View>
        <View style={styles.key}><View style={[styles.dot, { backgroundColor: '#fca5a5' }]} /><Text style={styles.axis}>Pending</Text></View>
      </View>
      {rows.map((r) => (
        <TouchableOpacity key={r.label} accessibilityRole="text" activeOpacity={1} style={styles.row}>
          <Text style={styles.label} numberOfLines={1}>{r.label}</Text>
          <Text style={styles.value}>{formatMoney(r.collected)} of {formatMoney(r.due)}  ·  {r.rate}%</Text>
        </TouchableOpacity>
      ))}
      </>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.lg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  arrow: { fontSize: 26, color: Colors.primary, paddingHorizontal: Spacing.sm },
  off: { color: Colors.border },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  axis: { fontSize: 10, color: Colors.textSecondary },
  legend: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  key: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: Spacing.md },
  label: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  value: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
