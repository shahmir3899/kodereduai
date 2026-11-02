import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useStaffLeaveActions, useStaffLeaveBalance, useStaffLeaveList } from '../../hooks/useStaffAdminHr';
import { useLeavePolicyList, useStaffPicker } from '../../hooks/useHrAdmin';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { leaveTone, canCancelLeave } from '../../services/myHr';
import {
  LEAVE_FILTERS, buildApplyPayload, canDecide, emptyApplyForm, leaveDatesLine, staffLabel, staffLeaveErrorMessage, validateApply,
  type ApplyForm, type LeaveFilter, type StaffLeaveApplication,
} from '../../services/staffLeave';
import Card from '../ui/Card';
import Input from '../ui/Input';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import SearchBar from '../ui/SearchBar';
import QueryBoundary from '../ui/QueryBoundary';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Decision = { kind: 'approve' | 'reject'; leave: StaffLeaveApplication };

// Staff leave for admin and principal: see the applications, approve or reject with remarks, cancel,
// and apply on a staff member's behalf. The server tells the staff member by notification. Student
// leave requests (from parents) are a separate list, one tap away.
export default function StaffLeaveScreen() {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<LeaveFilter>('PENDING');
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const list = useStaffLeaveList(filter, term);
  const actions = useStaffLeaveActions();
  const refreshControl = useRefreshControl(list.refetch);

  const [decision, setDecision] = useState<Decision | null>(null);
  const [remarks, setRemarks] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const [applying, setApplying] = useState(false);
  const [form, setForm] = useState<ApplyForm>(emptyApplyForm());
  const [applyError, setApplyError] = useState<string | null>(null);
  const staff = useStaffPicker();
  const policies = useLeavePolicyList();
  const balance = useStaffLeaveBalance(applying ? form.staff : null);
  const activePolicies = (policies.data ?? []).filter((p) => p.is_active);
  const policyBalance = form.policy != null ? (balance.data ?? []).find((b) => b.policy_id === form.policy) : undefined;

  const openDecision = (kind: Decision['kind'], leave: StaffLeaveApplication) => { setRemarks(''); setDecisionError(null); setDecision({ kind, leave }); };

  const submitDecision = async () => {
    if (!decision) return;
    setDecisionError(null);
    try {
      const mutation = decision.kind === 'approve' ? actions.approve : actions.reject;
      await mutation.mutateAsync({ id: decision.leave.id, remarks: remarks.trim() });
      toast.success(decision.kind === 'approve' ? 'Leave approved.' : 'Leave rejected.');
      setDecision(null);
    } catch (e) { setDecisionError(staffLeaveErrorMessage(e, 'Could not save the decision.')); }
  };

  const cancel = async (leave: StaffLeaveApplication) => {
    const ok = await confirm({ title: 'Cancel this leave?', message: `${staffLabel(leave)}: ${leaveDatesLine(leave)}`, confirmLabel: 'Cancel leave', cancelLabel: 'Keep', destructive: true });
    if (!ok) return;
    try { await actions.cancel.mutateAsync(leave.id); toast.success('Leave cancelled.'); }
    catch (e) { toast.error(staffLeaveErrorMessage(e, 'Could not cancel the leave.')); }
  };

  const openApply = () => { setForm(emptyApplyForm()); setApplyError(null); setApplying(true); };

  const submitApply = async () => {
    const problem = validateApply(form);
    if (problem) return setApplyError(problem);
    setApplyError(null);
    try {
      await actions.apply.mutateAsync(buildApplyPayload(form));
      toast.success('Leave application added.');
      setApplying(false);
    } catch (e) { setApplyError(staffLeaveErrorMessage(e, 'Could not add the leave application.')); }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <View style={styles.top}>
          <Button title="+ Apply for staff" size="sm" onPress={openApply} />
          <Button title="Student leave requests" size="sm" variant="outline" onPress={() => router.push('/(admin)/hr/student-leave' as Href)} />
          <Button title="Leave policies" size="sm" variant="outline" onPress={() => router.push('/(admin)/hr/leave-policies' as Href)} />
        </View>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search by staff name or ID..." />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsRow}>
          {LEAVE_FILTERS.map((o) => (
            <TouchableOpacity key={o.value} accessibilityRole="radio" accessibilityState={{ selected: filter === o.value }} onPress={() => setFilter(o.value)}
              style={[styles.chip, filter === o.value && styles.chipOn]}>
              <Text style={[styles.chipText, filter === o.value && styles.chipTextOn]}>{o.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <QueryBoundary query={list} emptyTitle={filter === 'PENDING' ? 'No pending leave' : 'No leave applications'}
          emptyMessage={filter === 'PENDING' ? 'Every application has been dealt with.' : 'Nothing matches this filter.'}>
          {(items) => items.map((a) => (
            <Card key={a.id} style={styles.card}>
              <View style={styles.rowTop}>
                <View style={styles.who}>
                  <Text style={styles.name} numberOfLines={1}>{staffLabel(a)}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{a.leave_policy_name || a.leave_type_display || 'Leave'}{a.staff_employee_id ? `  ·  ${a.staff_employee_id}` : ''}</Text>
                </View>
                <StatusPill label={a.status[0] + a.status.slice(1).toLowerCase()} tone={leaveTone(a.status)} />
              </View>
              <Text style={styles.dates}>{leaveDatesLine(a)}</Text>
              {a.reason ? <Text style={styles.reason}>{a.reason}</Text> : null}
              {a.admin_remarks ? <Text style={styles.remarks}>Remarks: {a.admin_remarks}{a.approved_by_name ? `  (${a.approved_by_name})` : ''}</Text> : null}
              {canDecide(a) || canCancelLeave(a) ? (
                <View style={styles.actions}>
                  {canDecide(a) ? <Button title="Approve" size="sm" onPress={() => openDecision('approve', a)} style={styles.act} /> : null}
                  {canDecide(a) ? <Button title="Reject" size="sm" variant="danger" onPress={() => openDecision('reject', a)} style={styles.act} /> : null}
                  {canCancelLeave(a) ? <Button title="Cancel leave" size="sm" variant="ghost" onPress={() => cancel(a)} /> : null}
                </View>
              ) : null}
            </Card>
          ))}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={decision !== null} title={decision?.kind === 'approve' ? 'Approve leave' : 'Reject leave'} onClose={() => setDecision(null)} onSubmit={submitDecision}
        submitLabel={decision?.kind === 'approve' ? 'Approve' : 'Reject'} busy={actions.approve.isPending || actions.reject.isPending} error={decisionError}>
        {decision ? <Text style={styles.sheetLine}>{staffLabel(decision.leave)}: {leaveDatesLine(decision.leave)}</Text> : null}
        <Input label="Remarks (optional)" value={remarks} onChangeText={setRemarks} multiline style={styles.area} placeholder="Shown to the staff member" />
      </FormSheet>

      <FormSheet visible={applying} title="Apply leave for staff" onClose={() => setApplying(false)} onSubmit={submitApply} submitLabel="Add application"
        busy={actions.apply.isPending} error={applyError}>
        <Select label="Staff member" value={form.staff} searchable onChange={(v) => setForm((f) => ({ ...f, staff: Number(v), policy: null }))}
          options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.full_name }))} placeholder={staff.isLoading ? 'Loading staff...' : 'Choose staff'} />
        <Select label="Type of leave" value={form.policy} onChange={(v) => setForm((f) => ({ ...f, policy: Number(v) }))}
          options={activePolicies.map((p) => ({ value: p.id, label: p.name }))} placeholder={policies.isLoading ? 'Loading...' : 'Choose type'} />
        {policyBalance ? (
          <Text style={styles.balance}>{policyBalance.days_remaining} of {policyBalance.days_allowed} days left this year</Text>
        ) : null}
        <DateField label="From" value={form.start || null} onChange={(v) => setForm((f) => ({ ...f, start: v, end: f.end && f.end < v ? v : f.end }))} />
        <DateField label="To" value={form.end || null} onChange={(v) => setForm((f) => ({ ...f, end: v }))} />
        <Input label="Reason" value={form.reason} onChangeText={(v) => setForm((f) => ({ ...f, reason: v }))} multiline style={styles.area} />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  top: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', marginBottom: Spacing.md },
  chips: { marginBottom: Spacing.md },
  chipsRow: { gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 6, borderRadius: BorderRadius.full, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  chipTextOn: { color: Colors.textInverse },
  card: { marginBottom: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  dates: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.sm, fontWeight: '600' },
  reason: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  remarks: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 4, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md, flexWrap: 'wrap' },
  act: { minWidth: 96 },
  sheetLine: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.xs },
  balance: { fontSize: FontSize.sm, color: Colors.primary, marginBottom: Spacing.sm },
  area: { minHeight: 72, textAlignVertical: 'top' },
});
