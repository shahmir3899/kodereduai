import React from 'react';
import type { Q } from './types';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useStudentExamSchedule } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { dateRange, sortSheet, type ExamScheduleExam } from '../../services/studentPortal';
import { formatSlotTime } from '../../services/teacher';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Date sheet of the student's own class. Only appears once the school publishes it.
export function ExamScheduleView({ query }: { query: Q<ExamScheduleExam[]> }) {
  const refreshControl = useRefreshControl(query.refetch);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const exams = query.data ?? [];
  if (exams.length === 0) return <EmptyState title="No exam schedule" message="The date sheet has not been published yet." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {exams.map((e) => (
        <Card key={e.exam_id} style={styles.exam}>
          <Text style={styles.name}>{e.exam_name}</Text>
          <Text style={styles.meta}>{[e.exam_type, dateRange(e.start_date, e.end_date)].filter(Boolean).join('  ·  ')}</Text>
          {sortSheet(e.subjects).map((s, i) => (
            <View key={`${s.subject_name}-${i}`} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subject} numberOfLines={1}>{s.subject_name}</Text>
                <Text style={styles.meta}>
                  {[s.exam_date, s.start_time ? `${formatSlotTime(s.start_time)}${s.end_time ? ` – ${formatSlotTime(s.end_time)}` : ''}` : ''].filter(Boolean).join('  ·  ') || 'Date to be announced'}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      ))}
    </ScrollView>
  );
}

export default function StudentExamScheduleScreen() {
  return <ExamScheduleView query={useStudentExamSchedule()} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  exam: { padding: Spacing.md, marginBottom: Spacing.md },
  name: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row', paddingTop: Spacing.sm, marginTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  subject: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
