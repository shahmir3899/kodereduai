import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notificationsApi } from '../../services/api';
import { notificationsOf } from '../../services/manager';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import NotificationItem from '../NotificationItem';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The signed-in person's notifications. Tapping one marks it read.
export default function NotificationsScreen() {
  const qc = useQueryClient();
  const query = useScopedQuery('myNotifications', ['all'], async () =>
    notificationsOf((await notificationsApi.getMyNotifications()).data), { staleTime: 30_000 });
  const refreshControl = useRefreshControl(query.refetch);
  const done = () => qc.invalidateQueries({ queryKey: ['myNotifications'] });
  const markRead = useMutation({ mutationFn: (id: number) => notificationsApi.markRead(id), onSuccess: done });
  const markAll = useMutation({ mutationFn: () => notificationsApi.markAllRead(), onSuccess: done });

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const items = query.data ?? [];
  const unread = items.filter((n) => !n.is_read).length;

  return (
    <View style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={(n) => String(n.id)}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListHeaderComponent={unread > 0 ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => markAll.mutate()} style={styles.markAll}>
            <Text style={styles.markAllText}>Mark all read ({unread})</Text>
          </TouchableOpacity>
        ) : null}
        ListEmptyComponent={<EmptyState title="No notifications" message="You're all caught up!" />}
        renderItem={({ item: n }) => (
          <NotificationItem id={n.id} title={n.title} message={n.message} created_at={n.created_at}
            is_read={n.is_read} notification_type={n.notification_type}
            onPress={(id) => { if (!n.is_read) markRead.mutate(id); }} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  markAll: { alignSelf: 'flex-end', marginBottom: Spacing.md },
  markAllText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
});
