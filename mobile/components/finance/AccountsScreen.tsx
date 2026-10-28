import React from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { useAccountBalances } from '../../hooks/useAccountant';
import { totalBalance } from '../../services/accountant';
import { formatMoney } from '../../services/feeCollect';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Account balances, read-only. The server already hides the accounts the school keeps private
// from restricted roles.
export default function AccountsScreen() {
  const q = useAccountBalances();
  const refreshControl = useRefreshControl(q.refetch);
  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const accounts = q.data ?? [];
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={accounts}
      keyExtractor={(a) => String(a.id)}
      refreshControl={refreshControl}
      ListHeaderComponent={
        <View style={styles.total}>
          <Text style={styles.totalLabel}>Total balance · {accounts.length} account{accounts.length === 1 ? '' : 's'}</Text>
          <Text style={styles.totalValue}>{formatMoney(totalBalance(accounts))}</Text>
        </View>
      }
      ListEmptyComponent={<EmptyState title="No accounts" message="No accounts are visible to your role." />}
      renderItem={({ item: a }) => (
        <View style={styles.row}>
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>{a.name}</Text>
            {a.account_type ? <StatusPill label={a.account_type} tone="info" /> : null}
          </View>
          <Text style={styles.amount}>{formatMoney(Number(a.balance) || 0)}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  total: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.lg, marginBottom: Spacing.md },
  totalLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  totalValue: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.primary, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.md },
  who: { flex: 1, alignItems: 'flex-start', gap: 4 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  amount: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});
