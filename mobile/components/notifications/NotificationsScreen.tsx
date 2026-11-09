import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { notificationsApi } from '../../services/api';
import { useScopedPagedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import NotificationItem from '../NotificationItem';
import SegmentedTabs from '../ui/SegmentedTabs';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { confirm } from '../ui/confirm';
import { useToast } from '../ui/Toast';
import {
  EVENT_TYPE_OPTIONS, bundleNotifications, groupByDay, normalizeNotification, notificationDestination,
  type NotificationEntry, type NotificationRecord,
} from '../../services/notificationMeta';
import { Colors, FontSize, Spacing } from '../../constants/colors';

const ROOT = 'myNotifications';
const PAGE_SIZE = 20;

interface Page { results: NotificationRecord[]; next: string | null; count: number }
type Row = { kind: 'header'; key: string; label: string } | { kind: 'item'; key: string; n: NotificationEntry };

const TYPE_TABS = [{ value: '', label: 'All' }, ...EVENT_TYPE_OPTIONS];

// The signed-in person's notifications, shared by every role's inbox. Server-paged (20 a time),
// so a long history is never rendered at once; tapping marks read and opens the related screen.
export default function NotificationsScreen() {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const { user, persona } = useAuth();
  const { refreshUnreadCount } = useNotifications();
  const [type, setType] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [schoolId, setSchoolId] = useState('');
  const schools = user?.schools ?? [];
  const multiSchool = schools.length > 1;

  const query = useScopedPagedQuery<NotificationRecord>(ROOT, ['inbox', type, unreadOnly, schoolId], async (page) => {
    const r = (await notificationsApi.getMyNotifications({
      page, page_size: PAGE_SIZE,
      event_type: type || undefined, unread: unreadOnly ? 1 : undefined, school_id: schoolId || undefined,
    })).data;
    const rows: unknown[] = Array.isArray(r) ? r : (r.results ?? r.notifications ?? []);
    return { results: rows.map(normalizeNotification), next: Array.isArray(r) ? null : (r.next ?? null), count: r.count ?? rows.length };
  });
  const refreshControl = useRefreshControl(query.refetch);

  const items = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.results), [query.data]);
  const unread = items.filter((n) => !n.is_read).length;

  // Show the change straight away; a failure refetches the real state.
  const patch = useCallback((fn: (n: NotificationRecord) => NotificationRecord) => {
    qc.setQueriesData<InfiniteData<Page>>({ predicate: (q) => q.queryKey[0] === ROOT }, (old) =>
      old && 'pages' in old ? { ...old, pages: old.pages.map((p) => ({ ...p, results: p.results.map(fn) })) } : old);
  }, [qc]);
  const refresh = useCallback(() => {
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === ROOT });
    refreshUnreadCount();
  }, [qc, refreshUnreadCount]);

  const markRead = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onMutate: (id) => patch((n) => (n.id === id ? { ...n, is_read: true } : n)),
    onSuccess: refreshUnreadCount,
    onError: () => { refresh(); toast.error('Could not mark it as read.'); },
  });
  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(schoolId ? { school_id: schoolId } : undefined),
    onMutate: () => patch((n) => ({ ...n, is_read: true })),
    onSuccess: refreshUnreadCount,
    onError: () => { refresh(); toast.error('Could not mark all as read.'); },
  });

  const onMarkAll = async () => {
    if (await confirm({ title: 'Mark all as read', message: 'Mark all notifications as read?', confirmLabel: 'Mark all read' })) markAll.mutate();
  };

  const onOpen = useCallback((n: NotificationRecord) => {
    if (!n.is_read) markRead.mutate(n.id);
    const to = notificationDestination(n, persona);
    if (to) router.push(to as Href);
  }, [markRead, persona, router]);

  const rows = useMemo<Row[]>(() => groupByDay(bundleNotifications(items)).flatMap((g) => [
    { kind: 'header' as const, key: `h-${g.label}`, label: g.label },
    ...g.items.map((n) => ({ kind: 'item' as const, key: String(n.id), n })),
  ]), [items]);

  const renderItem = useCallback(({ item }: { item: Row }) => item.kind === 'header'
    ? <Text style={styles.group}>{item.label}</Text>
    : <NotificationItem n={item.n} multiSchool={multiSchool} onOpen={onOpen} />, [multiSchool, onOpen]);

  if (query.isLoading && !query.data) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const filtered = !!type || unreadOnly || !!schoolId;

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        initialNumToRender={8}
        windowSize={7}
        removeClippedSubviews
        onEndReachedThreshold={0.5}
        onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage(); }}
        ListHeaderComponent={(
          <View style={styles.filters}>
            <SegmentedTabs scrollable tabs={TYPE_TABS} value={type} onChange={setType} />
            {multiSchool ? (
              <SegmentedTabs scrollable value={schoolId} onChange={setSchoolId}
                tabs={[{ value: '', label: 'All schools' }, ...schools.map((s) => ({ value: String(s.id), label: s.name }))]} />
            ) : null}
            <View style={styles.bar}>
              <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: unreadOnly }} onPress={() => setUnreadOnly((v) => !v)} style={styles.toggle}>
                <Text style={styles.toggleText}>{unreadOnly ? '☑' : '☐'} Unread only</Text>
              </TouchableOpacity>
              {unread > 0 ? (
                <TouchableOpacity accessibilityRole="button" onPress={onMarkAll}>
                  <Text style={styles.markAllText}>Mark all read ({unread})</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        )}
        ListEmptyComponent={<EmptyState title="No notifications" message={filtered ? 'Nothing matches these filters.' : "You're all caught up!"} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator style={styles.more} color={Colors.primary} /> : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  filters: { gap: Spacing.sm, marginBottom: Spacing.md },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44 },
  toggle: { minHeight: 44, justifyContent: 'center' },
  toggleText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  markAllText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  group: { fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.textSecondary, marginTop: Spacing.sm, marginBottom: Spacing.sm },
  more: { paddingVertical: Spacing.lg },
});
