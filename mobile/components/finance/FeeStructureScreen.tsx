import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAcademicYear, useAttendanceClassOptions, useMasterClasses } from '../../hooks/useAcademicYear';
import { useFeeCategories, useFeeStructureActions, useFeeStructures } from '../../hooks/useFeeStructure';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import { inventoryErrorMessage } from '../../services/inventory';
import {
  buildFeePayload, changeSummary, emptyRow, feeClassOptions, savedRows, totalOf, validateRows, type ChargeRow, type FeeKind,
} from '../../services/feeStructure';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import QuickAdd from '../inventory/QuickAdd';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The amounts each class is charged per category, monthly or annual. Admin and principal only.
// Saving closes the class's current charge for each changed category and opens the new amount from
// the chosen date, so earlier fee records are not rewritten. Amounts for single students are on their own screen.
export default function FeeStructureScreen() {
  const router = useRouter();
  const toast = useToast();
  const { current: year } = useAcademicYear();
  const [kind, setKind] = useState<FeeKind>('MONTHLY');
  const actions = useFeeStructureActions(kind);
  const sections = useAttendanceClassOptions().options;
  const masters = useMasterClasses();
  const structures = useFeeStructures(kind);
  const categories = useFeeCategories(kind);
  const refreshControl = useRefreshControl(structures.refetch, categories.refetch);

  const classes = useMemo(
    () => feeClassOptions(sections, (masters.data ?? []).map((c) => ({ id: Number(c.id), name: String(c.name) }))),
    [sections, masters.data],
  );
  const [classId, setClassId] = useState<number | null>(null);
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState(todayString());
  const [error, setError] = useState<string | null>(null);

  // Start from what is saved whenever the class, the kind or the saved data changes.
  useEffect(() => {
    if (classId == null) return setRows([]);
    const saved = savedRows(structures.data ?? [], classId, kind);
    setRows(saved.length ? saved : [emptyRow()]);
    setError(null);
  }, [classId, kind, structures.data]);

  const names = useMemo(() => Object.fromEntries((categories.data ?? []).map((c) => [c.id, c.name])), [categories.data]);
  const taken = new Set(rows.map((r) => r.category).filter(Boolean));
  const className = classes.find((c) => c.id === classId)?.label ?? '';

  const setRow = (i: number, patch: Partial<ChargeRow>) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const save = async () => {
    if (classId == null) return;
    const problem = validateRows(rows, effectiveFrom);
    if (problem) return setError(problem);
    setError(null);
    const ok = await confirm({
      title: 'Save new amounts?',
      message: changeSummary(className, rows, effectiveFrom, names),
      confirmLabel: 'Save',
    });
    if (!ok) return;
    try {
      await actions.save.mutateAsync(buildFeePayload(classId, kind, rows, effectiveFrom, year?.id));
      toast.success('Fee amounts saved.');
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  if (structures.isLoading || masters.isLoading) return <Skeleton />;
  if (structures.isError && !structures.data) return <ErrorState error={structures.error} onRetry={() => structures.refetch()} />;
  if (!year) return <EmptyState title="No academic year" message="Create or activate an academic year on the web first." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
      <SegmentedTabs tabs={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'ANNUAL', label: 'Annual' }]} value={kind} onChange={(k) => { setKind(k); }} />
      <Select label="Class" searchable value={classId} onChange={setClassId} placeholder="Choose a class" options={classes.map((c) => ({ value: c.id, label: c.label }))} />

      {classId == null ? <Text style={styles.hint}>Choose a class to see and change what it is charged.</Text> : (
        <Card>
          <Text style={styles.section}>{kind === 'MONTHLY' ? 'Monthly charges' : 'Annual charges'} · {className}</Text>
          {(categories.data ?? []).length === 0 ? <Text style={styles.hint}>No categories yet. Add one below.</Text> : null}
          {rows.map((r, i) => (
            <View key={`${r.category ?? 'new'}-${i}`} style={styles.row}>
              <View style={styles.cat}>
                <Select
                  label={i === 0 ? 'Category' : undefined} value={r.category} onChange={(v) => setRow(i, { category: v })} placeholder="Choose"
                  disabled={r.saved !== ''}
                  options={(categories.data ?? []).filter((c) => !taken.has(c.id) || c.id === r.category).map((c) => ({ value: c.id, label: c.name }))}
                />
              </View>
              <View style={styles.amount}>
                <Input label={i === 0 ? 'Amount (PKR)' : undefined} value={r.amount} onChangeText={(v) => setRow(i, { amount: v })} keyboardType="decimal-pad" placeholder="0" />
              </View>
            </View>
          ))}
          <Button title="+ Add a charge" variant="ghost" size="sm" onPress={() => setRows((rs) => [...rs, emptyRow()])} />
          <QuickAdd noun="category" onCreate={async (name) => {
            const res = await actions.createCategory.mutateAsync({ name, is_active: true });
            return (res.data as { id?: number })?.id;
          }} />
          <Text style={styles.total}>Total per {kind === 'MONTHLY' ? 'month' : 'year'}: PKR {totalOf(rows).toLocaleString()}</Text>
          <DateField label="New amounts start from" value={effectiveFrom} onChange={setEffectiveFrom} />
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <Button title="Save amounts" onPress={save} loading={actions.save.isPending} disabled={actions.save.isPending} />
        </Card>
      )}

      <Button title="Generate fee records" variant="outline" onPress={() => router.push('/(admin)/finance/fee-generate' as Href)} />
      <Button title="Amounts for single students" variant="outline" onPress={() => router.push('/(admin)/finance/student-fees' as Href)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-end' },
  cat: { flex: 3 },
  amount: { flex: 2 },
  total: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginVertical: Spacing.sm },
  error: { color: Colors.error, fontSize: FontSize.sm, marginBottom: Spacing.sm },
});
