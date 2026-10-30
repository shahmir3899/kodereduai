import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Switch, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear, useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useBooksForClassSubject, useLessonPlanActions, useLessonPlansPaged, useMyStaffRecordId } from '../../hooks/useLessonPlans';
import { useSubjectsList } from '../../hooks/useManager';
import { useStaffOptions } from '../../hooks/usePayroll';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString, type ClassOption } from '../../services/attendanceEntry';
import { buildPlanPayload, emptyPlanForm, planToForm, statusTone, validatePlan, type LessonPlan, type LessonPlanForm } from '../../services/lessonPlans';
import { inventoryErrorMessage } from '../../services/inventory';
import {
  aiProblem, aiRequest, applyAiDraft, buildBulkPlanPayload, bulkConflictText, bulkResultText, emptyBulkPlanForm, topicSummary,
  validateAiDraft, validateBulkPlans, type AiResult, type BulkPlanForm,
} from '../../services/lessonPlanTools';
import LessonPlanTopicPicker from './LessonPlanTopicPicker';
import SearchBar from '../ui/SearchBar';
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

type Tab = '' | 'DRAFT' | 'PUBLISHED';
const TABS: Array<{ value: Tab; label: string }> = [{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'PUBLISHED', label: 'Published' }];

// Lesson plans: list, write, publish. A teacher sees and writes their own; an admin or principal can
// write for any teacher. Topics are typed one per line (the web can also pick them from the book
// and draft with AI).
export default function LessonPlansScreen({ classOptions }: { classOptions?: ClassOption[] }) {
  const toast = useToast();
  const { activeSchool, isSchoolAdminNav } = useAuth();
  const { current: year } = useAcademicYear();
  const actions = useLessonPlanActions();
  const options = useAttendanceClassOptions(classOptions).options;
  const subjects = useSubjectsList();
  const myStaff = useMyStaffRecordId();
  const [tab, setTab] = useState<Tab>('');
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useLessonPlansPaged(tab, term);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [editing, setEditing] = useState<LessonPlan | 'new' | null>(null);
  const staff = useStaffOptions(isSchoolAdminNav && editing !== null);
  const [form, setForm] = useState<LessonPlanForm>(emptyPlanForm(todayString()));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LessonPlanForm>(k: K, v: LessonPlanForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const option = options.find((o) => o.id === form.classOption);
  const masterClass = option ? (option.isSession ? option.classObj : option.id) : null;
  const books = useBooksForClassSubject(masterClass, form.subject);
  const [picker, setPicker] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkPlanForm>(emptyBulkPlanForm(todayString()));
  const [bulkError, setBulkError] = useState<string | null>(null);

  const save = async () => {
    const problem = validatePlan(form);
    if (problem || !activeSchool) return setError(problem ?? 'No school selected.');
    setError(null);
    try {
      const payload = buildPlanPayload(form, options.find((o) => o.id === form.classOption), { school: activeSchool.id, academicYear: year?.id });
      if (editing === 'new') await actions.create.mutateAsync(payload);
      else await actions.update.mutateAsync({ id: (editing as LessonPlan).id, data: payload });
      toast.success(form.published ? 'Lesson plan published.' : 'Lesson plan saved as a draft.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const draftWithAi = async () => {
    const problem = validateAiDraft(form);
    if (problem) return setError(problem);
    setError(null);
    setDrafting(true);
    try {
      const res = (await actions.draft.mutateAsync(aiRequest(form, books.data ?? []))).data as AiResult;
      const failed = aiProblem(res);
      if (failed) return setError(failed);
      setForm((f) => applyAiDraft(f, res));
      toast.success('Draft filled in. Read it and change anything before saving.');
    } catch (e) {
      setError(inventoryErrorMessage(e, 'The draft could not be made. Try again, or write it yourself.'));
    } finally {
      setDrafting(false);
    }
  };

  const runBulk = async () => {
    const problem = validatePlan(form) ?? validateBulkPlans(bulk);
    if (problem || !activeSchool) return setBulkError(problem ?? 'No school selected.');
    setBulkError(null);
    const ok = await confirm({
      title: 'Create a plan for each teaching day?',
      message: `${form.title.trim()}, ${bulk.from} to ${bulk.to}. School off days${bulk.skipSaturday ? ' and Saturdays' : ''} are skipped.`,
      confirmLabel: 'Create',
    });
    if (!ok) return;
    try {
      const single = buildPlanPayload(form, option, { school: activeSchool.id, academicYear: year?.id });
      const res = await actions.bulk.mutateAsync(buildBulkPlanPayload(single as unknown as Record<string, unknown>, bulk));
      toast.success(bulkResultText(res.data));
      setBulkOpen(false);
      setEditing(null);
    } catch (e) {
      const data = (e as { response?: { data?: { error?: string; conflict_dates?: string[] } } }).response?.data;
      setBulkError(bulkConflictText(data) ?? inventoryErrorMessage(e, 'Could not create the lesson plans.'));
    }
  };

  const remove = async (p: LessonPlan) => {
    if (!(await confirm({ title: 'Delete this lesson plan?', message: p.title, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(p.id);
      toast.success('Lesson plan deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete.'));
    }
  };

  const header = (
    <View>
      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search lesson plans..." />
      <Button
        title="+ New lesson plan" size="sm"
        onPress={() => { setForm(emptyPlanForm(todayString(), isSchoolAdminNav ? null : myStaff.data ?? null)); setError(null); setEditing('new'); }}
      />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(p) => String(p.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No lesson plans" message={term ? 'Nothing matches your search.' : 'Write the first lesson plan.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: p }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => { setForm(planToForm(p, options)); setError(null); setEditing(p); }}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{p.title}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[p.lesson_date, p.class_name, p.subject_name, isSchoolAdminNav ? p.teacher_name : ''].filter(Boolean).join('  ·  ')}</Text>
            </View>
            <StatusPill label={p.status === 'PUBLISHED' ? 'Published' : 'Draft'} tone={statusTone(p.status)} />
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New lesson plan' : 'Edit lesson plan'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Input label="Title" value={form.title} onChangeText={(v) => set('title', v)} />
        <Select label="Class" searchable value={form.classOption} onChange={(v) => set('classOption', v)} placeholder="Choose a class"
          options={options.map((o) => ({ value: o.id, label: o.label }))} />
        <Select label="Subject" searchable value={form.subject} onChange={(v) => set('subject', v)} placeholder="Choose a subject"
          options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        {isSchoolAdminNav ? (
          <Select label="Teacher" searchable value={form.teacher} onChange={(v) => set('teacher', v)} placeholder="Choose a teacher"
            options={(staff.data ?? []).map((m) => ({ value: m.id, label: m.full_name ?? m.name ?? `#${m.id}` }))} />
        ) : null}
        <DateField label="Lesson date" value={form.date} onChange={(v) => set('date', v)} />
        <Input label="Duration (minutes)" value={form.duration} onChangeText={(v) => set('duration', v)} keyboardType="number-pad" />
        <Button
          title={form.topicIds.length ? `Book topics: ${form.topicIds.length} chosen` : 'Pick topics from the book'} variant="outline" size="sm"
          disabled={!masterClass || !form.subject} onPress={() => setPicker(true)}
        />
        {form.topicIds.length ? <Text style={styles.sub}>{topicSummary(books.data ?? [], form.topicIds)}</Text> : null}
        <Button title="Draft with AI from the chosen topics" variant="outline" size="sm" onPress={draftWithAi} loading={drafting} disabled={drafting || form.topicIds.length === 0} />
        <Input label="Topics (one per line)" value={form.topics} onChangeText={(v) => set('topics', v)} multiline />
        <Input label="Objectives" value={form.objectives} onChangeText={(v) => set('objectives', v)} multiline />
        <Input label="Lesson description" value={form.description} onChangeText={(v) => set('description', v)} multiline />
        <Input label="Materials needed" value={form.materials} onChangeText={(v) => set('materials', v)} multiline />
        <Input label="Teaching methods" value={form.methods} onChangeText={(v) => set('methods', v)} multiline />
        <View style={styles.toggle}>
          <Text style={styles.name}>Published (visible to others)</Text>
          <Switch value={form.published} onValueChange={(v) => set('published', v)} accessibilityLabel="Publish this lesson plan" />
        </View>
        {editing === 'new' ? <Button title="Create one for each day in a date range" variant="ghost" size="sm" onPress={() => { setBulk(emptyBulkPlanForm(form.date)); setBulkError(null); setBulkOpen(true); }} /> : null}
        {editing && editing !== 'new' ? <Button title="Delete lesson plan" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>

      <LessonPlanTopicPicker visible={picker} books={books.data ?? []} loading={books.isLoading} value={form.topicIds} onChange={(ids) => set('topicIds', ids)} onClose={() => setPicker(false)} />

      <FormSheet visible={bulkOpen} title="Plans for a date range" onClose={() => setBulkOpen(false)} onSubmit={runBulk} submitLabel="Create" busy={actions.bulk.isPending} error={bulkError}>
        <Text style={styles.sub}>Uses the class, subject, topics and text of this lesson plan for every teaching day.</Text>
        <DateField label="From" value={bulk.from} onChange={(v) => setBulk((b) => ({ ...b, from: v }))} />
        <DateField label="To" value={bulk.to} onChange={(v) => setBulk((b) => ({ ...b, to: v }))} />
        <Input label="Title for each day (optional)" value={bulk.titleTemplate} onChangeText={(v) => setBulk((b) => ({ ...b, titleTemplate: v }))} placeholder={form.title} />
        <View style={styles.toggle}>
          <Text style={styles.name}>Skip Saturdays</Text>
          <Switch value={bulk.skipSaturday} onValueChange={(v) => setBulk((b) => ({ ...b, skipSaturday: v }))} accessibilityLabel="Skip Saturdays" />
        </View>
        <Select label="If a day already has a plan" value={bulk.onConflict} onChange={(v) => setBulk((b) => ({ ...b, onConflict: v }))}
          options={[{ value: 'skip', label: 'Skip that day' }, { value: 'error', label: 'Stop and tell me' }]} />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, flexShrink: 1 },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: Spacing.md },
});
