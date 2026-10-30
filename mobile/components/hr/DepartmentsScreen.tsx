import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useDepartments, useDesignations, useHrActions } from '../../hooks/useHrAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildDepartmentPayload, buildDesignationPayload, departmentToForm, designationToForm, emptyDepartmentForm, emptyDesignationForm,
  validateDepartment, validateDesignation, type Department, type DepartmentForm, type Designation, type DesignationForm,
} from '../../services/hrAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import SegmentedTabs from '../ui/SegmentedTabs';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'departments' | 'designations';

// Departments and the designations (job titles) under them. Admin and principal only. A department
// or designation that people still hold cannot be deleted; turn it off instead.
export default function DepartmentsScreen() {
  const [tab, setTab] = useState<Tab>('departments');
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedTabs<Tab> tabs={[{ value: 'departments', label: 'Departments' }, { value: 'designations', label: 'Designations' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'departments' ? <DepartmentsTab /> : <DesignationsTab />}
    </View>
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

function DepartmentsTab() {
  const toast = useToast();
  const q = useDepartments();
  const actions = useHrActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);
  const [form, setForm] = useState<DepartmentForm>(emptyDepartmentForm());
  const [error, setError] = useState<string | null>(null);

  const open = (d: Department | 'new') => { setForm(d === 'new' ? emptyDepartmentForm() : departmentToForm(d)); setError(null); setEditing(d); };

  const save = async () => {
    const problem = validateDepartment(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildDepartmentPayload(form);
      if (editing === 'new') await actions.createDepartment.mutateAsync(payload);
      else await actions.updateDepartment.mutateAsync({ id: (editing as Department).id, data: payload });
      toast.success('Department saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (d: Department) => {
    if (!(await confirm({ title: 'Delete department?', message: d.staff_count ? `${d.name} still has ${d.staff_count} staff. Turn it off instead if you only want to stop using it.` : d.name, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteDepartment.mutateAsync(d.id);
      toast.success('Department deleted.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the department. It may still be in use.')); }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ Add department" size="sm" onPress={() => open('new')} />
        <QueryBoundary query={q} emptyTitle="No departments" emptyMessage="Add departments such as Science, Admin or Transport.">
          {(list) => list.map((d) => (
            <TouchableOpacity key={d.id} accessibilityRole="button" accessibilityLabel={`${d.name}, ${d.staff_count ?? 0} staff. Edit`} style={styles.row} onPress={() => open(d)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{`${d.staff_count ?? 0} staff${d.description ? `  ·  ${d.description}` : ''}`}</Text>
              </View>
              {!d.is_active ? <StatusPill label="Off" tone="neutral" /> : null}
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>
      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New department' : 'Edit department'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createDepartment.isPending || actions.updateDepartment.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
        <Input label="Description (optional)" value={form.description} onChangeText={(v) => setForm((f) => ({ ...f, description: v }))} />
        <ToggleRow label="Active" value={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
        {editing && editing !== 'new' ? <Button title="Delete department" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
  );
}

function DesignationsTab() {
  const toast = useToast();
  const q = useDesignations();
  const departments = useDepartments();
  const actions = useHrActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<Designation | 'new' | null>(null);
  const [form, setForm] = useState<DesignationForm>(emptyDesignationForm());
  const [error, setError] = useState<string | null>(null);

  const open = (d: Designation | 'new') => { setForm(d === 'new' ? emptyDesignationForm() : designationToForm(d)); setError(null); setEditing(d); };

  const save = async () => {
    const problem = validateDesignation(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildDesignationPayload(form);
      if (editing === 'new') await actions.createDesignation.mutateAsync(payload);
      else await actions.updateDesignation.mutateAsync({ id: (editing as Designation).id, data: payload });
      toast.success('Designation saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (d: Designation) => {
    if (!(await confirm({ title: 'Delete designation?', message: d.name, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deleteDesignation.mutateAsync(d.id);
      toast.success('Designation deleted.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the designation. It may still be in use.')); }
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ Add designation" size="sm" onPress={() => open('new')} />
        <QueryBoundary query={q} emptyTitle="No designations" emptyMessage="Add job titles such as Teacher, Clerk or Principal.">
          {(list) => list.map((d) => (
            <TouchableOpacity key={d.id} accessibilityRole="button" accessibilityLabel={`${d.name}. Edit`} style={styles.row} onPress={() => open(d)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{d.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{d.department_name || 'Any department'}</Text>
              </View>
              {!d.is_active ? <StatusPill label="Off" tone="neutral" /> : null}
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>
      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New designation' : 'Edit designation'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createDesignation.isPending || actions.updateDesignation.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
        <Select<string | number> label="Department (optional)" searchable value={form.department} placeholder="Any department"
          onChange={(v) => setForm((f) => ({ ...f, department: v === '' ? null : Number(v) }))}
          options={[{ value: '', label: 'Any department' }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
        <ToggleRow label="Active" value={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
        {editing && editing !== 'new' ? <Button title="Delete designation" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  tabs: { padding: Spacing.lg, paddingBottom: 0 },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 56 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text, flex: 1, marginRight: Spacing.md },
});
