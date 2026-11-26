import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
import RecordCard from '../ui/RecordCard';
import AppList from '../ui/AppList';

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
      <AppList
        data={query.data ?? []}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListEmptyComponent={<EmptyState title="No messages yet" message={base === '/(admin)' ? 'Start a conversation with a member of staff.' : 'Start a conversation with the school office.'} />}
        renderItem={({ item: t }) => {
          const unread = t.unread_count ?? 0;
          return (
            <RecordCard
              title={threadTitle(t)}
              avatarName={threadTitle(t)}
              subtitle={t.latest_message || t.subject || ''}
              meta={[roleLabel(t.other_participant_role), t.student_name].filter(Boolean).join('  ·  ') || undefined}
              trailing={timeAgo(t.latest_message_at || t.created_at)}
              badge={unread}
              accessibilityLabel={`${threadTitle(t)}${unread > 0 ? `, ${unread} unread` : ''}`}
              onPress={() => router.push({ pathname: `${base}/messages/thread`, params: { id: t.id } } as Href)}
            />
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
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
});
