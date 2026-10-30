import React, { useState } from 'react';
import { View, Text, FlatList, TextInput, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useMessageActions, useThread } from '../../hooks/useMessaging';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { canSend, timeAgo } from '../../services/messaging';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import Button from '../ui/Button';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { saveFailureMessage } from '../../services/errorKind';

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const query = useThread(String(id));
  const { reply } = useMessageActions();
  const refreshControl = useRefreshControl(query.refetch);
  const [text, setText] = useState('');

  if (query.isLoading) return <Skeleton />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const send = () => {
    const message = text.trim();
    if (!canSend(message, null, false)) return;
    reply.mutateAsync({ id: String(id), message })
      .then(() => setText(''))
      .catch((e: any) => toast.error(e?.response ? e?.response?.data?.detail || e?.response?.data?.error || 'Could not send the message.' : saveFailureMessage(e)));
  };

  // Server order is oldest first; the list is inverted so the newest sits at the bottom.
  const messages = [...query.data.messages].reverse();

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        inverted
        data={messages}
        keyExtractor={(m) => String(m.id)}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        renderItem={({ item: m }) => (
          <View style={[styles.bubble, m.is_mine ? styles.mine : styles.theirs]}>
            {!m.is_mine ? <Text style={styles.sender}>{m.sender_name}</Text> : null}
            <Text style={[styles.body, m.is_mine && { color: Colors.textInverse }]}>{m.body}</Text>
            <Text style={[styles.time, m.is_mine && { color: Colors.textInverse }]}>{timeAgo(m.created_at)}</Text>
          </View>
        )}
      />
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Write a reply..."
          placeholderTextColor={Colors.textTertiary}
          multiline
        />
        <Button title="Send" onPress={send} loading={reply.isPending} disabled={!canSend(text, null, false)} size="md" />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  bubble: { maxWidth: '82%', borderRadius: BorderRadius.lg, padding: Spacing.md, marginBottom: Spacing.sm },
  mine: { alignSelf: 'flex-end', backgroundColor: Colors.primary },
  theirs: { alignSelf: 'flex-start', backgroundColor: Colors.surface },
  sender: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, marginBottom: 2 },
  body: { fontSize: FontSize.md, color: Colors.text },
  time: { fontSize: 10, color: Colors.textSecondary, marginTop: 4, alignSelf: 'flex-end' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, padding: Spacing.md, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  input: { flex: 1, maxHeight: 120, backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.md, color: Colors.text },
});
