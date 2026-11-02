import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useStudentAttendance } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { attendanceCells, rateTone, type AttendanceCode, type PortalAttendance } from '../../services/studentPortal';
import type { Q } from './types';
import { monthTitle, shiftMonth } from '../../services/manager';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const COLORS: Record<AttendanceCode, string> = {
  PRESENT: Colors.success, ABSENT: Colors.error, LATE: Colors.warning, LEAVE: Colors.info,
};
const LEGEND: Array<[AttendanceCode, string]> = [['PRESENT', 'Present'], ['ABSENT', 'Absent'], ['LATE', 'Late'], ['LEAVE', 'Leave']];
const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

// Month calendar with the summary for that month.
export interface MonthData { records: PortalAttendance['records']; summary: PortalAttendance['summary'] }

export function AttendanceView({ useMonth }: { useMonth: (year: number, month: number) => Q<MonthData> }) {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const query = useMonth(ym.year, ym.month);
  const refreshControl = useRefreshControl(query.refetch);
  const cells = useMemo(() => attendanceCells(ym.year, ym.month, query.data?.records ?? []), [ym, query.data]);
  const atCurrent = ym.year === now.getFullYear() && ym.month === now.getMonth() + 1;

  const summary = query.data?.summary;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <View style={styles.nav}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setYm(shiftMonth(ym.year, ym.month, -1))}><Text style={styles.arrow}>‹</Text></TouchableOpacity>
        <Text style={styles.title}>{monthTitle(ym.year, ym.month)}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" disabled={atCurrent} onPress={() => setYm(shiftMonth(ym.year, ym.month, 1))}>
          <Text style={[styles.arrow, atCurrent && styles.off]}>›</Text>
        </TouchableOpacity>
      </View>

      {query.isLoading ? <Skeleton /> : query.isError && !query.data ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (
        <>
          {summary ? (
            <Card style={styles.summary}>
              <View style={styles.rateRow}>
                <Text style={styles.rate}>{summary.total_days > 0 ? `${summary.rate}%` : '–'}</Text>
                {summary.total_days > 0 ? <StatusPill label={summary.rate >= 90 ? 'Good' : summary.rate >= 75 ? 'Fair' : 'Low'} tone={rateTone(summary.rate)} /> : null}
              </View>
              <Text style={styles.sub}>
                {summary.present} present · {summary.absent} absent · {summary.late} late · {summary.leave} leave · {summary.total_days} days
              </Text>
            </Card>
          ) : null}

          <View style={styles.grid}>
            {WEEK.map((w, i) => <Text key={i} style={styles.weekday}>{w}</Text>)}
            {cells.map((c, i) => (
              <View key={i} style={styles.cell}>
                {c.day ? (
                  <View style={[styles.day, c.status ? { backgroundColor: COLORS[c.status] } : null]}>
                    <Text style={[styles.dayText, c.status ? { color: Colors.textInverse } : null]}>{c.day}</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>

          <View style={styles.legend}>
            {LEGEND.map(([code, label]) => (
              <View key={code} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: COLORS[code] }]} />
                <Text style={styles.legendText}>{label}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

export default function StudentAttendanceScreen() {
  return <AttendanceView useMonth={useStudentAttendance} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  arrow: { fontSize: 28, color: Colors.primary, paddingHorizontal: Spacing.md },
  off: { color: Colors.textTertiary },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  summary: { padding: Spacing.md, marginBottom: Spacing.lg },
  rateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  rate: { fontSize: FontSize.xxxl, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.sm },
  weekday: { width: '14.285%', textAlign: 'center', fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, paddingVertical: Spacing.xs },
  cell: { width: '14.285%', alignItems: 'center', paddingVertical: 3 },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: FontSize.sm, color: Colors.text },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.lg, marginTop: Spacing.lg },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 12, height: 12, borderRadius: 6 },
  legendText: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
