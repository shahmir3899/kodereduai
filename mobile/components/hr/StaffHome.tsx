import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import { useMyInventory, useMyPayslips, useUnreadNotifications } from '../../hooks/useStaff';
import { useMyLeaveApplications } from '../../hooks/useMyHr';
import { useUnreadMessages } from '../../hooks/useMessaging';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { payslipPeriod, sortPayslips } from '../../services/accountant';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import SchoolSwitcher from '../nav/SchoolSwitcher';
import StatTiles from '../dashboard/StatTiles';
import RecentNotifications from '../dashboard/RecentNotifications';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Port of frontend/src/pages/staff/StaffDashboard.jsx: own leave, payslips, assigned items and
// the unread counts. Staff have no student, finance or academic data.
export default function StaffHome() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const hrOn = isModuleEnabled('hr');
  const leave = useMyLeaveApplications();
  const payslips = useMyPayslips();
  const inventory = useMyInventory();
  const unreadNotes = useUnreadNotifications();
  const unreadMsgs = useUnreadMessages();
  const refreshControl = useRefreshControl(leave.refetch, payslips.refetch, inventory.refetch);

  const go = (route?: string) => route && router.push(route as Href);
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;
  const pending = (leave.data ?? []).filter((a) => a.status === 'PENDING').length;
  const latest = sortPayslips(payslips.data ?? [])[0];
  const held = (inventory.data ?? []).filter((a) => a.is_active).length;

  const tiles = [
    ...(hrOn ? [
      { label: 'Pending Leave', value: leave.data ? String(pending) : '–', route: routeFor('staff', '/hr/self-service') },
      { label: latest ? `Latest payslip` : 'Payslips', value: latest ? formatMoney(Number(latest.net_salary) || 0) : '–', route: routeFor('staff', '/hr/payslips') },
    ] : []),
    ...(isModuleEnabled('inventory') && (inventory.data ?? []).length > 0
      ? [{ label: 'Items With You', value: String(held), route: routeFor('staff', '/inventory/assignments') }]
      : []),
    ...(isModuleEnabled('notifications')
      ? [{ label: 'Unread Notifications', value: String(unreadNotes), route: routeFor('staff', '/notifications') }]
      : []),
  ];

  const quick = [
    { label: 'Apply Leave', icon: '🗓️', route: routeFor('staff', '/hr/self-service'), show: hrOn },
    { label: 'Payslips', icon: '🧾', route: routeFor('staff', '/hr/payslips'), show: hrOn },
    { label: unreadMsgs > 0 ? `Messages (${unreadMsgs})` : 'Messages', icon: '💬', route: routeFor('staff', '/messages'), show: true },
  ].filter((a) => a.show);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.greeting}>Welcome back, {name}</Text>
      <SchoolSwitcher />

      <StatTiles tiles={tiles} onPress={go} />

      <View style={styles.actions}>
        {quick.map((a) => (
          <TouchableOpacity accessibilityRole="button" key={a.label} style={styles.quick} onPress={() => go(a.route)}>
            <Text style={styles.quickIcon}>{a.icon}</Text>
            <Text style={styles.quickLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {hrOn && latest ? (
        <>
          <Text style={styles.section}>Recent payslips</Text>
          <Card style={styles.list}>
            {sortPayslips(payslips.data ?? []).slice(0, 3).map((p) => (
              <View key={p.id} style={styles.line}>
                <Text style={styles.lineTitle}>{payslipPeriod(p)}</Text>
                <StatusPill label={p.status_display ?? p.status} tone={p.status === 'PAID' ? 'success' : p.status === 'APPROVED' ? 'info' : 'neutral'} />
                <Text style={styles.lineAmount}>{formatMoney(Number(p.net_salary) || 0)}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
      <RecentNotifications enabled={isModuleEnabled('notifications')} onSeeAll={() => go(routeFor('staff', '/notifications'))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.lg },
  quick: { width: '30%', minWidth: 84, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  quickIcon: { fontSize: 22 },
  quickLabel: { fontSize: FontSize.xs, color: Colors.text, marginTop: 4, textAlign: 'center' },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  list: { padding: Spacing.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6 },
  lineTitle: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  lineAmount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
});
