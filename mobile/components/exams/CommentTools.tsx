import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { examinationsApi } from '../../services/api';
import {
  MAX_COMMENT_CHARS, commentErrorMessage, commentProblem, isJobActive, jobPercent, jobProgressLabel, jobSummary, justFinished,
  sourceBadge, type CommentJob, type CommentRowData,
} from '../../services/examComments';
import { saveFailureMessage } from '../../services/errorKind';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Button from '../ui/Button';
import StatusPill from '../ui/StatusPill';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Starts the server's background comment run for an exam and follows it once a second while it
// is active, so the screen picks the run back up after a restart. `onFinished` refetches the
// results once, when a run that was active ends.
export function CommentJobCard({ examId, onFinished }: { examId: number; onFinished: () => void }) {
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const jobQ = useScopedQuery<CommentJob>('commentJob', [examId], async () => (await examinationsApi.getCommentJob(examId)).data, {
    staleTime: 0,
    refetchInterval: (query) => (isJobActive((query.state.data as CommentJob | undefined)?.status) ? 1000 : false),
  });
  const job = jobQ.data;
  const active = isJobActive(job?.status);

  const prev = useRef<{ id?: string; active: boolean }>({ active: false });
  useEffect(() => {
    if (!job) return;
    if (justFinished(prev.current, job)) {
      setMessage({ text: jobSummary(job), error: job.status === 'FAILED' });
      onFinished();
    }
    prev.current = { id: job.task_id, active };
  }, [job?.task_id, job?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different exam is a different run: forget the last exam's message.
  useEffect(() => { setMessage(null); prev.current = { active: false }; }, [examId]);

  const start = async (force: boolean) => {
    if (force && !(await confirm({
      title: 'Regenerate all comments?',
      message: 'Every generated comment for this exam is written again. Comments you edited by hand are kept.',
      confirmLabel: 'Regenerate all',
    }))) return;
    setMessage(null);
    setStarting(true);
    try {
      await examinationsApi.generateComments(examId, force);
      await jobQ.refetch();
    } catch (e) {
      setMessage({ text: commentErrorMessage(e, saveFailureMessage(e, 'Could not start comment generation.')), error: true });
    } finally { setStarting(false); }
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      await examinationsApi.cancelCommentJob(examId);
      await jobQ.refetch();
    } catch (e) {
      setMessage({ text: commentErrorMessage(e, saveFailureMessage(e, 'Could not stop the run.')), error: true });
    } finally { setCancelling(false); }
  };

  const percent = jobPercent(job);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>AI report card comments</Text>
      <Text style={styles.help}>Writes a comment for each student&apos;s subjects and an overall comment, from their marks and attendance. You can edit any of them after.</Text>
      <View style={styles.buttons}>
        <Button title={starting || active ? 'Generating...' : 'Generate comments'} size="sm" onPress={() => start(false)} loading={starting} disabled={starting || active} />
        <Button title="Regenerate all" size="sm" variant="outline" onPress={() => start(true)} disabled={starting || active} />
      </View>
      {active ? (
        <View style={styles.progress}>
          <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={percent == null ? undefined : { min: 0, max: 100, now: percent }}>
            <View style={[styles.fill, { width: `${percent ?? 5}%` }]} />
          </View>
          <Text style={styles.progressText} accessibilityLiveRegion="polite">{jobProgressLabel(job)}</Text>
          {!job?.cancel_requested ? <Button title="Stop" size="sm" variant="ghost" onPress={cancel} loading={cancelling} disabled={cancelling} /> : null}
        </View>
      ) : null}
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.message, message.error && styles.messageError]}>{message.text}</Text> : null}
    </View>
  );
}

