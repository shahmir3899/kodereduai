import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useMyTimetable } from '../../hooks/useTeacher';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  DAY_CODES, DAY_LABELS, dayCodeFor, daysWithEntries, entriesForDay, formatSlotTime, type DayCode,
} from '../../services/teacher';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import Card from '../../components/ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export default function TeacherSchedule() {
  const query = useMyTimetable();
  const refreshControl = useRefreshControl(query.refetch);
  const today = dayCodeFor(new Date());
  const [picked, setPicked] = useState<DayCode | null>(null);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const entries = query.data ?? [];
  if (entries.length === 0) {
    return <EmptyState title="No periods yet" message="Your timetable has no periods assigned to you." />;
  }

  // Open on today, or on the first teaching day when today has no periods.
  const days = daysWithEntries(entries);
  const day = picked ?? (days.includes(today) ? today : days[0]);
  const list = entriesForDay(entries, day);

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

      {list.map((e) => (
        <Card key={e.id} style={styles.period}>
          <View style={styles.time}>
            <Text style={styles.timeText}>{formatSlotTime(e.slot_start_time)}</Text>
            <Text style={styles.timeSub}>{formatSlotTime(e.slot_end_time)}</Text>
          </View>
          <View style={styles.info}>
            <Text style={styles.subject} numberOfLines={1}>{e.subject_name || e.slot_name || 'Period'}</Text>
            <Text style={styles.cls} numberOfLines={1}>{e.class_name}{e.slot_name && e.subject_name ? `  ·  ${e.slot_name}` : ''}</Text>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
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
  cls: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
