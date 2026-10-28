import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  canReturn, firstFieldError, gradeLabel, submissionStats, truncate, validateGrade, type Submission,
} from '../../services/assignments';
import { useAssignment, useSubmissionActions, useSubmissions } from '../../hooks/useAssignments';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill, { type Tone } from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE: Record<Submission['status'], Tone> = {
  PENDING: 'neutral', SUBMITTED: 'info', LATE: 'warning', GRADED: 'success', RETURNED: 'neutral',
};

// Review what students handed in for one assignment: read it, grade it, return it. Needs a
// connection to grade or return.
export default function SubmissionsScreen() {
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const assignmentId = id ? Number(id) : null;
  const assignment = useAssignment(assignmentId);
  const submissions = useSubmissions(assignmentId);
  const { grade, returnToStudent } = useSubmissionActions();
  const refreshControl = useRefreshControl(submissions.refetch, assignment.refetch);

  const [grading, setGrading] = useState<Submission | null>(null);
  const [marks, setMarks] = useState('');
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const list = submissions.data ?? [];
  const stats = useMemo(() => submissionStats(list), [list]);
  const total = assignment.data?.total_marks ?? null;

  const startGrading = (s: Submission) => {
    setGrading(s);
    setMarks(s.marks_obtained != null ? String(s.marks_obtained) : '');
    setFeedback(s.feedback || '');
    setError(null);
  };

  const saveGrade = async () => {
    const problem = validateGrade(marks, total);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await grade.mutateAsync({ id: grading!.id, marks: parseFloat(marks), feedback });
      setGrading(null);
      toast.success('Submission graded.');
    } catch (e: any) {
      if (!e?.response) setError('No connection. Check your internet and try again.');
      else setError(e.response?.data?.detail || e.response?.data?.marks_obtained?.[0] || e.response?.data?.error || firstFieldError(e.response?.data) || 'Failed to grade submission');
    }
  };

  const sendBack = async (s: Submission) => {
    try {
      await returnToStudent.mutateAsync(s.id);
      toast.success('Returned to the student.');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || e?.response?.data?.error || 'Failed to return submission');
    }
  };

  if (assignment.isLoading || submissions.isLoading) return <Skeleton />;
  if (!assignment.data) {
    return assignment.isError
      ? <ErrorState onRetry={() => { assignment.refetch(); submissions.refetch(); }} />
      : <EmptyState title="Assignment not found" message="It may have been deleted." />;
  }
  const a = assignment.data;

  const header = (
    <View>
      <View style={styles.card}>
        <Text style={styles.title}>{a.title}</Text>
        <Text style={styles.meta}>{a.class_name || '--'} · {a.subject_name || '--'}</Text>
        <Text style={styles.meta}>Due {a.due_date || '--'}  ·  Total marks {a.total_marks ?? '--'}</Text>
      </View>
      <View style={styles.stats}>
        <Stat label="Total" value={stats.total} />
        <Stat label="To grade" value={stats.submitted} color={Colors.info} />
        <Stat label="Graded" value={stats.graded} color={Colors.success} />
        <Stat label="Pending" value={stats.pending} color={Colors.textSecondary} />
      </View>
      {stats.late > 0 ? <Text style={styles.lateNote}>{stats.late} handed in late</Text> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={list}
        keyExtractor={(s) => String(s.id)}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No submissions" message="No student has been assigned this work yet." />}
        renderItem={({ item: s }) => {
          const open = expanded.has(s.id);
          const text = s.submission_text || '';
          return (
            <View style={styles.card}>
              <View style={styles.top}>
                <Text style={styles.name} numberOfLines={1}>{s.student_name}</Text>
                <StatusPill label={s.status} tone={TONE[s.status] ?? 'neutral'} />
              </View>
              {s.submitted_at ? <Text style={styles.meta}>Submitted {s.submitted_at.replace('T', ' ').slice(0, 16)}</Text> : null}
              {text ? (
                <TouchableOpacity onPress={() => setExpanded((cur) => { const n = new Set(cur); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}>
                  <Text style={styles.text}>{open ? text : truncate(text)}</Text>
                  {text.length > 140 ? <Text style={styles.more}>{open ? 'Show less' : 'Read more'}</Text> : null}
                </TouchableOpacity>
              ) : null}
              {s.file_url ? (
                <TouchableOpacity onPress={() => Linking.openURL(s.file_url as string)}>
                  <Text style={styles.link}>Open attachment</Text>
                </TouchableOpacity>
              ) : null}
              {s.marks_obtained != null ? <Text style={styles.marks}>Marks: {s.marks_obtained}{total ? ` / ${total}` : ''}</Text> : null}
              {s.feedback ? <Text style={styles.feedback}>“{s.feedback}”</Text> : null}
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => startGrading(s)}><Text style={styles.action}>{gradeLabel(s)}</Text></TouchableOpacity>
                {canReturn(s) ? (
                  <TouchableOpacity disabled={returnToStudent.isPending} onPress={() => sendBack(s)}><Text style={styles.action}>Return</Text></TouchableOpacity>
                ) : null}
              </View>
            </View>
          );
        }}
      />

      <BottomSheet visible={!!grading} onClose={() => setGrading(null)} title={grading ? `Grade ${grading.student_name}` : undefined}>
        <View style={styles.sheet}>
          <Text style={styles.label}>Marks{total ? ` (out of ${total})` : ''}</Text>
          <TextInput style={[styles.input, error ? styles.inputError : null]} keyboardType="decimal-pad" value={marks}
            onChangeText={(t) => { setMarks(t.replace(',', '.')); setError(null); }} placeholder="0" placeholderTextColor={Colors.textTertiary} />
          <Text style={styles.label}>Feedback</Text>
          <TextInput style={[styles.input, styles.multi]} multiline value={feedback} onChangeText={setFeedback}
            placeholder="Optional feedback for the student" placeholderTextColor={Colors.textTertiary} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Save grade" onPress={saveGrade} loading={grade.isPending} fullWidth size="lg" />
        </View>
      </BottomSheet>
    </View>
  );
}

function Stat({ label, value, color = Colors.text }: { label: string; value: number; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  stats: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  stat: { flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.sm, alignItems: 'center' },
  statValue: { fontSize: FontSize.lg, fontWeight: '700' },
  statLabel: { fontSize: 10, color: Colors.textSecondary },
  lateNote: { fontSize: FontSize.xs, color: Colors.warning, marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  text: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.sm },
  more: { fontSize: FontSize.xs, color: Colors.primary, marginTop: 2 },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600', marginTop: Spacing.sm },
  marks: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.success, marginTop: Spacing.sm },
  feedback: { fontSize: FontSize.sm, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 2 },
  actions: { flexDirection: 'row', gap: Spacing.xl, marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  action: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },
  sheet: { paddingHorizontal: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: FontSize.md, color: Colors.text, marginBottom: Spacing.lg,
  },
  inputError: { borderColor: Colors.error },
  multi: { minHeight: 80, textAlignVertical: 'top' },
  error: { fontSize: FontSize.sm, color: Colors.error, marginBottom: Spacing.md },
});
