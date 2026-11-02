import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import {
  useAccountBalances, useFinanceSummary, useMonthFeeSummary, useOverdueFees, useRecentEntries,
} from '../../hooks/useAccountant';
import { useUnreadMessages } from '../../hooks/useMessaging';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { entryAmount, entrySign, periodRange, rateTone, totalBalance } from '../../services/accountant';
import { balanceOf, formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import IncomeExpenseCard from './IncomeExpenseCard';
import StatusPill from '../ui/StatusPill';
import SchoolSwitcher from '../nav/SchoolSwitcher';
import StatTiles from '../dashboard/StatTiles';
import RecentNotifications from '../dashboard/RecentNotifications';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of frontend/src/pages/AccountantDashboard.jsx, minus the quick actions that write
// (record payment, expense, transfer): the finance API is read-only for this role.
export default function AccountantHome() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const balances = useAccountBalances();
  const fees = useMonthFeeSummary();
  const recent = useRecentEntries(8);
  const month = useFinanceSummary(periodRange('MONTH'));
  const overdue = useOverdueFees(6);
  const unread = useUnreadMessages();
  const refreshControl = useRefreshControl(balances.refetch, fees.refetch, recent.refetch, overdue.refetch, month.refetch);

  const go = (route?: string) => route && router.push(route as Href);
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;
  const summary = fees.data;
  const accounts = balances.data ?? [];

  const tiles = [
    { label: 'Account Balance', value: balances.data ? formatMoney(totalBalance(accounts)) : '–', route: routeFor('accountant', '/finance/accounts') },
    { label: 'Fees Collected', value: summary ? formatMoney(summary.totalCollected) : '–', route: routeFor('accountant', '/finance/fees') },
    { label: 'Fees Pending', value: summary ? formatMoney(summary.totalPending) : '–', route: routeFor('accountant', '/finance/fees') },
    { label: 'Collection Rate', value: summary?.rate != null ? `${summary.rate}%` : '–', route: routeFor('accountant', '/finance') },
  ];

  const quick = [
    { label: 'Reports', icon: '📊', route: routeFor('accountant', '/finance') },
    { label: 'Income', icon: '💵', route: routeFor('accountant', '/finance/income') },
    { label: 'Expenses', icon: '🧾', route: routeFor('accountant', '/finance/expenses') },
    { label: unread > 0 ? `Messages (${unread})` : 'Messages', icon: '💬', route: routeFor('accountant', '/messages') },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.greeting}>Welcome back, {name}</Text>
      <SchoolSwitcher />

      <StatTiles tiles={tiles} onPress={go} />
      {summary?.rate != null ? (
        <View style={styles.rateRow}><StatusPill label={summary.rate >= 80 ? 'On track' : summary.rate >= 50 ? 'Needs attention' : 'Critical'} tone={rateTone(summary.rate)} /></View>
      ) : null}

      <View style={styles.actions}>
        {quick.map((a) => (
          <TouchableOpacity accessibilityRole="button" key={a.label} style={styles.quick} onPress={() => go(a.route)}>
            <Text style={styles.quickIcon}>{a.icon}</Text>
            <Text style={styles.quickLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {summary && summary.byClass.length > 0 ? (
        <>
          <Text style={styles.section}>Collection by class</Text>
          <Card style={styles.list}>
            {summary.byClass.slice(0, 8).map((c) => (
              <View key={c.name} style={styles.line}>
                <Text style={styles.lineTitle} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.lineSub}>{formatMoney(c.collected)} / {formatMoney(c.due)}</Text>
                <StatusPill label={c.rate != null ? `${c.rate}%` : '–'} tone={rateTone(c.rate)} />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Text style={styles.section}>Income vs expense, this month</Text>
      {month.data ? (
        <IncomeExpenseCard income={Number(month.data.total_income ?? 0) || 0} expenses={Number(month.data.total_expenses ?? 0) || 0} />
      ) : <Card style={styles.list}><Text style={styles.muted}>{month.isLoading ? 'Loading…' : 'Could not load.'}</Text></Card>}

      <View style={styles.sectionRow}>
        <Text style={styles.section}>Account balances</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => go(routeFor('accountant', '/finance/accounts'))} style={styles.linkBox}>
          <Text style={styles.link}>See all</Text>
        </TouchableOpacity>
      </View>
      <Card style={styles.list}>
        {accounts.length === 0 ? (
          <Text style={styles.muted}>{balances.isLoading ? 'Loading…' : 'No accounts yet.'}</Text>
        ) : accounts.map((a) => (
          <View key={a.id} style={styles.line}>
            <Text style={[styles.lineTitle, styles.lineBody]} numberOfLines={1}>{a.name}</Text>
            <Text style={styles.lineAmount}>{formatMoney(Number(a.net_balance ?? a.balance) || 0)}</Text>
          </View>
        ))}
      </Card>

      <Text style={styles.section}>Recent transactions</Text>
      <Card style={styles.list}>
        {(recent.data ?? []).length === 0 ? (
          <Text style={styles.muted}>{recent.isLoading ? 'Loading…' : 'No transactions yet.'}</Text>
        ) : (
          (recent.data ?? []).slice(0, 8).map((e) => (
            <View key={`${e.type}-${e.id}`} style={styles.line}>
              <View style={styles.lineBody}>
                <Text style={styles.lineTitle} numberOfLines={1}>{e.description || 'Transaction'}</Text>
                <Text style={styles.lineSub}>{e.date ?? ''}</Text>
              </View>
              <Text style={[styles.lineAmount, { color: entrySign(e.type) === '-' ? Colors.error : entrySign(e.type) === '+' ? Colors.success : Colors.text }]}>
                {entryAmount(e)}
              </Text>
            </View>
          ))
        )}
      </Card>

      {(overdue.data ?? []).length > 0 ? (
        <>
          <Text style={styles.section}>Overdue fees</Text>
          <Card style={styles.list}>
            {(overdue.data ?? []).map((p) => (
              <View key={p.id} style={styles.line}>
                <View style={styles.lineBody}>
                  <Text style={styles.lineTitle} numberOfLines={1}>{p.student_name}</Text>
                  <Text style={styles.lineSub} numberOfLines={1}>{p.class_name ?? ''}</Text>
                </View>
                <Text style={[styles.lineAmount, { color: Colors.error }]}>{formatMoney(balanceOf(p))}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <RecentNotifications enabled={isModuleEnabled('notifications')} onSeeAll={() => go(routeFor('accountant', '/notifications'))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  linkBox: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  rateRow: { marginTop: Spacing.sm, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.lg },
  quick: { width: '22%', minWidth: 72, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  quickIcon: { fontSize: 22 },
  quickLabel: { fontSize: FontSize.xs, color: Colors.text, marginTop: 4, textAlign: 'center' },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  list: { padding: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6 },
  lineBody: { flex: 1 },
  lineTitle: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  lineSub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  lineAmount: { fontSize: FontSize.sm, fontWeight: '700' },
});
