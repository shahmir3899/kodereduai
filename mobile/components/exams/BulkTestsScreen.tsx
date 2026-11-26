import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { academicsApi, examinationsApi, sessionsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { useAcademicYear, useMasterClasses } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import {
  buildTestName, bulkTestError, bulkTestPayload, previewLabel, previewSummary, previewTone, syncRows, uniqueSubjects,
  validateDetails, validateSchedule, type ClassSubjectLite, type Details, type Preview, type TestRow,
} from '../../services/bulkTests';
import Select from '../ui/Select';
import MultiSelect from '../ui/MultiSelect';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import SegmentedTabs from '../ui/SegmentedTabs';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing } from '../../constants/colors';

type Step = 1 | 2 | 3;
const STEPS: Array<{ value: '1' | '2' | '3'; label: string }> = [{ value: '1', label: '1. Details' }, { value: '2', label: '2. Schedule' }, { value: '3', label: '3. Preview' }];
const NO_TERM = 0;

interface Named { id: number; name: string }

// "Create tests" (web BulkTestModal, admin and principal): one standalone test per chosen subject of
// one class. The server previews first (what will be made, what already exists) and creates only
// when nothing blocks it.
export default function BulkTestsScreen() {
  const toast = useToast();
  const qc = useQueryClient();
  const year = useAcademicYear();
  const classes = useMasterClasses();
  const [step, setStep] = useState<Step>(1);
  const [details, setDetails] = useState<Details>({ yearId: null, termId: null, examTypeId: null, classObj: null, subjectIds: [] });
  const [rows, setRows] = useState<TestRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!details.yearId && year.current?.id) setDetails((d) => ({ ...d, yearId: year.current!.id })); }, [year.current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const terms = useScopedQuery<Named[]>('bulkTestTerms', [details.yearId], async () =>
    listOf<Named>((await sessionsApi.getTerms({ academic_year: details.yearId, page_size: 100 })).data), { enabled: !!details.yearId });
  const types = useScopedQuery<Array<Named & { is_active?: boolean }>>('examTypes', [], async () =>
    listOf<Named & { is_active?: boolean }>((await examinationsApi.getExamTypes({ page_size: 200 })).data), { staleTime: 60_000 });
  const subjectsQ = useScopedQuery<ClassSubjectLite[]>('bulkTestSubjects', [details.classObj, details.yearId], async () =>
    listOf<ClassSubjectLite>((await academicsApi.getClassSubjects({ class_obj: details.classObj, academic_year: details.yearId, page_size: 500 })).data),
  { enabled: !!details.classObj });
  const subjects = useMemo(() => uniqueSubjects(subjectsQ.data ?? []), [subjectsQ.data]);
  const yearName = year.years.find((y) => y.id === details.yearId)?.name;
  const termName = (terms.data ?? []).find((t) => t.id === details.termId)?.name;

  useEffect(() => { setRows((prev) => syncRows(prev, details.subjectIds, subjects, termName, yearName)); }, [details.subjectIds, subjects, termName, yearName]);

  const change = (patch: Partial<Details>) => { setDetails((d) => ({ ...d, ...patch })); setPreview(null); setError(null); };
  const editRow = (id: number, patch: Partial<TestRow>) => { setRows((rs) => rs.map((r) => (r.subjectId === id ? { ...r, ...patch } : r))); setPreview(null); setError(null); };

  const next = async () => {
    setError(null);
    if (step === 1) {
      const problem = validateDetails(details);
      if (problem) return setError(problem);
      return setStep(2);
    }
    if (step === 2) {
      const problem = validateSchedule(rows);
      if (problem) return setError(problem);
      setBusy(true);
      try {
        setPreview((await examinationsApi.bulkTestPreview(bulkTestPayload(details, rows))).data as Preview);
        setStep(3);
      } catch (e) { setError(bulkTestError(e)); } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      const res = await examinationsApi.bulkTestApply(bulkTestPayload(details, rows));
      const made = ((res.data as { created_tests?: unknown[] })?.created_tests ?? []).length;
      qc.invalidateQueries({ predicate: (q) => ['examsAdmin', 'exams', 'examGroups', 'results'].includes(String(q.queryKey[0])) });
      toast.success(`${made} test${made === 1 ? '' : 's'} created.`);
      // Hidden tab screens go "back" to the first tab (Dashboard), so return to the exams list explicitly.
      router.replace('/(admin)/exams-manage');
    } catch (e) { setError(bulkTestError(e)); } finally { setBusy(false); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.hint}>One standalone test per subject you choose, for one class.</Text>
      {/* Tapping goes back only; going forward runs the checks of the Next button. */}
      <SegmentedTabs tabs={STEPS} value={String(step) as '1' | '2' | '3'} onChange={(v) => { const s = Number(v) as Step; if (s < step) { setStep(s); setError(null); } }} />

      {step === 1 ? (
        <>
          <Select label="Academic year" value={details.yearId} options={year.years.map((y) => ({ value: y.id, label: y.name }))}
            onChange={(v) => change({ yearId: Number(v), termId: null, subjectIds: [] })} />
          <Select label="Term (optional)" value={details.termId ?? NO_TERM}
            options={[{ value: NO_TERM, label: 'No term' }, ...(terms.data ?? []).map((t) => ({ value: t.id, label: t.name }))]}
            onChange={(v) => change({ termId: v === NO_TERM ? null : Number(v) })} />
          <Select label="Test type" value={details.examTypeId} placeholder="Choose a type"
            options={(types.data ?? []).filter((t) => t.is_active !== false).map((t) => ({ value: t.id, label: t.name }))}
            onChange={(v) => change({ examTypeId: Number(v) })} />
          <Select label="Class" value={details.classObj} placeholder="Choose a class" searchable
            options={(classes.data ?? []).filter((c) => c.is_active !== false).map((c) => ({ value: Number(c.id), label: String(c.name) }))}
            onChange={(v) => change({ classObj: Number(v), subjectIds: [] })} />
          {details.classObj ? (
            subjectsQ.isLoading ? <Text style={styles.hint}>Loading subjects...</Text> : subjects.length === 0 ? (
              <Text style={styles.hint}>No subjects are set for this class.</Text>
            ) : (
              <MultiSelect label="Subjects" values={details.subjectIds} options={subjects.map((s) => ({ value: s.subject, label: s.subject_name }))}
                onToggle={(id) => change({ subjectIds: details.subjectIds.includes(id) ? details.subjectIds.filter((x) => x !== id) : [...details.subjectIds, id] })} />
            )
          ) : null}
        </>
      ) : null}

      {step === 2 ? rows.map((r) => (
        <Card key={r.subjectId} style={styles.card}>
          <Text style={styles.subject}>{r.subjectName}</Text>
          <Input label="Test name" value={r.name} onChangeText={(t) => editRow(r.subjectId, { name: t, manualName: t.trim() !== '' && t !== buildTestName(r.subjectName, termName, yearName) })} />
          <DateField label="Date" value={r.date} onChange={(v) => editRow(r.subjectId, { date: v })} />
          <Input label="Total marks" value={r.totalMarks} keyboardType="decimal-pad" onChangeText={(t) => editRow(r.subjectId, { totalMarks: t })} />
          <View style={styles.row}>
            <View style={styles.flex}><Input label="Start (optional)" value={r.start} placeholder="09:00" onChangeText={(t) => editRow(r.subjectId, { start: t })} /></View>
            <View style={styles.flex}><Input label="End (optional)" value={r.end} placeholder="10:00" onChangeText={(t) => editRow(r.subjectId, { end: t })} /></View>
          </View>
        </Card>
      )) : null}

      {step === 3 && preview ? (
        <>
          <Text style={styles.summary}>{previewSummary(preview)}</Text>
          {preview.tests.map((t) => (
            <Card key={`${t.subject_id}-${t.name}`} style={styles.card}>
              <View style={styles.head}>
                <Text style={styles.subject} numberOfLines={1}>{t.name}</Text>
                <StatusPill label={previewLabel(t.status)} tone={previewTone(t.status)} />
              </View>
              <Text style={styles.hint}>{t.subject_name}  ·  {t.exam_date}{t.total_marks ? `  ·  ${Number(t.total_marks)} marks` : ''}</Text>
              {t.reason && t.status !== 'create' ? <Text style={styles.reason}>{t.reason}</Text> : null}
            </Card>
          ))}
          {!preview.can_apply ? <Text style={styles.reason}>Fix or remove the subjects that cannot be made (go back to Details or Schedule), then preview again.</Text> : null}
        </>
      ) : null}

      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <View style={styles.row}>
        {step > 1 ? <View style={styles.flex}><Button title="Back" variant="outline" onPress={() => { setStep((s) => (s - 1) as Step); setError(null); }} disabled={busy} /></View> : null}
        <View style={styles.flex}>
          <Button title={step === 1 ? 'Next: schedule' : step === 2 ? 'Preview' : `Create ${preview?.counts.create ?? 0} test${preview?.counts.create === 1 ? '' : 's'}`}
            onPress={next} loading={busy} disabled={busy || (step === 3 && !preview?.can_apply)} />
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  summary: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  card: { gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  subject: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  reason: { fontSize: FontSize.sm, color: Colors.error },
  error: { fontSize: FontSize.sm, color: Colors.error },
  row: { flexDirection: 'row', gap: Spacing.sm },
  flex: { flex: 1 },
});
