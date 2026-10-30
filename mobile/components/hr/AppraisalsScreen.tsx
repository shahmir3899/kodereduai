import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAppraisalActions, useAppraisals } from '../../hooks/usePayroll';
import { useStaffOptions } from '../../hooks/usePayroll';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  appraisalToForm, buildAppraisalPayload, emptyAppraisalForm, RATING_LABELS, ratingTone, sortAppraisals, validateAppraisal,
  type Appraisal, type AppraisalForm,
} from '../../services/appraisals';
import { inventoryErrorMessage } from '../../services/inventory';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of PerformanceAppraisalPage.jsx for admin and principal: reviews with a 1 to 5 rating.
export default function AppraisalsScreen() {
  const toast = useToast();
  const actions = useAppraisalActions();
  const q = useAppraisals();
  const refreshControl = useRefreshControl(q.refetch) as React.ReactElement<RefreshControlProps>;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Appraisal | 'new' | null>(null);
  const staff = useStaffOptions(editing === 'new');
  const [form, setForm] = useState<AppraisalForm>(emptyAppraisalForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AppraisalForm>(k: K, v: AppraisalForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    return sortAppraisals(q.data ?? []).filter((a) => !t || a.staff_member_name.toLowerCase().includes(t));
  }, [q.data, search]);

  const save = async () => {
    const creating = editing === 'new';
    const problem = validateAppraisal(form, creating);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildAppraisalPayload(form, creating);
      if (creating) await actions.create.mutateAsync(payload);
      else await actions.update.mutateAsync({ id: (editing as Appraisal).id, data: payload });
      toast.success('Appraisal saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const remove = async (a: Appraisal) => {
    if (!(await confirm({ title: 'Delete this appraisal?', message: `${a.staff_member_name}, ${a.review_period_start} to ${a.review_period_end}`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(a.id);
      toast.success('Appraisal deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete.'));
    }
  };

  const header = (
    <View>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search staff..." />
      <Button title="+ New appraisal" size="sm" onPress={() => { setForm(emptyAppraisalForm()); setError(null); setEditing('new'); }} />
    </View>
  );

  if (q.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={shown}
        keyExtractor={(a) => String(a.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No appraisals" message={search ? 'No staff match your search.' : 'Write the first review.'} />}
        renderItem={({ item: a }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => { setForm(appraisalToForm(a)); setError(null); setEditing(a); }}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{a.staff_member_name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{a.review_period_start} to {a.review_period_end}</Text>
            </View>
            <StatusPill label={`${a.rating} · ${RATING_LABELS[a.rating] ?? ''}`} tone={ratingTone(a.rating)} />
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New appraisal' : 'Edit appraisal'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        {editing === 'new' ? (
          <Select label="Staff member" searchable value={form.staff} onChange={(v) => set('staff', v)} placeholder="Choose staff"
            options={(staff.data ?? []).map((m) => ({ value: m.id, label: `${m.full_name ?? m.name}${m.employee_id ? ` (${m.employee_id})` : ''}` }))} />
        ) : <Text style={styles.name}>{(editing as Appraisal | null)?.staff_member_name}</Text>}
        <DateField label="Period start" value={form.start} onChange={(v) => set('start', v)} />
        <DateField label="Period end" value={form.end} onChange={(v) => set('end', v)} />
        <Select label="Rating" value={form.rating} onChange={(v) => set('rating', v)} placeholder="Choose 1 to 5"
          options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: `${n} · ${RATING_LABELS[n]}` }))} />
        <Input label="Strengths" value={form.strengths} onChangeText={(v) => set('strengths', v)} multiline />
        <Input label="Areas for improvement" value={form.improvements} onChangeText={(v) => set('improvements', v)} multiline />
        <Input label="Goals" value={form.goals} onChangeText={(v) => set('goals', v)} multiline />
        <Input label="Comments" value={form.comments} onChangeText={(v) => set('comments', v)} multiline />
        {editing && editing !== 'new' ? <Button title="Delete appraisal" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
