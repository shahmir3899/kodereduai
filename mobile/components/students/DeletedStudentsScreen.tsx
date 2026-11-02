import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { studentsApi } from '../../services/api';
import { buildRestorePayload, deletedLine, deletedMeta, isRollConflict, type DeletedStudent } from '../../services/studentMove';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import { useDeletedStudents } from '../../hooks/useStudents';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Card from '../ui/Card';
import Avatar from '../ui/Avatar';
import Input from '../ui/Input';
import Button from '../ui/Button';
import QueryBoundary from '../ui/QueryBoundary';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Students an admin removed by mistake, newest first. Restoring brings back everything they owned.
// If their roll number was given to someone else meanwhile, the server says so and a new roll is
// asked for. Erasing for good stays on the web.
export default function DeletedStudentsScreen() {
  const toast = useToast();
  const qc = useQueryClient();
  const list = useDeletedStudents();
  const refreshControl = useRefreshControl(list.refetch);
  const [target, setTarget] = useState<DeletedStudent | null>(null);
  const [roll, setRoll] = useState('');
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = useMutation({ mutationFn: (v: { id: number; roll: string }) => studentsApi.restoreStudent(v.id, buildRestorePayload(v.roll)) });

  const open = (s: DeletedStudent) => { setTarget(s); setRoll(''); setConflict(false); setError(null); };

  const submit = async () => {
    if (!target) return;
    setError(null);
    try {
      await restore.mutateAsync({ id: target.id, roll });
      qc.invalidateQueries({ predicate: (q) => ['studentsDeleted', 'students', 'student', 'classes', 'session-classes'].includes(q.queryKey[0] as string) });
      toast.success(`${target.name} was restored.`);
      setTarget(null);
    } catch (e) {
      if (isRollConflict(e)) { setConflict(true); setError(staffLeaveErrorMessage(e, 'That roll number is taken. Enter a new one.')); }
      else setError(staffLeaveErrorMessage(e, 'Could not restore the student.'));
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Text style={styles.note}>Removed students keep all their records. Restore one to bring everything back.</Text>
        <QueryBoundary query={list} emptyTitle="Nothing removed" emptyMessage="Students you remove will appear here.">
          {(rows) => rows.map((s) => (
            <Card key={s.id} style={styles.card}>
              <View style={styles.top}>
                <Avatar name={s.name} size={40} />
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{deletedLine(s)}</Text>
                  {deletedMeta(s) ? <Text style={styles.meta}>{deletedMeta(s)}</Text> : null}
                </View>
              </View>
              {s.deleted_reason ? <Text style={styles.reason}>Reason: {s.deleted_reason}</Text> : null}
              <Button title="Restore" size="sm" variant="outline" onPress={() => open(s)} style={styles.restore} />
            </Card>
          ))}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={target !== null} title="Restore student" onClose={() => setTarget(null)} onSubmit={submit} submitLabel="Restore" busy={restore.isPending} error={error}>
        <Text style={styles.note}>{target?.name} will be shown in their class again with everything they owned.</Text>
        {conflict ? <Input label="New roll number" value={roll} onChangeText={setRoll} maxLength={20} /> : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  note: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.md },
  card: { marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  reason: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm },
  restore: { alignSelf: 'flex-start', marginTop: Spacing.sm },
});
