import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, ActivityIndicator, Switch, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear, useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useBooksForClassSubject, useLessonPlanActions, useLessonPlansPaged, useMyStaffRecordId, useTopicObjectives, useClassSubjectTeachers } from '../../hooks/useLessonPlans';
import { bloomLabel, bloomTone, linkIdsOf, objectiveSummary, suggestionsFor } from '../../services/lessonPlanObjectives';
import ObjectivesEditor from './ObjectivesEditor';
import { useSubjectsList } from '../../hooks/useManager';
import { useStaffOptions } from '../../hooks/usePayroll';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString, type ClassOption } from '../../services/attendanceEntry';
import {
  activeFilterCount, bulkDeleteResultText, bulkDeleteText, bulkPublishResultText, bulkPublishText, buildPlanPayload, canPublish, draftIdsOf,
  emptyFilters, emptyPlanForm, filterParams, filterProblem, planToForm, quickForm, statusTone, teacherFromAssignments, validatePlan, validateQuick, type LessonPlan, type LessonPlanForm, type PlanFilters,
} from '../../services/lessonPlans';
import { selectedAll, toggleAll, toggleId } from '../../services/questionExtras';
import { lmsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import {
  EXPORT_MAX_PLANS, exportCountProblem, exportRangeProblem, lessonPlansFileName, renderLessonPlansHtml, sortByDate, type ExportPlan,
} from '../../services/lessonPlansHtml';
import { htmlToPdf } from '../../services/htmlPdf';
import { shareReportFile } from '../../services/reportShare';
import { exportErrorMessage } from '../../services/reports';
import { useSchoolProfile } from '../../hooks/useSchoolProfile';
import { inventoryErrorMessage } from '../../services/inventory';
import {
  aiProblem, aiRequest, applyAiDraft, buildBulkPlanPayload, bulkConflictText, bulkResultText, emptyBulkPlanForm, topicNames, topicSummary,
  validateAiDraft, validateBulkPlans, type AiResult, type BulkPlanForm,
} from '../../services/lessonPlanTools';
import LessonPlanTopicPicker from './LessonPlanTopicPicker';
import { DATE_PRESETS, activePreset, groupPlans, planBodySections, planStats, presetRange, type GroupMode, type PresetId } from '../../services/lessonPlanView';
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
import ScopeBadge from '../teacher/ScopeBadge';
import { useTeacherScope } from '../../hooks/useTeacher';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = '' | 'DRAFT' | 'PUBLISHED';
const TABS: Array<{ value: Tab; label: string }> = [{ value: '', label: 'All' }, { value: 'DRAFT', label: 'Drafts' }, { value: 'PUBLISHED', label: 'Published' }];

// Lesson plans: list, write, publish. A teacher sees and writes their own; an admin or principal can
// write for any teacher. Topics are typed one per line (the web can also pick them from the book
// and draft with AI).
export default function LessonPlansScreen({ classOptions }: { classOptions?: ClassOption[] }) {
  const toast = useToast();
  const scope = useTeacherScope();
  const { activeSchool, isSchoolAdminNav } = useAuth();
  const { current: year } = useAcademicYear();
  const actions = useLessonPlanActions();
  const options = useAttendanceClassOptions(classOptions).options;
  const subjects = useSubjectsList();
  const myStaff = useMyStaffRecordId();
  const [tab, setTab] = useState<Tab>('');
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  // Opens on this month so the list is bounded and the quick stats mean something straight away.
  const thisMonth = () => ({ ...emptyFilters(), ...presetRange('month') });
  const [filters, setFilters] = useState<PlanFilters>(thisMonth);
  const [groupMode, setGroupMode] = useState<GroupMode>('subject');
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [viewing, setViewing] = useState<LessonPlan | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const params = useMemo(() => filterParams(filters, options), [filters, options]);
  const query = useLessonPlansPaged(tab, term, params);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  // Grouping and the stats need the whole list, not one page of it, so the rest is fetched in the
  // background (capped, like the PDF export, so a huge range cannot run away).
  const GROUP_FETCH_CAP = 500;
  React.useEffect(() => {
    if (groupMode !== 'flat' && query.hasNextPage && !query.isFetchingNextPage && rows.length < GROUP_FETCH_CAP) query.fetchNextPage();
  }, [groupMode, query, rows.length]);
  const stats = useMemo(() => planStats(rows), [rows]);
  const sections = useMemo(() => (groupMode === 'flat' ? [] : groupPlans(rows, groupMode)), [rows, groupMode]);
  const activeSection = sections.find((s) => s.key === groupKey) ?? sections[0];
  type Item = { kind: 'plan'; plan: LessonPlan } | { kind: 'head'; key: string; label: string; count: number; published: number; draft: number };
  const items: Item[] = useMemo(() => {
    if (groupMode === 'flat') return rows.map((plan) => ({ kind: 'plan' as const, plan }));
    return (activeSection?.children ?? []).flatMap((c) => [
      { kind: 'head' as const, key: c.key, label: c.label, count: c.count, published: c.published, draft: c.draft },
      ...c.plans.map((plan) => ({ kind: 'plan' as const, plan })),
    ]);
  }, [groupMode, rows, activeSection]);
  const preset = activePreset(filters.from, filters.to);
  const rangeProblem = filterProblem(filters);
  const filterCount = activeFilterCount(filters);

  // Choosing plans is page-scoped: ids from a list that is no longer on screen must not ride along in a bulk action.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const listKey = `${tab}|${term}|${JSON.stringify(params)}`;
  React.useEffect(() => { setSelected([]); }, [listKey]);
  const rowIds = rows.map((r) => r.id);
  const draftIds = draftIdsOf(rows, selected);

  const [editing, setEditing] = useState<LessonPlan | 'new' | null>(null);
  const staff = useStaffOptions(isSchoolAdminNav && (editing !== null || filtersOpen));
  const [form, setForm] = useState<LessonPlanForm>(emptyPlanForm(todayString()));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LessonPlanForm>(k: K, v: LessonPlanForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const option = options.find((o) => o.id === form.classOption);
  const masterClass = option ? (option.isSession ? option.classObj : option.id) : null;
  const books = useBooksForClassSubject(masterClass, form.subject);
  // A new plan starts as a quick plan (class, subject, date, topics); "Detailed" shows every field.
  const [quick, setQuick] = useState(true);
  const isQuick = editing === 'new' && quick;
  const assigned = useClassSubjectTeachers(masterClass, isQuick && isSchoolAdminNav);
  const defaultTeacher = teacherFromAssignments(assigned.data ?? [], form.subject);
  React.useEffect(() => {
    // The subject's own teacher is the default; an admin can still choose another from the list below.
    if (isQuick && isSchoolAdminNav && defaultTeacher && form.teacher !== defaultTeacher) setForm((f) => ({ ...f, teacher: defaultTeacher }));
  }, [isQuick, isSchoolAdminNav, defaultTeacher, form.teacher]);
  const topicObjectives = useTopicObjectives(editing !== null ? form.topicIds : []);
  const suggestions = useMemo(() => suggestionsFor(topicObjectives.data ?? [], form.objectiveRows), [topicObjectives.data, form.objectiveRows]);
  const [picker, setPicker] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulk, setBulk] = useState<BulkPlanForm>(emptyBulkPlanForm(todayString()));
  const [bulkError, setBulkError] = useState<string | null>(null);

  const save = async () => {
    // A quick plan is saved as a draft whose title is made from its topics; the rest is filled in later.
    const toSave = isQuick ? quickForm(form, topicNames(books.data ?? [], form.topicIds)) : form;
    const problem = isQuick ? validateQuick(form) : validatePlan(form);
    if (problem || !activeSchool) return setError(problem ?? 'No school selected.');
    setError(null);
    try {
      const payload = buildPlanPayload(toSave, options.find((o) => o.id === toSave.classOption), { school: activeSchool.id, academicYear: year?.id });
      const saved = editing === 'new' ? await actions.create.mutateAsync(payload) : await actions.update.mutateAsync({ id: (editing as LessonPlan).id, data: payload });
      const planId = (saved.data as { id?: number } | undefined)?.id ?? (editing !== 'new' ? (editing as LessonPlan).id : null);
      // The plan is saved by now; if linking the curriculum objectives fails, say so instead of undoing the save.
      const linkIds = linkIdsOf(toSave.objectiveRows);
      let linkFailed = false;
      if (planId && linkIds.length > 0) {
        try { await actions.link.mutateAsync({ id: planId, ids: linkIds }); } catch { linkFailed = true; }
      }
      if (linkFailed) toast.error('Saved, but the curriculum objectives could not be linked. Open the plan to try again.');
      else toast.success(toSave.published ? 'Lesson plan published.' : 'Lesson plan saved as a draft.');
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

  const publishOne = async (p: LessonPlan) => {
    try {
      await actions.publish.mutateAsync(p.id);
      toast.success('Lesson plan published.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not publish.'));
    }
  };

  const publishSelected = async () => {
    if (draftIds.length === 0) return;
    if (!(await confirm({ title: 'Publish selected lesson plans?', message: bulkPublishText(draftIds.length), confirmLabel: 'Publish' }))) return;
    try {
      toast.success(bulkPublishResultText((await actions.publishMany.mutateAsync(draftIds)).data));
      setSelected([]);
      setSelecting(false);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not publish the lesson plans.'));
    }
  };

  const removeSelected = async () => {
    if (selected.length === 0) return;
    if (!(await confirm({ title: 'Delete selected lesson plans?', message: bulkDeleteText(selected.length), confirmLabel: 'Delete', destructive: true }))) return;
    try {
      toast.success(bulkDeleteResultText((await actions.removeMany.mutateAsync(selected)).data));
      setSelected([]);
      setSelecting(false);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the lesson plans.'));
    }
  };

  // The PDF holds every plan the class, subject, dates and search match (not only the page on screen), as on the web.
  // The status tabs are left out, as on the web. It is drawn on the phone from the same list, then shared.
  const school = useSchoolProfile();
  const [exporting, setExporting] = useState(false);
  const exportPdf = async () => {
    const bad = exportRangeProblem(filters.from, filters.to);
    if (bad) return toast.error(bad);
    setExporting(true);
    try {
      const res = await lmsApi.getLessonPlans({ ...params, ...(term ? { search: term } : {}), page_size: EXPORT_MAX_PLANS + 1 });
      const list = listOf<ExportPlan>(res.data);
      const tooMany = exportCountProblem(list.length);
      if (tooMany) return toast.error(tooMany);
      const plans = sortByDate(list);
      const html = renderLessonPlansHtml({
        plans, from: filters.from, to: filters.to, yearLabel: year?.name ?? null, school: school.data ?? null, generatedAt: new Date().toLocaleString(),
      });
      await shareReportFile(() => htmlToPdf(html), lessonPlansFileName(plans, filters.from, filters.to), 'pdf');
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message || 'Could not make the PDF.');
    } finally {
      setExporting(false);
    }
  };

  const setFilter = <K extends keyof PlanFilters>(k: K, v: PlanFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const bulkBusy = actions.publishMany.isPending || actions.removeMany.isPending;

  const header = (
    <View>
      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search lesson plans..." />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {DATE_PRESETS.map((p) => (
          <TouchableOpacity key={p.id} accessibilityRole="button" accessibilityState={{ selected: preset === p.id }} style={[styles.chip, preset === p.id && styles.chipOn]}
            onPress={() => setFilters((f) => ({ ...f, ...presetRange(p.id as PresetId) }))}>
            <Text style={[styles.chipText, preset === p.id && styles.chipTextOn]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {rows.length > 0 ? (
        <Text style={styles.stats} accessibilityLabel="Lesson plan totals">
          {`${stats.total}${query.hasNextPage ? '+' : ''} plans · ${stats.published} published · ${stats.draft} draft · ${stats.teachers} teachers · ${stats.subjects} subjects · ${stats.classes} classes`}
        </Text>
      ) : null}
      <SegmentedTabs
        tabs={[{ value: 'subject', label: 'By subject' }, { value: 'class', label: 'By class' }, { value: 'flat', label: 'All' }]}
        value={groupMode} onChange={(v) => { setGroupMode(v as GroupMode); setGroupKey(null); }}
      />
      {groupMode !== 'flat' && sections.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {sections.map((s) => (
            <TouchableOpacity key={s.key} accessibilityRole="button" accessibilityState={{ selected: activeSection?.key === s.key }}
              style={[styles.chip, activeSection?.key === s.key && styles.chipOn]} onPress={() => setGroupKey(s.key)}>
              <Text style={[styles.chipText, activeSection?.key === s.key && styles.chipTextOn]}>{`${s.label} (${s.count})`}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.actions}>
        <Button title={filterCount > 0 ? `Filters (${filterCount})` : 'Filters'} size="sm" variant="outline" onPress={() => setFiltersOpen((v) => !v)} />
        <Button title={selecting ? 'Done selecting' : 'Select'} size="sm" variant="outline" onPress={() => { setSelecting((v) => !v); setSelected([]); }} />
      </View>
      {filtersOpen ? (
        <View style={styles.filters}>
          <Select label="Class" searchable value={filters.classOption ?? -1} onChange={(v) => setFilter('classOption', v === -1 ? null : Number(v))}
            options={[{ value: -1, label: 'All classes' }, ...options.map((o) => ({ value: o.id, label: o.label }))]} />
          <Select label="Subject" searchable value={filters.subject ?? -1} onChange={(v) => setFilter('subject', v === -1 ? null : Number(v))}
            options={[{ value: -1, label: 'All subjects' }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
          {isSchoolAdminNav ? (
            <Select label="Teacher" searchable value={filters.teacher ?? -1} onChange={(v) => setFilter('teacher', v === -1 ? null : Number(v))}
              options={[{ value: -1, label: 'All teachers' }, ...(staff.data ?? []).map((m) => ({ value: m.id, label: m.full_name ?? m.name ?? `#${m.id}` }))]} />
          ) : null}
          <DateField label="Lesson date from" value={filters.from} onChange={(v) => setFilter('from', v)} />
          <DateField label="Lesson date to" value={filters.to} onChange={(v) => setFilter('to', v)} />
          {rangeProblem ? <Text style={styles.problem} accessibilityRole="alert">{rangeProblem}</Text> : null}
          <Button title="Download as PDF" size="sm" variant="outline" onPress={exportPdf} loading={exporting} disabled={exporting || !!exportRangeProblem(filters.from, filters.to)} />
          <Text style={styles.hint}>Needs both lesson dates. Includes every plan in the range for the class, subject and search above.</Text>
          {filterCount > 0 ? <Button title="Clear filters" size="sm" variant="ghost" onPress={() => setFilters(thisMonth())} /> : null}
        </View>
      ) : null}
      {selecting ? (
        <View style={styles.actions}>
          <Button title={selectedAll(rowIds, selected) ? 'Clear page' : 'Select page'} size="sm" variant="ghost" onPress={() => setSelected((s) => toggleAll(rowIds, s))} />
          <Button title={`Publish (${draftIds.length})`} size="sm" variant="outline" disabled={draftIds.length === 0 || bulkBusy} onPress={publishSelected} />
          <Button title={`Delete (${selected.length})`} size="sm" variant="danger" disabled={selected.length === 0 || bulkBusy} onPress={removeSelected} />
        </View>
      ) : null}
      <Button
        title="+ New lesson plan" size="sm"
        onPress={() => { setForm(emptyPlanForm(todayString(), isSchoolAdminNav ? null : myStaff.data ?? null)); setError(null); setQuick(true); setEditing('new'); }}
      />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(it) => (it.kind === 'head' ? `h${it.key}` : String(it.plan.id))}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No lesson plans" message={term ? 'Nothing matches your search.' : 'Write the first lesson plan.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item }) => {
          if (item.kind === 'head') {
            return (
              <View style={styles.sectionHead}>
                <Text style={styles.name}>{item.label}</Text>
                <Text style={styles.sub}>{`${item.count} plan${item.count === 1 ? '' : 's'} · ${item.published} published · ${item.draft} draft`}</Text>
              </View>
            );
          }
          const p = item.plan;
          return (
          <View style={styles.card}>
            <TouchableOpacity accessibilityRole={selecting ? 'checkbox' : 'button'} accessibilityState={selecting ? { checked: selected.includes(p.id) } : undefined} style={styles.row}
              onPress={() => (selecting ? setSelected((s) => toggleId(s, p.id)) : (setForm(planToForm(p, options)), setError(null), setEditing(p)))}>
              {selecting ? <Text style={styles.check}>{selected.includes(p.id) ? '☑' : '☐'}</Text> : null}
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{p.title}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[p.lesson_date, p.class_name, p.subject_name, isSchoolAdminNav ? p.teacher_name : ''].filter(Boolean).join('  ·  ')}</Text>
                <ScopeBadge scope={scope.classify(p.class_obj, p.subject)} />
                {objectiveSummary(p.linked_objectives).shown.map((o) => (
                  <View key={o.id} style={styles.objective}>
                    <Text style={styles.sub} numberOfLines={1}>{o.statement}</Text>
                    {o.bloom_level ? <StatusPill label={bloomLabel(o.bloom_level)} tone={bloomTone(o.bloom_level)} /> : null}
                  </View>
                ))}
                {objectiveSummary(p.linked_objectives).more > 0 ? <Text style={styles.sub}>+{objectiveSummary(p.linked_objectives).more} objectives</Text> : null}
              </View>
              <View style={styles.pills}>
                <StatusPill label={p.status === 'PUBLISHED' ? 'Published' : 'Draft'} tone={statusTone(p.status)} />
                {p.ai_generated ? <StatusPill label="AI" tone="info" /> : null}
              </View>
            </TouchableOpacity>
            {!selecting ? (
              <View style={styles.actions}>
                <Button title="View" size="sm" variant="outline" onPress={() => setViewing(p)} />
                {canPublish(p) ? (
                  <Button title="Publish" size="sm" variant="outline" onPress={() => publishOne(p)} loading={actions.publish.isPending && actions.publish.variables === p.id} disabled={actions.publish.isPending} />
                ) : null}
              </View>
            ) : null}
          </View>
          );
        }}
      />

      <FormSheet visible={viewing !== null} title={viewing?.title ?? 'Lesson plan'} onClose={() => setViewing(null)} submitLabel="Edit"
        onSubmit={() => { const p = viewing; if (!p) return; setViewing(null); setForm(planToForm(p, options)); setError(null); setEditing(p); }} busy={false} error={null}>
        {viewing ? (
          <>
            <Text style={styles.sub}>{[viewing.lesson_date, viewing.class_name, viewing.subject_name, viewing.teacher_name, `${viewing.duration_minutes} min`, viewing.status === 'PUBLISHED' ? 'Published' : 'Draft'].filter(Boolean).join('  ·  ')}</Text>
            {planBodySections(viewing).length === 0 ? <Text style={styles.sub}>This plan has no lesson content yet.</Text> : null}
            {planBodySections(viewing).map(([heading, text]) => (
              <View key={heading} style={styles.viewBlock}>
                <Text style={styles.viewHead}>{heading}</Text>
                <Text style={styles.viewText}>{text}</Text>
              </View>
            ))}
          </>
        ) : null}
      </FormSheet>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New lesson plan' : 'Edit lesson plan'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel={isQuick ? 'Save quick plan' : 'Save'} busy={actions.create.isPending || actions.update.isPending} error={error}>
        {editing === 'new' ? (
          <SegmentedTabs tabs={[{ value: 'quick', label: 'Quick' }, { value: 'full', label: 'Detailed' }]} value={quick ? 'quick' : 'full'} onChange={(v) => setQuick(v === 'quick')} />
        ) : null}
        {isQuick ? <Text style={styles.sub}>Class, subject, date and topics. The title is made from the topics and the plan is saved as a draft to fill in later.</Text> : null}
        {!isQuick ? <Input label="Title" value={form.title} onChangeText={(v) => set('title', v)} /> : null}
        <Select label="Class" searchable value={form.classOption} onChange={(v) => set('classOption', v)} placeholder="Choose a class"
          options={options.map((o) => ({ value: o.id, label: o.label }))} />
        <Select label="Subject" searchable value={form.subject} onChange={(v) => set('subject', v)} placeholder="Choose a subject"
          options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        {isSchoolAdminNav && (!isQuick || !defaultTeacher) ? (
          <Select label="Teacher" searchable value={form.teacher} onChange={(v) => set('teacher', v)} placeholder="Choose a teacher"
            options={(staff.data ?? []).map((m) => ({ value: m.id, label: m.full_name ?? m.name ?? `#${m.id}` }))} />
        ) : null}
        <DateField label="Lesson date" value={form.date} onChange={(v) => set('date', v)} />
        {!isQuick ? <Input label="Duration (minutes)" value={form.duration} onChangeText={(v) => set('duration', v)} keyboardType="number-pad" /> : null}
        <Button
          title={form.topicIds.length ? `Book topics: ${form.topicIds.length} chosen` : 'Pick topics from the book'} variant="outline" size="sm"
          disabled={!masterClass || !form.subject} onPress={() => setPicker(true)}
        />
        {form.topicIds.length ? <Text style={styles.sub}>{topicSummary(books.data ?? [], form.topicIds)}</Text> : null}
        {!isQuick ? <Button title="Draft with AI from the chosen topics" variant="outline" size="sm" onPress={draftWithAi} loading={drafting} disabled={drafting || form.topicIds.length === 0} /> : null}
        <Input label="Topics (one per line)" value={form.topics} onChangeText={(v) => set('topics', v)} multiline />
        {!isQuick ? (
          <>
            <ObjectivesEditor rows={form.objectiveRows} onChange={(rows) => set('objectiveRows', rows)} suggestions={suggestions}
              suggestionsLoading={topicObjectives.isLoading} hasTopics={form.topicIds.length > 0} />
            <Input label="Lesson description" value={form.description} onChangeText={(v) => set('description', v)} multiline />
            <Input label="Materials needed" value={form.materials} onChangeText={(v) => set('materials', v)} multiline />
            <Input label="Teaching methods" value={form.methods} onChangeText={(v) => set('methods', v)} multiline />
            <View style={styles.toggle}>
              <Text style={styles.name}>Published (visible to others)</Text>
              <Switch value={form.published} onValueChange={(v) => set('published', v)} accessibilityLabel="Publish this lesson plan" />
            </View>
          </>
        ) : null}
        {editing === 'new' && !isQuick ? <Button title="Create one for each day in a date range" variant="ghost" size="sm" onPress={() => { setBulk(emptyBulkPlanForm(form.date)); setBulkError(null); setBulkOpen(true); }} /> : null}
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
  chips: { gap: Spacing.sm, paddingVertical: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text },
  chipTextOn: { color: '#fff' },
  stats: { fontSize: FontSize.sm, color: Colors.textSecondary, marginVertical: Spacing.xs },
  sectionHead: { marginTop: Spacing.lg },
  viewBlock: { marginTop: Spacing.sm },
  viewHead: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase' },
  viewText: { fontSize: FontSize.md, color: Colors.text },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  objective: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: 2 },
  check: { fontSize: 22, color: Colors.primary },
  pills: { alignItems: 'flex-end', gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginVertical: Spacing.xs },
  filters: { marginVertical: Spacing.sm },
  hint: { color: Colors.textSecondary, fontSize: FontSize.xs, marginVertical: Spacing.xs },
  problem: { color: Colors.error, fontSize: FontSize.sm, marginVertical: Spacing.xs },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, flexShrink: 1 },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, gap: Spacing.md },
});
