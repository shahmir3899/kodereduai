import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Switch, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useCategories, useInventoryActions, useItemsPaged } from '../../hooks/useInventory';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildItemPayload, emptyItemForm, inventoryErrorMessage, itemToForm, STOCK_LABEL, STOCK_TONE, stockStatus, UNITS,
  validateItem, type Item, type ItemForm,
} from '../../services/inventory';
import { formatMoney } from '../../services/feeCollect';
import SearchBar from '../ui/SearchBar';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import FormSheet from './FormSheet';
import QuickAdd from './QuickAdd';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type StockTab = '' | 'ok' | 'low' | 'out';
const TABS: Array<{ value: StockTab; label: string }> = [
  { value: '', label: 'All' }, { value: 'ok', label: 'In stock' }, { value: 'low', label: 'Low' }, { value: 'out', label: 'Out' },
];
const ALL = -1;

// Items with stock status, filters and, for admin and principal, add and edit. Stock levels change
// only through movements and assignments, so editing an item never touches its stock count.
export default function ItemsScreen() {
  const toast = useToast();
  const { isSchoolAdminNav: canManage } = useAuth();
  const actions = useInventoryActions();
  const categories = useCategories();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const [categoryId, setCategoryId] = useState<number>(ALL);
  const [stock, setStock] = useState<StockTab>('');
  const query = useItemsPaged(term, categoryId === ALL ? null : categoryId, stock);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const items = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const total = query.data?.pages[0]?.count ?? 0;

  const [editing, setEditing] = useState<Item | 'new' | null>(null);
  const [viewing, setViewing] = useState<Item | null>(null);
  const [form, setForm] = useState<ItemForm>(emptyItemForm());
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof ItemForm>(key: K, value: ItemForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const open = (item: Item | 'new') => {
    setError(null);
    if (item === 'new') {
      setForm(emptyItemForm());
      setEditing('new');
    } else if (canManage) {
      setForm(itemToForm(item));
      setEditing(item);
    } else {
      setViewing(item);
    }
  };

  const save = async () => {
    const creating = editing === 'new';
    const problem = validateItem(form, creating);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const payload = buildItemPayload(form, creating);
      if (creating) await actions.createItem.mutateAsync(payload);
      else await actions.updateItem.mutateAsync({ id: (editing as Item).id, data: payload });
      toast.success(creating ? 'Item added.' : 'Item saved.');
      setEditing(null);
    } catch (e) {
      setError(inventoryErrorMessage(e));
    }
  };

  const busy = actions.createItem.isPending || actions.updateItem.isPending;

  const header = (
    <View>
      <SegmentedTabs tabs={TABS} value={stock} onChange={setStock} />
      <Select
        label="Category" value={categoryId} onChange={setCategoryId}
        options={[{ value: ALL, label: 'All categories' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
      />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search name or code..." />
      {query.data ? <Text style={styles.count}>{total} item{total === 1 ? '' : 's'}</Text> : null}
      {canManage ? <Button title="+ Add item" size="sm" onPress={() => open('new')} /> : null}
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={items}
        keyExtractor={(i) => String(i.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No items" message={term || stock || categoryId !== ALL ? 'No items match the filters.' : 'No items yet.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item }) => {
          const status = stockStatus(item);
          return (
            <TouchableOpacity accessibilityRole="button" style={[styles.row, !item.is_active && styles.inactive]} onPress={() => open(item)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{item.name}{item.is_active ? '' : ' (inactive)'}</Text>
                <Text style={styles.sub} numberOfLines={1}>
                  {[item.category_name, item.sku, item.location].filter(Boolean).join('  ·  ') || 'Uncategorized'}
                </Text>
              </View>
              <View style={styles.right}>
                <Text style={styles.qty}>{item.current_stock} {item.unit_display ?? item.unit}</Text>
                <StatusPill label={STOCK_LABEL[status]} tone={STOCK_TONE[status]} />
              </View>
            </TouchableOpacity>
          );
        }}
      />

      <FormSheet
        visible={editing !== null} title={editing === 'new' ? 'Add item' : 'Edit item'} onClose={() => setEditing(null)}
        onSubmit={save} submitLabel={editing === 'new' ? 'Add item' : 'Save changes'} busy={busy} error={error}
      >
        <Input label="Name" value={form.name} onChangeText={(v) => set('name', v)} />
        <Select
          label="Category" placeholder="Uncategorized" value={form.category} onChange={(v) => set('category', v)}
          options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <QuickAdd noun="category" onCreate={async (name) => {
          const res = await actions.createCategory.mutateAsync({ name, is_active: true });
          const id = (res.data as { id?: number })?.id;
          if (id) set('category', id);
          return id;
        }} />
        <Input label="Code / SKU (optional)" value={form.sku} onChangeText={(v) => set('sku', v)} autoCapitalize="characters" />
        <Select label="Unit" value={form.unit} onChange={(v) => set('unit', v)} options={UNITS.map((u) => ({ value: u.value, label: u.label }))} />
        {editing === 'new' ? (
          <Input label="Opening stock" value={form.openingStock} onChangeText={(v) => set('openingStock', v)} keyboardType="number-pad" />
        ) : (
          <Text style={styles.note}>Stock now: {form.openingStock}. Change it with a movement or an assignment so the history adds up.</Text>
        )}
        <Input label="Minimum stock (alert level)" value={form.minimumStock} onChangeText={(v) => set('minimumStock', v)} keyboardType="number-pad" />
        <Input label="Unit price" value={form.unitPrice} onChangeText={(v) => set('unitPrice', v)} keyboardType="decimal-pad" />
        <Input label="Location (optional)" value={form.location} onChangeText={(v) => set('location', v)} />
        {editing !== 'new' ? (
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>Active</Text>
            <Switch value={form.isActive} onValueChange={(v) => set('isActive', v)} accessibilityLabel="Item is active" />
          </View>
        ) : null}
      </FormSheet>

      <FormSheet visible={viewing !== null} title={viewing?.name ?? ''} onClose={() => setViewing(null)} onSubmit={() => setViewing(null)} submitLabel="Close">
        {viewing ? (
          <View style={styles.detail}>
            {[
              ['Category', viewing.category_name || 'Uncategorized'],
              ['Code', viewing.sku || '–'],
              ['In stock', `${viewing.current_stock} ${viewing.unit_display ?? viewing.unit}`],
              ['Alert level', String(viewing.minimum_stock)],
              ['Unit price', formatMoney(Number(viewing.unit_price) || 0)],
              ['Stock value', formatMoney(Number(viewing.stock_value) || 0)],
              ['Location', viewing.location || '–'],
              ['With people now', String(viewing.active_assignments_count ?? 0)],
            ].map(([k, v]) => (
              <View key={k} style={styles.detailRow}><Text style={styles.detailKey}>{k}</Text><Text style={styles.detailVal}>{v}</Text></View>
            ))}
          </View>
        ) : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.md },
  inactive: { opacity: 0.6 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  qty: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  note: { fontSize: FontSize.sm, color: Colors.textSecondary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  switchLabel: { fontSize: FontSize.md, color: Colors.text },
  detail: { gap: Spacing.sm },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between' },
  detailKey: { fontSize: FontSize.sm, color: Colors.textSecondary },
  detailVal: { fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
});
