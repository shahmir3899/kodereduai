import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useStudentTimetable } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { portalPeriods, type PortalPeriod } from '../../services/studentPortal';
import type { Q } from './types';
import { DAY_CODES, DAY_LABELS, dayCodeFor, daysWithEntries, entriesForDay, formatSlotTime, type DayCode } from '../../services/teacher';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The student's own weekly timetable, one day at a time (opens on today).
export function TimetableView({ query, toPeriods }: { query: Q<unknown>; toPeriods: (data: any) => PortalPeriod[] }) {
  const refreshControl = useRefreshControl(query.refetch);
  const periods = useMemo(() => toPeriods(query.data), [query.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<DayCode | null>(null);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (periods.length === 0) return <EmptyState title="No timetable yet" message="The class timetable has not been set up." />;

  const days = daysWithEntries(periods);
  const today = dayCodeFor(new Date());
  const day = picked && days.includes(picked) ? picked : (days.includes(today) ? today : days[0]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <View style={styles.days}>
        {DAY_CODES.filter((d) => days.includes(d)).map((d) => (
          <TouchableOpacity key={d} style={[styles.day, d === day && styles.dayActive]} onPress={() => setPicked(d)}>
            <Text style={[styles.dayText, d === day && styles.dayTextActive]}>{DAY_LABELS[d]}</Text>
            {d === today ? <View style={[styles.dot, d === day && styles.dotActive]} /> : null}
          </TouchableOpacity>
        ))}
      </View>
      {entriesForDay(periods, day).map((p) => (
        <Card key={p.id} style={styles.period}>
          <View style={styles.time}>
            <Text style={styles.timeText}>{formatSlotTime(p.slot_start_time)}</Text>
            <Text style={styles.timeSub}>{formatSlotTime(p.slot_end_time)}</Text>
          </View>
          <View style={styles.info}>
            <Text style={styles.subject} numberOfLines={1}>{p.subject_name || p.slot_name || 'Period'}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {[p.teacher_name, p.room ? `Room ${p.room}` : '', p.subject_name ? p.slot_name : ''].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

export default function StudentTimetableScreen() {
  return <TimetableView query={useStudentTimetable()} toPeriods={portalPeriods} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  days: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  day: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: BorderRadius.md, backgroundColor: Colors.surface },
  dayActive: { backgroundColor: Colors.primary },
  dayText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  dayTextActive: { color: Colors.textInverse },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary, marginTop: 3 },
  dotActive: { backgroundColor: Colors.textInverse },
  period: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, marginBottom: Spacing.sm },
  time: { width: 76, marginRight: Spacing.md },
  timeText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  timeSub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  info: { flex: 1 },
  subject: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
