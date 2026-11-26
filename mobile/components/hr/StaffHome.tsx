import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import { useMyInventory, useUnreadNotifications } from '../../hooks/useStaff';
import { useUnreadMessages } from '../../hooks/useMessaging';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { sortAssignments } from '../../services/financeManager';
import Card from '../ui/Card';
import HomeHero from '../dashboard/HomeHero';
import { splitTiles } from '../../services/homeHero';
import StatTiles from '../dashboard/StatTiles';
import RecentNotifications from '../dashboard/RecentNotifications';
import { OwnHrPanels, useOwnHr } from './OwnHrHome';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import TileGrid from '../../components/ui/TileGrid';
import type { IconName } from '../../components/ui/Icon';

// Port of frontend/src/pages/staff/StaffDashboard.jsx: own attendance, leave, payslips, assigned
// items and the unread counts. Staff have no student, finance or academic data.
export default function StaffHome() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const hrOn = isModuleEnabled('hr');
  const own = useOwnHr({
    attendance: routeFor('staff', '/hr/self-service'),
    leave: routeFor('staff', '/hr/self-service'),
    payslips: routeFor('staff', '/hr/payslips'),
  });
  const inventory = useMyInventory();
  const unreadNotes = useUnreadNotifications();
  const unreadMsgs = useUnreadMessages();
  const refreshControl = useRefreshControl(...own.refetch, inventory.refetch);

  const go = (route?: string) => route && router.push(route as Href);
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;
  const pending = (own.leave.data ?? []).filter((a) => a.status === 'PENDING').length;
  const held = (inventory.data ?? []).filter((a) => a.is_active).length;
  const items = sortAssignments(inventory.data ?? []).filter((a) => a.is_active).slice(0, 5);

  const tiles = [
    ...(hrOn ? [
      ...own.tiles,
      ...(pending > 0 ? [{ label: 'Pending Leave', value: String(pending), route: routeFor('staff', '/hr/self-service') }] : []),
    ] : []),
    ...(isModuleEnabled('inventory') && (inventory.data ?? []).length > 0
      ? [{ label: 'Items With You', value: String(held), route: routeFor('staff', '/inventory/assignments') }]
      : []),
    ...(isModuleEnabled('notifications')
      ? [{ label: 'Unread Notifications', value: String(unreadNotes), route: routeFor('staff', '/notifications') }]
      : []),
  ];

  const quick = [
    { label: 'My Profile', icon: 'person-outline' as IconName, route: '/(staff)/my-profile', show: true },
    { label: 'Apply Leave', icon: 'calendar-outline' as IconName, route: routeFor('staff', '/hr/self-service'), show: hrOn },
    { label: 'Payslips', icon: 'receipt-outline' as IconName, route: routeFor('staff', '/hr/payslips'), show: hrOn },
    { label: unreadNotes > 0 ? `Notifications (${unreadNotes})` : 'Notifications', icon: 'notifications-outline' as IconName, route: routeFor('staff', '/notifications'), show: isModuleEnabled('notifications') },
    { label: unreadMsgs > 0 ? `Messages (${unreadMsgs})` : 'Messages', icon: 'chatbubbles-outline' as IconName, route: routeFor('staff', '/messages'), show: true },
  ].filter((a) => a.show);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <HomeHero name={name ?? ""} stats={splitTiles(tiles).hero} onPress={go} />
      <StatTiles tiles={splitTiles(tiles).rest} onPress={go} />

      <TileGrid items={quick.map((a) => ({ label: a.label, icon: a.icon, onPress: a.route ? () => go(a.route) : undefined }))} />

      {hrOn ? <OwnHrPanels balance={own.balance} payslips={own.payslips} /> : null}
      {items.length > 0 ? (
        <>
          <Text style={styles.section}>Assigned items</Text>
          <Card style={styles.list}>
            {items.map((a) => (
              <View key={a.id} style={styles.line}>
                <Text style={styles.lineTitle} numberOfLines={1}>{a.item_name}</Text>
                <Text style={styles.lineAmount}>{Number(a.quantity)}{a.item_unit ? ` ${a.item_unit}` : ''}</Text>
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
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  list: { padding: Spacing.md },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 6 },
  lineTitle: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  lineAmount: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
});
