import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { AccountBalance } from '../../services/accountant';
import { accountTypeTone, type BalanceGroup } from '../../services/financeDashboard';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

const balanceOf = (a: AccountBalance) => Number(a.net_balance ?? a.balance ?? 0) || 0;

// Balances with the account type next to each name; tapping one opens its ledger preview.
// Pass `groups` for a multi-school admin (one block per school, then the shared accounts).
export default function AccountBalancesCard({ accounts, groups, total, loading, onOpen, onManage }: {
  accounts?: AccountBalance[]; groups?: BalanceGroup[]; total: number; loading?: boolean;
  onOpen: (a: AccountBalance, schoolId?: number | null) => void; onManage?: () => void;
}) {
  const empty = groups ? groups.length === 0 : (accounts ?? []).length === 0;
  const line = (a: AccountBalance, schoolId?: number | null) => (
    <TouchableOpacity key={`${a.id}-${a.name}`} accessibilityRole="button" accessibilityLabel={`${a.name}, ${formatMoney(balanceOf(a))}. Open ledger`} style={styles.line} onPress={() => onOpen(a, schoolId)}>
      <View style={styles.name}>
        {a.account_type ? <StatusPill label={a.account_type} tone={accountTypeTone(a.account_type)} /> : null}
        <Text style={styles.nameText} numberOfLines={1}>{a.name}</Text>
      </View>
      <Text style={styles.amount}>{formatMoney(balanceOf(a))}</Text>
    </TouchableOpacity>
  );
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Account balances</Text>
        {onManage ? <TouchableOpacity accessibilityRole="button" onPress={onManage} hitSlop={8}><Text style={styles.link}>Manage</Text></TouchableOpacity> : null}
      </View>
      {loading ? <Text style={styles.muted}>Loading…</Text> : empty ? <Text style={styles.muted}>No accounts created yet.</Text> : (
        <>
          {groups
            ? groups.map((g) => (
                <View key={g.schoolName} style={styles.group}>
                  <Text style={[styles.groupName, g.shared && { color: Colors.primary }]}>{g.schoolName}</Text>
                  {g.accounts.map((a) => line(a, g.schoolId))}
                  <View style={styles.sub}><Text style={styles.subText}>Subtotal</Text><Text style={styles.subText}>{formatMoney(g.subtotal)}</Text></View>
                </View>
              ))
            : (accounts ?? []).map((a) => line(a))}
          <View style={styles.total}>
            <Text style={styles.totalLabel}>{groups ? 'Grand total' : 'Total'}</Text>
            <Text style={styles.totalValue}>{formatMoney(total)}</Text>
          </View>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.lg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  group: { marginBottom: Spacing.md },
  groupName: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, marginBottom: 2 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm, minHeight: 44, gap: Spacing.sm },
  name: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  nameText: { flex: 1, fontSize: FontSize.sm, color: Colors.primary },
  amount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  sub: { flexDirection: 'row', justifyContent: 'space-between' },
  subText: { fontSize: FontSize.xs, color: Colors.textSecondary },
  total: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.xs },
  totalLabel: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  totalValue: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
});
