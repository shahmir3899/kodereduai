import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, FlatList, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { bankQuestionPayload, confirmPayload, type CaptureState, type ReviewQuestion } from '../../services/paperCapture';
import { emptyPagesSession, type PagesSession } from '../../services/paperPages';
import { useMasterClasses } from '../../hooks/useAcademicYear';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { usePaper, usePaperActions, usePaperCoverage, usePaperExams, usePaperLessons } from '../../hooks/usePapers';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useQuestionActions, useQuestionsPaged } from '../../hooks/useQuestionBank';
import { useSubjectsList } from '../../hooks/useManager';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  addQuestion, addToSection, assignSection, buildAutosavePayload, buildEnsurePayload, countIn, dropSection,
  allocatedMarks, applyOverused, emptyPaperForm, isLockedStatus, hydrateStructure, isFull, reuseLine, structureMismatch, marksOf, moveInSection, slotLine, PAPER_STATUSES, pickedFromQuestion,
  paperFileName, paperToForm, paperTotal, pickedFromPaperRow, reconcileNote, removeQuestion, 
  statusSteps, validatePaper, validateSetup, type PaperForm, type PickedQuestion, type Section,
} from '../../services/paperBuilder';
import { typeLabel, type Question } from '../../services/questionBank';
import { plainText } from '../../services/richText';
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
import PaperPagesSheet from './PaperPagesSheet';
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
  const base = usePersonaBase();
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
  // The section the open question sheet or bank picker is filling (null = a free add, with no sections).
  const [target, setTarget] = useState<Section | null>(null);
  // Setup -> Structure -> Add Questions, as on the web; a saved paper opens at step 3.
  const [step, setStep] = useState<1 | 2 | 3>(routeId ? 3 : 1);
  // Capture from photos: the capture lives here so closing its sheet keeps it. Accepting creates the reviewed questions in
  // the bank, adds them with their sections, and remembers the pages to confirm once the paper is saved.
  const [capture, setCapture] = useState<PagesSession>(emptyPagesSession());
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
      setPicked(applyOverused([...(saved.data.paper_questions ?? [])].sort((a, b) => a.question_order - b.question_order).map(pickedFromPaperRow), saved.data.overused_questions));
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
    if (Number(c.header.totalMarks) > 0) set('totalMarks', String(Number(c.header.totalMarks)));
    setSections((ss) => [...ss, ...c.sections]);
    setPicked((ps) => [...ps, ...made.map(({ q, question }) => ({ ...pickedFromQuestion(question), sectionKey: q.sectionKey }))]);
    setPendingConfirm((prev) => ({
      uploadIds: [...(prev?.uploadIds ?? []), ...c.pages.filter((p) => p.status === 'extracted' && p.uploadId).map((p) => p.uploadId as number)],
      questions: [...(prev?.questions ?? []), ...c.questions],
    }));
    createdByLocal.current.clear();
    setCapture(emptyPagesSession());
  };

  const save = async (stay = false) => {
    const problem = validatePaper(form, picked, sections);
    if (problem) return setError(problem);
    setError(null);
    const note = reconcileNote(picked, sections, form.totalMarks);
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
      // router.back() landed on Home when the builder was opened from More; the saved paper shows in the list.
      else router.replace(`${base}/papers` as Href);
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

  // Only a draft can be edited, as on the web. A ready or published paper opens locked; "Reopen as draft" is a deliberate step
  // (it used to be put back to draft and restored silently on every save).
  const locked = isLockedStatus(savedStatus);
  const reopen = async () => {
    if (!paperId) return;
    setBusy(true);
    try {
      await actions.update.mutateAsync({ id: paperId, data: { status: 'DRAFT' } });
      setSavedStatus('DRAFT');
      set('status', 'DRAFT');
      toast.success('Paper reopened as a draft.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Structure -> Add Questions: warn (never block) when the sections and the typed Total Marks disagree, as the web does.
  const goToQuestions = async () => {
    const note = structureMismatch(sections, form.totalMarks);
    if (note && !(await confirm({ title: 'Marks mismatch', message: note, confirmLabel: 'Continue' }))) return;
    setStep(3);
  };

  // One question row: where it sits, its marks (a change applies to this paper only), and move / remove.
  const renderPicked = (p: PickedQuestion) => (
    <View key={p.question} style={styles.q}>
      <Text style={styles.qText} numberOfLines={3}>{picked.indexOf(p) + 1}. {plainText(p.text)}</Text>
      <Text style={styles.sub}>{typeLabel(p.type)} · {marksOf(p)} mark{marksOf(p) === 1 ? '' : 's'}{p.override.trim() ? ` (bank: ${p.bankMarks})` : ''}</Text>
      {reuseLine(p.useCount) ? <Text style={styles.warn}>{reuseLine(p.useCount)}</Text> : null}
      {groups.length > 0 ? (
        <Select hiddenLabel={`Section of question ${picked.indexOf(p) + 1}`} value={p.sectionKey} placeholder="Section" onChange={(v) => setPicked((ps) => assignSection(ps, p.question, v))}
          options={[{ value: '', label: 'No section' }, ...groups.map((g) => ({ value: g.key, label: g.title || 'Section' }))]} />
      ) : null}
      <View style={styles.qActions}>
        <View style={styles.col}>
          <Input value={p.override} onChangeText={(v) => setPicked((ps) => ps.map((x) => (x.question === p.question ? { ...x, override: v } : x)))} placeholder={`Marks ${p.bankMarks}`} keyboardType="decimal-pad" />
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move up" style={styles.btn} onPress={() => setPicked((ps) => moveInSection(ps, p.question, -1))}><Text style={styles.btnText}>↑</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move down" style={styles.btn} onPress={() => setPicked((ps) => moveInSection(ps, p.question, 1))}><Text style={styles.btnText}>↓</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove question" style={styles.btn} onPress={() => setPicked((ps) => removeQuestion(ps, p.question))}><Text style={[styles.btnText, { color: Colors.error }]}>✕</Text></TouchableOpacity>
      </View>
    </View>
  );

  if (routeId && saved.isLoading) return <Skeleton />;
  if (routeId && saved.isError && !saved.data) return <ErrorState error={saved.error} onRetry={() => saved.refetch()} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {locked ? (
        <View style={styles.lockBanner}>
          <Text style={styles.name}>This paper is {PAPER_STATUSES.find((x) => x.value === savedStatus)?.label ?? savedStatus}, so it cannot be edited.</Text>
          <Text style={styles.sub}>Reopen it as a draft to change it. You can still share the PDF.</Text>
          <View style={styles.row}>
            <View style={styles.col}><Button title="Reopen as draft" onPress={reopen} loading={busy} disabled={busy} /></View>
            <View style={styles.col}><Button title="Share PDF" variant="outline" onPress={share} disabled={busy} /></View>
          </View>
        </View>
      ) : null}
      <View pointerEvents={locked ? 'none' : 'auto'} style={locked ? styles.lockedBody : styles.body}>
      <StepBar step={step} onGo={(n) => { if (n !== 1 && validateSetup(form)) setError(validateSetup(form)); else { setError(null); if (n === 3) goToQuestions(); else setStep(n); } }} />
      {step === 1 ? (
        <>
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
      <Input label="Total marks" value={form.totalMarks} onChangeText={(v) => set('totalMarks', v)} keyboardType="decimal-pad" />
      <Input label="Duration (minutes)" value={form.duration} onChangeText={(v) => set('duration', v)} keyboardType="number-pad" />
      <Input label="Instructions for students" value={form.instructions} onChangeText={(v) => set('instructions', v)} multiline />
      <View style={styles.row}>
        <Text style={[styles.sub, styles.col]}>Print ruled answer lines under each answer</Text>
        <Switch value={form.answerLines} onValueChange={(on) => set('answerLines', on)} accessibilityLabel="Print answer lines" />
      </View>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <Button title="Next: Paper structure" onPress={() => { const p = validateSetup(form); setError(p); if (!p) setStep(2); }} />
        </>
      ) : null}

      {step === 2 ? (
        <>
      <SectionsEditor
        sections={sections} onChange={setSections} noun="paper" standardTotal={Number(form.totalMarks) > 0 ? Number(form.totalMarks) : 100}
        placed={(key) => countIn(picked, key)}
        onRemove={(key) => { const r = dropSection(sections, picked, key); setSections(r.sections); setPicked(r.picked); }}
      />
          <Text style={styles.sub}>Sections add up to {allocatedMarks(sections)} of {form.totalMarks || 100} total marks.</Text>
          <View style={styles.row}>
            <View style={styles.col}><Button title="Back: Setup" variant="outline" onPress={() => setStep(1)} /></View>
            <View style={styles.col}><Button title="Next: Add questions" onPress={goToQuestions} /></View>
          </View>
        </>
      ) : null}

      {step === 3 ? (
        <>
          {sections.length === 0 ? <Text style={styles.sub}>No sections yet: define them in step 2, or add questions freely.</Text> : null}
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

      <Text style={styles.section}>Questions · {picked.length} · {total} marks</Text>
      {groups.length > 0 ? sections.map((sec) => (sec.type === 'divider' ? (
        <Text key={sec.key} style={styles.divider}>{sec.title}</Text>
      ) : (
        <View key={sec.key} style={styles.slotBlock}>
          <Text style={styles.name}>{sec.title} · {typeLabel(sec.question_type)}</Text>
          {sec.instruction.trim() ? <Text style={styles.sub}>{sec.instruction}</Text> : null}
          <Text style={styles.sub}>{slotLine(sec, picked)}</Text>
          {picked.filter((p) => p.sectionKey === sec.key).map(renderPicked)}
          {isFull(sec, picked) ? <Text style={styles.sub}>This section is full. Raise the number shown in step 2 to add more.</Text> : (
            <View style={styles.row}>
              <View style={styles.col}><Button title="+ Write" variant="outline" onPress={() => { setTarget(sec); setQuick(true); }} disabled={!form.subject} /></View>
              <View style={styles.col}><Button title="+ From bank" variant="outline" onPress={() => { setTarget(sec); setPicker(true); }} /></View>
            </View>
          )}
        </View>
      ))) : null}
      {groups.length > 0 && picked.some((p) => !groups.some((g) => g.key === p.sectionKey)) ? (
        <View style={styles.slotBlock}>
          <Text style={styles.name}>Not in a section</Text>
          {picked.filter((p) => !groups.some((g) => g.key === p.sectionKey)).map(renderPicked)}
        </View>
      ) : null}
      {groups.length === 0 ? picked.map(renderPicked) : null}
      {groups.length === 0 ? (
        <>
          <Button title="+ Add questions from the bank" variant="outline" onPress={() => { setTarget(null); setPicker(true); }} />
          <Button title="+ Write a new question" variant="outline" onPress={() => { setTarget(null); setQuick(true); }} disabled={!form.subject} />
        </>
      ) : null}
      <Button title={capture.totalPages ? `Capture from photos (${capture.totalPages} page${capture.totalPages === 1 ? '' : 's'} in progress)` : 'Capture from photos'} variant="outline"
        onPress={() => setCaptureOpen(true)} />
      {!form.classObj || !form.subject ? <Text style={styles.sub}>Class and subject can be chosen after the photos are read; nothing is saved before that.</Text> : null}

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
              {reconcileNote(picked, sections, form.totalMarks) ? <Text style={styles.warn}>Allocated marks (sections) do not match the total marks of the paper.</Text> : null}
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

      {!locked ? (
        <>
          <Select label="Status" value={form.status} onChange={(v) => set('status', v)} options={PAPER_STATUSES.map((s) => ({ value: s.value as string, label: s.label }))} />
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <Button title="Save paper" onPress={() => save(false)} loading={busy} disabled={busy} />
          <Button title="Save and check coverage" variant="outline" onPress={() => save(true)} disabled={busy} />
        </>
      ) : null}
      {paperId && !locked ? <Button title="Share PDF" variant="outline" onPress={share} disabled={busy} /> : null}
          <Button title="Back: Paper structure" variant="ghost" onPress={() => setStep(2)} />
        </>
      ) : null}

      </View>

      <PaperPagesSheet visible={captureOpen} onClose={() => setCaptureOpen(false)} classId={form.classObj} subjectId={form.subject}
        session={capture} setSession={setCapture} onAccept={acceptCapture} />
      <QuickQuestionSheet
        visible={quick} subject={form.subject} onClose={() => setQuick(false)}
        section={target ? { title: target.title, question_type: target.question_type, marksPerQuestion: target.marksPerQuestion } : null}
        slotsLeft={target ? Math.max(0, target.slotsShown - countIn(picked, target.key)) : undefined}
        onCreated={(q) => setPicked((ps) => (target ? addToSection(ps, q, target) : addQuestion(ps, q)))}
      />
      <QuestionPicker
        visible={picker} subject={form.subject} type={target?.question_type ?? ''} topicIds={narrowedTopics.map((t) => t.id)} chosen={picked} onClose={() => setPicker(false)}
        slotsLeft={target ? Math.max(0, target.slotsShown - countIn(picked, target.key)) : undefined}
        onToggle={(q, on) => setPicked((ps) => {
          if (!on) return removeQuestion(ps, q.id);
          return target ? (isFull(target, ps) ? ps : addToSection(ps, q, target)) : addQuestion(ps, q);
        })}
      />
    </ScrollView>
  );
}

function StepBar({ step, onGo }: { step: 1 | 2 | 3; onGo: (n: 1 | 2 | 3) => void }) {
  const steps: Array<[1 | 2 | 3, string]> = [[1, 'Setup'], [2, 'Structure'], [3, 'Add questions']];
  return (
    <View style={styles.steps}>
      {steps.map(([n, label]) => (
        <TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={`Step ${n}: ${label}`} accessibilityState={{ selected: step === n }} style={[styles.step, step === n && styles.stepOn]} onPress={() => onGo(n)}>
          <Text style={[styles.stepText, step === n && styles.stepTextOn]}>{n}. {label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function QuestionPicker({ visible, subject, type, slotsLeft, topicIds, chosen, onClose, onToggle }: {
  visible: boolean; subject: number | null; type: string; slotsLeft?: number; topicIds: number[]; chosen: PickedQuestion[]; onClose: () => void; onToggle: (q: Question, on: boolean) => void;
}) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useQuestionsPaged(term, subject, type, '', '', null, topicIds);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const ids = new Set(chosen.map((c) => c.question));
  return (
    <BottomSheet visible={visible} onClose={onClose} title={`${topicIds.length ? `Add questions (${topicIds.length} topic${topicIds.length === 1 ? '' : 's'})` : subject ? 'Add questions (this subject)' : 'Add questions'}${slotsLeft !== undefined ? ` · ${slotsLeft} slot${slotsLeft === 1 ? '' : 's'} left` : ''}`}>
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
                <Text style={styles.qText} numberOfLines={2}>{on ? '✓ ' : ''}{plainText(q.question_text)}</Text>
                <Text style={styles.sub}>{typeLabel(q.question_type)} · {Number(q.marks)} marks</Text>
                {reuseLine(q.paper_use_count) ? <Text style={styles.warn}>{reuseLine(q.paper_use_count)}</Text> : null}
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
  body: { gap: Spacing.sm },
  lockedBody: { gap: Spacing.sm, opacity: 0.55 },
  lockBanner: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  divider: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textSecondary, textAlign: 'center', marginTop: Spacing.sm },
  slotBlock: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.sm, gap: Spacing.sm },
  steps: { flexDirection: 'row', gap: Spacing.xs },
  step: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceSecondary },
  stepOn: { backgroundColor: Colors.infoLight, borderWidth: 1, borderColor: Colors.primary },
  stepText: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
  stepTextOn: { color: Colors.primary, fontWeight: '600' },
});
