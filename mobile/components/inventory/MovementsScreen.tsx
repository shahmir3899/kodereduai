import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAllItems, useInventoryActions, useMovementsPaged, useVendors } from '../../hooks/useInventory';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  ALL_TYPE_FILTERS, buildMovementPayload, emptyMovementForm, inventoryErrorMessage, itemLabel, MOVEMENT_TYPES,
  movementTone, validateMovement, type MovementForm,
} from '../../services/inventory';
import { formatMoney } from '../../services/feeCollect';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import FormSheet from './FormSheet';
import QuickAdd from './QuickAdd';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The stock ledger. Rows are never edited or deleted (the server refuses it); admin and principal
// can record a purchase, adjustment or disposal. Issues and returns come from assignments.
export default function MovementsScreen() {
  const toast = useToast();
  const { isSchoolAdminNav: canManage } = useAuth();
  const actions = useInventoryActions();
  const [type, setType] = useState('');
  const query = useMovementsPaged(type, null);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [open, setOpen] = useState(false);
  const items = useAllItems(canManage && open);
  const vendors = useVendors();
  const [form, setForm] = useState<MovementForm>(emptyMovementForm(todayString()));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof MovementForm>(key: K, value: MovementForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const chosen = (items.data ?? []).find((i) => i.id === form.item) ?? null;

  const submit = async () => {
    const problem = validateMovement(form, chosen);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await actions.createMovement.mutateAsync(buildMovementPayload(form, chosen?.unit_price ?? 0));
      toast.success('Movement recorded.');
      setOpen(false);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const header = (
    <View>
      <Select label="Type" value={type} onChange={setType} options={ALL_TYPE_FILTERS.map((t) => ({ value: t.value, label: t.label }))} />
      {canManage ? (
        <Button title="+ Record movement" size="sm" onPress={() => { setForm(emptyMovementForm(todayString())); setError(null); setOpen(true); }} />
      ) : null}
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(m) => String(m.id)}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No movements" message="Stock movements will appear here." />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: m }) => (
          <View style={styles.row}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{m.item_name}</Text>
              <Text style={styles.sub} numberOfLines={2}>
                {[m.date, m.vendor_name, m.reference_number, m.remarks].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
            <View style={styles.right}>
              <Text style={[styles.qty, { color: m.quantity < 0 ? Colors.error : Colors.success }]}>{m.quantity > 0 ? '+' : ''}{m.quantity}</Text>
              <StatusPill label={m.transaction_type_display ?? m.transaction_type} tone={movementTone(m.transaction_type)} />
              {Number(m.total_amount) ? <Text style={styles.amount}>{formatMoney(Math.abs(Number(m.total_amount)))}</Text> : null}
            </View>
          </View>
        )}
      />

      <FormSheet visible={open} title="Record movement" onClose={() => setOpen(false)} onSubmit={submit} submitLabel="Record" busy={actions.createMovement.isPending} error={error}>
        <Select label="Type" value={form.type} onChange={(v) => set('type', v)} options={MOVEMENT_TYPES.map((t) => ({ value: t.value, label: `${t.label} — ${t.hint}` }))} />
        <Select
          label="Item" searchable value={form.item} onChange={(v) => set('item', v)} placeholder="Choose an item"
          options={(items.data ?? []).map((i) => ({ value: i.id, label: itemLabel(i) }))}
        />
        <Input
          label={form.type === 'ADJUSTMENT' ? 'Quantity (use - to reduce)' : 'Quantity'} value={form.quantity}
          onChangeText={(v) => set('quantity', v)} keyboardType="numbers-and-punctuation"
        />
        <Input label={`Unit price (default ${formatMoney(Number(chosen?.unit_price) || 0)})`} value={form.unitPrice} onChangeText={(v) => set('unitPrice', v)} keyboardType="decimal-pad" />
        {form.type === 'PURCHASE' ? (
          <>
            <Select
              label="Vendor (optional)" value={form.vendor} onChange={(v) => set('vendor', v)} placeholder="No vendor"
              options={(vendors.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
            />
            <QuickAdd noun="vendor" onCreate={async (name) => {
              const res = await actions.createVendor.mutateAsync({ name, is_active: true });
              const id = (res.data as { id?: number })?.id;
              if (id) set('vendor', id);
              return id;
            }} />
          </>
        ) : null}
        <Input label="Reference (optional)" value={form.reference} onChangeText={(v) => set('reference', v)} />
        <Input label="Remarks (optional)" value={form.remarks} onChangeText={(v) => set('remarks', v)} multiline />
        <DateField label="Date" value={form.date} onChange={(v) => set('date', v)} />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  qty: { fontSize: FontSize.lg, fontWeight: '700' },
  amount: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
