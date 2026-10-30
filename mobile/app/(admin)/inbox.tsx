import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../../services/api';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import NotificationItem from '../../components/NotificationItem';
import QueryBoundary from '../../components/ui/QueryBoundary';
import { useToast } from '../../components/ui/Toast';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface NotificationRecord {
  id: number; title: string; message: string; created_at: string; is_read: boolean; notification_type?: string;
}

const ROOT = 'my-notifications';

export default function Inbox() {
  const toast = useToast();
  const qc = useQueryClient();
  const query = useScopedQuery<NotificationRecord[]>(ROOT, [], async () => {
    const r = await notificationsApi.getMyNotifications();
    return r.data.results || r.data.notifications || r.data || [];
  });
  const refreshControl = useRefreshControl(query.refetch);

  // Mark as read in the cached list straight away; a failure puts the real state back.
  const patch = (fn: (n: NotificationRecord) => NotificationRecord) =>
    qc.setQueriesData<NotificationRecord[]>({ predicate: (q) => q.queryKey[0] === ROOT }, (old) => old?.map(fn));
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === ROOT });

  const markRead = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onMutate: (id) => patch((n) => (n.id === id ? { ...n, is_read: true } : n)),
    onError: () => { refresh(); toast.error('Could not mark it as read.'); },
  });
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: () => patch((n) => ({ ...n, is_read: true })),
    onError: () => { refresh(); toast.error('Could not mark all as read.'); },
  });

  const unreadCount = (query.data ?? []).filter((n) => !n.is_read).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Inbox</Text>
        {unreadCount > 0 && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Mark all notifications as read" onPress={() => markAll.mutate()}>
            <Text style={styles.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>
      <QueryBoundary query={query} emptyTitle="No Notifications" emptyMessage="You're all caught up!">
        {(items) => items.map((n) => (
          <NotificationItem key={n.id} id={n.id} title={n.title} message={n.message}
            created_at={n.created_at} is_read={n.is_read} notification_type={n.notification_type}
            onPress={(id: number) => markRead.mutate(id)} />
        ))}
      </QueryBoundary>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  markAllText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
});
