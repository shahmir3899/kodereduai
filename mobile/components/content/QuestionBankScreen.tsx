import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useMasterClasses } from '../../hooks/useAcademicYear';
import { useSubjectTags } from '../../hooks/useCurriculum';
import { useBooksForClassSubject } from '../../hooks/useLessonPlans';
import { useQuestionActions, useQuestionsPaged, useSemanticQuestions } from '../../hooks/useQuestionBank';
import { topicSummary } from '../../services/lessonPlanTools';
import LessonPlanTopicPicker from '../lms/LessonPlanTopicPicker';
import { useSubjectsList } from '../../hooks/useManager';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  BLOOM_LEVELS, buildQuestionPayload, DIFFICULTIES, difficultyTone, emptyQuestionForm, isEditableType, QUESTION_TYPES,
  questionToForm, typeLabel, validateQuestion, type Question, type QuestionForm,
} from '../../services/questionBank';
import {
  aiLabel, aiStatus, canCreateTag, filterTags, hitContext, newTagPayload, SEARCH_MODES, SEMANTIC_DEBOUNCE_MS, toggleId, verifyPayload, type SearchMode,
} from '../../services/questionExtras';
import { inventoryErrorMessage } from '../../services/inventory';
import SearchBar from '../ui/SearchBar';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import BlankFields from './BlankFields';
import MatchingFields from './MatchingFields';
import RichTextField from './RichTextField';
import QuestionPictures from './QuestionPictures';
import { plainText } from '../../services/richText';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const ANY = '';

