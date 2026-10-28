import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStudentAssignments, useSubmitAssignment } from '../../hooks/useStudentPortal';
import { canSubmit, dueLabel, submissionBody, taskState, validateSubmission } from '../../services/studentPortal';
import { TASK_PILL } from './StudentTasksScreen';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import Skeleton from '../ui/Skeleton';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// One task: instructions, due date, your hand-in and the teacher's feedback. Work is handed in
// as text and/or a link (the school has no file-upload endpoint yet).
export default function StudentTaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const query = useStudentAssignments();
  const submit = useSubmitAssignment();
  const [text, setText] = useState('');
  const [link, setLink] = useState('');

  if (query.isLoading) return <Skeleton />;
  const a = (query.data ?? []).find((x) => x.id === Number(id));
  if (!a) return <EmptyState title="Task not found" message="It may have been closed or removed." />;

  const state = taskState(a);
  const pill = TASK_PILL[state];

  const send = async () => {
    const problem = validateSubmission(text, link);
    if (problem) { toast.error(problem); return; }
    const yes = await confirm({ title: 'Hand in this work?', message: 'You can only submit once.', confirmLabel: 'Submit' });
    if (!yes) return;
    submit.mutateAsync({ id: a.id, body: submissionBody(text, link) })
      .then(() => { toast.success('Submitted.'); router.back(); })
      .catch((e: any) => toast.error(e?.response?.data?.error || e?.response?.data?.detail || 'Could not submit your work.'));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.top}>
        <Text style={styles.title}>{a.title}</Text>
        <StatusPill label={pill.label} tone={pill.tone} />
      </View>
      <Text style={styles.meta}>{a.subject}{a.teacher ? `  ·  ${a.teacher}` : ''}</Text>
      <Text style={[styles.meta, state === 'overdue' && { color: Colors.error }]}>
        {a.due_date ? `${a.due_date.slice(0, 10)}  ·  ${dueLabel(a.due_date)}` : 'No due date'}{a.total_marks != null ? `  ·  ${a.total_marks} marks` : ''}
      </Text>

      {a.description ? <Card style={styles.card}><Text style={styles.body}>{a.description}</Text></Card> : null}

      {a.submission ? (
        <Card style={styles.card}>
          <Text style={styles.section}>Your hand-in</Text>
          <Text style={styles.meta}>Submitted {a.submission.submitted_at.slice(0, 10)}{a.submission.status === 'LATE' ? ' (late)' : ''}</Text>
          {a.submission.marks_obtained != null ? (
            <Text style={styles.marks}>{a.submission.marks_obtained}{a.total_marks != null ? ` / ${a.total_marks}` : ''} marks</Text>
          ) : <Text style={styles.meta}>Not graded yet.</Text>}
          {a.submission.feedback ? <Text style={styles.body}>Feedback: {a.submission.feedback}</Text> : null}
        </Card>
      ) : canSubmit(a) ? (
        <View style={styles.form}>
          <Text style={styles.section}>Hand in your work</Text>
          <Input label="Your answer" value={text} onChangeText={setText} multiline numberOfLines={6}
            style={{ minHeight: 120, textAlignVertical: 'top' }} />
          <Input label="Link (optional)" value={link} onChangeText={setLink} autoCapitalize="none" keyboardType="url"
            placeholder="https://..." />
          <Button title="Submit" onPress={send} loading={submit.isPending} fullWidth size="lg" />
        </View>
      ) : state === 'info' ? (
        <Text style={styles.meta}>Nothing to hand in for this one.</Text>
      ) : (
        <Text style={styles.meta}>This task is no longer accepting work.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary },
  card: { padding: Spacing.md, marginTop: Spacing.sm },
  body: { fontSize: FontSize.md, color: Colors.text, marginTop: Spacing.xs },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text },
  marks: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.success, marginTop: Spacing.xs },
  form: { marginTop: Spacing.lg, gap: Spacing.md },
});
