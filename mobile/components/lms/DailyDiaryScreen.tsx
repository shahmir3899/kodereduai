import React, { useMemo, useState } from 'react';
import { Text, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { buildDiaryPayloads, diaryResultText, filledEntries, uniqueSubjects, validateDiary } from '../../services/dailyDiary';
import { firstFieldError, resolveDefaultTeacherId, splitSectionId, teacherSelectOptions } from '../../services/assignments';
import { useAuth } from '../../contexts/AuthContext';
import { todayString, type ClassOption } from '../../services/attendanceEntry';
import { useAttendanceClassOptions, useSessionClasses } from '../../hooks/useAcademicYear';
import { useAssignmentActions, useClassSubjectRows, useTeacherStaff } from '../../hooks/useAssignments';
import { useMyTimetable } from '../../hooks/useTeacher';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Daily diary, as on the web: pick a class and a date, write a note for each subject, and one DIARY
// entry per filled subject is saved as a draft (publish it from the assignments list). Teachers
// pass their own sections; admins leave `classOptions` out.
export default function DailyDiaryScreen({ classOptions }: { classOptions?: ClassOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const { year, options, isLoading } = useAttendanceClassOptions(classOptions);
  const sessionClasses = useSessionClasses(year.current?.id);
  const actions = useAssignmentActions();
  const { user, isTeacher, isManager } = useAuth();
  const staff = useTeacherStaff(!isManager);
  const timetable = useMyTimetable();
  const [teacherPick, setTeacherPick] = useState<number | null>(null);
  const [classId, setClassId] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const [details, setDetails] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);

  const picked = classId ?? (options.length === 1 ? options[0].id : null);
  const option = options.find((o) => o.id === picked) ?? null;
  const masterClassId = option ? (option.classObj ?? option.id) : null;
  const rows = useClassSubjectRows(masterClassId);
  const subjects = useMemo(() => uniqueSubjects(rows.data ?? []), [rows.data]);

  // A teacher writes as themselves (their staff record, found like the assignment form does); an
  // admin picks the teacher the diary is for.
  const selfId = isTeacher ? resolveDefaultTeacherId(staff.data ?? [], user?.id, timetable.data?.find((e) => e.teacher)?.teacher) : null;
  const teacherId = selfId ?? teacherPick;
  const teacherOptions = useMemo(() => teacherSelectOptions(staff.data ?? [], selfId), [staff.data, selfId]);

  const pickClass = (id: number) => { setClassId(id); setDetails({}); };

  const save = async () => {
    const entries = filledEntries(subjects, details);
    const problem = validateDiary(picked, date, entries, teacherId, !isManager);
    if (problem || !option || !masterClassId || (!teacherId && !isManager)) return toast.error(problem ?? 'Please select a class');
    const payloads = buildDiaryPayloads({
      entries, date, masterClassId, teacherId: isManager ? null : teacherId,
      sessionClassId: option.isSession ? splitSectionId(option.id, (sessionClasses.data ?? []) as Array<{ id: number; class_obj?: number | null }>) : null,
      academicYearId: year.current?.id,
    });
    setSaving(true);
    const saved: string[] = [];
    const failed: string[] = [];
    let reason: string | null = null;
    for (let i = 0; i < payloads.length; i++) {
      const name = entries[i].subject.name;
      try {
        await actions.create.mutateAsync(payloads[i]);
        saved.push(name);
      } catch (e: any) {
        failed.push(name);
        reason = reason ?? (e?.response ? (e.response.data?.detail || firstFieldError(e.response.data)) : 'No connection.');
      }
    }
    setSaving(false);
    // Saved subjects leave the form, so a retry only sends the ones that failed.
    setDetails((d) => {
      const next = { ...d };
      entries.forEach((e) => { if (saved.includes(e.subject.name)) delete next[e.subject.id]; });
      return next;
    });
    const text = diaryResultText(saved, failed);
    if (failed.length === 0) {
      toast.success(text);
      router.back();
    } else {
      toast.error(reason ? `${text} ${reason}` : text);
    }
  };

  if (isLoading) return <Skeleton />;
  if (options.length === 0) return <EmptyState title="No classes" message="There is no class you can write a diary for." />;

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Select label="Class *" value={picked} options={options.map((o) => ({ value: o.id, label: o.label }))}
          onChange={pickClass} placeholder="Select a class" />
        {selfId || isManager ? null : (
          <Select label="Teacher *" value={teacherPick} options={teacherOptions} onChange={setTeacherPick} searchable placeholder="Select a teacher" />
        )}
        <DateField label="Diary date *" value={date} onChange={setDate} />

        {!option ? null : rows.isLoading ? <Skeleton /> : subjects.length === 0 ? (
          <EmptyState title="No subjects" message="No subjects are assigned to this class yet." />
        ) : (
          <>
            <Text style={styles.hint}>Write a note for each subject. Subjects left empty are skipped.</Text>
            {subjects.map((s) => (
              <Input key={s.id} label={s.code ? `${s.name} (${s.code})` : s.name} value={details[s.id] ?? ''}
                onChangeText={(t) => setDetails((d) => ({ ...d, [s.id]: t }))} multiline numberOfLines={3}
                placeholder="Classwork and homework for the day" />
            ))}
            <Button title="Save diary as drafts" onPress={save} loading={saving} disabled={saving} fullWidth size="lg" />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginVertical: Spacing.sm },
});
