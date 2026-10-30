import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAcademicYear, useAttendanceClassOptions, useMasterClasses } from '../../hooks/useAcademicYear';
import { useExamActions, useExamsPaged, useExamTypeList, useTermList } from '../../hooks/useExamsAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { feeClassOptions } from '../../services/feeStructure';
import {
  buildExamPayload, emptyExamForm, EXAM_STATUSES, examToForm, marksProgress, populateText, statusTone, validateExam,
  type ExamForm, type ExamRow,
} from '../../services/examsAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const FILTERS = [{ value: '', label: 'All' }, { value: 'SCHEDULED', label: 'Upcoming' }, { value: 'MARKS_ENTRY', label: 'Marks' }, { value: 'PUBLISHED', label: 'Published' }];

// Exams for the active academic year: create one per class, change dates or status, sync its
// subjects from the class, delete one that has no marks. Admin and principal only. The multi-class
// date sheet wizard, exam groups and exam types stay on the web.
export default function ExamsAdminScreen() {
  const router = useRouter();
  const toast = useToast();
  const actions = useExamActions();
  const { current: year } = useAcademicYear();
  const [status, setStatus] = useState('');
  const query = useExamsPaged(status);
  const types = useExamTypeList();
  const terms = useTermList();
  const sections = useAttendanceClassOptions().options;
  const masters = useMasterClasses();
  const classes = useMemo(() => feeClassOptions(sections, (masters.data ?? []).map((c) => ({ id: Number(c.id), name: String(c.name) }))), [sections, masters.data]);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [editing, setEditing] = useState<ExamRow | 'new' | null>(null);
  const [form, setForm] = useState<ExamForm>(emptyExamForm());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof ExamForm>(k: K, v: ExamForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const problem = validateExam(form);
    if (problem) return setError(problem);
    if (!year) return setError('There is no active academic year.');
    setError(null);
    try {
      const creating = editing === 'new';
      const payload = buildExamPayload(form, year.id, creating);
      if (creating) {
        const res = await actions.create.mutateAsync(payload);
        const id = (res.data as { id?: number })?.id;
        if (id) {
          // Same step the web takes after creating: copy the class's subjects onto the exam.
          const pop = await actions.populate.mutateAsync(id);
          toast.success(populateText(pop.data as { added_count?: number; total_count?: number }));
        } else toast.success('Exam created.');
      } else {
        await actions.update.mutateAsync({ id: (editing as ExamRow).id, data: payload });
        toast.success('Exam saved.');
      }
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const sync = async (e: ExamRow) => {
    setBusy(true);
    try {
      const res = await actions.populate.mutateAsync(e.id);
      toast.success(populateText(res.data as { added_count?: number; total_count?: number }));
    } catch (err) {
      toast.error(inventoryErrorMessage(err, 'Could not sync subjects.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e: ExamRow) => {
    if (!(await confirm({ title: 'Delete this exam?', message: `${e.name} (${e.class_name ?? 'class'}). An exam that already has marks cannot be deleted.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(e.id);
      toast.success('Exam deleted.');
      setEditing(null);
    } catch (err) {
      toast.error(inventoryErrorMessage(err, 'Could not delete the exam.'));
    }
  };

  const header = (
    <View>
      <SegmentedTabs tabs={FILTERS} value={status} onChange={setStatus} />
      <Button title="Date sheets and publishing" size="sm" variant="secondary" onPress={() => router.push('/(admin)/exam-groups' as Href)} />
      <Button title="+ New exams for several classes" size="sm" onPress={() => router.push('/(admin)/exam-wizard' as Href)} />
      <View style={{ height: Spacing.sm }} />
      <Button title="+ One exam for one class" size="sm" variant="outline" onPress={() => { setForm(emptyExamForm()); setError(null); setEditing('new'); }} />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (!year) return <EmptyState title="No academic year" message="Create or activate an academic year on the web first." />;

  const existing = editing && editing !== 'new' ? editing : null;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(e) => String(e.id)}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No exams" message="Create the first exam for this academic year." />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: e }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => { setForm(examToForm(e)); setError(null); setEditing(e); }}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{e.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[e.class_name, e.exam_type_name, e.start_date ? `${e.start_date}${e.end_date ? ` to ${e.end_date}` : ''}` : ''].filter(Boolean).join('  ·  ')}</Text>
              <Text style={styles.sub} numberOfLines={1}>{marksProgress(e)}</Text>
            </View>
            <StatusPill label={EXAM_STATUSES.find((s) => s.value === e.status)?.label ?? e.status} tone={statusTone(e.status)} />
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={editing !== null} title={existing ? 'Edit exam' : 'New exam'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending || actions.populate.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} />
        <Select label="Exam type" value={form.examType} onChange={(v) => set('examType', v)} placeholder="Choose a type"
          options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
        {existing ? <Text style={styles.sub}>Class: {existing.class_name}</Text> : (
          <Select label="Class (all its sections)" searchable value={form.classObj} onChange={(v) => set('classObj', v)} placeholder="Choose a class"
            options={classes.map((c) => ({ value: c.id, label: c.label }))} />
        )}
        <Select label="Term (optional)" value={form.term} onChange={(v) => set('term', v)} placeholder="No term"
          options={(terms.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
        <DateField label="Start date" value={form.start} onChange={(v) => set('start', v)} />
        <DateField label="End date" value={form.end} onChange={(v) => set('end', v)} />
        <Select label="Status" value={form.status} onChange={(v) => set('status', v)} options={EXAM_STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
        <Input label="Failed subjects that fail the exam" value={form.failThreshold} onChangeText={(v) => set('failThreshold', v)} keyboardType="number-pad" />
        {existing ? <Button title="Sync subjects from the class" variant="outline" size="sm" onPress={() => sync(existing)} loading={busy} disabled={busy} /> : null}
        {existing ? <Button title="Delete exam" variant="danger" size="sm" onPress={() => remove(existing)} /> : null}
        <Text style={styles.sub}>Exam types and the grade scale are on the web.</Text>
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
