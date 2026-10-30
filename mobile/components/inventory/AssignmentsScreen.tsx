import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAllItems, useAssignableUsers, useAssignmentsPaged, useInventoryActions } from '../../hooks/useInventory';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  assignableUsers, buildAssignmentPayload, CONDITIONS, emptyAssignForm, inventoryErrorMessage, itemLabel, personName,
  validateAssignment, type Assignment, type AssignForm,
} from '../../services/inventory';
import SearchBar from '../ui/SearchBar';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import Input from '../ui/Input';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from './FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'true' | 'false' | '';
const TABS: Array<{ value: Tab; label: string }> = [
  { value: 'true', label: 'With people' }, { value: 'false', label: 'Returned' }, { value: '', label: 'All' },
];

// Who holds what. Admin and principal assign (stock drops by the quantity) and mark items returned
// (stock comes back); everyone else with access only reads.
export default function AssignmentsScreen() {
  const toast = useToast();
  const { isSchoolAdminNav: canManage } = useAuth();
  const actions = useInventoryActions();
  const [tab, setTab] = useState<Tab>('true');
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useAssignmentsPaged(tab, term);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [assigning, setAssigning] = useState(false);
  const items = useAllItems(canManage && assigning);
  const users = useAssignableUsers(canManage && assigning);
  const [form, setForm] = useState<AssignForm>(emptyAssignForm(todayString()));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof AssignForm>(key: K, value: AssignForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const chosen = (items.data ?? []).find((i) => i.id === form.item) ?? null;

  const [returning, setReturning] = useState<Assignment | null>(null);
  const [condition, setCondition] = useState('GOOD');
  const [notes, setNotes] = useState('');

  const assign = async () => {
    const problem = validateAssignment(form, chosen);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      await actions.createAssignment.mutateAsync(buildAssignmentPayload(form));
      toast.success('Item assigned.');
      setAssigning(false);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const giveBack = async () => {
    if (!returning) return;
    const ok = await confirm({ title: 'Mark as returned?', message: `${returning.quantity} × ${returning.item_name} goes back into stock.`, confirmLabel: 'Mark returned' });
    if (!ok) return;
    try {
      await actions.returnItem.mutateAsync({ id: returning.id, data: { condition_on_return: condition, notes: notes.trim() } });
      toast.success('Marked as returned.');
      setReturning(null);
    } catch (e) {
      toast.error(inventoryErrorMessage(e));
    }
  };

  const header = (
    <View>
      <SegmentedTabs tabs={TABS} value={tab} onChange={setTab} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search item or person..." />
      {canManage ? (
        <Button title="+ Assign item" size="sm" onPress={() => { setForm(emptyAssignForm(todayString())); setError(null); setAssigning(true); }} />
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
        keyExtractor={(a) => String(a.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No assignments" message={term ? 'No assignments match your search.' : 'Nothing here yet.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: a }) => (
          <TouchableOpacity
            accessibilityRole="button" disabled={!(canManage && a.is_active)} style={styles.row}
            onPress={() => { setReturning(a); setCondition('GOOD'); setNotes(''); }}
          >
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{a.quantity} × {a.item_name}</Text>
              <Text style={styles.sub} numberOfLines={2}>
                {[a.assigned_to_full_name?.trim() || a.assigned_to_name, a.is_active ? `since ${a.assigned_date}` : `returned ${a.returned_date ?? ''}`, a.is_active ? a.condition_on_assign_display : a.condition_on_return_display].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
            <StatusPill label={a.is_active ? 'With them' : 'Returned'} tone={a.is_active ? 'info' : 'neutral'} />
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={assigning} title="Assign item" onClose={() => setAssigning(false)} onSubmit={assign} submitLabel="Assign" busy={actions.createAssignment.isPending} error={error}>
        <Select
          label="Item" searchable value={form.item} onChange={(v) => set('item', v)} placeholder="Choose an item"
          options={(items.data ?? []).filter((i) => i.current_stock > 0).map((i) => ({ value: i.id, label: itemLabel(i) }))}
        />
        <Select
          label="Assign to" searchable value={form.user} onChange={(v) => set('user', v)} placeholder="Choose a person"
          options={assignableUsers(users.data ?? []).map((u) => ({ value: u.id, label: `${personName(u)}${u.role ? ` (${u.role.toLowerCase()})` : ''}` }))}
        />
        <Input label={`Quantity${chosen ? ` (up to ${chosen.current_stock})` : ''}`} value={form.quantity} onChangeText={(v) => set('quantity', v)} keyboardType="number-pad" />
        <Select label="Condition" value={form.condition} onChange={(v) => set('condition', v)} options={CONDITIONS.map((c) => ({ value: c.value, label: c.label }))} />
        <DateField label="Date" value={form.date} onChange={(v) => set('date', v)} />
        <Input label="Notes (optional)" value={form.notes} onChangeText={(v) => set('notes', v)} multiline />
      </FormSheet>

      <FormSheet
        visible={returning !== null} title={returning ? `Return ${returning.item_name}` : ''} onClose={() => setReturning(null)}
        onSubmit={giveBack} submitLabel="Mark returned" busy={actions.returnItem.isPending}
      >
        <Select label="Condition on return" value={condition} onChange={setCondition} options={CONDITIONS.map((c) => ({ value: c.value, label: c.label }))} />
        <Input label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
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
});
