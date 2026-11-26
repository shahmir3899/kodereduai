import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { todayString, type ClassOption } from '../../services/attendanceEntry';
import { enrollable, enrollPayload, priceLabel, type FeeCategoryKind, type FeeEnrollment } from '../../services/feeEnrollments';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useEnrollClassStudents, useFeeEnrollmentActions, useFeeEnrollments } from '../../hooks/useFeeEnrollments';
import { inventoryErrorMessage } from '../../services/inventory';
import FormSheet from '../inventory/FormSheet';
import Select from '../ui/Select';
import MultiSelect from '../ui/MultiSelect';
import DateField from '../ui/DateField';
import Input from '../ui/Input';
import { confirm } from '../ui/confirm';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Who takes an optional fee (Robotics, Karate...): the current list, End per student, and adding a
// class's students from a start date. Joining mid-month is billed the full month; ending stops the
// months after today. Bills already generated never change here.
export default function FeeEnrollmentsSheet({ kind, category, onClose }: {
  kind: FeeCategoryKind;
  category: { id: number; name: string } | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const { year, options } = useAttendanceClassOptions();
  const academicYearId = year.current?.id ?? null;
  const list = useFeeEnrollments(kind, category?.id ?? null);
  const actions = useFeeEnrollmentActions();
  const [classId, setClassId] = useState<number | null>(null);
  const option: ClassOption | null = options.find((o) => o.id === classId) ?? null;
  const students = useEnrollClassStudents(option, academicYearId);
  const [picked, setPicked] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(todayString());
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  const enrolled = list.data ?? [];
  const offer = useMemo(() => enrollable(students.data ?? [], enrolled), [students.data, enrolled]);

  const enroll = async () => {
    if (!category) return;
    if (!picked.length) return setError('Pick at least one student.');
    if (price.trim() && !(Number(price) >= 0)) return setError('Enter a price of 0 or more.');
    setError(null);
    try {
      const res = await actions.enroll.mutateAsync(enrollPayload(kind, category.id, picked, startDate, price, academicYearId));
      const { created, skipped } = (res as { data: { created: number; skipped: number } }).data;
      toast.success(`${created} enrolled${skipped ? `, ${skipped} already enrolled` : ''}.`);
      setPicked([]);
      setPrice('');
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not enroll.'));
    }
  };

  const end = async (e: FeeEnrollment) => {
    const today = todayString();
    if (!(await confirm({ title: `End ${e.student_name}?`, message: `No ${category?.name} fee after ${today}.`, confirmLabel: 'End' }))) return;
    try {
      await actions.end.mutateAsync({ ids: [e.id], end_date: today });
      toast.success('Enrollment ended.');
    } catch (err) {
      toast.error(inventoryErrorMessage(err, 'Could not end the enrollment.'));
    }
  };

  return (
    <FormSheet visible={category !== null} title={category ? `${category.name}: students` : ''} onClose={onClose}
      onSubmit={enroll} submitLabel={picked.length ? `Enroll ${picked.length}` : 'Enroll'} busy={actions.enroll.isPending} error={error}>
      <Text style={styles.heading}>Enrolled now ({enrolled.length})</Text>
      {list.isLoading ? <Text style={styles.muted}>Loading…</Text> : enrolled.length === 0 ? (
        <Text style={styles.muted}>Nobody yet. Add students below.</Text>
      ) : enrolled.map((e) => (
        <View key={e.id} style={styles.row}>
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>{e.student_name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{[e.class_label, `from ${e.start_date}`, priceLabel(e)].filter(Boolean).join(' · ')}</Text>
          </View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`End ${e.student_name}`} hitSlop={8} onPress={() => end(e)}>
            <Text style={styles.end}>End</Text>
          </TouchableOpacity>
        </View>
      ))}

      <Text style={[styles.heading, styles.addHeading]}>Add students</Text>
      <Select label="Class" value={classId} options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={(v) => { setClassId(v); setPicked([]); }} placeholder="Pick a class" />
      {option ? (
        <MultiSelect label="Students" values={picked} placeholder={students.isLoading ? 'Loading…' : offer.length ? 'Pick students' : 'Everyone is enrolled'}
          options={offer.map((s) => ({ value: s.id, label: s.roll_number ? `${s.roll_number}. ${s.name}` : s.name }))}
          onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))} disabled={!offer.length} />
      ) : null}
      <DateField label="Starts on" value={startDate} onChange={setStartDate} />
      <Input label="Own price (optional)" value={price} onChangeText={setPrice} keyboardType="numeric" placeholder="Default price" />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  addHeading: { marginTop: Spacing.lg },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background, borderRadius: BorderRadius.md, padding: Spacing.sm, marginBottom: Spacing.xs, gap: Spacing.sm },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  end: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.error },
});
