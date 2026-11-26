import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useCategoryActions, useManagedCategories } from '../../hooks/useFinanceSetup';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { inventoryErrorMessage } from '../../services/inventory';
import type { ManagedCategory } from '../../services/financeSetup';
import FeeEnrollmentsSheet from './FeeEnrollmentsSheet';
import FormSheet from '../inventory/FormSheet';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SegmentedTabs from '../ui/SegmentedTabs';
import EmptyState from '../ui/EmptyState';
import Skeleton from '../ui/Skeleton';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Kind = 'monthly' | 'annual';
type Row = ManagedCategory & { kind: Kind };

// Optional fees (Robotics, Karate, Koder Kids, bus...) in one list: only enrolled students pay them.
// Tap one for its students; "New optional fee" creates one and goes straight to enrolling.
export default function OptionalFeesList() {
  const toast = useToast();
  const monthly = useManagedCategories('monthly');
  const annual = useManagedCategories('annual');
  const monthlyActions = useCategoryActions('monthly');
  const annualActions = useCategoryActions('annual');
  const refreshControl = useRefreshControl(monthly.refetch, annual.refetch);
  const [open, setOpen] = useState<{ kind: Kind; category: { id: number; name: string } } | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<{ name: string; kind: Kind; price: string }>({ name: '', kind: 'monthly', price: '' });
  const [error, setError] = useState<string | null>(null);

  const rows: Row[] = [
    ...(monthly.data ?? []).filter((c) => c.billing_mode === 'ENROLLED').map((c) => ({ ...c, kind: 'monthly' as const })),
    ...(annual.data ?? []).filter((c) => c.billing_mode === 'ENROLLED').map((c) => ({ ...c, kind: 'annual' as const })),
  ];

  const create = async () => {
    if (!form.name.trim()) return setError('Enter a name.');
    if (form.price.trim() && !(Number(form.price) >= 0)) return setError('Enter a price of 0 or more.');
    setError(null);
    try {
      const actions = form.kind === 'monthly' ? monthlyActions : annualActions;
      const res = await actions.create.mutateAsync({
        name: form.name.trim(), billing_mode: 'ENROLLED', default_amount: form.price.trim() || null,
      });
      const created = (res as { data: { id: number; name: string } }).data;
      toast.success(`${created.name} created.`);
      setCreating(false);
      setForm({ name: '', kind: 'monthly', price: '' });
      setOpen({ kind: form.kind, category: created });
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not create the fee.'));
    }
  };

  if (monthly.isLoading || annual.isLoading) return <Skeleton />;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={refreshControl}>
        <Text style={styles.hint}>Courses and services only some students take. Only enrolled students are billed; joining mid-month is a full month.</Text>
        <Button title="+ New optional fee" size="sm" onPress={() => { setError(null); setCreating(true); }} />
        {rows.length === 0 ? <EmptyState title="No optional fees" message="Add one, then enroll the students who take it." /> : rows.map((c) => (
          <TouchableOpacity key={`${c.kind}-${c.id}`} accessibilityRole="button" accessibilityLabel={`${c.name} students`} style={styles.row}
            onPress={() => setOpen({ kind: c.kind, category: c })}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>
                {c.kind === 'monthly' ? 'Every month' : 'Once a year'}  ·  {c.default_amount != null ? `PKR ${Number(c.default_amount).toLocaleString()}` : 'Price per class'}
              </Text>
            </View>
            <StatusPill label={`${c.enrolled_count ?? 0} enrolled`} tone="info" />
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FormSheet visible={creating} title="New optional fee" onClose={() => setCreating(false)} onSubmit={create}
        submitLabel="Create and enroll students" busy={monthlyActions.create.isPending || annualActions.create.isPending} error={error}>
        <Input label="Name" value={form.name} placeholder="e.g. Koder Kids" onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
        <SegmentedTabs tabs={[{ value: 'monthly', label: 'Every month' }, { value: 'annual', label: 'Once a year' }]} value={form.kind}
          onChange={(k) => setForm((f) => ({ ...f, kind: k }))} />
        <Input label="Price (PKR)" value={form.price} keyboardType="numeric" placeholder="e.g. 1500" onChangeText={(v) => setForm((f) => ({ ...f, price: v }))} />
      </FormSheet>

      {open ? <FeeEnrollmentsSheet kind={open.kind} category={open.category} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.sm },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
