import React from 'react';
import { Text, StyleSheet, TextInput, Switch, View } from 'react-native';
import { financeApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import type { EntryForm, EntryKind } from '../../services/financeEntry';
import { useAccounts } from '../../hooks/useFees';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The school's own categories for an expense or an income entry, shared by the entry form, the
// editor and the list filter.
export function useEntryCategories(kind: EntryKind) {
  return useScopedQuery('categories', [kind], async () =>
    listOf<{ id: number; name: string; is_active?: boolean }>((await (kind === 'expense' ? financeApi.getExpenseCategories : financeApi.getIncomeCategories)({ page_size: 9999 })).data));
}

// The fields of the expense / income form, used by the record screen and the edit sheet so the two
// cannot drift. `keepCategoryId` keeps an entry's own category selectable after it was deactivated.
export default function EntryFields({ kind, form, set, keepCategoryId }: {
  kind: EntryKind; form: EntryForm; set: (patch: Partial<EntryForm>) => void; keepCategoryId?: number | null;
}) {
  const isExpense = kind === 'expense';
  const accounts = useAccounts();
  const cats = useEntryCategories(kind);
  const activeAccounts = (accounts.data ?? []).filter((a) => a.is_active !== false || a.id === form.account);
  const categories = (cats.data ?? []).filter((c) => c.is_active !== false || c.id === keepCategoryId);
  return (
    <View>
      <Select label="Account" value={form.account} options={activeAccounts.map((a) => ({ value: a.id, label: a.name }))}
        onChange={(v) => set({ account: v })} placeholder="Select account" />
      <View style={styles.gap} />
      <Select label="Category" value={form.category} options={categories.map((c) => ({ value: c.id, label: c.name }))}
        onChange={(v) => set({ category: v })} placeholder={cats.isLoading ? 'Loading…' : categories.length ? 'Select category' : 'No categories yet'} />

      <Text style={styles.label}>Amount (PKR)</Text>
      <TextInput style={styles.input} placeholder="Enter amount..." placeholderTextColor={Colors.placeholder}
        value={form.amount} onChangeText={(v) => set({ amount: v })} keyboardType="numeric" />

      <View style={styles.gap} />
      <DateField label="Date" value={form.date} onChange={(v) => set({ date: v })} />

      <Text style={styles.label}>Description</Text>
      <TextInput style={[styles.input, styles.area]} placeholder={isExpense ? 'What was this expense for?' : 'Where did this income come from?'}
        placeholderTextColor={Colors.placeholder} value={form.description} onChangeText={(v) => set({ description: v })} multiline numberOfLines={3} />

      {isExpense ? (
        <View style={styles.switchRow}>
          <View style={styles.grow}>
            <Text style={styles.switchTitle}>Mark as sensitive</Text>
            <Text style={styles.switchHint}>Hidden from staff members</Text>
          </View>
          <Switch value={form.sensitive} onValueChange={(v) => set({ sensitive: v })} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  gap: { height: Spacing.md },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.sm, marginTop: Spacing.md },
  input: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md, fontSize: FontSize.md, color: Colors.text },
  area: { minHeight: 80, textAlignVertical: 'top' },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.lg, gap: Spacing.md },
  switchTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  switchHint: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
