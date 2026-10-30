import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, FlatList, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { useMasterClasses } from '../../hooks/useAcademicYear';
import { usePaper, usePaperActions } from '../../hooks/usePapers';
import { useQuestionsPaged } from '../../hooks/useQuestionBank';
import { useSubjectsList } from '../../hooks/useManager';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  addQuestion, allocatedMarks, assignSection, autoDistribution, buildAutosavePayload, buildEnsurePayload, countIn, dropSection,
  emptyPaperForm, hydrateStructure, isChoice, makeDivider, makeSection, marksOf, moveQuestion, moveSection, PAPER_STATUSES,
  paperFileName, paperToForm, paperTotal, pickedFromPaperRow, reconcileNote, removeQuestion, SECTION_TYPES, setChoice, setSlotsCounted,
  setSlotsShown, statusSteps, validatePaper, type PaperForm, type PickedQuestion, type Section,
} from '../../services/paperBuilder';
import { typeLabel, type Question } from '../../services/questionBank';
import { inventoryErrorMessage } from '../../services/inventory';
import { exportErrorMessage } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import SearchBar from '../ui/SearchBar';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import BottomSheet from '../ui/BottomSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Build or edit a question paper from the question bank: details, sections (question groups with
// "attempt any N", and printed dividers), questions placed in sections, marks changes for this paper
// only, status, and the server's PDF. Saved the way the web saves a draft: the paper and its
// structure first, then its questions in section order.
export default function PaperBuilderScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const routeId = id ? Number(id) : null;
  const router = useRouter();
  const toast = useToast();
  const actions = usePaperActions();
  const classes = useMasterClasses();
  const subjects = useSubjectsList();
  const saved = usePaper(routeId);
  const [paperId, setPaperId] = useState<number | null>(routeId);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  const [form, setForm] = useState<PaperForm>(emptyPaperForm());
  const [picked, setPicked] = useState<PickedQuestion[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!routeId);
  const set = <K extends keyof PaperForm>(k: K, v: PaperForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (routeId && saved.data && !loaded) {
      setForm(paperToForm(saved.data));
      setSavedStatus(saved.data.status);
      setSections(hydrateStructure(saved.data.structure));
      setPicked([...(saved.data.paper_questions ?? [])].sort((a, b) => a.question_order - b.question_order).map(pickedFromPaperRow));
      setLoaded(true);
    }
  }, [routeId, saved.data, loaded]);

  const groups = sections.filter((s) => s.type !== 'divider');
  const total = useMemo(() => paperTotal(picked, sections), [picked, sections]);
  const updateSection = (key: string, fn: (s: Section) => Section) => setSections((ss) => ss.map((s) => (s.key === key ? fn(s) : s)));

  const save = async () => {
    const problem = validatePaper(form, picked, sections);
    if (problem) return setError(problem);
    setError(null);
    const note = reconcileNote(picked, sections);
    if (note && !(await confirm({ title: 'The marks do not match', message: `${note}\nThe paper total will be ${total}.`, confirmLabel: 'Save anyway' }))) return;
    setBusy(true);
    try {
      const steps = statusSteps(savedStatus, form.status);
      let target = paperId;
      // The server only autosaves a draft, so a ready or published paper is set back to draft for the edit.
      if (target && steps.first) await actions.update.mutateAsync({ id: target, data: { status: 'DRAFT' } });
      if (!target) {
        target = ((await actions.ensure.mutateAsync(buildEnsurePayload(form, picked, sections))).data as { id: number }).id;
        setPaperId(target);
      }
      await actions.autosave.mutateAsync({ id: target, data: buildAutosavePayload(form, picked, sections) });
      if (steps.last) await actions.update.mutateAsync({ id: target, data: { status: form.status } });
      setSavedStatus(form.status);
      toast.success('Paper saved.');
      router.back();
    } catch (e) {
      setError(inventoryErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!paperId) return;
    setBusy(true);
    try {
      await shareReportFile(() => examinationsApi.generatePaperPdf(paperId), paperFileName(form.title), 'pdf');
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (routeId && saved.isLoading) return <Skeleton />;
  if (routeId && saved.isError && !saved.data) return <ErrorState error={saved.error} onRetry={() => saved.refetch()} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Input label="Paper title" value={form.title} onChangeText={(v) => set('title', v)} />
      <Select label="Class" searchable value={form.classObj} onChange={(v) => set('classObj', v)} placeholder="Choose a class"
        options={(classes.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))} />
      <Select label="Subject" searchable value={form.subject} onChange={(v) => set('subject', v)} placeholder="Choose a subject"
        options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
      <Input label="Duration (minutes)" value={form.duration} onChangeText={(v) => set('duration', v)} keyboardType="number-pad" />
      <Input label="Instructions for students" value={form.instructions} onChangeText={(v) => set('instructions', v)} multiline />

      <Text style={styles.section}>Sections · {allocatedMarks(sections)} marks</Text>
      <Text style={styles.sub}>Optional. Sections print the paper as Question 1, 2, 3… with "attempt any N" choices. Without them the paper is one list.</Text>
      {sections.map((s, i) => (
        <View key={s.key} style={styles.q}>
          {s.type === 'divider' ? (
            <Input label="Divider (printed heading)" value={s.title} onChangeText={(v) => updateSection(s.key, (x) => ({ ...x, title: v }))} />
          ) : (
            <>
              <Input label="Title" value={s.title} onChangeText={(v) => updateSection(s.key, (x) => ({ ...x, title: v }))} />
              <Select label="Question type" value={s.question_type} onChange={(v) => updateSection(s.key, (x) => ({ ...x, question_type: v }))}
                options={SECTION_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))} />
              <View style={styles.row}>
                <View style={styles.col}><Input label="Questions shown" value={String(s.slotsShown)} onChangeText={(v) => updateSection(s.key, (x) => setSlotsShown(x, v))} keyboardType="number-pad" /></View>
                <View style={styles.col}><Input label="Marks each" value={String(s.marksPerQuestion)} onChangeText={(v) => updateSection(s.key, (x) => ({ ...x, marksPerQuestion: Number(v) || 0 }))} keyboardType="decimal-pad" /></View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.sub, styles.col]}>Student chooses which to attempt</Text>
                <Switch value={isChoice(s)} onValueChange={(on) => updateSection(s.key, (x) => setChoice(x, on))} accessibilityLabel="Student chooses which questions to attempt" />
              </View>
              {isChoice(s) ? <Input label="Questions to attempt" value={String(s.slotsCounted)} onChangeText={(v) => updateSection(s.key, (x) => setSlotsCounted(x, v))} keyboardType="number-pad" /> : null}
              <Input label="Instruction (optional)" value={s.instruction} onChangeText={(v) => updateSection(s.key, (x) => ({ ...x, instruction: v, autoInstruction: false }))} />
              <Text style={styles.sub}>{countIn(picked, s.key)} of {s.slotsShown} questions placed here</Text>
            </>
          )}
          <View style={styles.qActions}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move section up" style={styles.btn} onPress={() => setSections((ss) => moveSection(ss, i, -1))}><Text style={styles.btnText}>↑</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move section down" style={styles.btn} onPress={() => setSections((ss) => moveSection(ss, i, 1))}><Text style={styles.btnText}>↓</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove section" style={styles.btn} onPress={() => { const r = dropSection(sections, picked, s.key); setSections(r.sections); setPicked(r.picked); }}><Text style={[styles.btnText, { color: Colors.error }]}>✕</Text></TouchableOpacity>
          </View>
        </View>
      ))}
      <View style={styles.row}>
        <Button title="+ Section" size="sm" variant="outline" onPress={() => setSections((ss) => [...ss, makeSection(ss.filter((x) => x.type !== 'divider').length)])} />
        <Button title="+ Divider" size="sm" variant="outline" onPress={() => setSections((ss) => [...ss, makeDivider(ss.filter((x) => x.type === 'divider').length)])} />
        <Button title="Standard layout" size="sm" variant="ghost" onPress={() => setSections(autoDistribution(form.title ? total || 100 : 100))} />
      </View>

      <Text style={styles.section}>Questions · {picked.length} · {total} marks</Text>
      {picked.map((p, i) => (
        <View key={p.question} style={styles.q}>
          <Text style={styles.qText} numberOfLines={3}>{i + 1}. {p.text}</Text>
          <Text style={styles.sub}>{typeLabel(p.type)} · {marksOf(p)} mark{marksOf(p) === 1 ? '' : 's'}{p.override.trim() ? ` (bank: ${p.bankMarks})` : ''}</Text>
          {groups.length > 0 ? (
            <Select value={p.sectionKey} placeholder="Section" onChange={(v) => setPicked((ps) => assignSection(ps, p.question, v))}
              options={[{ value: '', label: 'No section' }, ...groups.map((g) => ({ value: g.key, label: g.title || 'Section' }))]} />
          ) : null}
          <View style={styles.qActions}>
            <View style={styles.col}>
              <Input value={p.override} onChangeText={(v) => setPicked((ps) => ps.map((x) => (x.question === p.question ? { ...x, override: v } : x)))} placeholder={`Marks ${p.bankMarks}`} keyboardType="decimal-pad" />
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move up" style={styles.btn} onPress={() => setPicked((ps) => moveQuestion(ps, i, -1))}><Text style={styles.btnText}>↑</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move down" style={styles.btn} onPress={() => setPicked((ps) => moveQuestion(ps, i, 1))}><Text style={styles.btnText}>↓</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove question" style={styles.btn} onPress={() => setPicked((ps) => removeQuestion(ps, p.question))}><Text style={[styles.btnText, { color: Colors.error }]}>✕</Text></TouchableOpacity>
          </View>
        </View>
      ))}
      <Button title="+ Add questions from the bank" variant="outline" onPress={() => setPicker(true)} />

      <Select label="Status" value={form.status} onChange={(v) => set('status', v)} options={PAPER_STATUSES.map((s) => ({ value: s.value as string, label: s.label }))} />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title="Save paper" onPress={save} loading={busy} disabled={busy} />
      {paperId ? <Button title="Share PDF" variant="outline" onPress={share} disabled={busy} /> : null}

      <QuestionPicker
        visible={picker} subject={form.subject} chosen={picked} onClose={() => setPicker(false)}
        onToggle={(q, on) => setPicked((ps) => {
          if (!on) return removeQuestion(ps, q.id);
          const next = addQuestion(ps, q);
          // With exactly one section, new questions go straight into it.
          return groups.length === 1 ? assignSection(next, q.id, groups[0].key) : next;
        })}
      />
    </ScrollView>
  );
}

