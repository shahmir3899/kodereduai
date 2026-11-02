import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, FlatList, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { bankQuestionPayload, confirmPayload, emptyCapture, type CaptureState, type ReviewQuestion } from '../../services/paperCapture';
import { useMasterClasses } from '../../hooks/useAcademicYear';
import { usePaper, usePaperActions, usePaperCoverage, usePaperExams, usePaperLessons } from '../../hooks/usePapers';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useQuestionActions, useQuestionsPaged } from '../../hooks/useQuestionBank';
import { useSubjectsList } from '../../hooks/useManager';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  addQuestion, assignSection, buildAutosavePayload, buildEnsurePayload, countIn, dropSection,
  emptyPaperForm, hydrateStructure, marksOf, moveQuestion, PAPER_STATUSES, pickedFromQuestion,
  paperFileName, paperToForm, paperTotal, pickedFromPaperRow, reconcileNote, removeQuestion, 
  statusSteps, validatePaper, type PaperForm, type PickedQuestion, type Section,
} from '../../services/paperBuilder';
import { typeLabel, type Question } from '../../services/questionBank';
import {
  autoPaperTitle, BLOOM_ORDER, bloomMix, coverageView, examOptionLabel, lessonLine, sameIds, sloText, toggleId, topicsOfLessons,
} from '../../services/questionExtras';
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
import QuickQuestionSheet from './QuickQuestionSheet';
import PaperCaptureSheet from './PaperCaptureSheet';
import SectionsEditor from './SectionsEditor';
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
  const questions = useQuestionActions();
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
  const [quick, setQuick] = useState(false);
  // Capture from photos: the capture lives here so closing its sheet keeps it. Accepting creates the reviewed questions in
  // the bank, adds them with their sections, and remembers the pages to confirm once the paper is saved.
  const [capture, setCapture] = useState<CaptureState>(emptyCapture());
  const [captureOpen, setCaptureOpen] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<{ uploadIds: number[]; questions: ReviewQuestion[] } | null>(null);
  const createdByLocal = React.useRef(new Map<string, Question>());
  // The title follows "Exam - Class - Subject" until the person types their own (or clears it back to empty).
  const [titleAuto, setTitleAuto] = useState(!routeId);
  const { current: year } = useAcademicYear();
  const exams = usePaperExams(form.classObj, year?.id);
  const lessons = usePaperLessons(form.classObj, form.subject);
  const coverage = usePaperCoverage(paperId);
  const cov = coverageView(coverage.data);
  const [lessonIds, setLessonIds] = useState<number[]>([]);
  const lessonsSeeded = React.useRef(false);
  // Seeded from what the server already has linked, so an unseeded empty choice is never taken for "clear everything".
  useEffect(() => {
    if (!lessonsSeeded.current && coverage.data) { lessonsSeeded.current = true; setLessonIds(cov.linkedIds); }
  }, [coverage.data, cov.linkedIds]);
  const narrowedTopics = useMemo(() => topicsOfLessons(lessons.data ?? [], lessonIds), [lessons.data, lessonIds]);
  const mix = useMemo(() => bloomMix(picked.map((p) => ({ bloom_level: p.bloom }))), [picked]);
  const set = <K extends keyof PaperForm>(k: K, v: PaperForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const examLabel = (() => { const e = (exams.data ?? []).find((x) => x.id === form.exam); return e ? examOptionLabel(e) : ''; })();
  const className = String((classes.data ?? []).find((c) => Number(c.id) === form.classObj)?.name ?? '');
  const suggested = autoPaperTitle(examLabel, className, (subjects.data ?? []).find((x) => x.id === form.subject)?.name ?? '');
  useEffect(() => {
    if (titleAuto && suggested && suggested !== form.title) setForm((f) => ({ ...f, title: suggested }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleAuto, suggested]);

  useEffect(() => {
    if (routeId && saved.data && !loaded) {
      setForm(paperToForm(saved.data));
      setTitleAuto(!saved.data.paper_title?.trim());
      setSavedStatus(saved.data.status);
      setSections(hydrateStructure(saved.data.structure));
      setPicked([...(saved.data.paper_questions ?? [])].sort((a, b) => a.question_order - b.question_order).map(pickedFromPaperRow));
      setLoaded(true);
    }
  }, [routeId, saved.data, loaded]);

  const groups = sections.filter((s) => s.type !== 'divider');
  const total = useMemo(() => paperTotal(picked, sections), [picked, sections]);

  const acceptCapture = async (c: CaptureState) => {
    if (!form.subject) throw new Error('Choose the subject first.');
    const made: Array<{ q: ReviewQuestion; question: Question }> = [];
    for (let i = 0; i < c.questions.length; i += 1) {
      const rq = c.questions[i];
      let question = createdByLocal.current.get(rq.localId);
      if (!question) {
        try {
          question = (await questions.create.mutateAsync(bankQuestionPayload(rq, form.subject))).data as Question;
        } catch (e) {
          throw new Error(`Question ${i + 1} could not be added: ${inventoryErrorMessage(e, 'the server refused it.')} Fix it and accept again; the earlier ones are kept.`);
        }
        createdByLocal.current.set(rq.localId, question);
      }
      made.push({ q: rq, question });
    }
    if (c.header.title.trim()) { setTitleAuto(false); set('title', c.header.title.trim()); }
    if (c.header.duration.trim()) set('duration', c.header.duration.trim());
    setSections((ss) => [...ss, ...c.sections]);
    setPicked((ps) => [...ps, ...made.map(({ q, question }) => ({ ...pickedFromQuestion(question), sectionKey: q.sectionKey }))]);
    setPendingConfirm((prev) => ({
      uploadIds: [...(prev?.uploadIds ?? []), ...c.pages.filter((p) => p.status === 'extracted' && p.uploadId).map((p) => p.uploadId as number)],
      questions: [...(prev?.questions ?? []), ...c.questions],
    }));
    createdByLocal.current.clear();
    setCapture(emptyCapture());
  };

  const save = async (stay = false) => {
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
      // Link the chosen lesson plans when they differ from what the server has (the web does the same once a draft exists).
      if (target && !sameIds(lessonIds, cov.linkedIds)) await actions.linkLessons.mutateAsync({ id: target, ids: lessonIds });
      // The learning loop is told what the person made of each captured page; the paper itself is already saved above.
      if (target && pendingConfirm) {
        await Promise.all(pendingConfirm.uploadIds.map((uid) => examinationsApi.confirmPaperUpload(uid, confirmPayload(target as number, pendingConfirm.questions)).catch(() => undefined)));
        setPendingConfirm(null);
      }
      toast.success('Paper saved.');
      if (stay) await coverage.refetch();
      else router.back();
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
      <Input label="Paper title" value={form.title} onChangeText={(v) => { setTitleAuto(v.trim() === ''); set('title', v); }} />
      {titleAuto && suggested ? <Text style={styles.sub}>Made from the exam, class and subject. Type your own any time.</Text> : null}
      <Select label="Class" searchable value={form.classObj} onChange={(v) => set('classObj', v)} placeholder="Choose a class"
        options={(classes.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))} />
      <Select label="Subject" searchable value={form.subject} onChange={(v) => set('subject', v)} placeholder="Choose a subject"
        options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
      {form.classObj ? (
        <Select label="Exam (optional)" value={form.exam ?? -1} onChange={(v) => set('exam', v === -1 ? null : Number(v))} placeholder="Choose an exam"
          options={[{ value: -1, label: exams.isLoading ? 'Loading exams…' : (exams.data ?? []).length ? 'No exam' : 'No exams for this class this year' }, ...(exams.data ?? []).map((e) => ({ value: e.id, label: examOptionLabel(e) }))]} />
      ) : null}
      <Input label="Duration (minutes)" value={form.duration} onChangeText={(v) => set('duration', v)} keyboardType="number-pad" />
      <Input label="Instructions for students" value={form.instructions} onChangeText={(v) => set('instructions', v)} multiline />
      <View style={styles.row}>
        <Text style={[styles.sub, styles.col]}>Print ruled answer lines under each answer</Text>
        <Switch value={form.answerLines} onValueChange={(on) => set('answerLines', on)} accessibilityLabel="Print answer lines" />
      </View>

      {form.classObj && form.subject ? (
        <View style={styles.q}>
          <Text style={styles.name}>Narrow by lesson plans (optional)</Text>
          {lessons.isLoading ? <Text style={styles.sub}>Loading lesson plans…</Text> : (lessons.data ?? []).length === 0 ? <Text style={styles.sub}>No lesson plans found for this class and subject.</Text> : (
            <>
              {(lessons.data ?? []).map((l) => {
                const on = lessonIds.includes(l.id);
                return (
                  <TouchableOpacity key={l.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={[styles.pick, on && styles.picked]} onPress={() => setLessonIds((ids) => toggleId(ids, l.id))}>
                    <Text style={styles.qText} numberOfLines={2}>{on ? '☑ ' : '☐ '}{l.title}</Text>
                    <Text style={styles.sub}>{lessonLine(l)}</Text>
                  </TouchableOpacity>
                );
              })}
              {lessonIds.length > 0 ? <Button title="Clear selection" size="sm" variant="ghost" onPress={() => setLessonIds([])} /> : null}
              {narrowedTopics.length > 0 ? <Text style={styles.sub}>The question picker is narrowed to {narrowedTopics.length} topic(s): {narrowedTopics.map((t) => `${t.topic_number ?? ''} ${t.title ?? ''}`.trim()).join(', ')}</Text> : null}
              <Text style={styles.sub}>The chosen lesson plans are linked to the paper when you save; the coverage below follows them.</Text>
            </>
          )}
        </View>
      ) : null}

      <SectionsEditor
        sections={sections} onChange={setSections} noun="paper" standardTotal={form.title ? total || 100 : 100}
        placed={(key) => countIn(picked, key)}
        onRemove={(key) => { const r = dropSection(sections, picked, key); setSections(r.sections); setPicked(r.picked); }}
      />

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
      <Button title="+ Write a new question" variant="outline" onPress={() => setQuick(true)} disabled={!form.subject} />
      <Button title={capture.pages.length ? `Capture from photos (${capture.pages.length} page${capture.pages.length === 1 ? '' : 's'} in progress)` : 'Capture from photos'} variant="outline"
        onPress={() => setCaptureOpen(true)} disabled={!form.classObj || !form.subject} />
      {!form.classObj || !form.subject ? <Text style={styles.sub}>Choose the class and subject to capture a printed paper from photos.</Text> : null}

      {picked.length > 0 ? (
        <View style={styles.q}>
          <Text style={styles.name}>Thinking levels</Text>
          {BLOOM_ORDER.filter((k) => mix.counts[k] > 0).map((k) => <Text key={k} style={styles.sub}>{k.charAt(0).toUpperCase() + k.slice(1)}: {mix.counts[k]} ({mix.percent[k]}%)</Text>)}
          {mix.surfaceHeavy ? <Text style={styles.warn}>More than 70% of the questions only ask to remember or understand ({mix.surfacePercent}%).</Text> : null}
        </View>
      ) : null}

      {paperId ? (
        <View style={styles.q}>
          <Text style={styles.name}>Curriculum coverage</Text>
          {coverage.isLoading ? <Text style={styles.sub}>Loading coverage…</Text> : coverage.isError ? <Text style={styles.error}>Could not load coverage.</Text> : (
            <>
              {reconcileNote(picked, sections) ? <Text style={styles.warn}>Allocated marks (sections) do not match the total marks of the paper.</Text> : null}
              <Text style={styles.sub}>{cov.total} learning objectives in the linked lesson plans · {cov.coveredCount} covered ({cov.percent}%)</Text>
              <View style={styles.track}><View style={[styles.fill, { width: `${cov.percent}%` }]} /></View>
              {cov.total === 0 ? <Text style={styles.sub}>Link lesson plans above, then save, to see which objectives the questions reach.</Text> : (
                <>
                  <Text style={styles.name}>Covered</Text>
                  {cov.covered.length === 0 ? <Text style={styles.sub}>None yet.</Text> : cov.covered.map((o) => <Text key={o.id} style={styles.sub}>✓ {sloText(o)}</Text>)}
                  <Text style={styles.name}>Not covered</Text>
                  {cov.uncovered.length === 0 ? <Text style={styles.sub}>Every objective is covered.</Text> : cov.uncovered.map((o) => <Text key={o.id} style={styles.sub}>• {sloText(o)}</Text>)}
                </>
              )}
            </>
          )}
        </View>
      ) : <Text style={styles.sub}>Save the paper to see curriculum coverage.</Text>}

      <Select label="Status" value={form.status} onChange={(v) => set('status', v)} options={PAPER_STATUSES.map((s) => ({ value: s.value as string, label: s.label }))} />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title="Save paper" onPress={() => save(false)} loading={busy} disabled={busy} />
      <Button title="Save and check coverage" variant="outline" onPress={() => save(true)} disabled={busy} />
      {paperId ? <Button title="Share PDF" variant="outline" onPress={share} disabled={busy} /> : null}

      <PaperCaptureSheet kind="paper" visible={captureOpen} onClose={() => setCaptureOpen(false)} classId={form.classObj} subjectId={form.subject}
        capture={capture} setCapture={setCapture} onAccept={acceptCapture} />
      <QuickQuestionSheet
        visible={quick} subject={form.subject} onClose={() => setQuick(false)}
        onCreated={(q) => setPicked((ps) => { const next = addQuestion(ps, q); return groups.length === 1 ? assignSection(next, q.id, groups[0].key) : next; })}
      />
      <QuestionPicker
        visible={picker} subject={form.subject} topicIds={narrowedTopics.map((t) => t.id)} chosen={picked} onClose={() => setPicker(false)}
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

function QuestionPicker({ visible, subject, topicIds, chosen, onClose, onToggle }: {
  visible: boolean; subject: number | null; topicIds: number[]; chosen: PickedQuestion[]; onClose: () => void; onToggle: (q: Question, on: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useQuestionsPaged(term, subject, '', '', '', null, topicIds);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const ids = new Set(chosen.map((c) => c.question));
  return (
    <BottomSheet visible={visible} onClose={onClose} title={topicIds.length ? `Add questions (${topicIds.length} topic${topicIds.length === 1 ? '' : 's'})` : subject ? 'Add questions (this subject)' : 'Add questions'}>
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
  warn: { color: Colors.warningText, fontSize: FontSize.sm },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: Colors.success },
  pickerBody: { paddingHorizontal: Spacing.lg, gap: Spacing.sm },
  pickerList: { maxHeight: 380 },
  pick: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, marginBottom: Spacing.xs, minHeight: 44 },
  picked: { borderWidth: 2, borderColor: Colors.primary },
});
