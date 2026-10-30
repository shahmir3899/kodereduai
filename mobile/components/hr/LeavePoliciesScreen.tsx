import React, { useState } from 'react';
import { View, Text, ScrollView, Switch, TouchableOpacity, StyleSheet } from 'react-native';
import { useHrActions, useLeavePolicyList } from '../../hooks/useHrAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildLeavePolicyPayload, emptyLeavePolicyForm, LEAVE_TYPES, leavePolicySubtitle, leavePolicyToForm, validateLeavePolicy,
  type LeavePolicy, type LeavePolicyForm,
} from '../../services/hrAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// How many days of each kind of leave staff get a year. Admin and principal only. A policy that has
// leave applications against it cannot be deleted; turn it off instead.
export default function LeavePoliciesScreen() {
  const toast = useToast();
  const q = useLeavePolicyList();
  const actions = useHrActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<LeavePolicy | 'new' | null>(null);
  const [form, setForm] = useState<LeavePolicyForm>(emptyLeavePolicyForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof LeavePolicyForm>(k: K, v: LeavePolicyForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const open = (p: LeavePolicy | 'new') => { setForm(p === 'new' ? emptyLeavePolicyForm() : leavePolicyToForm(p)); setError(null); setEditing(p); };

  const save = async () => {
    const problem = validateLeavePolicy(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildLeavePolicyPayload(form);
      if (editing === 'new') await actions.createPolicy.mutateAsync(payload);
      else await actions.updatePolicy.mutateAsync({ id: (editing as LeavePolicy).id, data: payload });
      toast.success('Leave policy saved.');
      setEditing(null);
    } catch (e) { setError(inventoryErrorMessage(e)); }
  };

  const remove = async (p: LeavePolicy) => {
    if (!(await confirm({ title: 'Delete leave policy?', message: p.applications_count ? `${p.name} has ${p.applications_count} leave application(s). Turn it off instead.` : p.name, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.deletePolicy.mutateAsync(p.id);
      toast.success('Leave policy deleted.');
      setEditing(null);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not delete the policy. It may be in use.')); }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Button title="+ Add leave policy" size="sm" onPress={() => open('new')} />
        <QueryBoundary query={q} emptyTitle="No leave policies" emptyMessage="Add the kinds of leave staff can apply for, with their yearly days.">
          {(list) => list.map((p) => (
            <TouchableOpacity key={p.id} accessibilityRole="button" accessibilityLabel={`${p.name}. Edit`} style={styles.row} onPress={() => open(p)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                <Text style={styles.sub} numberOfLines={2}>{leavePolicySubtitle(p)}</Text>
              </View>
              {!p.is_active ? <StatusPill label="Off" tone="neutral" /> : null}
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>
      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New leave policy' : 'Edit leave policy'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.createPolicy.isPending || actions.updatePolicy.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Annual leave" />
        <Select label="Type" value={form.leaveType} onChange={(v) => set('leaveType', String(v))} options={LEAVE_TYPES} />
        <Input label="Days allowed per year" value={form.days} onChangeText={(v) => set('days', v.replace(/\D/g, ''))} keyboardType="number-pad" />
        <View style={styles.toggle}>
          <Text style={styles.toggleLabel}>Unused days carry forward</Text>
          <Switch value={form.carryForward} onValueChange={(v) => set('carryForward', v)} accessibilityLabel="Unused days carry forward" />
        </View>
        <View style={styles.toggle}>
          <Text style={styles.toggleLabel}>Active</Text>
          <Switch value={form.isActive} onValueChange={(v) => set('isActive', v)} accessibilityLabel="Active" />
        </View>
        {editing && editing !== 'new' ? <Button title="Delete leave policy" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 56 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text, flex: 1, marginRight: Spacing.md },
});
