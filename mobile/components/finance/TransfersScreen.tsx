import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAccountOptions, useTransferActions, useTransfers } from '../../hooks/useAccountsAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  buildTransferPayload, emptyTransferForm, fromAccountOptions, toAccountOptions, transferConfirmText, transferTitle, transferToForm,
  validateTransfer, type TransferForm, type TransferRow,
} from '../../services/accountsAdmin';
import { formatMoney } from '../../services/feeCollect';
import { inventoryErrorMessage } from '../../services/inventory';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import QueryBoundary from '../ui/QueryBoundary';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Money moved between the school's accounts. Admin and principal only. Recording and deleting both
// change balances, so each asks first; a closed month refuses the change and the server says why.
export default function TransfersScreen() {
  const toast = useToast();
  const { isPrincipal } = useAuth();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useTransfers(from, to);
  const accountsQ = useAccountOptions();
  const actions = useTransferActions();
  const refreshControl = useRefreshControl(q.refetch);
  const accounts = useMemo(() => accountsQ.data ?? [], [accountsQ.data]);
  const [editing, setEditing] = useState<TransferRow | 'new' | null>(null);
  const [form, setForm] = useState<TransferForm>(emptyTransferForm(todayString()));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof TransferForm>(k: K, v: TransferForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const open = (t: TransferRow | 'new') => {
    setForm(t === 'new' ? emptyTransferForm(todayString()) : transferToForm(t));
    setError(null);
    setEditing(t);
  };

  const save = async () => {
    const problem = validateTransfer(form);
    if (problem) return setError(problem);
    setError(null);
    if (!(await confirm({ title: editing === 'new' ? 'Record this transfer?' : 'Save the changes?', message: transferConfirmText(form, accounts), confirmLabel: 'Save' }))) return;
    try {
      const payload = buildTransferPayload(form);
      if (editing === 'new') await actions.create.mutateAsync(payload);
      else await actions.update.mutateAsync({ id: (editing as TransferRow).id, data: payload });
      toast.success('Transfer saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const remove = async (t: TransferRow) => {
    if (!(await confirm({ title: 'Delete this transfer?', message: `${transferTitle(t)}, ${formatMoney(Number(t.amount))}. Both balances change back. This cannot be undone.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(t.id);
      toast.success('Transfer deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the transfer.'));
    }
  };

  const fromOptions = fromAccountOptions(accounts, isPrincipal);
  const toOptions = toAccountOptions(accounts);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl} keyboardShouldPersistTaps="handled">
        <Button title="+ Record a transfer" size="sm" onPress={() => open('new')} />
        <View style={styles.dates}>
          <View style={styles.half}><DateField label="From date" value={from} onChange={setFrom} /></View>
          <View style={styles.half}><DateField label="To date" value={to} onChange={setTo} /></View>
        </View>
        {from || to ? <Button title="Clear dates" size="sm" variant="ghost" onPress={() => { setFrom(''); setTo(''); }} /> : null}
        <QueryBoundary query={q} emptyTitle="No transfers" emptyMessage="Record a transfer to move money between accounts.">
          {(list) => list.map((t) => (
            <TouchableOpacity key={t.id} accessibilityRole="button" accessibilityLabel={`${transferTitle(t)}, ${formatMoney(Number(t.amount))}, ${t.date}. Edit`} style={styles.row} onPress={() => open(t)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{transferTitle(t)}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[t.date, t.description].filter(Boolean).join('  ·  ')}</Text>
              </View>
              <Text style={styles.amount}>{formatMoney(Number(t.amount))}</Text>
            </TouchableOpacity>
          ))}
        </QueryBoundary>
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New transfer' : 'Edit transfer'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Select label="From account" value={form.from} onChange={(v) => set('from', Number(v))} placeholder="Choose an account" options={fromOptions.map((a) => ({ value: a.id, label: a.name }))} />
        <Select label="To account" value={form.to} onChange={(v) => set('to', Number(v))} placeholder="Choose an account" options={toOptions.map((a) => ({ value: a.id, label: a.name }))} />
        <Input label="Amount (PKR)" value={form.amount} onChangeText={(v) => set('amount', v)} keyboardType="decimal-pad" />
        <DateField label="Date" value={form.date} onChange={(v) => set('date', v)} />
        <Input label="Note (optional)" value={form.description} onChangeText={(v) => set('description', v)} />
        {editing && editing !== 'new' ? <Button title="Delete transfer" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  dates: { flexDirection: 'row', gap: Spacing.sm },
  half: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 56 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  amount: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});
