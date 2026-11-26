import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { todayString } from '../../services/attendanceEntry';
import { priceLabel, type FeeEnrollment } from '../../services/feeEnrollments';
import { inventoryErrorMessage } from '../../services/inventory';
import { useManagedCategories } from '../../hooks/useFinanceSetup';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Card from '../ui/Card';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { confirm } from '../ui/confirm';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// A student's optional fees (Robotics, Karate, Koder Kids...) on their Fees tab, so the front desk can
// sign a child up while the parent is there. Writing is for admins; the server checks it too.
export default function StudentOptionalFees({ studentId, canEdit }: { studentId: number; canEdit: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const list = useScopedQuery('feeEnrollments', ['student', studentId], async () =>
    listOf<FeeEnrollment & { fee_type: string; monthly_category: number | null; annual_category: number | null; category_name: string }>(
      (await financeApi.getFeeEnrollments({ student: studentId, status: 'all' })).data));
  const monthly = useManagedCategories('monthly');
  const annual = useManagedCategories('annual');
  const [fee, setFee] = useState<string | null>(null);
  const [start, setStart] = useState(todayString());
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = () => ['feeEnrollments', 'categories', 'feeCategories'].forEach((root) =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));

  const current = (list.data ?? []).filter((e) => !e.end_date || e.is_active);
  const taken = new Set(current.map((e) => `${e.fee_type}-${e.monthly_category ?? e.annual_category}`));
  const options = [
    ...(monthly.data ?? []).filter((c) => c.billing_mode === 'ENROLLED').map((c) => ({ value: `MONTHLY-${c.id}`, label: c.name })),
    ...(annual.data ?? []).filter((c) => c.billing_mode === 'ENROLLED').map((c) => ({ value: `ANNUAL-${c.id}`, label: c.name })),
  ].filter((o) => !taken.has(o.value));

  const add = useMutation({
    mutationFn: () => {
      const [kind, id] = (fee as string).split('-');
      return financeApi.createFeeEnrollment({
        student: studentId, [kind === 'MONTHLY' ? 'monthly_category' : 'annual_category']: Number(id),
        start_date: start, amount: price.trim() || null,
      });
    },
    onSuccess: () => { refresh(); setFee(null); setPrice(''); toast.success('Enrolled.'); },
    onError: (e) => setError(inventoryErrorMessage(e, 'Could not enroll.')),
  });

  const end = async (e: FeeEnrollment & { category_name: string }) => {
    const today = todayString();
    if (!(await confirm({ title: `End ${e.category_name}?`, message: `No more ${e.category_name} fee after ${today}.`, confirmLabel: 'End' }))) return;
    try {
      await financeApi.endFeeEnrollments({ ids: [e.id], end_date: today });
      refresh();
      toast.success('Ended.');
    } catch (err) {
      toast.error(inventoryErrorMessage(err, 'Could not end it.'));
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Optional fees</Text>
      <Text style={styles.hint}>Courses and services this student takes, billed on top of the normal fees.</Text>
      {current.length === 0 ? <Text style={styles.hint}>{list.isLoading ? 'Loading…' : 'None.'}</Text> : current.map((e) => (
        <View key={e.id} style={styles.row}>
          <View style={styles.who}>
            <Text style={styles.name}>{e.category_name}</Text>
            <Text style={styles.hint}>from {e.start_date}{e.end_date ? ` to ${e.end_date}` : ''}  ·  {priceLabel(e)}</Text>
          </View>
          {canEdit && !e.end_date ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`End ${e.category_name}`} hitSlop={8} onPress={() => end(e)}>
              <Text style={styles.end}>End</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      {canEdit && options.length > 0 ? (
        <View style={styles.form}>
          <Select label="Add optional fee" value={fee} onChange={(v) => { setFee(v); setError(null); }} placeholder="Choose" options={options} />
          <DateField label="Starts on" value={start} onChange={setStart} />
          <Input label="Own price (optional)" value={price} keyboardType="numeric" placeholder="Default price" onChangeText={setPrice} />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button title="Enroll" size="sm" onPress={() => add.mutate()} loading={add.isPending} disabled={!fee || !start || add.isPending} />
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  hint: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  end: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.error },
  form: { marginTop: Spacing.md },
  error: { color: Colors.error, fontSize: FontSize.sm, marginBottom: Spacing.sm },
});
