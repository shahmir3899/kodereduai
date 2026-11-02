import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { COVERAGE_FILTERS, coverageStats, topicName, topicStatus, type CoverageFilter, type CoverageTopic } from '../../services/curriculumCoverage';
import { uniqueSubjects } from '../../services/dailyDiary';
import { inventoryErrorMessage } from '../../services/inventory';
import type { ClassOption } from '../../services/attendanceEntry';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useClassSubjectRows } from '../../hooks/useAssignments';
import { useCoverageTopics, useSetPlannedDate } from '../../hooks/useCoverage';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Which topics of a class and subject are taught and tested, and when each is planned. The planned
// date can be set or cleared here (the web page does the same); taught and tested come from the
// lesson plans and tests themselves. A teacher passes their own sections.
export default function CurriculumCoverageScreen({ classOptions }: { classOptions?: ClassOption[] }) {
  const toast = useToast();
  const { year, options, isLoading } = useAttendanceClassOptions(classOptions);
  const yearId = year.current?.id ?? null;
  const [classId, setClassId] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [coverage, setCoverage] = useState<CoverageFilter>('');

  const picked = classId ?? (options.length === 1 ? options[0].id : null);
  const option = options.find((o) => o.id === picked) ?? null;
  const masterClassId = option ? (option.classObj ?? option.id) : null;
  const subjectRows = useClassSubjectRows(masterClassId);
  const subjects = useMemo(() => uniqueSubjects(subjectRows.data ?? []), [subjectRows.data]);
  const topicsQ = useCoverageTopics(masterClassId, subjectId, coverage, yearId);
  const setDate = useSetPlannedDate(yearId);
  const refreshControl = useRefreshControl(topicsQ.refetch);
  const topics = topicsQ.data ?? [];
  const stats = coverageStats(topics);

  const save = (t: CoverageTopic, date: string | null) =>
    setDate.mutateAsync({ topicId: t.id, date }).catch((e) => toast.error(inventoryErrorMessage(e, 'Could not save the planned date.')));

  const header = (
    <View>
      <Select label="Class" value={picked} options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={(id) => { setClassId(id); setSubjectId(null); }} placeholder="Select a class" />
      <Select label="Subject" value={subjectId} options={subjects.map((s) => ({ value: s.id, label: s.code ? `${s.code} - ${s.name}` : s.name }))}
        onChange={setSubjectId} disabled={!option || subjectRows.isLoading}
        placeholder={!option ? 'Select a class first' : subjectRows.isLoading ? 'Loading subjects...' : subjects.length ? 'Select a subject' : 'No subjects assigned'} />
      <Select label="Show" value={coverage} options={COVERAGE_FILTERS.map((f) => ({ value: f.value, label: f.label }))}
        onChange={setCoverage} placeholder="All topics" />
      {subjectId ? (
        <View style={styles.tiles}>
          <Tile label="Topics" value={stats.total} color={Colors.text} />
          <Tile label="Taught" value={stats.taught} color={Colors.success} />
          <Tile label="Tested" value={stats.tested} color={Colors.info} />
        </View>
      ) : null}
    </View>
  );

  if (isLoading) return <Skeleton />;
  if (options.length === 0) return <EmptyState title="No classes" message="There is no class you can see coverage for." />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={subjectId && !topicsQ.isLoading && !topicsQ.isError ? topics : []}
      keyExtractor={(t) => String(t.id)}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={header}
      ListEmptyComponent={
        !subjectId ? <EmptyState title="Pick a class and subject" message="Choose a class and a subject to see its topics." />
          : topicsQ.isLoading ? <Skeleton />
          : topicsQ.isError ? <ErrorState error={topicsQ.error} onRetry={() => topicsQ.refetch()} />
          : <EmptyState title="No topics" message="No topics match these filters." />
      }
      renderItem={({ item: t }) => {
        const status = topicStatus(t);
        return (
          <Card style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.title} numberOfLines={2}>{topicName(t)}</Text>
              <StatusPill label={status.label} tone={status.tone} />
            </View>
            <Text style={styles.meta}>
              {t.lesson_plan_count ?? 0} lesson plan{(t.lesson_plan_count ?? 0) === 1 ? '' : 's'}  ·  {t.test_question_count ?? 0} question{(t.test_question_count ?? 0) === 1 ? '' : 's'}  ·  Taught {t.taught_date || 'not yet'}
            </Text>
            <DateField label="Planned date" value={t.planned_date} onChange={(d) => save(t, d)} placeholder="Not set" />
            {t.planned_date ? (
              <TouchableOpacity accessibilityRole="button" style={styles.clearBox} onPress={() => save(t, null)} disabled={setDate.isPending}>
                <Text style={styles.clear}>Clear planned date</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        );
      }}
    />
  );
}

function Tile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Card style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, { color }]}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  tiles: { flexDirection: 'row', gap: Spacing.sm, marginVertical: Spacing.md },
  tile: { flex: 1, padding: Spacing.md },
  tileLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  tileValue: { fontSize: FontSize.xl, fontWeight: '700' },
  card: { padding: Spacing.md, marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs, marginBottom: Spacing.sm },
  clearBox: { minHeight: 44, justifyContent: 'center' },
  clear: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
});
