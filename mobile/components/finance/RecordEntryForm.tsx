import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, ScrollView, RefreshControl, KeyboardAvoidingView, Platform } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { schoolToday } from '../../services/schoolTime';
import { saveFailureMessage } from '../../services/errorKind';
import { defaultAccount, emptyEntry, entryPayload, validateEntry, type EntryForm, type EntryKind } from '../../services/financeEntry';
import { useAccounts } from '../../hooks/useFees';
import { useToast } from '../ui/Toast';
import Card from '../ui/Card';
import Button from '../ui/Button';
import EntryFields, { useEntryCategories } from './EntryFields';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// One form for "record expense" and "record income", as on the web: the school's own categories and
// the account the money moves in or out of. Saving refreshes the balances so the account shows it.
export default function RecordEntryForm({ kind }: { kind: EntryKind }) {
  const isExpense = kind === 'expense';
  const toast = useToast();
  const queryClient = useQueryClient();
  const accounts = useAccounts();
  const cats = useEntryCategories(kind);
  const [form, setForm] = useState<EntryForm>(() => emptyEntry(schoolToday()));
  const set = (patch: Partial<EntryForm>) => setForm((f) => ({ ...f, ...patch }));

  // A lone account is picked for you.
  useEffect(() => {
    if (form.account == null) { const only = defaultAccount(accounts.data ?? []); if (only) set({ account: only }); }
  }, [accounts.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) => (isExpense ? financeApi.createExpense(data) : financeApi.createOtherIncome(data)),
    onSuccess: () => {
      toast.success(isExpense ? 'Expense recorded.' : 'Income recorded.');
      setForm({ ...emptyEntry(schoolToday()), account: form.account });
      ['accounts', 'finance', 'expenses', 'otherIncome'].forEach((root) => queryClient.invalidateQueries({ queryKey: [root] }));
    },
    onError: (e) => toast.error(saveFailureMessage(e, isExpense ? 'Could not record the expense.' : 'Could not record the income.')),
  });

  const submit = () => {
    const problem = validateEntry(form);
    if (problem) { toast.error(problem); return; }
    save.mutate(entryPayload(kind, form));
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={accounts.isRefetching || cats.isRefetching} onRefresh={() => { accounts.refetch(); cats.refetch(); }} />}>
        <Text style={styles.title}>{isExpense ? 'Record Expense' : 'Record Income'}</Text>
        <Card style={styles.card}>
          <EntryFields kind={kind} form={form} set={set} />
          <Button title={isExpense ? 'Record Expense' : 'Record Income'} onPress={submit} loading={save.isPending} fullWidth style={styles.submit} />
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  card: { marginBottom: Spacing.xxl },
  submit: { marginTop: Spacing.xl },
});
