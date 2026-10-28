import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useThreads } from '../../hooks/useMessaging';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { roleLabel, threadTitle, timeAgo } from '../../services/messaging';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Button from '../ui/Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Conversations with the school's admins. Opening one marks it read on the server.
export default function ThreadListScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  const query = useThreads();
  const refreshControl = useRefreshControl(query.refetch);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={query.data ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListEmptyComponent={<EmptyState title="No messages yet" message="Start a conversation with the school office." />}
        renderItem={({ item: t }) => {
          const unread = t.unread_count ?? 0;
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push({ pathname: `${base}/messages/thread`, params: { id: t.id } } as Href)}
            >
              <View style={styles.top}>
                <Text style={[styles.name, unread > 0 && styles.bold]} numberOfLines={1}>{threadTitle(t)}</Text>
                <Text style={styles.time}>{timeAgo(t.latest_message_at || t.created_at)}</Text>
              </View>
              {t.other_participant_role || t.student_name ? (
                <Text style={styles.role}>{[roleLabel(t.other_participant_role), t.student_name].filter(Boolean).join('  ·  ')}</Text>
              ) : null}
              <View style={styles.bottom}>
                <Text style={[styles.preview, unread > 0 && styles.bold]} numberOfLines={1}>{t.latest_message || t.subject || ''}</Text>
                {unread > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{unread}</Text></View> : null}
              </View>
            </TouchableOpacity>
          );
        }}
      />
      <View style={styles.footer}>
        <Button title="New message" onPress={() => router.push(`${base}/messages/new` as Href)} fullWidth size="lg" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 100 },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  bold: { fontWeight: '700' },
  time: { fontSize: FontSize.xs, color: Colors.textSecondary },
  role: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.xs, gap: Spacing.sm },
  preview: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  badge: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: Colors.textInverse, fontSize: FontSize.xs, fontWeight: '700' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
});
