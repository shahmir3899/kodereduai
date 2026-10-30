import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useAcademicYear, useAttendanceClassOptions, useMasterClasses } from '../../hooks/useAcademicYear';
import { useFeeCategories, useFeeStructures, useFeeClassStudents, useStudentFeeSave } from '../../hooks/useFeeStructure';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import { feeClassOptions, type FeeKind } from '../../services/feeStructure';
import {
  buildStudentFeePayload, buildStudentRows, changedStudentRows, classDefaultAmount, isOverride, studentFeeSummary, validateStudentFees,
} from '../../services/studentFees';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import EmptyState from '../ui/EmptyState';
import ErrorState from '../ui/ErrorState';
import Skeleton from '../ui/Skeleton';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// What each student of a class pays when it differs from the class charge. Admin and principal only.
// Only the students whose box was changed are saved; the new amount starts from the chosen date and
// earlier fee records are not rewritten (same rule as the web).
export default function StudentFeesScreen() {
  const toast = useToast();
  const { current: year } = useAcademicYear();
  const [kind, setKind] = useState<FeeKind>('MONTHLY');
  const [classId, setClassId] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayString());
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);

  const sections = useAttendanceClassOptions().options;
  const masters = useMasterClasses();
  const classes = useMemo(() => feeClassOptions(sections, (masters.data ?? []).map((c) => ({ id: Number(c.id), name: String(c.name) }))), [sections, masters.data]);
  const categories = useFeeCategories('ANNUAL');
  const structures = useFeeStructures(kind);
  const students = useFeeClassStudents(classId);
  const save = useStudentFeeSave();
  const refreshControl = useRefreshControl(structures.refetch, students.refetch);

  // Switching what is being priced throws away the typed amounts: they belong to the old choice.
  useEffect(() => { setEdits({}); setError(null); }, [kind, classId, categoryId]);
  useEffect(() => {
    if (kind === 'ANNUAL' && categoryId == null && (categories.data ?? []).length > 0) setCategoryId(categories.data![0].id);
  }, [kind, categoryId, categories.data]);

  const scopeCategory = kind === 'ANNUAL' ? categoryId : null;
  const rows = useMemo(
    () => (classId == null ? [] : buildStudentRows(students.data ?? [], structures.data ?? [], classId, kind, scopeCategory, edits)),
    [classId, students.data, structures.data, kind, scopeCategory, edits],
  );
  const classDefault = classId == null ? '' : classDefaultAmount(structures.data ?? [], classId, kind, scopeCategory);
  const changed = changedStudentRows(rows).length;
  const className = classes.find((c) => c.id === classId)?.label ?? '';

  const submit = async () => {
    if (classId == null) return;
    const problem = validateStudentFees(rows, effectiveFrom, kind, scopeCategory);
    if (problem) return setError(problem);
    setError(null);
    if (!(await confirm({ title: `Save ${changed} student amount${changed === 1 ? '' : 's'}?`, message: studentFeeSummary(className, rows, effectiveFrom), confirmLabel: 'Save' }))) return;
    try {
      await save.mutateAsync(buildStudentFeePayload(classId, kind, scopeCategory, effectiveFrom, rows));
      toast.success('Student amounts saved.');
      setEdits({});
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  if (masters.isLoading) return <Skeleton />;
  if (!year) return <EmptyState title="No academic year" message="Create or activate an academic year on the web first." />;

  const header = (
    <View style={styles.header}>
      <SegmentedTabs tabs={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'ANNUAL', label: 'Annual' }]} value={kind} onChange={setKind} />
      <Select label="Class" searchable value={classId} onChange={setClassId} placeholder="Choose a class" options={classes.map((c) => ({ value: c.id, label: c.label }))} />
      {kind === 'ANNUAL' ? (
        <Select label="Annual category" value={categoryId} onChange={setCategoryId} placeholder="Choose a category" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      ) : null}
      <DateField label="New amounts start from" value={effectiveFrom} onChange={setEffectiveFrom} />
      {classId != null ? <Text style={styles.hint}>{classDefault ? `Class charge: PKR ${Number(classDefault).toLocaleString()}. Type a different amount for a student who pays more or less.` : 'This class has no charge set yet. Set it under Fee setup first, or type each amount here.'}</Text> : <Text style={styles.hint}>Choose a class to see what each student pays.</Text>}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.studentId)}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
        ListHeaderComponent={header}
        ListEmptyComponent={
          classId == null ? null
            : students.isLoading || structures.isLoading ? <Skeleton />
            : students.isError ? <ErrorState error={students.error} onRetry={() => students.refetch()} />
            : <EmptyState title="No students" message="This class has no active students this year." />
        }
        renderItem={({ item: r }) => (
          <View style={styles.row}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{r.roll ? `${r.roll}. ${r.name}` : r.name}</Text>
              {isOverride(r) ? <StatusPill label="Own amount" tone="info" /> : null}
            </View>
            <View style={styles.box}>
              <Input value={r.amount} onChangeText={(v) => setEdits((e) => ({ ...e, [r.studentId]: v }))} keyboardType="decimal-pad" placeholder="PKR" accessibilityLabel={`Amount for ${r.name}`} />
            </View>
          </View>
        )}
        ListFooterComponent={rows.length > 0 ? (
          <View style={styles.footer}>
            {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
            <Button title={changed ? `Save ${changed} change${changed === 1 ? '' : 's'}` : 'Save changes'} onPress={submit} loading={save.isPending} disabled={save.isPending || changed === 0} />
          </View>
        ) : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md },
  who: { flex: 1, gap: Spacing.xs, alignItems: 'flex-start' },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  box: { width: 120 },
  footer: { marginTop: Spacing.md, gap: Spacing.sm },
  error: { color: Colors.error, fontSize: FontSize.sm },
});
