import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useDateSheet, useDateSheetActions } from '../../hooks/useExamGroups';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildDateSheetEntry, sortRows, subjectsInSheet, toRows, unscheduledCount, validateDateSheetEdit, type DateSheetEdit, type DateSheetRow,
} from '../../services/examGroups';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Button from '../ui/Button';
import DateField from '../ui/DateField';
import Select from '../ui/Select';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The date sheet of one exam group, row by row (a subject in a class), plus a way to give one subject the
// same date in every class. Edits save straight away, as on the web. Admin and principal only.
export default function DateSheetScreen({ groupId }: { groupId: number }) {
  const toast = useToast();
  const q = useDateSheet(groupId);
  const actions = useDateSheetActions(groupId);
  const refreshControl = useRefreshControl(q.refetch);
  const rows = useMemo(() => sortRows(toRows(q.data?.subjects ?? [])), [q.data]);
  const [editing, setEditing] = useState<DateSheetRow | null>(null);
  const [edit, setEdit] = useState<DateSheetEdit>({ date: '', start: '', end: '' });
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState(false);
  const [bulkSubject, setBulkSubject] = useState<number | null>(null);
  const [bulkDate, setBulkDate] = useState('');

  const open = (r: DateSheetRow) => { setEdit({ date: r.date, start: r.start, end: r.end }); setError(null); setEditing(r); };

  const save = async () => {
    if (!editing) return;
    const problem = validateDateSheetEdit(edit);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.saveRow.mutateAsync(buildDateSheetEntry(editing.examSubjectId, edit));
      toast.success('Date sheet updated.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const saveBulk = async () => {
    if (!bulkSubject) return setError('Choose the subject.');
    const problem = validateDateSheetEdit({ date: bulkDate, start: '', end: '' });
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.setSubjectDate.mutateAsync({ subjectId: bulkSubject, date: bulkDate || null });
      toast.success(bulkDate ? 'Date set for every class.' : 'Date cleared for every class.');
      setBulk(false);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const missing = unscheduledCount(rows);
  const subjects = subjectsInSheet(rows, q.data?.subjects ?? []);
  const window = q.data?.start_date && q.data?.end_date ? `${q.data.start_date} to ${q.data.end_date}` : null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <QueryBoundary query={q} isEmpty={(d) => d.subjects.length === 0} emptyTitle="No subjects yet" emptyMessage="Sync subjects into the exams first, then set their dates.">
          {() => (
            <>
              <Text style={styles.title}>{q.data?.group_name}</Text>
              {window ? <Text style={styles.sub}>{`Exam period ${window}`}</Text> : null}
              {missing > 0 ? <StatusPill label={`${missing} not scheduled yet`} tone="warning" /> : <StatusPill label="Every subject has a date" tone="success" />}
              <Button title="Same date for one subject, all classes" size="sm" variant="outline" onPress={() => { setBulkSubject(null); setBulkDate(''); setError(null); setBulk(true); }} />
              {rows.map((r) => (
                <TouchableOpacity key={r.examSubjectId} accessibilityRole="button" accessibilityLabel={`${r.subject}, ${r.className}. Edit date and time`} style={styles.row} onPress={() => open(r)}>
                  <View style={styles.who}>
                    <Text style={styles.name} numberOfLines={1}>{`${r.subject}  ·  ${r.className}`}</Text>
                    <Text style={styles.sub}>{r.date ? `${r.date}${r.start ? `  ${r.start}${r.end ? ` to ${r.end}` : ''}` : ''}` : 'Not scheduled'}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing ? `${editing.subject}, ${editing.className}` : ''} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.saveRow.isPending} error={error}>
        <DateField label="Exam date" value={edit.date} onChange={(v) => setEdit((e) => ({ ...e, date: v }))} />
        {edit.date ? <Button title="Clear date" size="sm" variant="ghost" onPress={() => setEdit({ date: '', start: '', end: '' })} /> : null}
        <Input label="Start time (24-hour, optional)" value={edit.start} onChangeText={(v) => setEdit((e) => ({ ...e, start: v }))} placeholder="09:00" keyboardType="numbers-and-punctuation" />
        <Input label="End time (24-hour, optional)" value={edit.end} onChangeText={(v) => setEdit((e) => ({ ...e, end: v }))} placeholder="11:30" keyboardType="numbers-and-punctuation" />
      </FormSheet>

      <FormSheet visible={bulk} title="Same date for a subject" onClose={() => setBulk(false)} onSubmit={saveBulk} submitLabel="Apply to all classes" busy={actions.setSubjectDate.isPending} error={error}>
        <Select label="Subject" searchable value={bulkSubject} onChange={(v) => setBulkSubject(Number(v))} placeholder="Choose a subject" options={subjects.map((s) => ({ value: s.id, label: s.name }))} />
        <DateField label="Exam date (leave empty to clear)" value={bulkDate} onChange={setBulkDate} />
        <Text style={styles.hint}>This replaces the date of this subject in every class of the group.</Text>
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, minHeight: 56, justifyContent: 'center' },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
