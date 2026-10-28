import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import {
  LEAVE_STATUSES, buildLeavePayload, canCancelLeave, emptyLeaveForm, filterLeave, leaveDays, leaveErrorMessage,
  leaveTone, sortLeave, usedPercent, validateLeave, type LeaveForm,
} from '../../services/myHr';
import { useLeaveActions, useLeavePolicies, useMyLeaveApplications, useMyLeaveBalance } from '../../hooks/useMyHr';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
const label = (s: string) => s[0] + s.slice(1).toLowerCase();

// Self-service leave: see your balance, apply, and cancel. Approving is for admins and is not here.
// Needs a connection to apply or cancel.
export default function MyLeaveScreen() {
  const toast = useToast();
  const apps = useMyLeaveApplications();
  const policies = useLeavePolicies();
  const balance = useMyLeaveBalance(apps.data ?? [], apps.isSuccess);
  const actions = useLeaveActions();
  const refreshControl = useRefreshControl(apps.refetch, policies.refetch, balance.refetch);

  const [tab, setTab] = useState<Tab>('ALL');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LeaveForm>(emptyLeaveForm());
  const [error, setError] = useState<string | null>(null);

  const shown = useMemo(() => sortLeave(filterLeave(apps.data ?? [], tab === 'ALL' ? '' : tab)), [apps.data, tab]);
  const days = leaveDays(form.start, form.end);

  const submit = async () => {
    const problem = validateLeave(form);
    if (problem) {
      setError(problem);
      return;
    }
    try {
      await actions.apply.mutateAsync(buildLeavePayload(form));
      toast.success('Leave application submitted.');
      setOpen(false);
      setForm(emptyLeaveForm());
    } catch (e: any) {
      setError(e?.response ? leaveErrorMessage(e.response.data) : 'No connection. Check your internet and try again.');
    }
  };

  const cancel = async (id: number) => {
    const yes = await confirm({ title: 'Cancel this leave?', message: 'The application will be marked cancelled.', confirmLabel: 'Cancel leave', cancelLabel: 'Keep', destructive: true });
    if (!yes) return;
    try {
      await actions.cancel.mutateAsync(id);
      toast.success('Leave cancelled.');
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || 'Failed to cancel leave');
    }
  };

  if (apps.isLoading) return <Skeleton />;
  if (apps.isError && !apps.data) return <ErrorState error={apps.error} onRetry={() => apps.refetch()} />;

  const header = (
    <View>
      {(balance.data ?? []).length > 0 ? (
        <>
          <Text style={styles.section}>Leave balance (this year)</Text>
          {(balance.data ?? []).map((b) => (
            <View key={b.policy_id} style={styles.balance}>
              <View style={styles.balanceTop}>
                <Text style={styles.balanceName}>{b.policy_name}</Text>
                <Text style={styles.balanceLeft}>{b.days_remaining} left</Text>
              </View>
              <View style={styles.bar}><View style={[styles.barFill, { width: `${usedPercent(b)}%` }]} /></View>
              <Text style={styles.balanceSub}>{b.days_used} of {b.days_allowed} days used</Text>
            </View>
          ))}
        </>
      ) : null}
      <Text style={styles.section}>My applications</Text>
      <SegmentedTabs<Tab> value={tab} onChange={setTab}
        tabs={[{ value: 'ALL', label: 'All' }, ...LEAVE_STATUSES.map((s) => ({ value: s, label: label(s) }))]} />
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={shown}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No leave applications" message="Tap Apply for leave to send one." />}
        renderItem={({ item: a }) => (
          <View style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.type}>{a.leave_type_display || a.leave_policy_name || 'Leave'}</Text>
              <StatusPill label={a.status} tone={leaveTone(a.status)} />
            </View>
            <Text style={styles.dates}>{a.start_date} to {a.end_date}{a.total_days ? `  ·  ${a.total_days} day${a.total_days === 1 ? '' : 's'}` : ''}</Text>
            {a.reason ? <Text style={styles.reason}>{a.reason}</Text> : null}
            {a.admin_remarks ? <Text style={styles.remarks}>Admin: {a.admin_remarks}</Text> : null}
            {canCancelLeave(a) ? (
              <TouchableOpacity onPress={() => cancel(a.id)} disabled={actions.cancel.isPending}>
                <Text style={styles.cancel}>Cancel</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      />
      <View style={styles.footer}>
        <Button title="Apply for leave" onPress={() => { setForm(emptyLeaveForm()); setError(null); setOpen(true); }} fullWidth size="lg" />
      </View>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Apply for leave">
        <ScrollView contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
          <Select label="Leave type *" value={form.policy}
            options={(policies.data ?? []).map((p) => ({ value: p.id, label: p.days_allowed ? `${p.name} (${p.days_allowed} days)` : p.name }))}
            onChange={(v) => { setForm({ ...form, policy: v }); setError(null); }}
            placeholder={policies.isLoading ? 'Loading...' : 'Select leave type'} />
          <DateField label="First day *" value={form.start || null} onChange={(v) => { setForm({ ...form, start: v, end: form.end && form.end < v ? v : form.end }); setError(null); }} />
          <DateField label="Last day *" value={form.end || null} onChange={(v) => { setForm({ ...form, end: v }); setError(null); }} />
          {days ? <Text style={styles.days}>{days} day{days === 1 ? '' : 's'}</Text> : null}
          <Text style={styles.label}>Reason *</Text>
          <TextInput style={[styles.input, styles.multi]} multiline value={form.reason} placeholder="Why do you need leave?"
            placeholderTextColor={Colors.textTertiary} onChangeText={(t) => { setForm({ ...form, reason: t }); setError(null); }} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Submit application" onPress={submit} loading={actions.apply.isPending} fullWidth size="lg" />
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 100 },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm, marginTop: Spacing.xs },
  balance: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  balanceTop: { flexDirection: 'row', justifyContent: 'space-between' },
  balanceName: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  balanceLeft: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.success },
  bar: { height: 6, borderRadius: 3, backgroundColor: Colors.border, marginVertical: Spacing.xs, overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: Colors.primary },
  balanceSub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  type: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  dates: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  reason: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.xs },
  remarks: { fontSize: FontSize.xs, color: Colors.textSecondary, fontStyle: 'italic', marginTop: Spacing.xs },
  cancel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.error, marginTop: Spacing.sm },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  sheet: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  days: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600', marginTop: -Spacing.sm, marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  input: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: FontSize.md, color: Colors.text, marginBottom: Spacing.lg },
  multi: { minHeight: 80, textAlignVertical: 'top' },
  error: { fontSize: FontSize.sm, color: Colors.error, marginBottom: Spacing.md },
});
