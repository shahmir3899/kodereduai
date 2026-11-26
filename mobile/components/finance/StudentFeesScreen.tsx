import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAcademicYear, useAttendanceClassOptions, useMasterClasses } from '../../hooks/useAcademicYear';
import { useFeeCategories, useFeeStructures, useFeeClassStudents, useStudentFeeSave } from '../../hooks/useFeeStructure';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import { feeClassOptions, type FeeKind } from '../../services/feeStructure';
import {
  buildStudentFeePayload, buildStudentRows, changeCountsText, changedCells, isOverride, rowTotal, studentFeeSummary, validateStudentFees,
  type StudentFeeEdits, type StudentFeeRow,
} from '../../services/studentFees';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import MultiSelect from '../ui/MultiSelect';
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
import AppList from '../ui/AppList';

// What each student of a class pays when it differs from the class charge, for one or several fees
// (categories) at once. Admin and principal only. Only the boxes that were changed are saved; the new
// amount starts from the chosen date and earlier fee records are not rewritten (same rule as the web).
export default function StudentFeesScreen() {
  const toast = useToast();
  const { current: year } = useAcademicYear();
  const [kind, setKind] = useState<FeeKind>('MONTHLY');
  const [classId, setClassId] = useState<number | null>(null);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(todayString());
  const [edits, setEdits] = useState<StudentFeeEdits>({});
  const [error, setError] = useState<string | null>(null);

  const sections = useAttendanceClassOptions().options;
  const masters = useMasterClasses();
  const classes = useMemo(() => feeClassOptions(sections, (masters.data ?? []).map((c) => ({ id: Number(c.id), name: String(c.name) }))), [sections, masters.data]);
  const categories = useFeeCategories(kind);
  const structures = useFeeStructures(kind);
  const students = useFeeClassStudents(classId);
  const save = useStudentFeeSave();
  const refreshControl = useRefreshControl(structures.refetch, students.refetch);

  // Switching what is being priced throws away the typed amounts: they belong to the old choice.
  useEffect(() => { setEdits({}); setError(null); setCategoryIds([]); }, [kind]);
  useEffect(() => { setEdits({}); setError(null); }, [classId]);
  useEffect(() => {
    if (categoryIds.length === 0 && (categories.data ?? []).length > 0) setCategoryIds([categories.data![0].id]);
  }, [categoryIds.length, categories.data]);

  const chosen = useMemo(() => (categories.data ?? []).filter((c) => categoryIds.includes(c.id)), [categories.data, categoryIds]);
  const rows = useMemo(
    () => (classId == null ? [] : buildStudentRows(students.data ?? [], structures.data ?? [], classId, kind, chosen, edits)),
    [classId, students.data, structures.data, kind, chosen, edits],
  );
  const changes = changedCells(rows);
  const changed = changes.length;
  const className = classes.find((c) => c.id === classId)?.label ?? '';
  const many = chosen.length > 1;

  // At least one fee stays chosen; unticking one drops the amounts typed for it.
  const toggleCategory = (id: number) => {
    if (categoryIds.includes(id)) {
      if (categoryIds.length === 1) return;
      setCategoryIds(categoryIds.filter((x) => x !== id));
      setEdits((e) => {
        const next = { ...e };
        delete next[id];
        return next;
      });
    } else {
      setCategoryIds([...categoryIds, id]);
    }
  };
  const setCell = (categoryId: number, studentId: number, v: string) =>
    setEdits((e) => ({ ...e, [categoryId]: { ...(e[categoryId] ?? {}), [studentId]: v } }));

  const submit = async () => {
    if (classId == null) return;
    const problem = validateStudentFees(rows, effectiveFrom, categoryIds);
    if (problem) return setError(problem);
    setError(null);
    if (!(await confirm({ title: `Save ${changed} amount${changed === 1 ? '' : 's'}?`, message: studentFeeSummary(className, rows, chosen, effectiveFrom), confirmLabel: 'Save' }))) return;
    try {
      await save.mutateAsync(buildStudentFeePayload(classId, kind, effectiveFrom, rows));
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
      {(categories.data ?? []).length === 0 && !categories.isLoading ? (
        <Text style={styles.hint}>No {kind === 'MONTHLY' ? 'monthly' : 'annual'} fees yet. Add one under Fee setup first.</Text>
      ) : (
        <MultiSelect label="Fees" values={categoryIds} onToggle={toggleCategory} placeholder="Choose fees" hint="Tick one or more fees to set together."
          options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      )}
      <DateField label="New amounts start from" value={effectiveFrom} onChange={setEffectiveFrom} />
      {classId == null ? <Text style={styles.hint}>Choose a class to see what each student pays.</Text> : (
        <Text style={styles.hint}>
          {classChargeText(chosen, rows)} Type a different amount for a student who pays more or less.
        </Text>
      )}
      {changed > 0 ? <Text style={styles.changes}>{changed} change{changed === 1 ? '' : 's'} · {changeCountsText(changes, chosen)}</Text> : null}
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Rows hold typing boxes: clipping off-screen rows on Android can drop the keyboard. */}
      <AppList
        removeClippedSubviews={false}
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
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Text style={styles.name} numberOfLines={1}>{r.roll ? `${r.roll}. ${r.name}` : r.name}</Text>
              {many ? <Text style={styles.total}>PKR {rowTotal(r).toLocaleString()}</Text> : null}
            </View>
            {chosen.map((c) => {
              const cell = r.cells[c.id];
              if (!cell) return null;
              return (
                <View key={c.id} style={styles.line}>
                  <View style={styles.who}>
                    {many ? <Text style={styles.fee} numberOfLines={1}>{c.name}</Text> : null}
                    {cell.legacy && !cell.edited ? <StatusPill label="Old all-fees amount" tone="warning" />
                      : isOverride(cell) ? <StatusPill label="Own amount" tone="info" /> : null}
                  </View>
                  <View style={styles.box}>
                    <Input value={cell.amount} onChangeText={(v) => setCell(c.id, r.studentId, v)} keyboardType="decimal-pad" placeholder="PKR" accessibilityLabel={`${c.name} amount for ${r.name}`} />
                  </View>
                </View>
              );
            })}
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

// "Tuition: PKR 3,000 · Koder Kids: no class charge." The class charge is the same on every row.
function classChargeText(chosen: { id: number; name: string }[], rows: StudentFeeRow[]): string {
  if (!rows[0]) return '';
  return chosen.map((c) => {
    const d = rows[0].cells[c.id]?.classDefault;
    return `${c.name}: ${d ? `PKR ${Number(d).toLocaleString()}` : 'no class charge'}`;
  }).join(' · ') + '.';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  who: { flex: 1, gap: Spacing.xs, alignItems: 'flex-start' },
  name: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  fee: { fontSize: FontSize.sm, color: Colors.textSecondary },
  total: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  changes: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  box: { width: 120 },
  footer: { marginTop: Spacing.md, gap: Spacing.sm },
  error: { color: Colors.error, fontSize: FontSize.sm },
});
