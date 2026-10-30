import React, { useState } from 'react';
import { FlatList, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Button from '../ui/Button';
import { financeApi } from '../../services/api';
import { periodRange } from '../../services/accountant';
import { exportErrorMessage, ledgerFileName } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import { useToast } from '../ui/Toast';
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
// `canManage` adds transfers and month closing (admin and principal); accountants only read.
export default function AccountsScreen({ canManage = false }: { canManage?: boolean }) {
  const router = useRouter();
  const q = useAccountBalances();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  // The server's own ledger files (same as the web Accounts page), year to date.
  const exportLedger = async (id: number, name: string, kind: 'pdf' | 'xlsx') => {
    const range = periodRange('YEAR');
    const params = { account_id: id, date_from: range.from, date_to: range.to };
    setBusy(`${id}-${kind}`);
    try {
      await shareReportFile(
        () => (kind === 'pdf' ? financeApi.exportLedgerPdf(params) : financeApi.exportLedger(params)),
        ledgerFileName(name, range, kind), kind);
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message || exportErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
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
        <View>
          <View style={styles.total}>
            <Text style={styles.totalLabel}>Total balance · {accounts.length} account{accounts.length === 1 ? '' : 's'}</Text>
            <Text style={styles.totalValue}>{formatMoney(totalBalance(accounts))}</Text>
          </View>
          {canManage ? (
            <View style={styles.manage}>
              <Button title="Transfers" size="sm" variant="outline" style={styles.manageBtn} onPress={() => router.push('/(admin)/finance/transfers' as Href)} />
              <Button title="Close month" size="sm" variant="outline" style={styles.manageBtn} onPress={() => router.push('/(admin)/finance/close-month' as Href)} />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={<EmptyState title="No accounts" message="No accounts are visible to your role." />}
      renderItem={({ item: a }) => (
        <View style={styles.row}>
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>{a.name}</Text>
            {a.account_type ? <StatusPill label={a.account_type} tone="info" /> : null}
          </View>
          <View style={styles.right}>
            <Text style={styles.amount}>{formatMoney(Number(a.net_balance ?? a.balance) || 0)}</Text>
            <View style={styles.exports}>
              {(['pdf', 'xlsx'] as const).map((kind) => (
                <TouchableOpacity
                  key={kind} accessibilityRole="button" disabled={busy !== null}
                  accessibilityLabel={`Export ${a.name} ledger as ${kind === 'pdf' ? 'PDF' : 'Excel'}`}
                  style={[styles.export, busy !== null && { opacity: 0.5 }]} onPress={() => exportLedger(a.id, a.name, kind)}
                >
                  <Text style={styles.exportText}>{busy === `${a.id}-${kind}` ? '…' : kind === 'pdf' ? 'PDF' : 'Excel'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
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
  manage: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  manageBtn: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.md },
  who: { flex: 1, alignItems: 'flex-start', gap: 4 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  amount: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  right: { alignItems: 'flex-end', gap: 6 },
  exports: { flexDirection: 'row', gap: Spacing.sm },
  export: { minHeight: 32, minWidth: 52, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.sm, borderWidth: 1, borderColor: Colors.primary, paddingHorizontal: Spacing.sm },
  exportText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.primary },
});
