import React, { useMemo } from 'react';
import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { examinationsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { groupSubjectsByExam, type ScheduleSubject } from '../../services/examViews';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface PublishedExam { id: number; name: string; class_name?: string; start_date?: string | null; end_date?: string | null }

// Published exam dates for the signed-in teacher's classes and subjects. The server already
// scopes both lists to what the teacher teaches, so nothing is filtered here.
export default function ExamScheduleScreen() {
  const exams = useScopedQuery('examSchedule', ['exams'], async () =>
    listOf<PublishedExam>((await examinationsApi.getExams({ schedule_published: true, page_size: 9999, is_active: true })).data),
  { staleTime: 60_000 });
  const subjects = useScopedQuery('examSchedule', ['subjects'], async () =>
    listOf<ScheduleSubject>((await examinationsApi.getExamSubjects({ page_size: 9999 })).data),
  { staleTime: 60_000 });
  const refreshControl = useRefreshControl(exams.refetch, subjects.refetch);
  const byExam = useMemo(() => groupSubjectsByExam(subjects.data ?? []), [subjects.data]);

  if (exams.isLoading || subjects.isLoading) return <Skeleton />;
  if ((exams.isError && !exams.data) || (subjects.isError && !subjects.data)) {
    return <ErrorState onRetry={() => { exams.refetch(); subjects.refetch(); }} />;
  }
  if ((exams.data ?? []).length === 0) {
    return <EmptyState title="No exam schedules yet" message="No exam schedules have been published for your classes yet." />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {(exams.data ?? []).map((exam) => {
        const list = byExam[exam.id] ?? [];
        return (
          <Card key={exam.id} style={styles.card}>
            <Text style={styles.title}>{exam.class_name ? `${exam.class_name} — ` : ''}{exam.name}</Text>
            {exam.start_date ? <Text style={styles.dates}>{exam.start_date}{exam.end_date ? ` — ${exam.end_date}` : ''}</Text> : null}
            {list.length === 0 ? (
              <Text style={styles.muted}>Subject dates not set yet.</Text>
            ) : (
              list.map((s) => (
                <View key={s.id} style={styles.row}>
                  <Text style={styles.subject} numberOfLines={1}>{s.subject_code || s.subject_name}</Text>
                  <Text style={styles.date}>{s.exam_date || '—'}</Text>
                </View>
              ))
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { padding: Spacing.md, marginBottom: Spacing.md },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  dates: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, marginBottom: Spacing.sm },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  subject: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  date: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
