import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useClassTimetable } from '../../hooks/useManager';
import { useEditableTimetable, useQualityScore, useTimetableSlots } from '../../hooks/useTimetableEdit';
import { usePdfShare } from '../../hooks/usePdfShare';
import { academicsApi } from '../../services/api';
import { timetableFileName, timetablePdfParams } from '../../services/pdfDownloads';
import { showScore } from '../../services/timetableWeek';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  DAY_CODES, DAY_LABELS, dayCodeFor, daysWithEntries, entriesForDay, formatSlotTime, type DayCode,
} from '../../services/teacher';
import Select from '../ui/Select';
import Button from '../ui/Button';
import SegmentedTabs from '../ui/SegmentedTabs';
import WeekGrid from './WeekGrid';
import { ScoreBadge, ScoreSheet } from './TimetableTools';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Read-only timetable of one class or section, for roles that don't teach (Manager): a day at a time or the whole
// week at a glance, the quality score, and the server's PDF.
export default function ClassTimetableScreen() {
  const { options, isLoading: optionsLoading } = useAttendanceClassOptions();
  const [classId, setClassId] = useState<number | null>(null);
  const [picked, setPicked] = useState<DayCode | null>(null);
  const [view, setView] = useState<'day' | 'week'>('day');
  const [scoreOpen, setScoreOpen] = useState(false);
  const pdf = usePdfShare();

  const option = options.find((o) => o.id === (classId ?? options[0]?.id)) ?? null;
  const query = useClassTimetable(option ? (option.classObj ?? option.id) : null, option?.isSession ? option.id : null);
  const refreshControl = useRefreshControl(query.refetch);
  const classObj = option ? (option.classObj ?? option.id) : null;
  const sessionClass = option?.isSession ? option.id : null;
  const slots = useTimetableSlots();
  const week = useEditableTimetable(classObj, sessionClass);
  const quality = useQualityScore(classObj, (query.data ?? []).length > 0);

  if (optionsLoading) return <Skeleton />;
  if (options.length === 0) return <EmptyState title="No classes" message="This school has no classes set up yet." />;

  const entries = query.data ?? [];
  const days = daysWithEntries(entries);
  const today = dayCodeFor(new Date());
  const day = picked && days.includes(picked) ? picked : (days.includes(today) ? today : days[0]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <Select label="Class" value={option?.id ?? null} searchable options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={(v) => { setClassId(v); setPicked(null); }} />

      {showScore(quality.data) ? <ScoreBadge score={quality.data} onPress={() => setScoreOpen(true)} /> : null}
      <SegmentedTabs tabs={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} value={view} onChange={setView} />
      {view === 'week' ? (
        week.isLoading || slots.isLoading ? <Skeleton /> : (week.data ?? []).length === 0 ? <EmptyState title="No periods yet" message="This class has no timetable." /> : <WeekGrid slots={slots.data ?? []} entries={week.data ?? []} />
      ) : query.isLoading ? <Skeleton /> : query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState title="No periods yet" message="This class has no timetable." />
      ) : (
        <>
          <View style={styles.days}>
            {DAY_CODES.filter((d) => days.includes(d)).map((d) => (
              <TouchableOpacity accessibilityRole="button" key={d} style={[styles.day, d === day && styles.dayActive]} onPress={() => setPicked(d)}>
                <Text style={[styles.dayText, d === day && styles.dayTextActive]}>{DAY_LABELS[d]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {entriesForDay(entries, day).map((e) => (
            <Card key={e.id} style={styles.period}>
              <View style={styles.time}>
                <Text style={styles.timeText}>{formatSlotTime(e.slot_start_time)}</Text>
                <Text style={styles.timeSub}>{formatSlotTime(e.slot_end_time)}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.subject} numberOfLines={1}>{e.subject_name || e.slot_name || 'Period'}</Text>
                <Text style={styles.teacher} numberOfLines={1}>
                  {[(e as { teacher_name?: string }).teacher_name, e.subject_name ? e.slot_name : ''].filter(Boolean).join('  ·  ')}
                </Text>
              </View>
            </Card>
          ))}
        </>
      )}
      {option && timetablePdfParams(classObj, sessionClass) != null ? (
        <Button title="Timetable PDF" variant="outline" loading={pdf.busy} disabled={pdf.busy}
          onPress={() => pdf.share(() => academicsApi.downloadTimetablePdf(timetablePdfParams(classObj, sessionClass) as Record<string, unknown>) as Promise<{ data: ArrayBuffer }>, timetableFileName(option.label))} />
      ) : null}
      <ScoreSheet visible={scoreOpen} onClose={() => setScoreOpen(false)} score={quality.data ?? null} />
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
  period: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, marginBottom: Spacing.sm },
  time: { width: 76, marginRight: Spacing.md },
  timeText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  timeSub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  info: { flex: 1 },
  subject: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  teacher: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
