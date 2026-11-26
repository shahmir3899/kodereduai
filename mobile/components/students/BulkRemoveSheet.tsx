import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { studentsApi } from '../../services/api';
import {
  bulkRemoveError, namesPreview, removeInBatches, skippedLines, validateBulkRemove, type SkippedStudent,
} from '../../services/studentBulkRemove';
import Input from '../ui/Input';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  students: Array<{ id: number; name: string }>;
  // Called with the ids that were removed, so the list can drop its selection.
  onDone: (deleted: number[]) => void;
}

// Remove the ticked students (web BulkDeleteStudentsModal): the same soft delete as removing one, so
// they go to Recently deleted and an admin can restore them. The count is typed back and a reason
// is required. Students the server will not remove (part of a branch transfer) are listed after.
export default function BulkRemoveSheet({ visible, onClose, students, onDone }: Props) {
  const qc = useQueryClient();
  // The list clears its selection once students are removed; keep what this sheet was opened with.
  const [targets, setTargets] = useState(students);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ deleted: number; skipped: SkippedStudent[] } | null>(null);
  useEffect(() => {
    if (visible) { setTargets(students); setTyped(''); setReason(''); setError(null); setResult(null); }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    const problem = validateBulkRemove(typed, targets.length, reason);
    if (problem) return setError(problem);
    setError(null); setBusy(true);
    const out = await removeInBatches(targets.map((s) => s.id), reason, (body) => studentsApi.bulkDeleteStudents(body));
    setBusy(false);
    qc.invalidateQueries({ predicate: (q) => ['students', 'studentsDeleted', 'classes', 'session-classes', 'parentStatus'].includes(q.queryKey[0] as string) });
    if (out.error) setError(bulkRemoveError(out.error, out.deleted.length));
    if (out.deleted.length || out.skipped.length) {
      onDone(out.deleted);
      setResult({ deleted: out.deleted.length, skipped: out.skipped });
    }
  };

  if (result) {
    return (
      <FormSheet visible={visible} title="Students removed" onClose={onClose} onSubmit={onClose} submitLabel="Done" error={error}>
        <Text style={styles.text}>{result.deleted} student{result.deleted === 1 ? '' : 's'} removed. An admin can restore them from Students › Recently deleted.</Text>
        {result.skipped.length > 0 ? (
          <>
            <Text style={styles.warnTitle}>{result.skipped.length} could not be removed:</Text>
            {skippedLines(result.skipped).map((l) => <Text key={l} style={styles.warn}>{l}</Text>)}
          </>
        ) : null}
      </FormSheet>
    );
  }

  const n = targets.length;
  return (
    <FormSheet visible={visible} title={`Remove ${n} student${n === 1 ? '' : 's'}`} onClose={busy ? () => undefined : onClose} onSubmit={submit}
      submitLabel={busy ? 'Removing...' : `Remove ${n}`} busy={busy} error={error}>
      <Text style={styles.text}>{namesPreview(targets.map((s) => s.name))}</Text>
      <Text style={styles.text}>They will be hidden from the school. Their attendance, fees, marks and enrollments are kept, and an admin can bring them back from Recently deleted.</Text>
      <Text style={styles.warn}>Use this only for records entered by mistake. Students who have left the school go through Leaving / Transfer instead.</Text>
      <Input label={`Type ${n} to confirm`} value={typed} onChangeText={setTyped} keyboardType="number-pad" />
      <Input label="Reason" value={reason} onChangeText={setReason} placeholder="For example: duplicate entries" multiline style={styles.area} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: FontSize.sm, color: Colors.text },
  warnTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.warning, marginTop: Spacing.sm },
  warn: { fontSize: FontSize.sm, color: Colors.textSecondary },
  area: { minHeight: 70, textAlignVertical: 'top' },
});
