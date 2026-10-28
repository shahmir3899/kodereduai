import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useChildren, useLeaveRequests } from '../../hooks/useParent';
import { useRecentNotifications } from '../../hooks/useManager';
import { useThreads } from '../../hooks/useMessaging';
import { totalUnread } from '../../services/messaging';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import ChildCard from '../../components/parent/ChildCard';
import Card from '../../components/ui/Card';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import SchoolSwitcher from '../../components/nav/SchoolSwitcher';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export default function ParentDashboard() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const children = useChildren();
  const leave = useLeaveRequests();
  const threads = useThreads();
  const notifications = useRecentNotifications(isModuleEnabled('notifications'), 3);
  const refreshControl = useRefreshControl(children.refetch, leave.refetch, threads.refetch, notifications.refetch);
  const go = (route: string) => router.push(route as Href);

  if (children.isLoading) return <Skeleton />;
  if (children.isError && !children.data) return <ErrorState error={children.error} onRetry={() => children.refetch()} />;

  const kids = children.data ?? [];
  const unread = totalUnread(threads.data ?? []);
  const pendingLeave = (leave.data ?? []).filter((l) => l.status === 'PENDING').length;
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.greeting}>Welcome, {name}</Text>
      <SchoolSwitcher />

      {kids.length === 0 ? (
        <EmptyState title="No children linked" message="Ask the school office for an invite code to link your child, or switch school above." />
      ) : (
        <>
          <Text style={styles.section}>{kids.length === 1 ? 'Your child' : 'Your children'}</Text>
          {kids.map((c) => <ChildCard key={c.id} child={c} />)}
        </>
      )}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.quick} onPress={() => go('/(parent)/messages')}>
          <Text style={styles.quickIcon}>💬</Text>
          <Text style={styles.quickLabel}>{unread > 0 ? `Messages (${unread})` : 'Messages'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quick} onPress={() => go('/(parent)/leave')}>
          <Text style={styles.quickIcon}>🗓️</Text>
          <Text style={styles.quickLabel}>{pendingLeave > 0 ? `Leave (${pendingLeave} pending)` : 'Leave'}</Text>
        </TouchableOpacity>
      </View>

      {isModuleEnabled('notifications') ? (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.section}>Notifications</Text>
            <TouchableOpacity onPress={() => go('/(parent)/inbox')}><Text style={styles.link}>See all</Text></TouchableOpacity>
          </View>
          <Card style={styles.list}>
            {(notifications.data ?? []).length === 0 ? (
              <Text style={styles.muted}>{notifications.isLoading ? 'Loading…' : 'No notifications.'}</Text>
            ) : (notifications.data ?? []).map((n) => (
              <View key={n.id} style={styles.note}>
                <Text style={[styles.noteTitle, !n.is_read && styles.bold]} numberOfLines={1}>{n.title}</Text>
                <Text style={styles.noteBody} numberOfLines={2}>{n.message}</Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600', marginBottom: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.sm },
  quick: { flex: 1, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  quickIcon: { fontSize: 22 },
  quickLabel: { fontSize: FontSize.sm, color: Colors.text, marginTop: 4, textAlign: 'center' },
  list: { padding: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  note: { paddingVertical: 6 },
  noteTitle: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '700' },
  noteBody: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
