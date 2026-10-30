import React, { useState } from 'react';
import { View, Text, FlatList, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useChildren, useLeaveActions, useLeaveRequests } from '../../hooks/useParent';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { apiErrorMessage, canCancelLeave, leaveBody, leaveDays, LEAVE_TONE, validateLeave, type LeaveForm } from '../../services/parentPortal';
import { todayString } from '../../services/attendanceEntry';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import BottomSheet from '../ui/BottomSheet';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { saveFailureMessage } from '../../services/errorKind';

const blank = (student: number | null): LeaveForm => ({ student, start: todayString(), end: todayString(), reason: '', link: '' });

// Leave applications for the parent's children: apply, see the school's answer, withdraw a pending one.
export default function LeaveScreen() {
  const toast = useToast();
  const children = useChildren();
  const query = useLeaveRequests();
  const { create, cancel } = useLeaveActions();
  const refreshControl = useRefreshControl(query.refetch);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<LeaveForm>(blank(null));

  const kids = children.data ?? [];
  const start = () => { setForm(blank(kids.length === 1 ? kids[0].student : null)); setOpen(true); };

  const submit = () => {
    const problem = validateLeave(form);
    if (problem) { toast.error(problem); return; }
    create.mutateAsync(leaveBody(form))
      .then(() => { toast.success('Leave request sent.'); setOpen(false); })
      .catch((e: any) => toast.error(e?.response ? apiErrorMessage(e?.response?.data, 'Could not send the request.') : saveFailureMessage(e)));
  };

  const withdraw = async (id: number) => {
    const yes = await confirm({ title: 'Withdraw this request?', message: 'The school will no longer see it as pending.', confirmLabel: 'Withdraw', destructive: true });
    if (yes) cancel.mutateAsync(id).then(() => toast.success('Request withdrawn.')).catch((e: any) => toast.error(e?.response ? apiErrorMessage(e?.response?.data, 'Could not withdraw the request.') : saveFailureMessage(e)));
  };

  if (query.isLoading || children.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const rows = [...(query.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(l) => String(l.id)}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListEmptyComponent={<EmptyState title="No leave requests" message="Tell the school when your child will be absent." />}
        renderItem={({ item: l }) => (
          <View style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.name} numberOfLines={1}>{l.student_name}</Text>
              <StatusPill label={l.status[0] + l.status.slice(1).toLowerCase()} tone={LEAVE_TONE[l.status]} />
            </View>
            <Text style={styles.meta}>
              {l.start_date === l.end_date ? l.start_date : `${l.start_date} to ${l.end_date}`}  ·  {leaveDays(l.start_date, l.end_date)} day{leaveDays(l.start_date, l.end_date) === 1 ? '' : 's'}
            </Text>
            <Text style={styles.reason}>{l.reason}</Text>
            {l.review_note ? <Text style={styles.meta}>School: {l.review_note}{l.reviewed_by_name ? ` (${l.reviewed_by_name})` : ''}</Text> : null}
            {canCancelLeave(l) ? (
              <TouchableOpacity accessibilityRole="button" onPress={() => withdraw(l.id)}><Text style={styles.withdraw}>Withdraw</Text></TouchableOpacity>
            ) : null}
          </View>
        )}
      />
      <View style={styles.footer}>
        <Button title="Apply for leave" onPress={start} fullWidth size="lg" disabled={kids.length === 0} />
      </View>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title="Apply for leave">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: Spacing.md }}>
          <Select label="Child" value={form.student} options={kids.map((k) => ({ value: k.student, label: k.student_name }))}
            onChange={(v) => setForm({ ...form, student: v })} placeholder="Choose a child" />
          <DateField label="From" value={form.start} onChange={(v) => setForm({ ...form, start: v, end: form.end < v ? v : form.end })} />
          <DateField label="To" value={form.end} onChange={(v) => setForm({ ...form, end: v })} />
          <Input label="Reason" value={form.reason} onChangeText={(v) => setForm({ ...form, reason: v })} multiline numberOfLines={3} style={{ minHeight: 80, textAlignVertical: 'top' }} />
          <Input label="Document link (optional)" value={form.link} onChangeText={(v) => setForm({ ...form, link: v })} autoCapitalize="none" keyboardType="url" />
          <Button title="Send request" onPress={submit} loading={create.isPending} fullWidth size="lg" />
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 100 },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  reason: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.xs },
  withdraw: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.error, marginTop: Spacing.sm },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
});
