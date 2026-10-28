import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, Switch, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import {
  ASSIGNMENT_TYPES, SINGLE_FORM_TYPES, STATUSES, TYPE_HELP, buildPayload, emptyForm, firstFieldError, formFromAssignment,
  resolveDefaultTeacherId, setType, splitSectionId, validateForm, type AssignmentForm,
} from '../../services/assignments';
import type { ClassOption } from '../../services/attendanceEntry';
import { useAuth } from '../../contexts/AuthContext';
import { useAttendanceClassOptions, useSessionClasses } from '../../hooks/useAcademicYear';
import { useAssignment, useAssignmentActions, useSubjectList, useTeacherStaff } from '../../hooks/useAssignments';
import { useMyTimetable } from '../../hooks/useTeacher';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  // Teachers pass their own sections; admins leave it out and get every class.
  classOptions?: ClassOption[];
}

// Create or edit one assignment (the route's `id` param says which). Needs a connection to save.
export default function AssignmentFormScreen({ classOptions }: Props) {
  const router = useRouter();
  const navigation = useNavigation();
  const toast = useToast();
  const { user, isTeacher } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editingId = id ? Number(id) : null;

  const { year, options, isLoading: classesLoading } = useAttendanceClassOptions(classOptions);
  const sessionClasses = useSessionClasses(year.current?.id);
  const subjects = useSubjectList();
  const staff = useTeacherStaff();
  const timetable = useMyTimetable();
  const existing = useAssignment(editingId);
  const actions = useAssignmentActions();

  const [form, setForm] = useState<AssignmentForm>(emptyForm());
  const [baseline, setBaseline] = useState<AssignmentForm>(emptyForm());
  const loaded = useRef(false);
  const useSession = options.some((o) => o.isSession);
  const sessionList = (sessionClasses.data ?? []) as Array<{ id: number; class_obj?: number | null }>;

  // Fill the form once: from the assignment being edited, or with defaults for a new one.
  useEffect(() => {
    if (loaded.current || classesLoading) return;
    if (editingId) {
      if (!existing.data) return;
      const next = formFromAssignment(existing.data, sessionList, useSession);
      setForm(next);
      setBaseline(next);
    } else {
      const teacher = isTeacher
        ? resolveDefaultTeacherId(staff.data ?? [], user?.id, timetable.data?.find((e) => e.teacher)?.teacher)
        : null;
      const next = { ...emptyForm(), teacher, classId: options.length === 1 ? options[0].id : null };
      setForm(next);
      setBaseline(next);
    }
    loaded.current = true;
  }, [classesLoading, editingId, existing.data, sessionList, useSession, isTeacher, staff.data, user?.id, timetable.data, options]);

  // A teacher whose staff list is closed to them can still pick themselves, via the timetable.
  const selfId = isTeacher ? resolveDefaultTeacherId(staff.data ?? [], user?.id, timetable.data?.find((e) => e.teacher)?.teacher) : null;
  const teacherOptions = useMemo(() => {
    const list = (staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name || `Staff #${s.id}` }));
    if (selfId && !list.some((o) => o.value === selfId)) list.unshift({ value: selfId, label: 'Me' });
    return list;
  }, [staff.data, selfId]);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const saving = useRef(false);

  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (!dirtyRef.current || saving.current) return;
    e.preventDefault();
    confirm({ title: 'Leave without saving?', message: 'Your changes will be lost.', confirmLabel: 'Leave', destructive: true })
      .then((ok) => ok && navigation.dispatch(e.data.action));
  }), [navigation]);

  const set = <K extends keyof AssignmentForm>(key: K, value: AssignmentForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    const problem = validateForm(form);
    if (problem) {
      toast.error(problem);
      return;
    }
    const option = options.find((o) => o.id === form.classId)!;
    const payload = buildPayload({
      form,
      masterClassId: option.classObj ?? option.id,
      sessionClassId: option.isSession ? splitSectionId(option.id, sessionList) : null,
      academicYearId: year.current?.id,
    });
    try {
      if (editingId) await actions.update.mutateAsync({ id: editingId, data: payload });
      else await actions.create.mutateAsync(payload);
      saving.current = true;
      toast.success(editingId ? 'Assignment updated.' : 'Assignment created.');
      router.back();
    } catch (error: any) {
      if (!error?.response) toast.error('No connection. Check your internet and try again.');
      else toast.error(error.response?.data?.detail || firstFieldError(error.response?.data) || 'Could not save the assignment.');
    }
  };

  if (classesLoading || (editingId && existing.isLoading)) return <Skeleton />;
  if (editingId && existing.isError && !existing.data) return <ErrorState error={existing.error} onRetry={() => existing.refetch()} />;

  const isDiary = form.assignment_type === 'DIARY';
  const types = baseline.assignment_type === 'DIARY' ? ASSIGNMENT_TYPES : SINGLE_FORM_TYPES;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.label}>Title *</Text>
        <TextInput style={styles.input} value={form.title} onChangeText={(t) => set('title', t)} placeholder="Chapter 3 exercises"
          placeholderTextColor={Colors.textTertiary} />

        <Select label="Class *" value={form.classId} options={options.map((o) => ({ value: o.id, label: o.label }))}
          onChange={(v) => set('classId', v)} placeholder="Select a class" />
        <Select label="Subject *" value={form.subject} options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
          onChange={(v) => set('subject', v)} placeholder="Select a subject" />
        <Select label="Teacher *" value={form.teacher} options={teacherOptions} onChange={(v) => set('teacher', v)}
          placeholder="Select a teacher" searchable />
        <Select label="Type" value={form.assignment_type} options={types.map((t) => ({ value: t, label: t[0] + t.slice(1).toLowerCase() }))}
          onChange={(v) => setForm((f) => setType(f, v))} />
        <Text style={styles.help}>{TYPE_HELP[form.assignment_type]}</Text>

        <Text style={styles.label}>Description *</Text>
        <TextInput style={[styles.input, styles.multi]} multiline value={form.description} onChangeText={(t) => set('description', t)}
          placeholder="What the students should do" placeholderTextColor={Colors.textTertiary} />
        <Text style={styles.label}>Instructions</Text>
        <TextInput style={[styles.input, styles.multi]} multiline value={form.instructions} onChangeText={(t) => set('instructions', t)}
          placeholder="Optional extra instructions" placeholderTextColor={Colors.textTertiary} />

        {!isDiary ? (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Students submit work</Text>
              <Switch value={form.requires_submission} onValueChange={(v) => set('requires_submission', v)} />
            </View>
            <DateField label={form.requires_submission ? 'Due date *' : 'Due date'} value={form.due_date || null} onChange={(v) => set('due_date', v)} />
            <Text style={styles.label}>Total marks</Text>
            <TextInput style={[styles.input, styles.short]} keyboardType="number-pad" value={form.total_marks}
              onChangeText={(t) => set('total_marks', t.replace(/[^0-9]/g, ''))} />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Allow attachments</Text>
              <Switch value={form.attachments_allowed} onValueChange={(v) => set('attachments_allowed', v)} />
            </View>
          </>
        ) : null}

        <Select label="Status" value={form.status} options={STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))}
          onChange={(v) => set('status', v)} />
      </ScrollView>

      <View style={styles.footer}>
        <Button title={editingId ? 'Save changes' : 'Create assignment'} onPress={submit}
          loading={actions.create.isPending || actions.update.isPending} disabled={!dirty} fullWidth size="lg" />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 110 },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  input: {
    backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: FontSize.md, color: Colors.text, marginBottom: Spacing.lg,
  },
  multi: { minHeight: 90, textAlignVertical: 'top' },
  short: { width: 120 },
  help: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: -Spacing.sm, marginBottom: Spacing.lg },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  switchLabel: { fontSize: FontSize.md, color: Colors.text },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
});
