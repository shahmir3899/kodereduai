import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, type RefreshControlProps } from 'react-native';
import { useActiveAllocations, useGatePasses, useHostelActions } from '../../hooks/useHostel';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  PASS_ACTION_DONE, PASS_ACTION_LABEL, PASS_FILTERS, PASS_STATUS_LABEL, PASS_STATUS_TONE, PASS_TYPES, buildPassPayload, emptyPassForm, passActions, passLine,
  passRemarkPayload, validatePass, type GatePassRow, type PassAction, type PassForm,
} from '../../services/hostel';
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
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Gate passes: make one for a student who has a room, approve or reject it (with a remark), check the
// student out and mark them back. Admin and principal only. The server calls a checked-out pass USED.
export default function GatePassesScreen() {
  const toast = useToast();
  const actions = useHostelActions();
  const [filter, setFilter] = useState('');
  const query = useGatePasses(filter);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [busy, setBusy] = useState<number | null>(null);
  const [remark, setRemark] = useState<{ pass: GatePassRow; action: 'approve' | 'reject'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<PassForm>(emptyPassForm(todayString()));
  const [error, setError] = useState<string | null>(null);
  const allocations = useActiveAllocations(adding);
  const set = <K extends keyof PassForm>(k: K, v: PassForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const run = async (p: GatePassRow, action: PassAction, data?: Record<string, unknown>) => {
    setBusy(p.id);
    try {
      await actions.passAction.mutateAsync({ id: p.id, action, data });
      toast.success(`Gate pass ${PASS_ACTION_DONE[action]}.`);
      return true;
    } catch (e) { toast.error(inventoryErrorMessage(e, `Could not ${action} the gate pass.`)); return false; }
    finally { setBusy(null); }
  };

  const act = async (p: GatePassRow, action: PassAction) => {
    if (action === 'approve' || action === 'reject') return setRemark({ pass: p, action, text: '' });
    const ok = await confirm({ title: `${PASS_ACTION_LABEL[action]}?`, message: `${p.student_name}, ${passLine(p)}.`, confirmLabel: PASS_ACTION_LABEL[action] });
    if (ok) await run(p, action);
  };

  const submitRemark = async () => {
    if (!remark) return;
    if (await run(remark.pass, remark.action, passRemarkPayload(remark.text))) setRemark(null);
  };

  const open = () => { setForm(emptyPassForm(todayString())); setError(null); setAdding(true); };

  const create = async () => {
    const problem = validatePass(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.createPass.mutateAsync(buildPassPayload(form));
      toast.success('Gate pass created.');
      setAdding(false);
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not create the gate pass.')); }
  };

  const header = (
    <View style={styles.header}>
      <Button title="+ New gate pass" size="sm" onPress={open} />
      <SegmentedTabs tabs={PASS_FILTERS} value={filter} onChange={setFilter} scrollable />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton variant="list" /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(p) => String(p.id)}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No gate passes" message="No gate pass matches this view." />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: p }) => (
          <Card style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.name}>{p.student_name}</Text>
              <StatusPill label={PASS_STATUS_LABEL[p.status] ?? p.status_display ?? p.status} tone={PASS_STATUS_TONE[p.status] ?? 'neutral'} />
            </View>
            <Text style={styles.when}>{`${p.pass_type_display ?? p.pass_type}  ·  ${passLine(p)}`}</Text>
            <Text style={styles.sub}>{`To ${p.going_to}${p.contact_at_destination ? `  ·  ${p.contact_at_destination}` : ''}`}</Text>
            <Text style={styles.sub}>{p.reason}</Text>
            {p.remarks ? <Text style={styles.sub}>{`Remark: ${p.remarks}`}</Text> : null}
            {passActions(p.status).length > 0 ? (
              <View style={styles.actions}>
                {passActions(p.status).map((a) => (
                  <Button key={a} title={PASS_ACTION_LABEL[a]} size="sm" variant={a === 'reject' ? 'danger' : a === 'approve' ? 'primary' : 'secondary'}
                    style={styles.flex} loading={busy === p.id} disabled={busy !== null} onPress={() => act(p, a)} />
                ))}
              </View>
            ) : null}
          </Card>
        )}
      />

      <FormSheet visible={remark !== null} title={remark?.action === 'approve' ? 'Approve gate pass' : 'Reject gate pass'} onClose={() => setRemark(null)} onSubmit={submitRemark}
        submitLabel={remark?.action === 'approve' ? 'Approve' : 'Reject'} busy={actions.passAction.isPending}>
        <Text style={styles.sub}>{remark ? `${remark.pass.student_name}, ${passLine(remark.pass)}.` : ''}</Text>
        <Input label="Remark (optional)" value={remark?.text ?? ''} onChangeText={(t) => setRemark((r) => (r ? { ...r, text: t } : r))} multiline />
      </FormSheet>

      <FormSheet visible={adding} title="New gate pass" onClose={() => setAdding(false)} onSubmit={create} submitLabel="Create" busy={actions.createPass.isPending} error={error}>
        <Select<number> label="Student" searchable value={form.allocation} placeholder={allocations.isLoading ? 'Loading students...' : 'Choose a student with a room'}
          options={(allocations.data ?? []).map((a) => ({ value: a.id, label: `${a.student_name} (${a.hostel_name}, room ${a.room_number})` }))}
          onChange={(v) => { const a = (allocations.data ?? []).find((x) => x.id === Number(v)); setForm((f) => ({ ...f, allocation: Number(v), student: a?.student ?? null })); }} />
        <Select label="Type" value={form.passType} onChange={(v) => set('passType', String(v))} options={PASS_TYPES} />
        <Input label="Going to" value={form.goingTo} onChangeText={(v) => set('goingTo', v)} />
        <Input label="Contact there (optional)" value={form.contact} onChangeText={(v) => set('contact', v)} keyboardType="phone-pad" />
        <Input label="Reason" value={form.reason} onChangeText={(v) => set('reason', v)} multiline />
        <DateField label="Leaves on" value={form.departDate} onChange={(v) => set('departDate', v)} />
        <Input label="Leaves at (24-hour, HH:MM)" value={form.departTime} onChangeText={(v) => set('departTime', v)} placeholder="08:00" />
        <DateField label="Returns on" value={form.returnDate} onChange={(v) => set('returnDate', v)} />
        <Input label="Returns at (24-hour, HH:MM)" value={form.returnTime} onChangeText={(v) => set('returnTime', v)} placeholder="18:00" />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  card: { gap: Spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  when: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500' },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  flex: { flex: 1 },
});
