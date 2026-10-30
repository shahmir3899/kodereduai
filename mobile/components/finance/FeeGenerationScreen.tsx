import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useAcademicYear, useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useFeeCategories } from '../../hooks/useFeeStructure';
import { useGenerationActions, useGenerationPreview } from '../../hooks/useFeeGeneration';
import {
  buildBulkPayload, buildSinglePayload, CONFLICTS, confirmText, emptyBulkForm, emptySingleForm, MONTH_NAMES, previewParams,
  previewText, resultText, validateBulk, validateSingle, yearOptions, type BulkForm, type SingleForm,
} from '../../services/feeGeneration';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import MultiSelect from '../ui/MultiSelect';
import Button from '../ui/Button';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import StudentPicker from './StudentPicker';
import { Colors, FontSize, Spacing } from '../../constants/colors';

type Mode = 'bulk' | 'single';
const ALL = -1;

// Create fee records from the fee structure, for a class or the whole school, or for one student.
// Admin and principal only. A bulk run is previewed first and confirmed with the counts; paid
// records are never changed by the server whichever option is chosen.
export default function FeeGenerationScreen() {
  const [mode, setMode] = useState<Mode>('bulk');
  const { current: year } = useAcademicYear();
  if (!year) return <EmptyState title="No academic year" message="Create or activate an academic year on the web first." />;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SegmentedTabs tabs={[{ value: 'bulk', label: 'A class or school' }, { value: 'single', label: 'One student' }]} value={mode} onChange={setMode} />
      {mode === 'bulk' ? <Bulk academicYearId={year.id} /> : <Single academicYearId={year.id} />}
    </ScrollView>
  );
}

function Bulk({ academicYearId }: { academicYearId: number }) {
  const toast = useToast();
  const actions = useGenerationActions();
  const options = useAttendanceClassOptions().options;
  const [f, setF] = useState<BulkForm>(emptyBulkForm());
  const categories = useFeeCategories(f.kind);
  const option = options.find((o) => o.id === f.classOption);
  const preview = useGenerationPreview(previewParams(f, option, academicYearId), f.categories.length > 0);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof BulkForm>(k: K, v: BulkForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const busy = actions.monthly.isPending || actions.annual.isPending;

  const run = async () => {
    const problem = validateBulk(f, preview.data);
    if (problem) return setError(problem);
    setError(null);
    const ok = await confirm({ title: 'Generate fee records?', message: confirmText(f, option?.label ?? '', preview.data!), confirmLabel: 'Generate' });
    if (!ok) return;
    try {
      const payload = buildBulkPayload(f, option, academicYearId);
      const res = await (f.kind === 'MONTHLY' ? actions.monthly : actions.annual).mutateAsync(payload);
      toast.success(resultText(res.status, res.data));
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not generate the records.'));
    }
  };

  return (
    <View style={styles.gap}>
      <SegmentedTabs tabs={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'ANNUAL', label: 'Annual' }]} value={f.kind} onChange={(k) => setF((x) => ({ ...x, kind: k, categories: [] }))} />
      {f.kind === 'MONTHLY' ? (
        <Select label="Month" value={f.month} onChange={(v) => set('month', v)} options={MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m }))} />
      ) : null}
      <Select label="Year" value={f.year} onChange={(v) => set('year', v)} options={yearOptions().map((y) => ({ value: y, label: String(y) }))} />
      <Select label="Class" searchable value={f.classOption ?? ALL} onChange={(v) => set('classOption', v === ALL ? null : v)}
        options={[{ value: ALL, label: 'Every class' }, ...options.map((o) => ({ value: o.id, label: o.label }))]} />
      <MultiSelect
        label={f.kind === 'MONTHLY' ? 'Monthly categories' : 'Annual categories'} values={f.categories} placeholder="Choose categories"
        options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        onToggle={(id) => setF((x) => ({ ...x, categories: x.categories.includes(id) ? x.categories.filter((c) => c !== id) : [...x.categories, id] }))}
        hint={(categories.data ?? []).length === 0 ? 'No categories yet. Add them under Fee setup first.' : undefined}
      />
      <Select label="If a record already exists" value={f.conflict} onChange={(v) => set('conflict', v)} options={CONFLICTS.map((c) => ({ value: c.value, label: c.label }))} />
      <Text style={styles.hint}>{CONFLICTS.find((c) => c.value === f.conflict)?.hint}</Text>

      {f.categories.length > 0 ? (
        <Card>
          <Text style={styles.title}>Preview</Text>
          <Text style={styles.body}>{preview.isLoading || preview.isFetching ? 'Checking…' : preview.isError ? 'Could not load the preview.' : preview.data ? previewText(preview.data) : ''}</Text>
        </Card>
      ) : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title="Generate records" onPress={run} loading={busy} disabled={busy || preview.isFetching || f.categories.length === 0} />
    </View>
  );
}

function Single({ academicYearId }: { academicYearId: number }) {
  const toast = useToast();
  const actions = useGenerationActions();
  const [f, setF] = useState<SingleForm>(emptySingleForm());
  const categories = useFeeCategories(f.kind);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SingleForm>(k: K, v: SingleForm[K]) => setF((x) => ({ ...x, [k]: v }));

  const run = async () => {
    const problem = validateSingle(f);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.single.mutateAsync(buildSinglePayload(f, academicYearId));
      toast.success('Fee record generated.');
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not generate the record. Check the student has a fee set for this category.'));
    }
  };

  return (
    <View style={styles.gap}>
      <StudentPicker value={f.student} onChange={(id) => set('student', id)} />
      <SegmentedTabs tabs={[{ value: 'MONTHLY', label: 'Monthly' }, { value: 'ANNUAL', label: 'Annual' }]} value={f.kind} onChange={(k) => setF((x) => ({ ...x, kind: k, category: null }))} />
      {f.kind === 'MONTHLY' ? (
        <Select label="Month" value={f.month} onChange={(v) => set('month', v)} options={MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m }))} />
      ) : null}
      <Select label="Year" value={f.year} onChange={(v) => set('year', v)} options={yearOptions().map((y) => ({ value: y, label: String(y) }))} />
      <Select label="Category" value={f.category} onChange={(v) => set('category', v)} placeholder="Choose a category" options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
      <Select label="If a record already exists" value={f.conflict} onChange={(v) => set('conflict', v)} options={CONFLICTS.map((c) => ({ value: c.value, label: c.label }))} />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <Button title="Generate record" onPress={run} loading={actions.single.isPending} disabled={actions.single.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  gap: { gap: Spacing.sm },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  body: { fontSize: FontSize.sm, color: Colors.text },
  error: { color: Colors.error, fontSize: FontSize.sm },
});
