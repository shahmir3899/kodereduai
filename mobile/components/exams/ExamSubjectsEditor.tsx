import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useExamSubjectActions, useExamSubjects, useClassSubjectRows } from '../../hooks/useExamsAdmin';
import {
  DEFAULT_PASSING_MARKS, DEFAULT_TOTAL_MARKS, missingSubjects, newSubjectPayload, removeSubjectText, subjectMarksPayload, subjectToForm, validateSubjectMarks,
  type SubjectMarksForm,
} from '../../services/examsAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props { examId: number; classObj: number; sessionClass?: number | null }

// The subjects of one exam inside the Edit exam sheet: change a subject's total and passing marks,
// add a subject the class has that the exam lacks, or remove one (its marks go with it). The date of
// each subject is set on the date sheet. Admin and principal only.
export default function ExamSubjectsEditor({ examId, classObj, sessionClass }: Props) {
  const toast = useToast();
  const subjects = useExamSubjects(examId);
  const classSubjects = useClassSubjectRows();
  const actions = useExamSubjectActions();
  const [editing, setEditing] = useState<number | null>(null);
  const [form, setForm] = useState<SubjectMarksForm>({ total: DEFAULT_TOTAL_MARKS, passing: DEFAULT_PASSING_MARKS });
  const [adding, setAdding] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => [...(subjects.data ?? [])].sort((a, b) => a.subject_name.localeCompare(b.subject_name)), [subjects.data]);
  const mine = useMemo(() => (classSubjects.data ?? []).filter((c) => (sessionClass != null && c.session_class === sessionClass) || (c.class_obj ?? null) === classObj), [classSubjects.data, classObj, sessionClass]);
  const missing = useMemo(() => missingSubjects(mine, rows), [mine, rows]);

  const open = (id: number, s: Parameters<typeof subjectToForm>[0]) => { setError(null); setAdding(null); setForm(subjectToForm(s)); setEditing(id); };

  const save = async () => {
    const problem = validateSubjectMarks(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.save.mutateAsync({ id: editing as number, data: subjectMarksPayload(form) });
      toast.success('Marks saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not save the subject.')); }
  };

  const add = async () => {
    const problem = validateSubjectMarks(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.add.mutateAsync(newSubjectPayload(examId, adding as number, form));
      toast.success('Subject added.');
      setAdding(null);
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not add the subject.')); }
  };

  const remove = async (id: number, name: string) => {
    if (!(await confirm({ title: 'Remove this subject?', message: removeSubjectText(name), confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(id);
      toast.success(`${name} removed from this exam.`);
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not remove the subject.')); }
  };

  const marksForm = (
    <View style={styles.form}>
      <View style={styles.pair}>
        <View style={styles.half}><Input label="Total marks" value={form.total} onChangeText={(v) => setForm((f) => ({ ...f, total: v }))} keyboardType="decimal-pad" /></View>
        <View style={styles.half}><Input label="Passing marks" value={form.passing} onChangeText={(v) => setForm((f) => ({ ...f, passing: v }))} keyboardType="decimal-pad" /></View>
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Subjects of this exam</Text>
      {subjects.isLoading ? <Text style={styles.sub}>Loading subjects...</Text> : null}
      {subjects.isError ? <Text style={styles.sub}>Could not load the subjects.</Text> : null}
      {!subjects.isLoading && rows.length === 0 && !subjects.isError ? <Text style={styles.sub}>No subjects on this exam yet.</Text> : null}
      {rows.map((s) => (
        <View key={s.id} style={styles.row}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Edit ${s.subject_name}`} onPress={() => (editing === s.id ? setEditing(null) : open(s.id, s))}>
            <Text style={styles.name}>{s.subject_name}</Text>
            <Text style={styles.sub}>{[s.exam_date || 'No date', s.total_marks != null ? `${Number(s.total_marks)} marks` : '', s.passing_marks != null ? `pass ${Number(s.passing_marks)}` : ''].filter(Boolean).join('  ·  ')}</Text>
          </TouchableOpacity>
          {editing === s.id ? (
            <>
              {marksForm}
              <View style={styles.pair}>
                <Button title="Save marks" size="sm" loading={actions.save.isPending} onPress={save} />
                <Button title="Remove subject" size="sm" variant="danger" onPress={() => remove(s.id, s.subject_name)} />
              </View>
            </>
          ) : null}
        </View>
      ))}

      {missing.length > 0 ? (
        <View style={styles.addBox}>
          <Text style={styles.label}>Add a subject of the class</Text>
          <View style={styles.chips}>
            {missing.map((c) => (
              <TouchableOpacity key={c.subject} accessibilityRole="button" onPress={() => { setEditing(null); setError(null); setForm({ total: DEFAULT_TOTAL_MARKS, passing: DEFAULT_PASSING_MARKS }); setAdding(adding === c.subject ? null : c.subject); }}
                style={[styles.chip, adding === c.subject && styles.chipOn]}>
                <Text style={[styles.chipText, adding === c.subject && { color: Colors.textInverse }]}>+ {c.subject_name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {adding != null ? (
            <>
              {marksForm}
              <Button title="Add to this exam" size="sm" loading={actions.add.isPending} onPress={add} />
            </>
          ) : null}
        </View>
      ) : null}
      <Text style={styles.sub}>Dates for each subject are set on the date sheet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs, marginVertical: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  row: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingVertical: Spacing.xs, gap: Spacing.xs },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  form: { marginTop: Spacing.xs },
  pair: { flexDirection: 'row', gap: Spacing.sm },
  half: { flex: 1 },
  error: { color: Colors.error, fontSize: FontSize.sm },
  addBox: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.xs },
  label: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { borderWidth: 1, borderColor: Colors.primary, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  chipOn: { backgroundColor: Colors.primary },
  chipText: { color: Colors.primary, fontSize: FontSize.sm, fontWeight: '600' },
});
