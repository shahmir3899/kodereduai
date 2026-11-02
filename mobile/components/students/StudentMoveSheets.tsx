import React, { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { studentsApi } from '../../services/api';
import {
  buildMovePayload, canRepriceFees, emptyMoveForm, feeBlockers, feeImpactLines, keptRecordsLine, moveWarningLines, movePreviewParams,
  validateMove, validateRemove, type MoveForm,
} from '../../services/studentMove';
import { todayString } from '../../services/attendanceEntry';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import { useMovePreview, useRemovalCounts } from '../../hooks/useStudents';
import { useAcademicYear, useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import { useToast } from '../ui/Toast';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const refreshStudent = (qc: ReturnType<typeof useQueryClient>) =>
  qc.invalidateQueries({ predicate: (q) => ['students', 'student', 'student-edit', 'studentProfileSummary', 'studentEnrollmentHistory', 'studentsDeleted', 'classes', 'session-classes'].includes(q.queryKey[0] as string) });

interface Base { visible: boolean; onClose: () => void; student: { id: number; name: string } }

// Hide a student from the school (soft delete). Nothing is erased: their records stay and an admin
// can bring them back from Recently deleted. For a record entered by mistake only; a student who
// left goes through Left or Transferred on the web.
export function StudentRemoveSheet({ visible, onClose, student }: Base) {
  const toast = useToast();
  const qc = useQueryClient();
  const router = useRouter();
  const base = usePersonaBase();
  const counts = useRemovalCounts(student.id, visible);
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({ mutationFn: () => studentsApi.deleteStudent(student.id, reason.trim()) });

  useEffect(() => { if (visible) { setTyped(''); setReason(''); setError(null); } }, [visible]);

  const submit = async () => {
    const problem = validateRemove(typed, student.name, reason);
    if (problem) return setError(problem);
    setError(null);
    try {
      await remove.mutateAsync();
      refreshStudent(qc);
      toast.success(`${student.name} was removed. Find them in Recently deleted.`);
      onClose();
      router.replace(`${base}/students` as Href);
    } catch (e) { setError(staffLeaveErrorMessage(e, 'Could not remove the student.')); }
  };

  return (
    <FormSheet visible={visible} title="Remove student" onClose={onClose} onSubmit={submit} submitLabel="Remove student" busy={remove.isPending} error={error}>
      <Text style={styles.text}>{student.name} will be hidden from the school. Their attendance, fees, marks and enrollments are kept, and an admin can bring them back from Recently deleted.</Text>
      <Text style={styles.text}>{counts.isLoading ? 'Checking their records...' : keptRecordsLine(counts.data)}</Text>
      <Text style={styles.warn}>Use this only for a record entered by mistake. If the student has left the school, use Left or Transferred on the web instead.</Text>
      <Input label={`Type "${student.name}" to confirm`} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} />
      <Input label="Reason" value={reason} onChangeText={setReason} placeholder="For example: duplicate entry" multiline style={styles.area} />
    </FormSheet>
  );
}

interface MoveProps extends Base { currentSectionId: number | null }

// Move a student to another section from a chosen day. The preview shows the roll they would get
// and what the move touches before anything changes.
export function StudentMoveSheet({ visible, onClose, student, currentSectionId }: MoveProps) {
  const toast = useToast();
  const qc = useQueryClient();
  const year = useAcademicYear();
  const yearId = year.current?.id ?? null;
  const { options } = useAttendanceClassOptions();
  const sections = useMemo(() => options.filter((o) => o.isSession), [options]);
  const [form, setForm] = useState<MoveForm>(emptyMoveForm(todayString()));
  const [rollTouched, setRollTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = visible && yearId != null && form.sectionId != null && form.effectiveDate ? movePreviewParams(yearId, form) : null;
  const preview = useMovePreview(student.id, params);
  const feesApply = !!preview.data?.fees?.applies;
  const move = useMutation({ mutationFn: (payload: Record<string, unknown>) => studentsApi.reclassifyStudent(student.id, payload) });

  useEffect(() => { if (visible) { setForm(emptyMoveForm(todayString())); setRollTouched(false); setError(null); } }, [visible]);
  // The server suggests the roll the student would get; keep it unless the admin typed their own.
  useEffect(() => {
    const suggested = preview.data?.suggested_roll;
    if (!rollTouched && suggested != null) setForm((f) => (f.roll === String(suggested) ? f : { ...f, roll: String(suggested) }));
  }, [preview.data?.suggested_roll, rollTouched]);

  const set = <K extends keyof MoveForm>(k: K, v: MoveForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const problem = validateMove(form, currentSectionId);
    if (problem) return setError(problem);
    if (yearId == null) return setError('There is no current academic year.');
    setError(null);
    try {
      await move.mutateAsync(buildMovePayload(yearId, form, feesApply));
      refreshStudent(qc);
      toast.success(`${student.name} was moved.`);
      onClose();
    } catch (e) { setError(staffLeaveErrorMessage(e, 'Could not move the student.')); }
  };

  const warnings = moveWarningLines(preview.data);
  const impact = feeImpactLines(preview.data);
  const blockers = feeBlockers(preview.data);

  return (
    <FormSheet visible={visible} title="Change class" onClose={onClose} onSubmit={submit} submitLabel="Move student" busy={move.isPending} error={error}>
      <Select label="New section" value={form.sectionId} searchable placeholder="Choose a section"
        options={sections.map((s) => ({ value: s.id, label: s.id === currentSectionId ? `${s.label} (current)` : s.label }))}
        onChange={(v) => { set('sectionId', Number(v)); setRollTouched(false); set('feeOption', 'keep'); }} />
      <DateField label="First day in the new class" value={form.effectiveDate} onChange={(v) => { set('effectiveDate', v); set('feeOption', 'keep'); }} />
      <Input label="Roll number" value={form.roll} onChangeText={(v) => { setRollTouched(true); set('roll', v); }}
        placeholder={preview.isFetching ? 'Checking...' : 'Suggested by the server'} maxLength={20} />
      <Input label="Reason" value={form.reason} onChangeText={(v) => set('reason', v)} placeholder="Why is the student moving?" multiline style={styles.area} />

      {preview.isError ? <Text style={styles.warn}>Could not check what this move changes. Check the section and date.</Text> : null}
      {warnings.map((w, i) => <Text key={i} style={styles.warn}>{w}</Text>)}
      {impact.length > 0 ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>Fees</Text>
          {impact.map((l, i) => <Text key={i} style={styles.text}>{l}</Text>)}
          {blockers.map((b, i) => <Text key={`b${i}`} style={styles.warn}>{b}</Text>)}
          {(['keep', 'reprice'] as const).map((opt) => {
            const disabled = opt === 'reprice' && !canRepriceFees(preview.data);
            return (
              <TouchableOpacity key={opt} accessibilityRole="radio" accessibilityState={{ selected: form.feeOption === opt, disabled }} disabled={disabled}
                onPress={() => set('feeOption', opt)} style={[styles.option, form.feeOption === opt && styles.optionOn, disabled && styles.optionOff]}>
                <Text style={styles.optionText}>{opt === 'keep' ? 'Keep the fees already generated' : 'Re-price unpaid months at the new class fee'}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: FontSize.sm, color: Colors.textSecondary, marginVertical: Spacing.xs },
  warn: { fontSize: FontSize.sm, color: Colors.warning, backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginVertical: Spacing.xs },
  area: { minHeight: 72, textAlignVertical: 'top' },
  box: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, marginVertical: Spacing.sm, gap: 2 },
  boxTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  option: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm },
  optionOn: { borderColor: Colors.primary, backgroundColor: Colors.infoLight },
  optionOff: { opacity: 0.5 },
  optionText: { fontSize: FontSize.sm, color: Colors.text },
});
