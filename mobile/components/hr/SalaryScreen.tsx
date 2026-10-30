import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, Switch, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { usePayrollActions, useSalaryStructures, useStaffOptions } from '../../hooks/usePayroll';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  buildSalaryPayload, emptySalaryForm, salaryPreview, salaryToForm, validateSalary, type PairRow, type SalaryForm, type SalaryStructure,
} from '../../services/payroll';
import { inventoryErrorMessage } from '../../services/inventory';
import { formatMoney } from '../../services/feeCollect';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of SalaryManagementPage.jsx for admin and principal: each staff member's basic salary,
// allowances and deductions. Changing one affects the payslips generated afterwards, not old ones.
export default function SalaryScreen() {
  const toast = useToast();
  const actions = usePayrollActions();
  const q = useSalaryStructures();
  const refreshControl = useRefreshControl(q.refetch) as React.ReactElement<RefreshControlProps>;
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<SalaryStructure | 'new' | null>(null);
  const staff = useStaffOptions(editing === 'new');
  const [form, setForm] = useState<SalaryForm>(emptySalaryForm(todayString()));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof SalaryForm>(k: K, v: SalaryForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const shown = useMemo(() => {
    const t = search.trim().toLowerCase();
    return (q.data ?? []).filter((s) => !t || s.staff_member_name.toLowerCase().includes(t) || (s.staff_employee_id ?? '').toLowerCase().includes(t));
  }, [q.data, search]);

  const have = new Set((q.data ?? []).map((s) => s.staff_member));
  const preview = salaryPreview(form);

  const save = async () => {
    const creating = editing === 'new';
    const problem = validateSalary(form, creating);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildSalaryPayload(form, creating);
      if (creating) await actions.createSalary.mutateAsync(payload);
      else await actions.updateSalary.mutateAsync({ id: (editing as SalaryStructure).id, data: payload });
      toast.success('Salary saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const deactivate = async (s: SalaryStructure) => {
    if (!(await confirm({ title: 'Deactivate this salary?', message: `${s.staff_member_name} will get no payslip from it until a new one is added.`, confirmLabel: 'Deactivate', destructive: true }))) return;
    try {
      await actions.removeSalary.mutateAsync(s.id);
      toast.success('Salary deactivated.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not deactivate.'));
    }
  };

  const header = (
    <View>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search staff..." />
      <Button title="+ Add salary" size="sm" onPress={() => { setForm(emptySalaryForm(todayString())); setError(null); setEditing('new'); }} />
    </View>
  );

  if (q.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={shown}
        keyExtractor={(s) => String(s.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No salaries" message={search ? 'No staff match your search.' : 'Add a salary for each staff member.'} />}
        renderItem={({ item: s }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => { setForm(salaryToForm(s)); setError(null); setEditing(s); }}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{s.staff_member_name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[s.staff_employee_id, s.department_name].filter(Boolean).join('  ·  ') || ' '}</Text>
            </View>
            <View style={styles.right}>
              <Text style={styles.net}>{formatMoney(Number(s.net_salary) || 0)}</Text>
              <Text style={styles.sub}>net per month</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      <FormSheet
        visible={editing !== null} title={editing === 'new' ? 'Add salary' : 'Edit salary'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createSalary.isPending || actions.updateSalary.isPending} error={error}
      >
        {editing === 'new' ? (
          <Select
            label="Staff member" searchable value={form.staff} onChange={(v) => set('staff', v)} placeholder="Choose staff"
            options={(staff.data ?? []).filter((m) => !have.has(m.id)).map((m) => ({ value: m.id, label: `${m.full_name ?? m.name}${m.employee_id ? ` (${m.employee_id})` : ''}` }))}
          />
        ) : <Text style={styles.name}>{(editing as SalaryStructure | null)?.staff_member_name}</Text>}
        <Input label="Basic salary" value={form.basic} onChangeText={(v) => set('basic', v)} keyboardType="decimal-pad" />
        <PairEditor title="Allowances" rows={form.allowances} onChange={(r) => set('allowances', r)} />
        <PairEditor title="Deductions" rows={form.deductions} onChange={(r) => set('deductions', r)} />
        <View style={styles.preview}>
          <Text style={styles.sub}>Gross {formatMoney(preview.gross)} · Deductions {formatMoney(preview.deductions)}</Text>
          <Text style={styles.net}>Net {formatMoney(preview.net)}</Text>
        </View>
        <DateField label="Effective from" value={form.effectiveFrom} onChange={(v) => set('effectiveFrom', v)} />
        <View style={styles.toggle}>
          <Text style={styles.name}>Active</Text>
          <Switch value={form.isActive} onValueChange={(v) => set('isActive', v)} accessibilityLabel="Salary is active" />
        </View>
        {editing && editing !== 'new' ? <Button title="Deactivate salary" variant="danger" size="sm" onPress={() => deactivate(editing)} /> : null}
      </FormSheet>
    </View>
  );
}

function PairEditor({ title, rows, onChange }: { title: string; rows: PairRow[]; onChange: (rows: PairRow[]) => void }) {
  const update = (i: number, patch: Partial<PairRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <View>
      <Text style={styles.pairTitle}>{title}</Text>
      {rows.map((r, i) => (
        <View key={i} style={styles.pair}>
          <View style={styles.pairName}><Input value={r.key} onChangeText={(v) => update(i, { key: v })} placeholder="Name, e.g. House rent" /></View>
          <View style={styles.pairAmount}><Input value={r.amount} onChangeText={(v) => update(i, { amount: v })} placeholder="0" keyboardType="decimal-pad" /></View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove ${r.key || 'row'}`} style={styles.pairRemove} onPress={() => onChange(rows.filter((_, idx) => idx !== i))}>
            <Text style={styles.pairRemoveText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
      <Button title={`+ Add to ${title.toLowerCase()}`} variant="ghost" size="sm" onPress={() => onChange([...rows, { key: '', amount: '' }])} />
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
  right: { alignItems: 'flex-end' },
  net: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  preview: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  pairTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginTop: Spacing.sm },
  pair: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  pairName: { flex: 3 },
  pairAmount: { flex: 2 },
  pairRemove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  pairRemoveText: { color: Colors.error, fontSize: FontSize.lg },
});
