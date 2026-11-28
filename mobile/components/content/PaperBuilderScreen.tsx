import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useClassSubjectOptions, useSectionPicker } from '../../hooks/useSectionPicker';
import { usePaper, usePaperActions, usePaperCoverage, usePaperExams, usePaperLessons } from '../../hooks/usePapers';
import { useSubjectsList } from '../../hooks/useManager';
import { emptyPaperForm, isLockedStatus, PAPER_STATUSES, paperToForm, validateSetup, type PaperForm } from '../../services/paperBuilder';
import { blockSetupPayload, emptyClassMessage } from '../../services/blockPaper';
import { useAuth } from '../../contexts/AuthContext';
import type { Block } from '../../services/shared/blockDocument';
import {
  autoPaperTitle, coverageView, examOptionLabel, lessonLine, sameIds, sloText, toggleId,
} from '../../services/questionExtras';
import { inventoryErrorMessage } from '../../services/inventory';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import { useToast } from '../ui/Toast';
import BlockPaperEditor from './blocks/BlockPaperEditor';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The paper builder, as on the web since Paper Builder v2 (docs/PAPER_BUILDER_V2_PLAN.md, Phase 6): Setup (class,
// subject, exam, title, duration, instructions, lesson plans, status), then Structure (the paper's questions, parts
// and marks, made at once) and Fill questions (written on the paper), both the block editor
// (blocks/BlockPaperEditor.tsx, docs/PAPER_BUILDER_STRUCTURE_PLAN.md). An old paper opens in the editor converted to blocks and is saved in the new form
// only once something in it changes. Total marks are the sum of the blocks.
export default function PaperBuilderScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const routeId = id ? Number(id) : null;
  const toast = useToast();
  const actions = usePaperActions();
  const picker = useSectionPicker();
  // The section picked here; a saved paper (master class only) shows its class's first section.
  const [classPick, setClassPick] = useState<number | null>(null);
  const { persona } = useAuth();
  const subjects = useSubjectsList();
  const saved = usePaper(routeId);
  const [paperId, setPaperId] = useState<number | null>(routeId);
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  const [form, setForm] = useState<PaperForm>(emptyPaperForm());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!routeId);
  // A saved paper opens on Fill questions; a new one on Setup, then Structure.
  const [step, setStep] = useState<1 | 2 | 3>(routeId ? 3 : 1);
  const [pendingConfirm, setPendingConfirm] = useState<{ uploadIds: number[]; blocks: Block[] } | null>(null);
  // The title follows "Exam - Class - Subject" until the person types their own (or clears it back to empty).
  const [titleAuto, setTitleAuto] = useState(!routeId);
  const { current: year } = useAcademicYear();
  const exams = usePaperExams(form.classObj, year?.id);
  const lessons = usePaperLessons(form.classObj, form.subject);
  const coverage = usePaperCoverage(paperId);
  const cov = coverageView(coverage.data);
  const [lessonIds, setLessonIds] = useState<number[]>([]);
  const lessonsSeeded = React.useRef(false);
  useEffect(() => {
    if (!lessonsSeeded.current && coverage.data) { lessonsSeeded.current = true; setLessonIds(cov.linkedIds); }
  }, [coverage.data, cov.linkedIds]);
  const set = <K extends keyof PaperForm>(k: K, v: PaperForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const examLabel = (() => { const e = (exams.data ?? []).find((x) => x.id === form.exam); return e ? examOptionLabel(e) : ''; })();
  const shownPick = classPick ?? picker.optionFor(form.classObj);
  const className = picker.options.find((o) => o.value === shownPick)?.label ?? '';
  const classSubjects = useClassSubjectOptions(form.classObj);
  // A saved paper's subject stays selectable even if the class no longer teaches it.
  const subjectOptions = !form.classObj ? (subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))
    : classSubjects.some((o) => o.value === form.subject) || !form.subject ? classSubjects
    : [...classSubjects, ...(subjects.data ?? []).filter((s) => s.id === form.subject).map((s) => ({ value: s.id, label: s.name }))];
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
      setLoaded(true);
    }
  }, [routeId, saved.data, loaded]);

  // The scan feedback (which blocks the teacher kept) is recorded for each photographed page, as the web does.
  useEffect(() => {
    if (!paperId || !pendingConfirm) return;
    const { uploadIds, blocks } = pendingConfirm;
    setPendingConfirm(null);
    uploadIds.forEach((uid) => {
      examinationsApi.confirmPaperUpload(uid, { exam_paper_id: paperId, confirmed_data: { blocks } }).catch(() => undefined);
    });
  }, [paperId, pendingConfirm]);

  const locked = isLockedStatus(savedStatus);

  // Save the paper's details (creating the draft the first time), link the chosen lesson plans, and set the status.
  const saveDetails = async (): Promise<number | null> => {
    const problem = validateSetup(form);
    setError(problem);
    if (problem) return null;
    let target = paperId;
    if (!target) {
      target = ((await actions.ensure.mutateAsync(blockSetupPayload(form))).data as { id: number }).id;
      setPaperId(target);
      setSavedStatus('DRAFT');
    } else if (!locked) {
      await actions.autosave.mutateAsync({ id: target, data: blockSetupPayload(form) });
    }
    if (!sameIds(lessonIds, cov.linkedIds)) await actions.linkLessons.mutateAsync({ id: target, ids: lessonIds });
    return target;
  };

  const goBuild = async () => {
    setBusy(true);
    try {
      if (await saveDetails()) setStep(2);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveStatus = async () => {
    setBusy(true);
    try {
      const target = await saveDetails();
      if (!target) return;
      if (form.status !== (savedStatus ?? 'DRAFT')) {
        await actions.update.mutateAsync({ id: target, data: { status: form.status } });
        setSavedStatus(form.status);
      }
      toast.success('Paper saved.');
      await coverage.refetch();
    } catch (e) {
      setError(inventoryErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Only a draft can be edited, as on the web. A ready or published paper opens locked; reopening is a deliberate step.
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

  const statusOptions = useMemo(() => PAPER_STATUSES.map((s) => ({ value: s.value as string, label: s.label })), []);

  if (routeId && saved.isLoading) return <Skeleton />;
  if (routeId && saved.isError && !saved.data) return <ErrorState error={saved.error} onRetry={() => saved.refetch()} />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {locked ? (
        <View style={styles.lockBanner}>
          <Text style={styles.name}>This paper is {PAPER_STATUSES.find((x) => x.value === savedStatus)?.label ?? savedStatus}, so it cannot be edited.</Text>
          <Text style={styles.sub}>Reopen it as a draft to change it. You can still print it and share the PDF or Word file.</Text>
          <Button title="Reopen as draft" onPress={reopen} loading={busy} disabled={busy} />
        </View>
      ) : null}
      <View style={styles.steps}>
        {([[1, 'Setup'], [2, 'Structure'], [3, 'Fill']] as const).map(([n, label]) => (
          <TouchableOpacity key={n} accessibilityRole="button" accessibilityLabel={`Step ${n}: ${label}`} accessibilityState={{ selected: step === n }}
            style={[styles.step, step === n && styles.stepOn]}
            onPress={() => (n === 1 ? setStep(1) : (paperId && (locked || step !== 1) ? setStep(locked ? 3 : n) : goBuild()))}>
            <Text style={[styles.stepText, step === n && styles.stepTextOn]}>{n}. {label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {step === 1 ? (
        <View pointerEvents={locked ? 'none' : 'auto'} style={locked ? styles.lockedBody : styles.body}>
          <Input label="Paper title" value={form.title} onChangeText={(v) => { setTitleAuto(v.trim() === ''); set('title', v); }} />
          {titleAuto && suggested ? <Text style={styles.sub}>Made from the exam, class and subject. Type your own any time.</Text> : null}
          <Select label="Class" searchable value={shownPick} placeholder={picker.isLoading ? 'Loading classes...' : 'Choose a class'}
            onChange={(v) => { setClassPick(Number(v)); set('classObj', picker.masterOf(Number(v))); }}
            options={picker.options} />
          {!picker.isLoading && picker.options.length === 0 ? <Text style={styles.warn}>{emptyClassMessage(persona)}</Text> : null}
          <Select label="Subject" searchable value={form.subject} onChange={(v) => set('subject', v)} placeholder="Choose a subject"
            options={subjectOptions} />
          {form.classObj ? (
            <Select label="Exam (optional)" value={form.exam ?? -1} onChange={(v) => set('exam', v === -1 ? null : Number(v))} placeholder="Choose an exam"
              options={[{ value: -1, label: exams.isLoading ? 'Loading exams…' : (exams.data ?? []).length ? 'No exam' : 'No exams for this class this year' }, ...(exams.data ?? []).map((e) => ({ value: e.id, label: examOptionLabel(e) }))]} />
          ) : null}
          <Input label="Duration (minutes)" value={form.duration} onChangeText={(v) => set('duration', v)} keyboardType="number-pad" />
          <Input label="Instructions for students" value={form.instructions} onChangeText={(v) => set('instructions', v)} multiline />

          {form.classObj && form.subject ? (
            <View style={styles.card}>
              <Text style={styles.name}>Lesson plans (optional)</Text>
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
                  <Text style={styles.sub}>The chosen lesson plans are linked to the paper when you save; the coverage below follows them.</Text>
                </>
              )}
            </View>
          ) : null}

          {paperId ? (
            <View style={styles.card}>
              <Text style={styles.name}>Curriculum coverage</Text>
              {coverage.isLoading ? <Text style={styles.sub}>Loading coverage…</Text> : coverage.isError ? <Text style={styles.error}>Could not load coverage.</Text> : (
                <>
                  <Text style={styles.sub}>{cov.total} learning objectives in the linked lesson plans · {cov.coveredCount} covered ({cov.percent}%)</Text>
                  <View style={styles.track}><View style={[styles.fill, { width: `${cov.percent}%` }]} /></View>
                  {cov.total === 0 ? <Text style={styles.sub}>Link lesson plans above, then save, to see which objectives the questions reach.</Text> : (
                    <>
                      {cov.covered.map((o) => <Text key={o.id} style={styles.sub}>✓ {sloText(o)}</Text>)}
                      {cov.uncovered.map((o) => <Text key={o.id} style={styles.sub}>• {sloText(o)}</Text>)}
                    </>
                  )}
                </>
              )}
            </View>
          ) : null}

          <Select label="Status" value={form.status} onChange={(v) => set('status', v)} options={statusOptions} />
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <Button title="Next: Structure" onPress={goBuild} loading={busy} disabled={busy} />
          {paperId ? <Button title="Save details and status" variant="outline" onPress={saveStatus} disabled={busy} /> : null}
        </View>
      ) : null}

      {step >= 2 && paperId ? (
        <>
          <BlockPaperEditor paperId={paperId} title={form.title} readOnly={locked} classId={form.classObj} subjectId={form.subject}
            mode={step === 2 && !locked ? 'structure' : 'fill'} onModeChange={(m) => setStep(m === 'structure' ? 2 : 3)}
            onCaptured={(p) => setPendingConfirm((prev) => ({ uploadIds: [...(prev?.uploadIds ?? []), ...p.uploadIds], blocks: [...(prev?.blocks ?? []), ...p.blocks] }))} />
          <Button title="Back: Setup" variant="ghost" onPress={() => setStep(1)} />
        </>
      ) : null}
      {step >= 2 && !paperId ? <Text style={styles.sub}>Choose the class, the subject and a title in Setup first.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 4 },
  qText: { fontSize: FontSize.md, color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  error: { color: Colors.error, fontSize: FontSize.sm },
  warn: { color: Colors.warning, fontSize: FontSize.sm },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  track: { height: 8, borderRadius: 4, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 8, backgroundColor: Colors.success },
  pick: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, marginBottom: Spacing.xs, minHeight: 44 },
  picked: { borderWidth: 2, borderColor: Colors.primary },
  body: { gap: Spacing.sm },
  lockedBody: { gap: Spacing.sm, opacity: 0.55 },
  lockBanner: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm, borderWidth: 1, borderColor: Colors.border },
  steps: { flexDirection: 'row', gap: Spacing.xs },
  step: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceSecondary },
  stepOn: { backgroundColor: Colors.infoLight, borderWidth: 1, borderColor: Colors.primary },
  stepText: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
  stepTextOn: { color: Colors.primary, fontWeight: '600' },
});
