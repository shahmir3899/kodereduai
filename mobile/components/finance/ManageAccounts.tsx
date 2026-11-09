import React, { useState } from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useAccountManageActions, useManagedAccounts } from '../../hooks/useFinanceSetup';
import { useAuth } from '../../contexts/AuthContext';
import { manageableAccounts } from '../../services/accountsAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  ACCOUNT_TYPES, accountToForm, bankSummary, buildAccountPayload, emptyAccountForm, validateAccount, type AccountForm, type ManagedAccount,
} from '../../services/financeSetup';
import { inventoryErrorMessage } from '../../services/inventory';
import { formatMoney } from '../../services/feeCollect';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import CopyableNumber from '../ui/CopyableNumber';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Add, edit and delete accounts (admin and principal), like the web Accounts page "Manage" tab.
export default function ManageAccounts() {
  const toast = useToast();
  const q = useManagedAccounts();
  const { isPrincipal } = useAuth();
  const actions = useAccountManageActions();
  const refreshControl = useRefreshControl(q.refetch);
  const [editing, setEditing] = useState<ManagedAccount | 'new' | null>(null);
  const [form, setForm] = useState<AccountForm>(emptyAccountForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AccountForm>(k: K, v: AccountForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const open = (a: ManagedAccount | 'new') => {
    setForm(a === 'new' ? emptyAccountForm() : accountToForm(a));
    setError(null);
    setEditing(a);
  };

  const save = async () => {
    const problem = validateAccount(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const payload = buildAccountPayload(form, editing !== 'new');
      if (editing === 'new') await actions.create.mutateAsync(payload);
      else await actions.update.mutateAsync({ id: (editing as ManagedAccount).id, data: payload });
      toast.success('Account saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not save the account.'));
    }
  };

  const remove = async (a: ManagedAccount) => {
    if (!(await confirm({ title: 'Delete account?', message: `${a.name}. This cannot be undone.`, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(a.id);
      toast.success('Account deleted.');
      setEditing(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the account.'));
    }
  };

  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = manageableAccounts(q.data ?? [], isPrincipal);

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Button title="+ New account" size="sm" onPress={() => open('new')} />
        {rows.length === 0 ? <EmptyState title="No accounts" message="Add the cash, bank or person accounts the school keeps." /> : rows.map((a) => (
          <TouchableOpacity key={a.id} accessibilityRole="button" accessibilityLabel={`Edit ${a.name}`} style={styles.row} onPress={() => open(a)}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{a.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {[ACCOUNT_TYPES.find((t) => t.value === a.account_type)?.label ?? a.account_type, bankSummary(a) || null,
                  `Opening ${formatMoney(Number(a.opening_balance) || 0)}`,
                  a.staff_visible === false ? 'Hidden from staff' : null].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
            <StatusPill label={a.is_active ? 'Active' : 'Inactive'} tone={a.is_active ? 'success' : 'neutral'} />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FormSheet visible={editing !== null} title={editing === 'new' ? 'New account' : 'Edit account'} onClose={() => setEditing(null)} onSubmit={save}
        submitLabel="Save" busy={actions.create.isPending || actions.update.isPending} error={error}>
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Principal Branch 1" />
        <Select label="Type" value={form.accountType} onChange={(v) => set('accountType', String(v))} options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label }))} />
        {form.accountType === 'BANK' ? (
          <>
            <Input label="Bank name" value={form.bankName} onChangeText={(v) => set('bankName', v)} placeholder="e.g. HBL" maxLength={100} />
            <Input label="Account title" value={form.accountTitle} onChangeText={(v) => set('accountTitle', v)} placeholder="Name the account is held in" maxLength={100} />
            <Input label="Account number" value={form.accountNumber} onChangeText={(v) => set('accountNumber', v)} placeholder="Letters, digits, spaces and hyphens" maxLength={34} autoCapitalize="characters" />
            {editing && editing !== 'new' && editing.account_number ? <CopyableNumber value={editing.account_number} textStyle={{ fontSize: FontSize.sm }} /> : null}
            <Input label="IBAN (optional)" value={form.iban} onChangeText={(v) => set('iban', v)} placeholder="e.g. PK36 HABB 0000 0123 4567 8901" maxLength={34} autoCapitalize="characters" />
          </>
        ) : null}
        <Input label="Opening balance" value={form.openingBalance} onChangeText={(v) => set('openingBalance', v)} keyboardType="decimal-pad" placeholder="0.00" />
        {editing && editing !== 'new' ? <ToggleRow label="Active" value={form.isActive} onChange={(v) => set('isActive', v)} /> : null}
        <ToggleRow label="Visible to staff" value={form.staffVisible} onChange={(v) => set('staffVisible', v)} />
        {editing && editing !== 'new' ? <Button title="Delete account" variant="danger" size="sm" onPress={() => remove(editing)} /> : null}
      </FormSheet>
    </>
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

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  toggleLabel: { fontSize: FontSize.md, color: Colors.text, flex: 1, marginRight: Spacing.md },
});
