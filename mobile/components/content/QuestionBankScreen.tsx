import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useMasterClasses } from '../../hooks/useAcademicYear';
import { useBooksForClassSubject } from '../../hooks/useLessonPlans';
import { useQuestionActions, useQuestionsPaged } from '../../hooks/useQuestionBank';
import { topicSummary } from '../../services/lessonPlanTools';
import LessonPlanTopicPicker from '../lms/LessonPlanTopicPicker';
import { useSubjectsList } from '../../hooks/useManager';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  BLOOM_LEVELS, buildQuestionPayload, hasPicture, pictureProblem, slotsFor, type PictureSlot, DIFFICULTIES, difficultyTone, emptyQuestionForm, isEditableType, QUESTION_TYPES,
  questionToForm, typeLabel, validateQuestion, type Question, type QuestionForm,
} from '../../services/questionBank';
import { inventoryErrorMessage } from '../../services/inventory';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
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
  const query = useQuestionsPaged(term, subjectFilter === -1 ? null : subjectFilter, typeFilter, diffFilter);
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
  const [pictureBusy, setPictureBusy] = useState<string | null>(null);
  const current = editing && editing !== 'new' ? editing : null;

  const open = (q: Question | 'new') => {
    setError(null);
    if (q !== 'new' && !isEditableType(q.question_type)) {
      toast.error(`${typeLabel(q.question_type)} questions are edited on the web.`);
      return;
    }
    setForm(q === 'new' ? { ...emptyQuestionForm(), subject: subjectFilter === -1 ? null : subjectFilter } : questionToForm(q));
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

  const addPicture = async (slot: PictureSlot) => {
    if (!current) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return toast.error('Allow photo access in your phone settings.');
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = pictureProblem(asset.mimeType ?? 'image/jpeg', asset.fileSize);
    if (problem) return toast.error(problem);
    setPictureBusy(slot);
    try {
      const form = new FormData();
      form.append('slot', slot);
      form.append('file', { uri: asset.uri, name: asset.fileName ?? `${slot}.jpg`, type: asset.mimeType ?? 'image/jpeg' } as unknown as Blob);
      const res = (await actions.uploadPicture.mutateAsync({ id: current.id, form })).data as Record<string, string>;
      const field = Object.keys(res).find((k) => k.endsWith('_image_url'));
      if (field) setEditing({ ...current, [field]: res[field] });
      toast.success('Picture added.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not upload the picture.'));
    } finally {
      setPictureBusy(null);
    }
  };

  const dropPicture = async (slot: PictureSlot) => {
    if (!current) return;
    setPictureBusy(slot);
    try {
      await actions.removePicture.mutateAsync({ id: current.id, slot });
      const field = slotsFor(current.question_type).find((x) => x.slot === slot)?.field;
      if (field) setEditing({ ...current, [field]: null });
      toast.success('Picture removed.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not remove the picture.'));
    } finally {
      setPictureBusy(null);
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
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search questions..." />
      <Select label="Subject" value={subjectFilter} onChange={setSubjectFilter}
        options={[{ value: -1, label: 'All subjects' }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      <Select label="Type" value={typeFilter} onChange={setTypeFilter} options={[{ value: ANY, label: 'All types' }, ...QUESTION_TYPES.map((t) => ({ value: t.value as string, label: t.label }))]} />
      <Select label="Difficulty" value={diffFilter} onChange={setDiffFilter} options={[{ value: ANY, label: 'Any difficulty' }, ...DIFFICULTIES.map((d) => ({ value: d.value as string, label: d.label }))]} />
      <Button title="+ New question" size="sm" onPress={() => open('new')} />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(q) => String(q.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No questions" message={term ? 'Nothing matches your search.' : 'Write the first question.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: q }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => open(q)}>
            <Text style={styles.text} numberOfLines={3}>{q.question_text}</Text>
            <View style={styles.meta}>
              <Text style={styles.sub}>{[q.subject_name, typeLabel(q.question_type), `${Number(q.marks)} mark${Number(q.marks) === 1 ? '' : 's'}`].filter(Boolean).join('  ·  ')}</Text>
              <StatusPill label={DIFFICULTIES.find((d) => d.value === q.difficulty_level)?.label ?? q.difficulty_level} tone={difficultyTone(q.difficulty_level)} />
            </View>
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New question' : 'Edit question'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Select label="Subject" searchable value={form.subject} onChange={(v) => set('subject', v)} placeholder="Choose a subject"
          options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
        <Select label="Type" value={form.type} onChange={(v) => set('type', v)} options={QUESTION_TYPES.map((t) => ({ value: t.value as string, label: t.label }))} />
        <Input label="Question" value={form.text} onChangeText={(v) => set('text', v)} multiline style={styles.big} />
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
        ) : (
          <Input label={form.type === 'FILL_BLANK' ? 'Accepted answer (optional)' : 'Short answer key (optional)'} value={form.correct} onChangeText={(v) => set('correct', v)} />
        )}
        {['SHORT', 'LONG', 'ESSAY'].includes(form.type) ? <Input label="Model answer (optional)" value={form.answer} onChangeText={(v) => set('answer', v)} multiline /> : null}
        {form.type === 'MATCHING' ? (
          <View style={styles.matching}>
            <Text style={styles.sub}>Left column, then right column. Choose each left item's partner.</Text>
            {form.left.map((l, i) => (
              <View key={`l${i}`} style={styles.matchRow}>
                <View style={styles.matchCol}><Input value={l} placeholder={`Left ${i + 1}`} onChangeText={(v) => set('left', form.left.map((x, j) => (j === i ? v : x)))} /></View>
                <View style={styles.matchCol}>
                  <Select value={form.pairs[i] ?? -1} placeholder="Partner" onChange={(v) => set('pairs', form.pairs.map((x, j) => (j === i ? (v === -1 ? null : v) : x)))}
                    options={[{ value: -1, label: 'No partner' }, ...form.right.map((r, ri) => ({ value: ri, label: r.trim() || `Right ${ri + 1}` })).filter((o) => form.right[o.value].trim())]} />
                </View>
              </View>
            ))}
            {form.right.map((r, i) => (
              <Input key={`r${i}`} value={r} placeholder={`Right ${i + 1}`} onChangeText={(v) => set('right', form.right.map((x, j) => (j === i ? v : x)))} />
            ))}
            <View style={styles.matchRow}>
              <Button title="+ Left item" variant="ghost" size="sm" disabled={form.left.length >= 8} onPress={() => { set('left', [...form.left, '']); set('pairs', [...form.pairs, null]); }} />
              <Button title="+ Right item" variant="ghost" size="sm" disabled={form.right.length >= 8} onPress={() => set('right', [...form.right, ''])} />
            </View>
          </View>
        ) : null}
        <Select label="Class (to find the book topics)" searchable value={topicClass} onChange={setTopicClass} placeholder="Choose a class"
          options={(masterClasses.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))} />
        <Button title={form.topics.length ? `Topics tagged: ${form.topics.length}` : 'Tag book topics'} variant="outline" size="sm" disabled={!topicClass || !form.subject} onPress={() => setTopicPicker(true)} />
        {form.topics.length ? <Text style={styles.sub}>{topicSummary(books.data ?? [], form.topics) || 'Topics from other books or classes are kept.'}</Text> : null}
        {current ? (
          <View style={styles.pictures}>
            <Text style={styles.sub}>Pictures (JPEG, PNG or WebP, up to 5 MB)</Text>
            {slotsFor(form.type).map((sl) => (
              <View key={sl.slot} style={styles.matchRow}>
                <Text style={[styles.sub, styles.pictureLabel]}>{sl.label}{hasPicture(current, sl.slot) ? ' ✓' : ''}</Text>
                <Button title={hasPicture(current, sl.slot) ? 'Replace' : 'Add'} size="sm" variant="outline" onPress={() => addPicture(sl.slot)} loading={pictureBusy === sl.slot} disabled={pictureBusy !== null} />
                {hasPicture(current, sl.slot) ? <Button title="Remove" size="sm" variant="ghost" onPress={() => dropPicture(sl.slot)} disabled={pictureBusy !== null} /> : null}
              </View>
            ))}
          </View>
        ) : <Text style={styles.sub}>Save the question first to add pictures.</Text>}
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
});
