import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { ENTRY_PAGE, useEntryHistory } from '../../../hooks/useFinanceManager';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import { monthRange, type RecentEntry } from '../../../services/financeManager';
import { formatMoney } from '../../../services/feeCollect';
import Card from '../../../components/ui/Card';
import Badge from '../../../components/ui/Badge';
import Icon, { type IconName } from '../../../components/ui/Icon';
import SegmentedTabs from '../../../components/ui/SegmentedTabs';
import QueryBoundary from '../../../components/ui/QueryBoundary';
import { Colors, FontSize, Spacing } from '../../../constants/colors';
import AppList from '../../../components/ui/AppList';
import Button from '../../../components/ui/Button';
import MonthFilter, { type YearMonth } from '../../../components/finance/MonthFilter';
import { day, dayTime } from '../../../services/dates';

// Every money movement (fee payments, other income, expenses, transfers), newest first, from the
// same feed as the finance dashboard: 50 at a time with "Load more", for all months or one month.
// Each shows what it was, which account it went into or out of, who recorded it and when.

type Kind = 'all' | 'fee_payment' | 'other_income' | 'expense' | 'transfer';

const KIND: Record<string, { label: string; variant: 'success' | 'error' | 'info' | 'purple'; sign: '+' | '-' | ''; color: string; accountLabel: string }> = {
  fee_payment: { label: 'Fee payment', variant: 'success', sign: '+', color: Colors.success, accountLabel: 'Into' },
  other_income: { label: 'Income', variant: 'info', sign: '+', color: Colors.success, accountLabel: 'Into' },
  expense: { label: 'Expense', variant: 'error', sign: '-', color: Colors.error, accountLabel: 'Paid from' },
  transfer: { label: 'Transfer', variant: 'purple', sign: '', color: Colors.text, accountLabel: 'Between' },
};

const FILTERS: Array<{ value: Kind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'fee_payment', label: 'Fees' },
  { value: 'other_income', label: 'Income' },
  { value: 'expense', label: 'Expenses' },
  { value: 'transfer', label: 'Transfers' },
];

function formatDay(iso?: string | null): string {
  if (!iso) return 'No date';
  return day(iso) || iso;
}

function formatStamp(iso?: string | null): string | null {
  if (!iso) return null;
  return dayTime(iso) || null;
}

function Detail({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Icon name={icon} size={15} color={Colors.textSecondary} />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function EntryCard({ e }: { e: RecentEntry }) {
  const k = KIND[e.type] ?? { label: e.type, variant: 'info' as const, sign: '' as const, color: Colors.text, accountLabel: 'Account' };
  const amount = Number(e.amount) || 0;
  // A transfer's description is "From → To — note"; the accounts are its "between" line.
  const [transferRoute, transferNote] = e.type === 'transfer' ? (e.description ?? '').split(' — ') : [null, null];
  const ledger = e.type === 'other_income' || e.type === 'expense';
  // Income and expense descriptions are "Category — note"; newer servers also send the two apart.
  const [descCategory, descNote] = ledger ? (e.description ?? '').split(' — ') : [null, null];
  const category = ledger ? (e.category ?? descCategory ?? 'Uncategorized') : e.type === 'fee_payment' ? e.fee_type_label : null;
  const title = e.type === 'transfer'
    ? (transferNote || 'Money moved between accounts')
    : ledger ? ((e.note ?? descNote) || category || k.label) : (e.description || k.label);
  const account = e.type === 'transfer' ? transferRoute : e.account_name;
  const stamp = formatStamp(e.timestamp);
  return (
    <Card style={styles.card}>
      <View style={styles.top}>
        <Badge label={k.label} variant={k.variant} />
        <Text style={styles.date}>{formatDay(e.date)}</Text>
      </View>
      <View style={styles.middle}>
        <View style={styles.flex}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
        </View>
        <Text style={[styles.amount, { color: k.color }]}>{k.sign}{formatMoney(amount)}</Text>
      </View>
      <View style={styles.details}>
        {category ? <Detail icon="pricetag-outline" label={e.type === 'fee_payment' ? 'Fee type' : 'Category'} value={category} /> : null}
        <Detail icon={e.type === 'transfer' ? 'swap-horizontal-outline' : 'wallet-outline'} label={k.accountLabel} value={account || 'No account'} />
        <Detail icon="person-outline" label="Recorded by" value={e.recorded_by || 'Not recorded'} />
        {stamp ? <Detail icon="time-outline" label="Entered" value={stamp} /> : null}
      </View>
    </Card>
  );
}

export default function TransactionHistory() {
  const [ym, setYm] = useState<YearMonth | null>(null);
  const range = ym ? monthRange(ym.year, ym.month) : null;
  const query = useEntryHistory(range);
  const refreshControl = useRefreshControl(query.refetch);
  const [kind, setKind] = useState<Kind>('all');
  const all = query.rows;
  const shown = useMemo(() => (kind === 'all' ? all : all.filter((e) => e.type === kind)), [all, kind]);
  const loaded = query.data !== undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <MonthFilter value={ym} onChange={setYm} />
        <SegmentedTabs tabs={FILTERS} value={kind} onChange={setKind} scrollable />
        <Text style={styles.count}>
          {loaded ? `${shown.length} ${shown.length === 1 ? 'entry' : 'entries'}${query.hasNextPage ? ' so far' : ''}` : ''}
        </Text>
      </View>
      <QueryBoundary
        query={{ data: loaded ? shown : undefined, isLoading: query.isLoading, isError: query.isError, error: query.error, fetchStatus: query.fetchStatus, refetch: query.refetch as never }}
        emptyTitle="No transactions"
        emptyMessage={query.hasNextPage ? 'Nothing of this kind in the latest entries. Load more to look further back.' : ym ? 'Nothing of this kind in this month.' : 'Nothing of this kind yet.'}>
        {(rows) => (
          <AppList
            data={rows}
            keyExtractor={(e) => `${e.type}-${e.id}`}
            renderItem={({ item }) => <EntryCard e={item} />}
            contentContainerStyle={styles.list}
            refreshControl={refreshControl}
            ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={styles.more} />
              : query.hasNextPage ? <Button title={`Load ${ENTRY_PAGE} more`} variant="outline" onPress={() => query.fetchNextPage()} style={styles.more} /> : null}
          />
        )}
      </QueryBoundary>
      {loaded && shown.length === 0 && query.hasNextPage ? (
        <View style={styles.list}>
          <Button title={`Load ${ENTRY_PAGE} more`} variant="outline" onPress={() => query.fetchNextPage()} loading={query.isFetchingNextPage} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, gap: Spacing.sm },
  count: { fontSize: FontSize.sm, color: Colors.textSecondary },
  list: { padding: Spacing.lg, paddingTop: Spacing.sm },
  more: { marginVertical: Spacing.md },
  card: { marginBottom: Spacing.md },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: FontSize.xs, color: Colors.textSecondary },
  middle: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, marginTop: Spacing.sm },
  flex: { flex: 1 },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  amount: { fontSize: FontSize.lg, fontWeight: '700' },
  details: {
    marginTop: Spacing.md, paddingTop: Spacing.sm, gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  detail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  detailLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, width: 82 },
  detailValue: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
});
