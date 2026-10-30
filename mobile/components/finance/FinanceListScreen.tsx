import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, StyleSheet, type RefreshControlProps } from 'react-native';
import { financeApi } from '../../services/api';
import { balanceOf, formatMoney, type FeePayment, type FeeStatus } from '../../services/feeCollect';
import { useFinanceList } from '../../hooks/useAccountant';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import SegmentedTabs from '../ui/SegmentedTabs';
import SearchBar from '../ui/SearchBar';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface LedgerRow {
  id: number;
  category_name?: string | null;
  description?: string;
  amount: number | string;
  date: string;
  account_name?: string | null;
}

type StatusTab = 'UNPAID' | 'PARTIAL' | 'PAID' | 'ALL';
const STATUS_TABS: Array<{ value: StatusTab; label: string }> = [
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'PAID', label: 'Paid' },
  { value: 'ALL', label: 'All' },
];
const FEE_TONE: Record<FeeStatus, 'error' | 'warning' | 'success' | 'info'> = {
  UNPAID: 'error', PARTIAL: 'warning', PAID: 'success', ADVANCE: 'info',
};

// Read-only lists for the Accountant: the finance API refuses every write for that role, so
// there is deliberately no add, edit or collect control here.
export default function FinanceListScreen({ kind }: { kind: 'fees' | 'expenses' | 'income' }) {
  return kind === 'fees' ? <FeesList /> : <LedgerList kind={kind} />;
}

function FeesList() {
  const [tab, setTab] = useState<StatusTab>('UNPAID');
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useFinanceList<FeePayment>('feePayments', financeApi.getFeePayments, {
    ...(tab === 'ALL' ? {} : { status: tab }),
    ...(term ? { search: term } : {}),
    ordering: '-year,-month',
  });
  const refreshControl = useRefreshControl(query.refetch);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const total = query.data?.pages[0]?.count ?? 0;

  const header = (
    <View>
      <SegmentedTabs tabs={STATUS_TABS} value={tab} onChange={setTab} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search student..." />
      {query.data ? <Text style={styles.count}>{total} record{total === 1 ? '' : 's'}</Text> : null}
    </View>
  );

  return (
    <List
      query={query} header={header} rows={rows} refreshControl={refreshControl}
      emptyTitle="No fee records" keyOf={(p) => String(p.id)}
      renderRow={(p) => (
        <View style={styles.row}>
          <View style={styles.who}>
            <Text style={styles.title} numberOfLines={1}>{p.student_name}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {[p.class_name, p.fee_type_display ?? p.fee_type, p.month ? `${p.month}/${p.year}` : p.year].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
          <View style={styles.right}>
            <Text style={styles.amount}>{formatMoney(balanceOf(p))}</Text>
            <StatusPill label={p.status} tone={FEE_TONE[p.status] ?? 'neutral'} />
          </View>
        </View>
      )}
    />
  );
}

function LedgerList({ kind }: { kind: 'expenses' | 'income' }) {
  const isExpense = kind === 'expenses';
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = useFinanceList<LedgerRow>(
    isExpense ? 'expenses' : 'otherIncome',
    isExpense ? financeApi.getExpenses : financeApi.getOtherIncome,
    { ...(term ? { search: term } : {}), ordering: '-date' },
  );
  const refreshControl = useRefreshControl(query.refetch);
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const header = <SearchBar value={search} onChangeText={setSearch} placeholder={isExpense ? 'Search expenses...' : 'Search income...'} />;

  return (
    <List
      query={query} header={header} rows={rows} refreshControl={refreshControl}
      emptyTitle={isExpense ? 'No expenses' : 'No other income'} keyOf={(r) => String(r.id)}
      renderRow={(r) => (
        <View style={styles.row}>
          <View style={styles.who}>
            <Text style={styles.title} numberOfLines={1}>{r.category_name || (isExpense ? 'Expense' : 'Income')}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {[r.date, r.account_name, r.description].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
          <Text style={[styles.amount, { color: isExpense ? Colors.error : Colors.success }]}>
            {isExpense ? '-' : '+'}{formatMoney(Number(r.amount) || 0)}
          </Text>
        </View>
      )}
    />
  );
}

interface ListProps<T> {
  query: {
    isLoading: boolean; isError: boolean; data?: unknown; refetch: () => unknown;
    hasNextPage?: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown;
  };
  header: React.ReactElement;
  rows: T[];
  refreshControl: React.ReactElement<RefreshControlProps>;
  emptyTitle: string;
  keyOf: (row: T) => string;
  renderRow: (row: T) => React.ReactElement;
}

function List<T>({ query, header, rows, refreshControl, emptyTitle, keyOf, renderRow }: ListProps<T>) {
  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState onRetry={() => query.refetch()} />;
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={keyOf}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={<EmptyState title={emptyTitle} message="Nothing matches the current filter." />}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
      renderItem={({ item }) => renderRow(item)}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary, marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  right: { alignItems: 'flex-end', gap: 4 },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  amount: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});
