import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useExamTypeActions, useExamTypeSetupList } from '../../hooks/useExamSetup';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildExamTypePayload, emptyExamTypeForm, examTypeToForm, validateExamType, type ExamTypeForm, type ExamTypeRow,
} from '../../services/examSetup';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Button from '../ui/Button';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of the web Exam Types page. `canEdit` is admin and principal; others see the list only.
export default function ExamTypesScreen({ canEdit }: { canEdit: boolean }) {
  const toast = useToast();
  const q = useExamTypeSetupList();
  const actions = useExamTypeActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<ExamTypeRow | 'new' | null>(null);
  const [form, setForm] = useState<ExamTypeForm>(emptyExamTypeForm());
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const problem = validateExamType(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildExamTypePayload(form);
      if (editing === 'new') await actions.create.mutateAsync(payload);
      else await actions.update.mutateAsync({ id: (editing as ExamTypeRow).id, data: payload });
      toast.success('Exam type saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const remove = async (t: ExamTypeRow) => {
    if (!(await confirm({ title: 'Delete exam type?', message: `${t.name} will be removed.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(t.id);
      toast.success('Exam type deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete. It may be used by an exam.'));
    }
  };

  const open = (t: ExamTypeRow | 'new') => {
    setForm(t === 'new' ? emptyExamTypeForm() : examTypeToForm(t));
    setError(null);
    setEditing(t);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        {canEdit ? <Button title="+ Add exam type" size="sm" onPress={() => open('new')} /> : null}
        <QueryBoundary query={q} emptyTitle="No exam types" emptyMessage={canEdit ? 'Add types such as Unit Test, Mid-Term and Final.' : 'Ask an admin to add them.'}>
          {(types) => types.map((t) => (
            <TouchableOpacity key={t.id} accessibilityRole="button" disabled={!canEdit} style={styles.row} onPress={() => open(t)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{t.name}</Text>
                <Text style={styles.sub}>{`Weight ${Number(t.weight)}% toward the overall grade`}</Text>
              </View>
              {t.is_final ? <StatusPill label="Final" tone="success" /> : null}
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New exam type' : 'Edit exam type'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g. Mid-Term Exam" />
        <Input label="Weight (%)" value={form.weight} onChangeText={(v) => setForm((f) => ({ ...f, weight: v }))} keyboardType="decimal-pad" />
        <View style={styles.toggle}>
          <View style={styles.who}>
            <Text style={styles.toggleLabel}>Final exam</Text>
            <Text style={styles.hint}>Only final exams decide promotion; report cards show Promoted or Not Promoted for these.</Text>
          </View>
          <Switch value={form.isFinal} onValueChange={(v) => setForm((f) => ({ ...f, isFinal: v }))} accessibilityLabel="Final exam" />
        </View>
        {editing && editing !== 'new' ? <Button title="Delete exam type" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: Spacing.md },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text },
});
