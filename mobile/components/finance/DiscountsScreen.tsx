import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useAcademicYear, useAttendanceClassOptions, useMasterClasses } from '../../hooks/useAcademicYear';
import { useDiscountActions, useDiscounts, useScholarships, useStudentDiscountsPaged } from '../../hooks/useDiscounts';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  APPLIES_TO, bulkResultText, buildAssignPayload, buildBulkPayload, buildDiscountPayload, buildScholarshipPayload,
  COVERAGES, DISCOUNT_TYPES, discountScopeText, discountToForm, discountValueText, emptyAssignForm, emptyDiscountForm,
  emptyScholarshipForm, scholarshipToForm, scholarshipValueText, SCHOLARSHIP_TYPES, validateAssign, validateDiscount,
  validateScholarship, type AssignForm, type AssignKind, type Discount, type DiscountForm, type Scholarship, type ScholarshipForm,
} from '../../services/discounts';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import StudentPicker from './StudentPicker';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'discounts' | 'scholarships' | 'assignments';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'discounts', label: 'Discounts' }, { value: 'scholarships', label: 'Scholarships' }, { value: 'assignments', label: 'Students' },
];

// Port of the web Discounts page. Admin and principal only; the server refuses everyone else.
export default function DiscountsScreen() {
  const [tab, setTab] = useState<Tab>('discounts');
  return (
    <View style={styles.container}>
      <View style={styles.tabs}><SegmentedTabs tabs={TABS} value={tab} onChange={setTab} /></View>
      {tab === 'discounts' ? <DiscountsTab /> : tab === 'scholarships' ? <ScholarshipsTab /> : <AssignmentsTab />}
    </View>
  );
}

// ─── Discounts ─────────────────────────────────────────────────────────────────────────────

