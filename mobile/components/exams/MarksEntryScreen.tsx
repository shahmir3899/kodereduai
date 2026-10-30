import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, FlatList, TextInput, Switch, TouchableOpacity, KeyboardAvoidingView, Platform, StyleSheet, Alert,
} from 'react-native';
import { useNavigation } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { examinationsApi, studentsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import {
  buildMarkRows, buildMarksPayload, describeRejected, examsForSection, inferSubjectId, isDirty, resultOf,
  rosterParams, setAbsent, setMarks, setRemarks, summarize, validateRows,
  type ExamLite, type ExamSubjectLite, type MarkRow, type RosterStudent, type SavedMark,
} from '../../services/marksEntry';
import type { ClassOption } from '../../services/attendanceEntry';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  // Teachers pass the sections they are assigned to; admins leave it out and get every class.
  classOptions?: ClassOption[];
}

// Same flow as the web's Marks Entry page: class, exam type, exam, subject, then a marks grid
// saved in one request. Needs a connection to save (no offline writes).
export default function MarksEntryScreen({ classOptions }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { year, options, isLoading: classesLoading } = useAttendanceClassOptions(classOptions);
  const yearId = year.current?.id ?? null;

  const [classId, setClassId] = useState<number | null>(null);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [examId, setExamId] = useState<number | null>(null);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [rows, setRows] = useState<MarkRow[]>([]);
  const [baseline, setBaseline] = useState<MarkRow[]>([]);
  const [openRemarks, setOpenRemarks] = useState<Set<number>>(new Set());
  const rowsRef = useRef<MarkRow[]>([]);
  const baselineRef = useRef<MarkRow[]>([]);
  const appliedKey = useRef('');
  rowsRef.current = rows;
  baselineRef.current = baseline;

  // Teachers get their first section pre-selected, as on the web.
  useEffect(() => {
    if (classOptions && classOptions.length > 0 && classId == null) setClassId(classOptions[0].id);
  }, [classOptions, classId]);

  const option = options.find((o) => o.id === classId) ?? null;
  const masterClassId = option ? (option.classObj ?? option.id) : null;

  const types = useScopedQuery('examTypes', [], async () =>
    listOf<{ id: number; name: string }>((await examinationsApi.getExamTypes({ page_size: 9999, is_active: true })).data),
  { staleTime: 5 * 60_000 });

  const examsQ = useScopedQuery('marksExams', [yearId, masterClassId, typeId], async () =>
    listOf<ExamLite>((await examinationsApi.getExams({
      academic_year: yearId || undefined, class_obj: masterClassId || undefined, exam_type: typeId || undefined, page_size: 9999,
    })).data),
  { enabled: !!typeId && !!masterClassId, staleTime: 60_000 });
  const exams = useMemo(
    () => examsForSection(examsQ.data ?? [], option?.id ?? null, !!option?.isSession),
    [examsQ.data, option],
  );
  const exam = exams.find((e) => e.id === examId) ?? null;

  const subjectsQ = useScopedQuery('examSubjects', [examId], async () =>
    listOf<ExamSubjectLite>((await examinationsApi.getExamSubjects({ exam: examId, page_size: 9999 })).data),
  { enabled: !!examId });
  const subjects = subjectsQ.data ?? [];
  const subject = subjects.find((s) => s.id === subjectId) ?? null;
  const total = Number(subject?.total_marks ?? 0);
  const passing = Number(subject?.passing_marks ?? 0);

  // A one-subject exam preselects its subject; otherwise try the subject named in the exam title.
  useEffect(() => {
    if (!examId || subjectId != null || subjects.length === 0) return;
    const inferred = inferSubjectId(exam?.name, subjects);
    if (inferred) setSubjectId(inferred);
  }, [examId, subjectId, subjects, exam?.name]);

  // Fresh on every open: marks must not come from a minute-old cache.
  const savedQ = useScopedQuery('examMarks', [subjectId], async () =>
    listOf<SavedMark>((await examinationsApi.getMarks({ exam_subject: subjectId, page_size: 9999 })).data),
  { enabled: !!subjectId, staleTime: 0 });

  const rosterQ = useScopedQuery('marksRoster', [examId], async () =>
    listOf<RosterStudent>((await studentsApi.getStudents(rosterParams(exam!))).data),
  { enabled: !!exam && !!subjectId, staleTime: 0 });

  // Build the grid once per subject, and again when fresher data arrives, but never over marks
  // the user has already typed.
  const key = `${subjectId}`;
  useEffect(() => {
    if (!subjectId || !savedQ.data || !rosterQ.data) return;
    if (appliedKey.current === key && isDirty(rowsRef.current, baselineRef.current)) return;
    const next = buildMarkRows(rosterQ.data, savedQ.data);
    appliedKey.current = key;
    setRows(next);
    setBaseline(next);
  }, [key, subjectId, savedQ.data, rosterQ.data]);

  const dirty = isDirty(rows, baseline);
  const errors = useMemo(() => validateRows(rows, total), [rows, total]);
  const errorCount = Object.keys(errors).length;
  const stats = useMemo(() => summarize(rows, passing), [rows, passing]);

  const discardOk = useCallback(async () => {
    if (!isDirty(rowsRef.current, baselineRef.current)) return true;
    return confirm({ title: 'Discard changes?', message: 'You have marks that are not saved.', confirmLabel: 'Discard', destructive: true });
  }, []);

  // Back button / swipe with unsaved marks.
  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (!isDirty(rowsRef.current, baselineRef.current)) return;
      e.preventDefault();
      confirm({ title: 'Leave without saving?', message: 'Your marks will be lost.', confirmLabel: 'Leave', destructive: true })
        .then((ok) => ok && navigation.dispatch(e.data.action));
    });
  }, [navigation]);

  const reset = (from: 'class' | 'type' | 'exam' | 'subject') => {
    if (from === 'class' || from === 'type') setExamId(null);
    if (from !== 'subject') setSubjectId(null);
    setRows([]);
    setBaseline([]);
    setOpenRemarks(new Set());
    appliedKey.current = '';
  };
  const pick = async (from: 'class' | 'type' | 'exam' | 'subject', id: number) => {
    if (!(await discardOk())) return;
    reset(from);
    if (from === 'class') setClassId(id);
    else if (from === 'type') setTypeId(id);
    else if (from === 'exam') setExamId(id);
    else setSubjectId(id);
  };

  const save = useMutation({
    mutationFn: async () => (await examinationsApi.bulkEntryMarks(buildMarksPayload(subjectId!, rowsRef.current))).data as {
      created?: number; updated?: number; errors?: Array<{ student_id?: number; error?: string }>;
    },
    onSuccess: (res) => {
      const rejected = res.errors ?? [];
      const rejectedIds = new Set(rejected.map((e) => e.student_id));
      // Rejected rows keep what was typed but stay unsaved, so Save stays available for them.
      const oldBase = new Map(baselineRef.current.map((r) => [r.studentId, r]));
      setBaseline(rowsRef.current.map((r) => (rejectedIds.has(r.studentId) ? oldBase.get(r.studentId) ?? r : r)));
      queryClient.invalidateQueries({ queryKey: ['examMarks'] });
      if (rejected.length > 0) {
        toast.error(`${rejected.length} row(s) not saved.`);
        Alert.alert('Some marks were not saved', describeRejected(rejected, rowsRef.current).join('\n'));
        return;
      }
      toast.success(`Saved: ${res.created ?? 0} added, ${res.updated ?? 0} updated.`);
    },
    onError: (error: any) => {
      if (!error?.response) toast.error('No connection. Check your internet and try again.');
      else toast.error(error.response?.data?.detail || 'Could not save marks.');
    },
  });

  if (classesLoading) return <Skeleton />;
  if (!year.current) return <EmptyState title="No academic session" message="Set a current academic year on the web app first." />;
  if (options.length === 0) return <EmptyState title="No classes" message="There are no classes to show." />;

  const loadingGrid = !!subjectId && (savedQ.isLoading || rosterQ.isLoading);
  const gridFailed = !!subjectId && rows.length === 0 && (savedQ.isError || rosterQ.isError);

  const header = (
    <View>
      <Select label="Class" value={classId} options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={(id) => pick('class', id)} placeholder="Select a class" />
      <Select label="Exam type" value={typeId} options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
        onChange={(id) => pick('type', id)} placeholder="Select exam type" disabled={!option} />
      <Select label="Exam" value={examId} options={exams.map((e) => ({ value: e.id, label: e.name }))}
        onChange={(id) => pick('exam', id)} placeholder={typeId && !examsQ.isLoading && exams.length === 0 ? 'No exams for this class' : 'Select exam'}
        disabled={!typeId} />
      <Select label="Subject" value={subjectId} options={subjects.map((s) => ({ value: s.id, label: `${s.subject_name} (${s.total_marks})` }))}
        onChange={(id) => pick('subject', id)} placeholder={examId && !subjectsQ.isLoading && subjects.length === 0 ? 'No subjects added to this exam' : 'Select subject'}
        disabled={!examId} />

      {subject && rows.length > 0 ? (
        <View style={styles.info}>
          <Text style={styles.infoText}>Total <Text style={styles.bold}>{subject.total_marks}</Text>  ·  Passing <Text style={styles.bold}>{subject.passing_marks}</Text></Text>
          <Text style={styles.infoSub}>
            {stats.entered} entered  ·  {stats.absent} absent  ·  {stats.missing} to do{stats.failing > 0 ? `  ·  ${stats.failing} failing` : ''}
          </Text>
        </View>
      ) : null}
    </View>
  );

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        data={subjectId && !loadingGrid && !gridFailed ? rows : []}
        keyExtractor={(r) => String(r.studentId)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={
          !subjectId ? <EmptyState title="Pick a subject" message="Choose a class, exam type, exam and subject to enter marks." />
            : loadingGrid ? <Skeleton />
            : gridFailed ? <ErrorState onRetry={() => { savedQ.refetch(); rosterQ.refetch(); }} />
            : <EmptyState title="No students" message="No students are enrolled for this exam." />
        }
        renderItem={({ item }) => {
          const error = errors[item.studentId];
          const result = resultOf(item, passing);
          const remarksOpen = openRemarks.has(item.studentId) || item.remarks !== '';
          return (
            <View style={[styles.row, item.isAbsent && styles.rowAbsent]}>
              <View style={styles.top}>
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
                  {item.roll ? <Text style={styles.roll}>Roll {item.roll}</Text> : null}
                </View>
                <TextInput
                  style={[styles.input, error ? styles.inputError : null, item.isAbsent && styles.inputOff,
                    result === 'fail' && styles.fail, result === 'pass' && styles.pass]}
                  value={item.marks}
                  editable={!item.isAbsent}
                  onChangeText={(t) => setRows((r) => setMarks(r, item.studentId, t.replace(',', '.')))}
                  keyboardType="decimal-pad"
                  placeholder={item.isAbsent ? 'Abs' : '—'}
                  placeholderTextColor={Colors.textTertiary}
                  maxLength={6}
                  selectTextOnFocus
                  accessibilityLabel={`Marks for ${item.name}`}
                />
                <View style={styles.absent}>
                  <Text style={styles.absentLabel}>Absent</Text>
                  <Switch value={item.isAbsent} onValueChange={(v) => setRows((r) => setAbsent(r, item.studentId, v))}
                    trackColor={{ true: Colors.error, false: Colors.border }} />
                </View>
              </View>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              {remarksOpen ? (
                <TextInput
                  style={styles.remarks}
                  value={item.remarks}
                  onChangeText={(t) => setRows((r) => setRemarks(r, item.studentId, t))}
                  placeholder="Remarks"
                  placeholderTextColor={Colors.textTertiary}
                />
              ) : (
                <TouchableOpacity accessibilityRole="button" onPress={() => setOpenRemarks((s) => new Set(s).add(item.studentId))}>
                  <Text style={styles.addRemarks}>+ Remarks</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      {subject && rows.length > 0 ? (
        <View style={styles.footer}>
          <Button
            title={errorCount > 0 ? `Fix ${errorCount} mark${errorCount === 1 ? '' : 's'} to save` : 'Save marks'}
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!dirty || errorCount > 0}
            fullWidth
            size="lg"
          />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 110 },
  info: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  infoText: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '700' },
  infoSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  rowAbsent: { backgroundColor: Colors.errorLight },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  roll: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  input: {
    width: 72, textAlign: 'center', fontSize: FontSize.md, fontWeight: '600', color: Colors.text,
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingVertical: Spacing.sm, backgroundColor: Colors.surface,
  },
  inputError: { borderColor: Colors.error },
  inputOff: { backgroundColor: Colors.surfaceSecondary },
  pass: { color: Colors.success },
  fail: { color: Colors.error },
  absent: { alignItems: 'center' },
  absentLabel: { fontSize: 10, color: Colors.textSecondary },
  error: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs },
  addRemarks: { fontSize: FontSize.xs, color: Colors.primary, marginTop: Spacing.xs },
  remarks: {
    marginTop: Spacing.sm, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.sm, color: Colors.text,
  },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
});