// Question bank for admin, principal, teacher (their own subjects; the server enforces it) and
// manager: search, filter, write and edit questions. Matching questions, pictures, topic tags and
// AI generation stay on the web.
export default function QuestionBankScreen() {
  const toast = useToast();
  const actions = useQuestionActions();
  const subjects = useSubjectsList();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const [subjectFilter, setSubjectFilter] = useState<number>(-1);
  const [typeFilter, setTypeFilter] = useState(ANY);
  const [diffFilter, setDiffFilter] = useState(ANY);
  const [bloomFilter, setBloomFilter] = useState(ANY);
  const [tagFilter, setTagFilter] = useState<number>(-1);
  const [mode, setMode] = useState<SearchMode>('keyword');
  const [classFilter, setClassFilter] = useState<number | null>(null);
  const { user } = useAuth();
  const subjectId = subjectFilter === -1 ? null : subjectFilter;
  const filterTagList = useSubjectTags(subjectId);
  const query = useQuestionsPaged(term, subjectId, typeFilter, diffFilter, bloomFilter, tagFilter === -1 ? null : tagFilter);
  // The web waits 600 ms after typing before it asks the server to search by meaning, and needs a class.
  const meaningTerm = useDebouncedValue(mode === 'meaning' ? search.trim() : '', SEMANTIC_DEBOUNCE_MS);
  const meaning = useSemanticQuestions(meaningTerm, classFilter, subjectId);
  const hits = meaning.data ?? [];
  const useHits = mode === 'meaning' && !!meaningTerm && hits.length > 0;
  const fellBack = mode === 'meaning' && !!meaningTerm && meaning.isSuccess && hits.length === 0;
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const [form, setForm] = useState<QuestionForm>(emptyQuestionForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof QuestionForm>(k: K, v: QuestionForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const masterClasses = useMasterClasses();
  const [topicClass, setTopicClass] = useState<number | null>(null);
  const books = useBooksForClassSubject(topicClass, form.subject);
  const [topicPicker, setTopicPicker] = useState(false);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [tagSearch, setTagSearch] = useState('');
  const [verifying, setVerifying] = useState<number | null>(null);
  const formTags = useSubjectTags(form.subject);
  const current = editing && editing !== 'new' ? editing : null;

  const open = (q: Question | 'new') => {
    setError(null);
    if (q !== 'new' && !isEditableType(q.question_type)) {
      toast.error(`${typeLabel(q.question_type)} questions are edited on the web.`);
      return;
    }
    setForm(q === 'new' ? { ...emptyQuestionForm(), subject: subjectFilter === -1 ? null : subjectFilter } : questionToForm(q));
    setTagIds([]);
    setTagSearch('');
    setEditing(q);
  };

  const save = async () => {
    const problem = validateQuestion(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildQuestionPayload(form);
      if (editing === 'new') {
        const res = await actions.create.mutateAsync(payload);
        const created = res.data as Question;
        // As on the web, tags picked before the first save are linked once the question exists.
        if (created?.id && tagIds.length > 0) {
          await Promise.all(tagIds.map((tagId) => actions.tag.mutateAsync({ id: created.id, tagId }))).catch(() => toast.error('Some tags could not be linked.'));
        }
        // Pictures need a saved question, so stay on it and offer them.
        toast.success('Question saved. You can add pictures now.');
        if (created?.id) { setEditing(created); return; }
      } else await actions.update.mutateAsync({ id: (editing as Question).id, data: payload });
      toast.success('Question saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  // On a saved question a tag is linked or unlinked at once (and put back if the server refuses); on a new one it waits for Save.
  const toggleTag = async (tagId: number) => {
    const on = tagIds.includes(tagId);
    setTagIds((ids) => toggleId(ids, tagId));
    if (!current) return;
    try {
      await actions.tag.mutateAsync({ id: current.id, tagId, remove: on });
    } catch {
      setTagIds((ids) => toggleId(ids, tagId));
      toast.error(on ? 'Could not remove the tag.' : 'Could not link the tag.');
    }
  };

  const makeTag = async () => {
    if (!form.subject || !tagSearch.trim()) return;
    try {
      const res = await actions.createTag.mutateAsync(newTagPayload(tagSearch, form.subject));
      const id = (res.data as { id?: number })?.id;
      setTagSearch('');
      if (id) await toggleTag(id);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not create the tag.'));
    }
  };

  const verify = async (q: Question) => {
    if (!user?.id) return toast.error('Unable to verify: sign in again.');
    setVerifying(q.id);
    try {
      await actions.update.mutateAsync({ id: q.id, data: verifyPayload(user.id) });
      toast.success('Marked as verified.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not verify the question.'));
    } finally {
      setVerifying(null);
    }
  };

  const remove = async (q: Question) => {
    if (!(await confirm({ title: 'Delete this question?', message: 'Papers that already use it keep their own copy of the wording.', confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(q.id);
      toast.success('Question deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the question.'));
    }
  };

  const header = (
    <View>
      <SegmentedTabs tabs={SEARCH_MODES.map((m) => ({ value: m.value, label: m.label }))} value={mode} onChange={setMode} />
      <SearchBar value={search} onChangeText={setSearch} placeholder={mode === 'meaning' ? 'Describe what you are looking for...' : 'Search questions...'} />
      {mode === 'meaning' ? (
        <Select label="Class (needed to search by meaning)" searchable value={classFilter} onChange={setClassFilter} placeholder="Choose a class"
          options={(masterClasses.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))} />
      ) : null}
      <Select label="Subject" value={subjectFilter} onChange={setSubjectFilter}
        options={[{ value: -1, label: 'All subjects' }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      <Select label="Type" value={typeFilter} onChange={setTypeFilter} options={[{ value: ANY, label: 'All types' }, ...QUESTION_TYPES.map((t) => ({ value: t.value as string, label: t.label }))]} />
      <Select label="Difficulty" value={diffFilter} onChange={setDiffFilter} options={[{ value: ANY, label: 'Any difficulty' }, ...DIFFICULTIES.map((d) => ({ value: d.value as string, label: d.label }))]} />
      <Select label="Thinking level" value={bloomFilter} onChange={setBloomFilter} options={[{ value: ANY, label: 'Any thinking level' }, ...BLOOM_LEVELS.map((b) => ({ value: b.value as string, label: b.label }))]} />
      {subjectId ? (
        <Select label="Tag" value={tagFilter} onChange={setTagFilter} options={[{ value: -1, label: 'Any tag' }, ...(filterTagList.data ?? []).map((t) => ({ value: t.id, label: t.name }))]} />
      ) : null}
      {mode === 'meaning' && !classFilter ? <Text style={styles.sub}>Choose a class to search by meaning.</Text> : null}
      {mode === 'meaning' && meaning.isFetching ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.sm }} /> : null}
      {fellBack ? <Text style={styles.sub}>Nothing close in meaning; showing keyword results instead.</Text> : null}
      <Button title="+ New question" size="sm" onPress={() => open('new')} />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={useHits ? (hits as unknown as Question[]) : rows}
        keyExtractor={(q) => String(q.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => !useHits && query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No questions" message={term ? 'Nothing matches your search.' : 'Write the first question.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: q }) => {
          const ai = aiStatus(q);
          const hit = useHits ? (q as unknown as { book_title?: string; chapter_title?: string; topic_title?: string }) : null;
          return (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => (useHits ? undefined : open(q))} disabled={useHits}>
            <Text style={styles.text} numberOfLines={3}>{plainText(q.question_text)}</Text>
            {hit && hitContext(hit as never) ? <Text style={styles.sub}>{hitContext(hit as never)}</Text> : null}
            {ai ? (
              <View style={styles.meta}>
                <StatusPill label={aiLabel(ai)} tone={ai === 'verified' ? 'success' : 'warning'} />
                {ai === 'unverified' ? <Button title="Mark verified" size="sm" variant="outline" onPress={() => verify(q)} loading={verifying === q.id} disabled={verifying !== null} /> : null}
              </View>
            ) : null}
            <View style={styles.meta}>
              <Text style={styles.sub}>{[q.subject_name, typeLabel(q.question_type), `${Number(q.marks)} mark${Number(q.marks) === 1 ? '' : 's'}`].filter(Boolean).join('  ·  ')}</Text>
              <StatusPill label={DIFFICULTIES.find((d) => d.value === q.difficulty_level)?.label ?? q.difficulty_level} tone={difficultyTone(q.difficulty_level)} />
            </View>
          </TouchableOpacity>
          );
        }}
      />

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New question' : 'Edit question'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Select label="Subject" searchable value={form.subject} onChange={(v) => set('subject', v)} placeholder="Choose a subject"
          options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Select label="Type" value={form.type} onChange={(v) => set('type', v)} options={QUESTION_TYPES.map((t) => ({ value: t.value as string, label: t.label }))} />
        <RichTextField label="Question" value={form.text} onChange={(v) => set('text', v)} resetKey={current?.id ?? 'new'} />
        {form.type === 'MCQ' ? (
          <>
            <Input label="Option A" value={form.a} onChangeText={(v) => set('a', v)} />
            <Input label="Option B" value={form.b} onChangeText={(v) => set('b', v)} />
            <Input label="Option C (optional)" value={form.c} onChangeText={(v) => set('c', v)} />
            <Input label="Option D (optional)" value={form.d} onChangeText={(v) => set('d', v)} />
            <Select label="Correct option" value={form.correct} onChange={(v) => set('correct', v)} placeholder="Not set"
              options={['A', 'B', 'C', 'D'].map((k) => ({ value: k, label: k }))} />
          </>
        ) : form.type === 'TRUE_FALSE' ? (
          <Select label="Answer" value={form.correct.toLowerCase()} onChange={(v) => set('correct', v)} placeholder="Choose"
            options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} />
        ) : form.type === 'FILL_BLANK' ? (
          <BlankFields blanks={form.blanks} onChange={(next) => set('blanks', next)} />
        ) : form.type === 'MATCHING' ? null : (
          <Input label="Short answer key (optional)" value={form.correct} onChangeText={(v) => set('correct', v)} />
        )}
        {['SHORT', 'LONG', 'ESSAY'].includes(form.type) ? <Input label="Model answer (optional)" value={form.answer} onChangeText={(v) => set('answer', v)} multiline /> : null}
        {form.type === 'MATCHING' ? <MatchingFields form={form} set={set} /> : null}
        <Select label="Class (to find the book topics)" searchable value={topicClass} onChange={setTopicClass} placeholder="Choose a class"
          options={(masterClasses.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))} />
        <Button title={form.topics.length ? `Topics tagged: ${form.topics.length}` : 'Tag book topics'} variant="outline" size="sm" disabled={!topicClass || !form.subject} onPress={() => setTopicPicker(true)} />
        {form.topics.length ? <Text style={styles.sub}>{topicSummary(books.data ?? [], form.topics) || 'Topics from other books or classes are kept.'}</Text> : null}
        {current ? <QuestionPictures question={current} type={form.type} ensure={async () => current} onChange={(q) => setEditing(q)} /> : <Text style={styles.sub}>Save the question first to add pictures.</Text>}
        <View style={styles.pictures}>
          <Text style={styles.sub}>Tags (subject tags)</Text>
          {!form.subject ? <Text style={styles.sub}>Choose the subject to see its tags.</Text> : (
            <>
              <Input value={tagSearch} onChangeText={setTagSearch} placeholder="Search or add a tag" autoCapitalize="none" />
              <View style={styles.tagWrap}>
                {filterTags(formTags.data ?? [], tagSearch).map((t) => {
                  const on = tagIds.includes(t.id);
                  return (
                    <TouchableOpacity key={t.id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${on ? 'Remove' : 'Add'} tag ${t.name}`} onPress={() => toggleTag(t.id)} style={[styles.tag, on && styles.tagOn]}>
                      <Text style={[styles.tagText, on && styles.tagTextOn]}>{on ? '✓ ' : ''}{t.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {canCreateTag(formTags.data ?? [], tagSearch) ? <Button title={`Create tag "${tagSearch.trim()}"`} size="sm" variant="outline" onPress={makeTag} loading={actions.createTag.isPending} /> : null}
            </>
          )}
        </View>
        <Input label="Marks" value={form.marks} onChangeText={(v) => set('marks', v)} keyboardType="decimal-pad" />
        <Select label="Difficulty" value={form.difficulty} onChange={(v) => set('difficulty', v)} options={DIFFICULTIES.map((d) => ({ value: d.value as string, label: d.label }))} />
        <Select label="Thinking level (optional)" value={form.bloom} onChange={(v) => set('bloom', v)} placeholder="Not set" options={BLOOM_LEVELS.map((b) => ({ value: b.value as string, label: b.label }))} />
        {editing && editing !== 'new' ? <Button title="Delete question" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>

      <LessonPlanTopicPicker visible={topicPicker} books={books.data ?? []} loading={books.isLoading} value={form.topics} onChange={(ids) => set('topics', ids)} onClose={() => setTopicPicker(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.xs },
  text: { fontSize: FontSize.md, color: Colors.text },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  sub: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  big: { minHeight: 100, textAlignVertical: 'top' },
  matching: { gap: Spacing.xs },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  matchCol: { flex: 1 },
  pictures: { gap: Spacing.xs },
  pictureLabel: { flex: 1 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  tag: { minHeight: 36, justifyContent: 'center', paddingHorizontal: Spacing.md, borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceSecondary, borderWidth: 1, borderColor: 'transparent' },
  tagOn: { borderColor: Colors.primary },
  tagText: { fontSize: FontSize.sm, color: Colors.text },
  tagTextOn: { color: Colors.primary, fontWeight: '600' },
});
