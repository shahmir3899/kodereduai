import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useGradeScale, useGradeScaleActions } from '../../hooks/useExamSetup';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildGradePayload, emptyGradeForm, gradeToForm, gradeTone, scaleWarnings, validateGrade, type GradeForm, type GradeRow,
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

// Port of the web Grade Scale page. Admin and principal only; a change affects every result and
// report card, so deleting asks first and the whole scale is checked for gaps and overlaps.
export default function GradeScaleScreen() {
  const toast = useToast();
  const q = useGradeScale();
  const actions = useGradeScaleActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<GradeRow | 'new' | null>(null);
  const [form, setForm] = useState<GradeForm>(emptyGradeForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof GradeForm>(k: K, v: GradeForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const sorted = useMemo(
    () => [...(q.data ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || Number(b.min_percentage) - Number(a.min_percentage)),
    [q.data],
  );
  const warnings = useMemo(() => scaleWarnings(q.data ?? []), [q.data]);

  const save = async () => {
    const problem = validateGrade(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildGradePayload(form);
      if (editing === 'new') await actions.create.mutateAsync(payload);
      else await actions.update.mutateAsync({ id: (editing as GradeRow).id, data: payload });
      toast.success('Grade saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const remove = async (g: GradeRow) => {
    if (!(await confirm({ title: 'Delete grade?', message: `${g.grade_label} will no longer be given to results.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(g.id);
      toast.success('Grade deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the grade.'));
    }
  };

  const open = (g: GradeRow | 'new') => {
    setForm(g === 'new' ? emptyGradeForm() : gradeToForm(g));
    setError(null);
    setEditing(g);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ Add grade" size="sm" onPress={() => open('new')} />
        {warnings.length > 0 ? (
          <View style={styles.warn} accessibilityRole="alert">
            {warnings.map((w) => <Text key={w} style={styles.warnText}>{w}</Text>)}
          </View>
        ) : null}
        <QueryBoundary query={q} emptyTitle="No grade scale" emptyMessage="Add grades such as A+, A, B, C, D and F so results can be graded.">
          {() => sorted.map((g) => (
            <TouchableOpacity key={g.id} accessibilityRole="button" style={styles.row} onPress={() => open(g)}>
              <StatusPill label={g.grade_label} tone={gradeTone(g.grade_label)} />
              <View style={styles.who}>
                <Text style={styles.name}>{`${Number(g.min_percentage)}% to ${Number(g.max_percentage)}%`}</Text>
                <Text style={styles.sub}>{`GPA ${g.gpa_points ?? 0}  ·  order ${g.order ?? 0}`}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New grade' : 'Edit grade'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Input label="Grade label" value={form.label} onChangeText={(v) => set('label', v)} placeholder="e.g. A+" autoCapitalize="characters" />
        <Input label="Minimum %" value={form.min} onChangeText={(v) => set('min', v)} keyboardType="decimal-pad" />
        <Input label="Maximum %" value={form.max} onChangeText={(v) => set('max', v)} keyboardType="decimal-pad" />
        <Input label="GPA points (optional)" value={form.gpa} onChangeText={(v) => set('gpa', v)} keyboardType="decimal-pad" />
        <Input label="Order (optional)" value={form.order} onChangeText={(v) => set('order', v)} keyboardType="number-pad" />
        {editing && editing !== 'new' ? <Button title="Delete grade" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
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
  warn: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 2 },
  warnText: { color: Colors.warningText, fontSize: FontSize.sm },
});