interface RowProps {
  row: CommentRowData;
  onSave: (text: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  // The report card does not know where a comment came from, so it passes false and shows no badge.
  showSource?: boolean;
}

// One comment (overall or one subject): the text with its source, edit in place, regenerate.
export function CommentRow({ row, onSave, onRegenerate, showSource = true }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState<'save' | 'regen' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const badge = showSource ? sourceBadge(row.source, !!row.text) : null;

  const run = async (kind: 'save' | 'regen', fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try { await fn(); setEditing(false); }
    catch (e) { setError(commentErrorMessage(e, saveFailureMessage(e, 'Could not save. Please try again.'))); }
    finally { setBusy(null); }
  };

  const save = () => {
    const problem = commentProblem(draft);
    if (problem) return setError(problem);
    run('save', () => onSave(draft.trim()));
  };

  // A regenerate replaces hand-written text, so ask first when there is some.
  const regenerate = async () => {
    if (row.text && !(await confirm({
      title: `Regenerate ${row.label.toLowerCase()} comment?`,
      message: row.source === 'EDITED' ? 'This replaces the text you wrote.' : 'This writes a new comment.',
      confirmLabel: 'Regenerate',
    }))) return;
    run('regen', onRegenerate);
  };

  return (
    <View style={styles.row}>
      <View style={styles.rowHead}>
        <Text style={styles.label} numberOfLines={1}>{row.label}</Text>
        {badge ? <StatusPill label={badge.label} tone={badge.tone} /> : null}
      </View>
      {editing ? (
        <View>
          <TextInput style={styles.input} multiline value={draft} onChangeText={setDraft} maxLength={MAX_COMMENT_CHARS}
            accessibilityLabel={`${row.label} comment`} placeholder="Write the comment" placeholderTextColor={Colors.textTertiary} />
          <View style={styles.buttons}>
            <Button title="Save" size="sm" onPress={save} loading={busy === 'save'} disabled={busy !== null} />
            <Button title="Cancel" size="sm" variant="ghost" onPress={() => { setEditing(false); setError(null); }} disabled={busy !== null} />
          </View>
        </View>
      ) : (
        <>
          <Text style={[styles.text, !row.text && styles.empty]}>{row.text || 'No comment yet.'}</Text>
          <View style={styles.buttons}>
            <Button title={row.text ? 'Edit' : 'Write'} size="sm" variant="outline" onPress={() => { setDraft(row.text); setError(null); setEditing(true); }} disabled={busy !== null} />
            <Button title="Regenerate" size="sm" variant="ghost" onPress={regenerate} loading={busy === 'regen'} disabled={busy !== null} />
          </View>
        </>
      )}
      {error ? <Text accessibilityLiveRegion="polite" style={styles.rowError}>{error}</Text> : null}
    </View>
  );
}

// Overall plus per-subject comments for one student in one exam (the Results screen).
export function StudentComments({ examId, studentId, rows, onChanged }: {
  examId: number; studentId: number; rows: CommentRowData[]; onChanged: () => void;
}) {
  return (
    <View>
      {rows.map((r) => (
        <CommentRow key={r.key} row={r}
          onSave={async (comment) => { await examinationsApi.editComment(examId, { studentId, subjectId: r.subjectId, comment }); onChanged(); }}
          onRegenerate={async () => { await examinationsApi.regenerateComment(examId, { studentId, subjectId: r.subjectId }); onChanged(); }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.infoLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  help: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  progress: { marginTop: Spacing.sm },
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.surface, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: Colors.primary },
  progressText: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4 },
  message: { fontSize: FontSize.sm, color: Colors.infoText, marginTop: Spacing.sm },
  messageError: { color: Colors.errorText },
  row: { paddingVertical: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  label: { flexShrink: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  text: { fontSize: FontSize.sm, color: Colors.text, fontStyle: 'italic', marginTop: 4 },
  empty: { color: Colors.textTertiary, fontStyle: 'normal' },
  input: { minHeight: 80, textAlignVertical: 'top', backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.sm, color: Colors.text, marginTop: 4 },
  rowError: { fontSize: FontSize.xs, color: Colors.errorText, marginTop: 4 },
});