function QuestionPicker({ visible, subject, chosen, onClose, onToggle }: {
  visible: boolean; subject: number | null; chosen: PickedQuestion[]; onClose: () => void; onToggle: (q: Question, on: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useQuestionsPaged(term, subject, '', '');
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const ids = new Set(chosen.map((c) => c.question));
  return (
    <BottomSheet visible={visible} onClose={onClose} title={subject ? 'Add questions (this subject)' : 'Add questions'}>
      <View style={styles.pickerBody}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search questions..." />
        <FlatList
          data={rows} keyExtractor={(q) => String(q.id)} style={styles.pickerList} keyboardShouldPersistTaps="handled"
          onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
          ListEmptyComponent={<Text style={styles.sub}>{query.isLoading ? 'Loading…' : 'No questions found.'}</Text>}
          renderItem={({ item: q }) => {
            const on = ids.has(q.id);
            return (
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.pick, on && styles.picked]} onPress={() => onToggle(q, !on)}>
                <Text style={styles.qText} numberOfLines={2}>{on ? '✓ ' : ''}{q.question_text}</Text>
                <Text style={styles.sub}>{typeLabel(q.question_type)} · {Number(q.marks)} marks</Text>
              </TouchableOpacity>
            );
          }}
        />
        <Button title={`Done (${chosen.length} chosen)`} onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.md },
  q: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 4 },
  qText: { fontSize: FontSize.md, color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  col: { flex: 1, minWidth: 120 },
  qActions: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  btn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: FontSize.lg, color: Colors.primary },
  error: { color: Colors.error, fontSize: FontSize.sm },
  pickerBody: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  pickerList: { maxHeight: 380 },
  pick: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, marginBottom: Spacing.xs, minHeight: 44 },
  picked: { borderWidth: 2, borderColor: Colors.primary },
});