function DiscountsTab() {
  const toast = useToast();
  const actions = useDiscountActions();
  const q = useDiscounts();
  const { current: year } = useAcademicYear();
  const classes = useMasterClasses();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<Discount | 'new' | null>(null);
  const [form, setForm] = useState<DiscountForm>(emptyDiscountForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof DiscountForm>(k: K, v: DiscountForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const problem = validateDiscount(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildDiscountPayload(form, year?.id);
      if (editing === 'new') await actions.createDiscount.mutateAsync(payload);
      else await actions.updateDiscount.mutateAsync({ id: (editing as Discount).id, data: payload });
      toast.success('Discount saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const remove = async (d: Discount) => {
    if (!(await confirm({ title: 'Delete discount?', message: d.usage_count ? `${d.name} is assigned to ${d.usage_count} student(s).` : d.name, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteDiscount.mutateAsync(d.id);
      toast.success('Discount deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the discount.'));
    }
  };

  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ New discount" size="sm" onPress={() => { setForm(emptyDiscountForm()); setError(null); setEditing('new'); }} />
        {(q.data ?? []).length === 0 ? <EmptyState title="No discounts" message="Add a discount, then assign it to students." /> : (q.data ?? []).map((d) => (
          <TouchableOpacity key={d.id} accessibilityRole="button" style={styles.row} onPress={() => { setForm(discountToForm(d)); setError(null); setEditing(d); }}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[discountValueText(d), discountScopeText(d), `${d.usage_count ?? 0} students`].join('  ·  ')}</Text>
            </View>
            <StatusPill label={d.is_active ? 'Active' : 'Off'} tone={d.is_active ? 'success' : 'neutral'} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New discount' : 'Edit discount'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createDiscount.isPending || actions.updateDiscount.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} />
        <Select label="Type" value={form.type} onChange={(v) => set('type', v)} options={DISCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        <Input label={form.type === 'PERCENTAGE' ? 'Percentage (0 to 100)' : 'Amount off (PKR)'} value={form.value} onChangeText={(v) => set('value', v)} keyboardType="decimal-pad" />
        <Select label="Applies to" value={form.appliesTo} onChange={(v) => set('appliesTo', v)} options={APPLIES_TO.map((a) => ({ value: a.value, label: a.label }))} />
        {form.appliesTo === 'GRADE_LEVEL' ? <Input label="Grade level" value={form.gradeLevel} onChangeText={(v) => set('gradeLevel', v)} keyboardType="number-pad" /> : null}
        {form.appliesTo === 'CLASS' ? (
          <Select label="Class" searchable value={form.targetClass} onChange={(v) => set('targetClass', v)} placeholder="Choose a class"
            options={(classes.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))} />
        ) : null}
        <DateField label="Start date (optional)" value={form.startDate} onChange={(v) => set('startDate', v)} />
        <DateField label="End date (optional)" value={form.endDate} onChange={(v) => set('endDate', v)} />
        <Input label="Maximum uses (optional)" value={form.maxUses} onChangeText={(v) => set('maxUses', v)} keyboardType="number-pad" />
        <ToggleRow label="Can combine with other discounts" value={form.stackable} onChange={(v) => set('stackable', v)} />
        <ToggleRow label="Active" value={form.isActive} onChange={(v) => set('isActive', v)} />
        {editing && editing !== 'new' ? <Button title="Delete discount" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
  );
}

// ─── Scholarships ──────────────────────────────────────────────────────────────────────────

function ScholarshipsTab() {
  const toast = useToast();
  const actions = useDiscountActions();
  const q = useScholarships();
  const { current: year } = useAcademicYear();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<Scholarship | 'new' | null>(null);
  const [form, setForm] = useState<ScholarshipForm>(emptyScholarshipForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ScholarshipForm>(k: K, v: ScholarshipForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const problem = validateScholarship(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildScholarshipPayload(form, year?.id);
      if (editing === 'new') await actions.createScholarship.mutateAsync(payload);
      else await actions.updateScholarship.mutateAsync({ id: (editing as Scholarship).id, data: payload });
      toast.success('Scholarship saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const remove = async (s: Scholarship) => {
    if (!(await confirm({ title: 'Delete scholarship?', message: s.recipient_count ? `${s.name} has ${s.recipient_count} recipient(s).` : s.name, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteScholarship.mutateAsync(s.id);
      toast.success('Scholarship deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the scholarship.'));
    }
  };

  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ New scholarship" size="sm" onPress={() => { setForm(emptyScholarshipForm()); setError(null); setEditing('new'); }} />
        {(q.data ?? []).length === 0 ? <EmptyState title="No scholarships" message="Add a scholarship program, then award it to students." /> : (q.data ?? []).map((s) => (
          <TouchableOpacity key={s.id} accessibilityRole="button" style={styles.row} onPress={() => { setForm(scholarshipToForm(s)); setError(null); setEditing(s); }}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[scholarshipValueText(s), s.scholarship_type_display, `${s.recipient_count ?? 0} students`].filter(Boolean).join('  ·  ')}</Text>
            </View>
            <StatusPill label={s.is_active ? 'Active' : 'Off'} tone={s.is_active ? 'success' : 'neutral'} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New scholarship' : 'Edit scholarship'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createScholarship.isPending || actions.updateScholarship.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} />
        <Input label="Description (optional)" value={form.description} onChangeText={(v) => set('description', v)} multiline />
        <Select label="Type" value={form.type} onChange={(v) => set('type', v)} options={SCHOLARSHIP_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        <Select label="Coverage" value={form.coverage} onChange={(v) => set('coverage', v)} options={COVERAGES.map((c) => ({ value: c.value, label: c.label }))} />
        {form.coverage !== 'FULL' ? (
          <Input label={form.coverage === 'PERCENTAGE' ? 'Percentage (0 to 100)' : 'Amount off (PKR)'} value={form.value} onChangeText={(v) => set('value', v)} keyboardType="decimal-pad" />
        ) : null}
        <Input label="Maximum recipients (optional)" value={form.maxRecipients} onChangeText={(v) => set('maxRecipients', v)} keyboardType="number-pad" />
        <ToggleRow label="Active" value={form.isActive} onChange={(v) => set('isActive', v)} />
        {editing && editing !== 'new' ? <Button title="Delete scholarship" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
  );
}

// ─── Student assignments ───────────────────────────────────────────────────────────────────

function AssignmentsTab() {
  const toast = useToast();
  const actions = useDiscountActions();
  const { current: year } = useAcademicYear();
  const discounts = useDiscounts();
  const scholarships = useScholarships();
  const classOptions = useAttendanceClassOptions().options;
  const [status, setStatus] = useState<'true' | 'false' | ''>('true');
  const query = useStudentDiscountsPaged(status);
  const refreshControl = useRefreshControl(query.refetch);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [mode, setMode] = useState<'one' | 'class' | null>(null);
  const [form, setForm] = useState<AssignForm>(emptyAssignForm());
  const [classId, setClassId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AssignForm>(k: K, v: AssignForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const discountOptions = (discounts.data ?? []).filter((d) => d.is_active).map((d) => ({ value: d.id, label: `${d.name} (${discountValueText(d)})` }));
  const scholarshipOptions = (scholarships.data ?? []).filter((s) => s.is_active).map((s) => ({ value: s.id, label: `${s.name} (${scholarshipValueText(s)})` }));

  const submit = async () => {
    setError(null);
    try {
      if (mode === 'one') {
        const problem = validateAssign(form, year?.id);
        if (problem) return setError(problem);
        await actions.assign.mutateAsync(buildAssignPayload(form, year!.id));
        toast.success('Assigned.');
      } else {
        const chosenId = form.kind === 'discount' ? form.discount : form.scholarship;
        const built = buildBulkPayload(form.kind, chosenId, classOptions.find((o) => o.id === classId) ?? null, year?.id);
        if ('error' in built) return setError(built.error ?? 'Check the form.');
        const ok = await confirm({ title: 'Assign to the whole class?', message: 'Every active student in the class gets it for this academic year. Students who already have it are skipped.', confirmLabel: 'Assign' });
        if (!ok) return;
        const res = await actions.bulkAssign.mutateAsync(built.payload);
        toast.success(bulkResultText(res.data as { created?: number; skipped?: number; total_students?: number }));
      }
      setMode(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const remove = async (id: number, label: string) => {
    if (!(await confirm({ title: 'Remove from student?', message: label, confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await actions.removeAssignment.mutateAsync(id);
      toast.success('Removed.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not remove it.'));
    }
  };

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const kindTabs: Array<{ value: AssignKind; label: string }> = [{ value: 'discount', label: 'Discount' }, { value: 'scholarship', label: 'Scholarship' }];

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <SegmentedTabs tabs={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Removed' }, { value: '', label: 'All' }]} value={status} onChange={setStatus} />
        <View style={styles.buttons}>
          <Button title="Assign to a student" size="sm" onPress={() => { setForm(emptyAssignForm()); setError(null); setMode('one'); }} />
          <Button title="Assign to a class" size="sm" variant="outline" onPress={() => { setForm(emptyAssignForm()); setClassId(null); setError(null); setMode('class'); }} />
        </View>
        {rows.length === 0 ? <EmptyState title="Nothing assigned" message="Assigned discounts and scholarships show here." /> : rows.map((r) => (
          <Card key={r.id} style={styles.card}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{r.student_name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[r.class_name, r.discount_name ?? r.scholarship_name, r.academic_year_name].filter(Boolean).join('  ·  ')}</Text>
            </View>
            {r.is_active ? (
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${r.discount_name ?? r.scholarship_name} from ${r.student_name}`} onPress={() => remove(r.id, `${r.discount_name ?? r.scholarship_name} from ${r.student_name}`)} style={styles.remove}>
                <Text style={styles.removeText}>Remove</Text>
              </TouchableOpacity>
            ) : <StatusPill label="Removed" tone="neutral" />}
          </Card>
        ))}
        {query.hasNextPage ? <Button title="Load more" variant="ghost" size="sm" onPress={() => query.fetchNextPage()} loading={query.isFetchingNextPage} /> : null}
      </ScrollView>

      <FormSheet visible={mode !== null} title={mode === 'one' ? 'Assign to a student' : 'Assign to a class'} onClose={() => setMode(null)} onSubmit={submit}
        submitLabel="Assign" busy={actions.assign.isPending || actions.bulkAssign.isPending} error={error}>
        <SegmentedTabs tabs={kindTabs} value={form.kind} onChange={(v) => set('kind', v)} />
        {form.kind === 'discount'
          ? <Select label="Discount" searchable value={form.discount} onChange={(v) => set('discount', v)} placeholder="Choose a discount" options={discountOptions} />
          : <Select label="Scholarship" searchable value={form.scholarship} onChange={(v) => set('scholarship', v)} placeholder="Choose a scholarship" options={scholarshipOptions} />}
        {mode === 'one' ? <StudentPicker value={form.student} onChange={(id) => set('student', id)} /> : (
          <Select label="Class" searchable value={classId} onChange={setClassId} placeholder="Choose a class"
            options={classOptions.map((o) => ({ value: o.id, label: o.label }))} />
        )}
        {mode === 'one' ? <Input label="Notes (optional)" value={form.notes} onChangeText={(v) => set('notes', v)} multiline /> : null}
        <Text style={styles.hint}>Applies to the active academic year{year ? ` (${year.name ?? 'current'})` : ''}.</Text>
      </FormSheet>
    </>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { padding: Spacing.lg, paddingBottom: 0 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  buttons: { gap: Spacing.sm, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md },
  card: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  remove: { minHeight: 44, justifyContent: 'center', paddingHorizontal: Spacing.sm },
  removeText: { color: Colors.error, fontWeight: '600', fontSize: FontSize.sm },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text, flex: 1, marginRight: Spacing.md },
});
