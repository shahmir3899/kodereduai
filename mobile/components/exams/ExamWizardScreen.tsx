import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAcademicYear, useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useClassSubjectRows, useExamTypeList, useTermList, useWizardCreate } from '../../hooks/useExamsAdmin';
import {
  autoFill, buildPairs, buildWizardPayload, conflictText, emptyDetails, scheduledCount, sectionLabels, subjectsBySection, suggestName,
  validateClasses, validateDetails, validateSheet, withDefaultSubjects, type DateSheet, type WizardDetails,
} from '../../services/examWizard';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Step = 'details' | 'classes' | 'dates' | 'review';
const STEPS: Array<{ value: Step; label: string }> = [
  { value: 'details', label: '1 Details' }, { value: 'classes', label: '2 Classes' }, { value: 'dates', label: '3 Dates' }, { value: 'review', label: '4 Create' },
];

// Create an exam for several sections at once with its date sheet, in one go: details, classes and
// subjects, the date for each subject, then review. Admin and principal only. Nothing is created
// until the last step, and the server does it all in one transaction.
export default function ExamWizardScreen() {
  const router = useRouter();
  const toast = useToast();
  const create = useWizardCreate();
  const { current: year } = useAcademicYear();
  const types = useExamTypeList();
  const terms = useTermList();
  const sections = useAttendanceClassOptions().options.filter((o) => o.isSession);
  const rows = useClassSubjectRows();

  const [step, setStep] = useState<Step>('details');
  const [d, setD] = useState<WizardDetails>(emptyDetails());
  const [named, setNamed] = useState(false);
  const [classIds, setClassIds] = useState<number[]>([]);
  const [chosen, setChosen] = useState<Record<number, number[]>>({});
  const [sheet, setSheet] = useState<DateSheet>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof WizardDetails>(k: K, v: WizardDetails[K]) => setD((x) => ({ ...x, [k]: v }));

  const bySection = useMemo(() => subjectsBySection(rows.data ?? []), [rows.data]);
  const labels = useMemo(() => sectionLabels(sections), [sections]);
  const pairs = useMemo(() => buildPairs(classIds, chosen, bySection, labels), [classIds, chosen, bySection, labels]);

  // Suggest the name from type, term and year until the person types their own.
  useEffect(() => {
    if (named) return;
    const type = types.data?.find((t) => t.id === d.examType)?.name;
    const term = terms.data?.find((t) => t.id === d.term)?.name;
    setD((x) => ({ ...x, name: suggestName(type, term, year?.name) }));
  }, [named, d.examType, d.term, types.data, terms.data, year?.name]);

  useEffect(() => setChosen((c) => withDefaultSubjects(c, classIds, bySection)), [classIds, bySection]);

  if (rows.isLoading || types.isLoading) return <Skeleton />;
  if (!year) return <EmptyState title="No academic year" message="Create or activate an academic year on the web first." />;
  if (sections.length === 0) return <EmptyState title="No sections" message="This academic year has no sections yet. Add them on the web first." />;

  const go = (next: Step) => { setError(null); setStep(next); };

  const next = () => {
    if (step === 'details') {
      const p = validateDetails(d);
      return p ? setError(p) : go('classes');
    }
    if (step === 'classes') {
      const p = validateClasses(classIds, chosen);
      if (p) return setError(p);
      // Fill the dates automatically the first time (one subject per day, Sundays skipped).
      if (scheduledCount(sheet) === 0) {
        const r = autoFill(pairs, d.start, d.end);
        setSheet(r.sheet);
        if (r.extendedTo) { set('end', r.end); setNotice(`The last day was moved to ${r.extendedTo} so every subject has its own day.`); } else setNotice(null);
      }
      return go('dates');
    }
    if (step === 'dates') {
      const p = validateSheet(sheet, d.start, d.end);
      return p ? setError(p) : go('review');
    }
  };

  const submit = async () => {
    const problem = validateDetails(d) ?? validateClasses(classIds, chosen) ?? validateSheet(sheet, d.start, d.end);
    if (problem) return setError(problem);
    const ok = await confirm({
      title: 'Create these exams?',
      message: `${d.name.trim()}\n${classIds.length} class${classIds.length === 1 ? '' : 'es'}, ${pairs.length} subject paper${pairs.length === 1 ? '' : 's'}, ${scheduledCount(sheet)} dated.`,
      confirmLabel: 'Create',
    });
    if (!ok) return;
    setError(null);
    try {
      await create.mutateAsync(buildWizardPayload(d, year.id, classIds, chosen, sheet));
      toast.success('Exams created.');
      router.back();
    } catch (e) {
      const data = (e as { response?: { data?: { detail?: string; conflicts?: Array<{ class_name: string; existing_exam: string }> } } }).response?.data;
      setError(conflictText(data) ?? inventoryErrorMessage(e, 'Could not create the exams.'));
    }
  };

  const toggleClass = (id: number) => setClassIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const toggleSubject = (cls: number, subject: number) => setChosen((c) => {
    const cur = c[cls] ?? [];
    return { ...c, [cls]: cur.includes(subject) ? cur.filter((x) => x !== subject) : [...cur, subject] };
  });
  const setSlot = (key: string, patch: Partial<DateSheet[string]>) => setSheet((s) => ({ ...s, [key]: { ...s[key], date: s[key]?.date ?? '', ...patch } }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SegmentedTabs tabs={STEPS} value={step} onChange={() => undefined} />

      {step === 'details' ? (
        <View style={styles.gap}>
          <Select label="Exam type" value={d.examType} onChange={(v) => set('examType', v)} placeholder="Choose a type" options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          <Select label="Term (optional)" value={d.term} onChange={(v) => set('term', v)} placeholder="No term" options={(terms.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />
          <Input label="Exam name" value={d.name} onChangeText={(v) => { setNamed(true); set('name', v); }} />
          <DateField label="First exam day" value={d.start} onChange={(v) => set('start', v)} />
          <DateField label="Last exam day" value={d.end} onChange={(v) => set('end', v)} />
          <Input label="Total marks per subject" value={d.totalMarks} onChangeText={(v) => set('totalMarks', v)} keyboardType="decimal-pad" />
          <Input label="Passing marks" value={d.passingMarks} onChangeText={(v) => set('passingMarks', v)} keyboardType="decimal-pad" />
          <Input label="Failed subjects that fail the exam" value={d.failThreshold} onChangeText={(v) => set('failThreshold', v)} keyboardType="number-pad" />
        </View>
      ) : null}

      {step === 'classes' ? (
        <View style={styles.gap}>
          <Text style={styles.hint}>Tick the sections. Each starts with all of its subjects; untick any that do not sit this exam.</Text>
          {sections.map((o) => {
            const on = classIds.includes(o.id);
            return (
              <Card key={o.id}>
                <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={styles.classRow} onPress={() => toggleClass(o.id)}>
                  <Text style={styles.check}>{on ? '☑' : '☐'}</Text>
                  <Text style={styles.name}>{o.label}</Text>
                  <Text style={styles.sub}>{(bySection[o.id] ?? []).length} subjects</Text>
                </TouchableOpacity>
                {on ? (bySection[o.id] ?? []).map((s) => {
                  const sel = (chosen[o.id] ?? []).includes(s.id);
                  return (
                    <TouchableOpacity key={s.id} accessibilityRole="checkbox" accessibilityState={{ checked: sel }} style={styles.subjectRow} onPress={() => toggleSubject(o.id, s.id)}>
                      <Text style={styles.check}>{sel ? '☑' : '☐'}</Text>
                      <Text style={styles.sub}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                }) : null}
                {on && (bySection[o.id] ?? []).length === 0 ? <Text style={styles.hint}>No subjects are assigned to this section yet.</Text> : null}
              </Card>
            );
          })}
        </View>
      ) : null}

      {step === 'dates' ? (
        <View style={styles.gap}>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Button title="Fill the dates again automatically" variant="outline" size="sm" onPress={() => {
            const r = autoFill(pairs, d.start, d.end);
            setSheet(r.sheet);
            if (r.extendedTo) { set('end', r.end); setNotice(`The last day was moved to ${r.extendedTo}.`); } else setNotice(null);
          }} />
          <Text style={styles.hint}>Exams run {d.start} to {d.end}. Leave a date empty to set it later on the web.</Text>
          {classIds.map((id) => (
            <Card key={id}>
              <Text style={styles.name}>{labels[id]}</Text>
              {pairs.filter((p) => p.classId === id).map((p) => (
                <View key={p.key} style={styles.slot}>
                  <Text style={styles.sub}>{p.subjectName}</Text>
                  <DateField value={sheet[p.key]?.date ?? ''} onChange={(v) => setSlot(p.key, { date: v })} placeholder="No date" />
                  <View style={styles.times}>
                    <View style={styles.time}><Input value={sheet[p.key]?.start ?? ''} onChangeText={(v) => setSlot(p.key, { start: v })} placeholder="Start 09:00" keyboardType="numbers-and-punctuation" /></View>
                    <View style={styles.time}><Input value={sheet[p.key]?.end ?? ''} onChangeText={(v) => setSlot(p.key, { end: v })} placeholder="End 11:00" keyboardType="numbers-and-punctuation" /></View>
                  </View>
                </View>
              ))}
            </Card>
          ))}
        </View>
      ) : null}

      {step === 'review' ? (
        <Card>
          <Text style={styles.name}>{d.name}</Text>
          <Text style={styles.sub}>{types.data?.find((t) => t.id === d.examType)?.name} · {d.start} to {d.end}</Text>
          <Text style={styles.sub}>Total {d.totalMarks}, passing {d.passingMarks}, {d.failThreshold} failed subjects fail</Text>
          <Text style={styles.sub}>{classIds.length} sections: {classIds.map((id) => labels[id]).join(', ')}</Text>
          <Text style={styles.sub}>{pairs.length} subject papers, {scheduledCount(sheet)} with a date</Text>
        </Card>
      ) : null}

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.nav}>
        {step !== 'details' ? <Button title="Back" variant="outline" onPress={() => go(step === 'classes' ? 'details' : step === 'dates' ? 'classes' : 'dates')} /> : null}
        {step !== 'review' ? <Button title="Next" onPress={next} /> : <Button title="Create exams" onPress={submit} loading={create.isPending} disabled={create.isPending} />}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  gap: { gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  notice: { fontSize: FontSize.sm, color: Colors.warning },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, flex: 1 },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  classRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44 },
  subjectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 44, paddingLeft: Spacing.lg },
  check: { fontSize: FontSize.lg, color: Colors.primary },
  slot: { marginTop: Spacing.sm, gap: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  times: { flexDirection: 'row', gap: Spacing.sm },
  time: { flex: 1 },
  error: { color: Colors.error, fontSize: FontSize.sm },
  nav: { flexDirection: 'row', gap: Spacing.sm, justifyContent: 'flex-end', borderRadius: BorderRadius.md },
});
