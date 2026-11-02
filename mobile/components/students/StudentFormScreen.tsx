import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { studentsApi } from '../../services/api';
import {
  SECTIONS, GENDER_OPTIONS, emptyForm, fieldsIn, formToPayload, placementPayload, serverFieldErrors, studentToForm,
  validate, type StudentField, type StudentForm,
} from '../../services/studentForm';
import { saveFailureMessage } from '../../services/errorKind';
import { useAuth } from '../../contexts/AuthContext';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  // Absent for Add; the student's id for Edit.
  studentId?: number;
}

const KEYBOARD: Record<string, 'default' | 'email-address' | 'phone-pad'> = { email: 'email-address', tel: 'phone-pad' };

// One form for adding and editing a student. Add asks for a class and shows only the quick fields
// until "More fields" is opened; Edit shows every section. Moving a student to another class is a
// separate action, so Edit never changes placement.
export default function StudentFormScreen({ studentId }: Props) {
  const isEdit = studentId != null;
  const router = useRouter();
  const base = usePersonaBase();
  const toast = useToast();
  const qc = useQueryClient();
  const { activeSchool } = useAuth();
  const { options, isLoading: optionsLoading } = useAttendanceClassOptions();

  const [form, setForm] = useState<StudentForm>(emptyForm);
  const [classId, setClassId] = useState<number | null>(null);
  const [showMore, setShowMore] = useState(isEdit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);

  // A failed load must not leave an empty form that could be saved over the real record.
  const query = useScopedQuery('student-edit', [studentId ?? 0], async () => (await studentsApi.getStudent(studentId as number)).data, { enabled: isEdit });
  useEffect(() => {
    if (query.data) setForm(studentToForm(query.data as Record<string, unknown>));
  }, [query.data]);

  const option = useMemo(() => options.find((o) => o.id === classId) ?? null, [options, classId]);

  const set = (name: string, value: string) => {
    setForm((f) => ({ ...f, [name]: value }));
    if (errors[name]) setErrors((e) => { const next = { ...e }; delete next[name]; return next; });
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = formToPayload(form);
      if (isEdit) return (await studentsApi.updateStudent(studentId as number, payload)).data;
      return (await studentsApi.createStudent({ school: activeSchool?.id, ...placementPayload(option), ...payload })).data;
    },
    onSuccess: (saved) => {
      toast.success(isEdit ? 'Student updated.' : 'Student added.');
      qc.invalidateQueries({ predicate: (q) => ['students', 'student', 'student-edit', 'classes', 'adminDashboard'].includes(q.queryKey[0] as string) });
      if (isEdit) router.back();
      else router.replace((saved?.id ? `${base}/students/${saved.id}` : `${base}/students`) as Href);
    },
    onError: (e) => {
      const data = (e as { response?: { data?: unknown } })?.response?.data;
      const { fields, general: message } = serverFieldErrors(data);
      setErrors(fields);
      setGeneral(message);
      // Show a toast only when the form itself cannot say what went wrong (no connection and the like).
      if (Object.keys(fields).length === 0 && !message) toast.error(saveFailureMessage(e, isEdit ? 'Could not update the student.' : 'Could not add the student.'));
    },
  });

  const submit = () => {
    const found = validate(form);
    if (!isEdit && !option) found.class = 'Choose a class.';
    setErrors(found);
    setGeneral(null);
    if (Object.keys(found).length > 0) { toast.error('Please fix the highlighted fields.'); return; }
    save.mutate();
  };

  if (isEdit && query.isLoading) return <Skeleton />;
  if (isEdit && query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const renderField = (f: StudentField) => {
    if (f.type === 'date') {
      return <DateField key={f.name} label={f.label} value={form[f.name] || null} onChange={(v) => set(f.name, v)} error={errors[f.name]} />;
    }
    if (f.type === 'select') {
      return (
        <Select key={f.name} label={f.label} value={form[f.name] || null} options={GENDER_OPTIONS} onChange={(v) => set(f.name, String(v))}
          placeholder="Not set" error={errors[f.name]} />
      );
    }
    return (
      <View key={f.name}>
        <Input
          label={f.label + (f.required ? ' *' : '')}
          value={form[f.name]}
          onChangeText={(v) => set(f.name, v)}
          error={errors[f.name]}
          placeholder={f.placeholder}
          keyboardType={KEYBOARD[f.type] ?? 'default'}
          autoCapitalize={f.type === 'email' ? 'none' : 'sentences'}
          multiline={f.type === 'textarea'}
          maxLength={f.maxLength}
          style={f.type === 'textarea' ? styles.textArea : undefined}
        />
        {f.hint && !errors[f.name] ? <Text style={styles.hint}>{f.hint}</Text> : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {general ? <View style={styles.banner}><Text style={styles.bannerText}>{general}</Text></View> : null}

        {!isEdit ? (
          <Select label="Class *" value={classId} options={options.map((o) => ({ value: o.id, label: o.label }))} onChange={setClassId}
            placeholder={optionsLoading ? 'Loading classes...' : 'Choose a class'} error={errors.class} />
        ) : null}

        {SECTIONS.map((section) => {
          const fields = fieldsIn(section.key, !showMore);
          if (fields.length === 0) return null;
          return (
            <View key={section.key} style={styles.section}>
              <Text style={styles.sectionTitle}>{section.label}</Text>
              {fields.map(renderField)}
            </View>
          );
        })}

        {!isEdit ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => setShowMore((v) => !v)} style={styles.more}>
            <Text style={styles.moreText}>{showMore ? 'Fewer fields' : 'More fields (date of birth, guardian, admission...)'}</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.actions}>
          <Button title="Cancel" variant="outline" onPress={() => router.back()} style={{ flex: 1 }} />
          <Button title={isEdit ? 'Save changes' : 'Add student'} onPress={submit} loading={save.isPending} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  section: { marginTop: Spacing.lg },
  sectionTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginBottom: Spacing.sm },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: -Spacing.sm, marginBottom: Spacing.md },
  more: { paddingVertical: Spacing.md, marginTop: Spacing.sm },
  moreText: { color: Colors.primary, fontWeight: '600', fontSize: FontSize.sm },
  banner: { backgroundColor: Colors.errorLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  bannerText: { color: Colors.error, fontSize: FontSize.sm },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xl },
});
