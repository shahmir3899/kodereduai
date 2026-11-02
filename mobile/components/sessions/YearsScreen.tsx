import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAllTerms, useManagedYears, useSessionActions } from '../../hooks/useAcademicSessions';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildYearPayload, emptyYearForm, formatDay, setCurrentMessage, validateYear, warningsToConfirm, yearStatus, yearToForm, yearWarnings,
  type ManagedYear, type YearForm,
} from '../../services/academicSessions';
import { inventoryErrorMessage } from '../../services/inventory';
import { schoolToday } from '../../services/schoolTime';
import Button from '../ui/Button';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import YearTimeline from './YearTimeline';
import { coverageSummary } from '../../services/yearTimeline';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of the web Academic Sessions page: academic years with their terms, add, edit, set as current and
// delete. Admin and principal only; the server refuses everyone else.
export default function YearsScreen() {
  const router = useRouter();
  const toast = useToast();
  const years = useManagedYears();
  const terms = useAllTerms();
  const actions = useSessionActions();
  const refreshControl = useRefreshControl(async () => { await Promise.all([years.refetch(), terms.refetch()]); });
  const [editing, setEditing] = useState<ManagedYear | 'new' | null>(null);
  const [form, setForm] = useState<YearForm>(emptyYearForm());
  const [error, setError] = useState<string | null>(null);
  // Warnings the server raised that the form could not see; saving again with them accepted sends confirm_warnings.
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);
  const today = schoolToday();
  const list = years.data ?? [];

  const others = useMemo(() => list.filter((y) => editing === 'new' || y.id !== (editing as ManagedYear | null)?.id), [list, editing]);
  const warnings = editing ? [...new Set([...yearWarnings(form, others), ...serverWarnings])] : [];
  const set = <K extends keyof YearForm>(k: K, v: YearForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setServerWarnings([]); };

  const open = (y: ManagedYear | 'new') => {
    setForm(y === 'new' ? emptyYearForm() : yearToForm(y));
    setError(null);
    setServerWarnings([]);
    setEditing(y);
  };

  const save = async () => {
    const problem = validateYear(form);
    if (problem) return setError(problem);
    setError(null);
    // Overlap and odd length are warnings the admin can accept: the button then reads "Save anyway".
    const payload = buildYearPayload(form, warnings.length > 0);
    try {
      if (editing === 'new') await actions.createYear.mutateAsync(payload);
      else await actions.updateYear.mutateAsync({ id: (editing as ManagedYear).id, data: payload });
      toast.success('Academic year saved.');
      setEditing(null);
    } catch (e) {
      const asked = warningsToConfirm(e);
      if (asked) setServerWarnings(asked);
      else setError(inventoryErrorMessage(e, 'Could not save the academic year.'));
    }
  };

  const setCurrent = async (y: ManagedYear) => {
    if (!(await confirm({ title: 'Set as current', message: setCurrentMessage(y, today), confirmLabel: 'Set as current' }))) return;
    try {
      // The dialog the admin just accepted is the confirmation the server asks for on a past or future year.
      await actions.setCurrent.mutateAsync({ id: y.id, data: { confirm_warnings: true } });
      toast.success('Current academic year changed.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not set the current year.'));
    }
  };

  const remove = async (y: ManagedYear) => {
    if (!(await confirm({ title: 'Delete year', message: `Delete "${y.name}"? This cannot be undone.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteYear.mutateAsync(y.id);
      toast.success('Academic year deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the year.'));
    }
  };

  if (years.isLoading) return <Skeleton />;
  if (years.isError && !years.data) return <ErrorState error={years.error} onRetry={() => years.refetch()} />;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ Add academic year" size="sm" onPress={() => open('new')} />
        {list.length === 0 ? <EmptyState title="No academic years" message="Add the first academic year, then its terms." /> : list.map((y) => {
          const status = yearStatus(y, today);
          const yearTerms = (terms.data ?? []).filter((t) => t.academic_year === y.id);
          return (
            <View key={y.id} style={[styles.card, y.is_current && styles.cardCurrent]}>
              <View style={styles.head}>
                <Text style={styles.name} numberOfLines={1}>{y.name}</Text>
                {status ? <StatusPill label={status.label} tone={status.tone} /> : null}
              </View>
              <Text style={styles.sub}>{formatDay(y.start_date)} - {formatDay(y.end_date)}</Text>
              <YearTimeline compact year={y} terms={yearTerms} today={today} />
              <Text style={styles.sub}>{`${coverageSummary(y, yearTerms)}  ·  ${y.enrollment_count ?? 0} enrolled`}</Text>
              <View style={styles.actions}>
                <Button title="Terms" size="sm" style={styles.action} onPress={() => router.push({ pathname: '/(admin)/session-terms', params: { yearId: String(y.id) } } as Href)} />
                <Button title="Edit" size="sm" variant="outline" style={styles.action} onPress={() => open(y)} />
                {!y.is_current ? <Button title="Set current" size="sm" variant="outline" style={styles.action} onPress={() => setCurrent(y)} /> : null}
              </View>
            </View>
          );
        })}
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'Add academic year' : 'Edit academic year'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel={warnings.length ? 'Save anyway' : editing === 'new' ? 'Create' : 'Update'} busy={actions.createYear.isPending || actions.updateYear.isPending} error={error}>
        {warnings.length ? (
          <View style={styles.warn}>
            {warnings.map((w) => <Text key={w} style={styles.warnText}>{w}</Text>)}
            <Text style={styles.warnText}>You can still save it.</Text>
          </View>
        ) : null}
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} placeholder="e.g. 2025-2026" />
        <DateField label="Start date" value={form.startDate} onChange={(v) => set('startDate', v)} />
        <DateField label="End date" value={form.endDate} onChange={(v) => set('endDate', v)} />
        {editing && editing !== 'new' ? <Button title="Delete year" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.xs, borderWidth: 1, borderColor: 'transparent' },
  cardCurrent: { borderColor: Colors.success },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  action: { flex: 1 },
  warn: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.sm, padding: Spacing.md, gap: 4 },
  warnText: { fontSize: FontSize.sm, color: Colors.warningText },
});
