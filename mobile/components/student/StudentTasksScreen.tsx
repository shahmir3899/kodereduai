import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useStudentAssignments } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { dueLabel, filterTasks, sortTasks, taskState, type TaskState, type TaskTab } from '../../services/studentPortal';
import SegmentedTabs from '../ui/SegmentedTabs';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill, { type Tone } from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export const TASK_PILL: Record<TaskState, { label: string; tone: Tone }> = {
  open: { label: 'To do', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'error' },
  submitted: { label: 'Submitted', tone: 'warning' },
  graded: { label: 'Graded', tone: 'success' },
  info: { label: 'Notice', tone: 'neutral' },
};

// Homework and notices for the student's section. Tap one to read it and hand in work.
export default function StudentTasksScreen() {
  const router = useRouter();
  const query = useStudentAssignments();
  const refreshControl = useRefreshControl(query.refetch);
  const [tab, setTab] = useState<TaskTab>('TODO');
  const shown = useMemo(() => sortTasks(filterTasks(query.data ?? [], tab)), [query.data, tab]);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={shown}
      keyExtractor={(a) => String(a.id)}
      refreshControl={refreshControl}
      ListHeaderComponent={
        <SegmentedTabs<TaskTab> value={tab} onChange={setTab}
          tabs={[{ value: 'TODO', label: 'To do' }, { value: 'DONE', label: 'Done' }, { value: 'ALL', label: 'All' }]} />
      }
      ListEmptyComponent={<EmptyState title={tab === 'TODO' ? 'Nothing to do' : 'No tasks'} message={tab === 'TODO' ? 'You are all caught up.' : undefined} />}
      renderItem={({ item: a }) => {
        const state = taskState(a);
        const pill = TASK_PILL[state];
        return (
          <TouchableOpacity accessibilityRole="button" style={styles.card} onPress={() => router.push({ pathname: '/(student)/assignments/detail', params: { id: a.id } } as Href)}>
            <View style={styles.top}>
              <Text style={styles.title} numberOfLines={2}>{a.title}</Text>
              <StatusPill label={pill.label} tone={pill.tone} />
            </View>
            <Text style={styles.meta}>{a.subject}{a.teacher ? `  ·  ${a.teacher}` : ''}</Text>
            <Text style={[styles.due, state === 'overdue' && styles.late]}>
              {state === 'graded' && a.submission?.marks_obtained != null
                ? `${a.submission.marks_obtained}${a.total_marks != null ? ` / ${a.total_marks}` : ''} marks`
                : state === 'submitted' || state === 'info' ? (a.due_date ? a.due_date.slice(0, 10) : '') : dueLabel(a.due_date)}
            </Text>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  due: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
  late: { color: Colors.error, fontWeight: '700' },
});
