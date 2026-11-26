import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { todayString } from '../../services/attendanceEntry';
import { monthLabel, stepMonth } from '../../services/register';
import {
  ATTENDANCE_LABELS, attendanceCounts, attendanceTone, monthRange, shortTime, sortAttendance,
} from '../../services/myHr';
import { useMyAttendance } from '../../hooks/useMyHr';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius, GlyphSize } from '../../constants/colors';
import AppList from '../ui/AppList';
import RecordCard from '../ui/RecordCard';
import { day } from '../../services/dates';

// The signed-in staff member's own attendance for a month. Read-only: marking is done by an admin.
export default function MyAttendanceScreen() {
  const now = new Date();
  const current = { year: now.getFullYear(), month0: now.getMonth() };
  const [ym, setYm] = useState(current);
  const { start, end } = monthRange(ym.year, ym.month0, todayString());
  const { records, summary } = useMyAttendance(start, end);
  const refreshControl = useRefreshControl(records.refetch, summary.refetch);
  const atCurrent = ym.year === current.year && ym.month0 === current.month0;
  const s = summary.data;
  const c = attendanceCounts(s);

  const header = (
    <View>
      <View style={styles.stepper}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} onPress={() => setYm(stepMonth(ym.year, ym.month0, -1, current))}><Text style={styles.step}>‹</Text></TouchableOpacity>
        <Text style={styles.month}>{monthLabel(ym.year, ym.month0)}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10} disabled={atCurrent} onPress={() => setYm(stepMonth(ym.year, ym.month0, 1, current))}>
          <Text style={[styles.step, atCurrent && styles.stepOff]}>›</Text>
        </TouchableOpacity>
      </View>
      {s ? (
        <View style={styles.cards}>
          <Card label="Present" value={c.present} color={Colors.success} />
          <Card label="Absent" value={c.absent} color={Colors.error} />
          <Card label="Late" value={c.late} color={Colors.warning} />
          <Card label="Half day" value={c.halfDay} color="#ea580c" />
          <Card label="On leave" value={c.onLeave} color={Colors.info} />
          <Card label="Rate" value={c.rate != null ? `${c.rate}%` : '—'} color={Colors.text} />
        </View>
      ) : null}
    </View>
  );

  if (records.isLoading) return <Skeleton />;
  if (records.isError && !records.data) return <ErrorState onRetry={() => { records.refetch(); summary.refetch(); }} />;

  return (
    <AppList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={sortAttendance(records.data ?? [])}
      keyExtractor={(r) => String(r.id)}
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState title="No records" message="No attendance has been recorded for you in this period." />}
      renderItem={({ item: r }) => (
        <RecordCard
          icon="calendar-outline"
          title={day(r.date) || r.date}
          subtitle={`In ${shortTime(r.check_in)}  ·  Out ${shortTime(r.check_out)}`}
          meta={r.notes || undefined}
          status={{ label: r.status_display || ATTENDANCE_LABELS[r.status] || r.status, tone: attendanceTone(r.status) }}
        />
      )}
    />
  );
}

function Card({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <View style={styles.card}>
      <Text style={[styles.cardValue, { color }]}>{value}</Text>
      <Text style={styles.cardLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, marginBottom: Spacing.md },
  step: { fontSize: GlyphSize.lg, color: Colors.primary, paddingHorizontal: Spacing.sm },
  stepOff: { color: Colors.border },
  month: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, minWidth: 140, textAlign: 'center' },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  card: { width: '31%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.sm, alignItems: 'center' },
  cardValue: { fontSize: FontSize.lg, fontWeight: '700' },
  cardLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
