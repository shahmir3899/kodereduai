import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  FlatList,
} from 'react-native';
import { parentsApi } from '../../services/api';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
import EmptyState from '../../components/ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Thread {
  id: number;
  subject: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
  participants: string[];
}

interface Message {
  id: number;
  sender_name: string;
  content: string;
  created_at: string;
  is_mine: boolean;
}

type ViewMode = 'threads' | 'chat' | 'compose';

export default function Messages() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('threads');
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sending, setSending] = useState(false);

  // Compose state
  const [composeSubject, setComposeSubject] = useState('');
  const [composeMessage, setComposeMessage] = useState('');

  const fetchThreads = async () => {
    try {
      const response = await parentsApi.getMessageThreads();
      setThreads(response.data.results || response.data || []);
    } catch (error) {
      console.error('Failed to fetch threads:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchMessages = async (threadId: number) => {
    try {
      const response = await parentsApi.getThreadMessages(threadId);
      setMessages(response.data.messages || response.data || []);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    }
  };

  useEffect(() => {
    fetchThreads();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    if (viewMode === 'threads') {
      fetchThreads();
    } else if (activeThread) {
      fetchMessages(activeThread.id);
      setRefreshing(false);
    }
  };

  const openThread = async (thread: Thread) => {
    setActiveThread(thread);
    setViewMode('chat');
    await fetchMessages(thread.id);
    if (thread.unread_count > 0) {
      try {
        await parentsApi.markMessageRead(thread.id);
      } catch {}
    }
  };

  const sendMessage = async () => {
    if (!messageText.trim() || !activeThread) return;

    setSending(true);
    try {
      await parentsApi.sendMessage({
        thread_id: activeThread.id,
        content: messageText.trim(),
      });
      setMessageText('');
      fetchMessages(activeThread.id);
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  const sendNewMessage = async () => {
    if (!composeSubject.trim() || !composeMessage.trim()) return;

    setSending(true);
    try {
      await parentsApi.sendMessage({
        subject: composeSubject.trim(),
        content: composeMessage.trim(),
      });
      setComposeSubject('');
      setComposeMessage('');
      setViewMode('threads');
      fetchThreads();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Spinner fullScreen message="Loading messages..." />;

  // Thread List View
  if (viewMode === 'threads') {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.headerRow}>
          <Text style={styles.title}>Messages</Text>
          <TouchableOpacity
            style={styles.composeBtn}
            onPress={() => setViewMode('compose')}
          >
            <Text style={styles.composeBtnText}>+ New</Text>
          </TouchableOpacity>
        </View>

        {threads.length === 0 ? (
          <EmptyState
            title="No Messages"
            message="You don't have any messages yet."
          />
        ) : (
          threads.map((thread) => (
            <TouchableOpacity
              key={thread.id}
              onPress={() => openThread(thread)}
            >
              <Card style={styles.threadCard}>
                <View style={styles.threadHeader}>
                  <Text style={styles.threadSubject} numberOfLines={1}>
                    {thread.subject || 'No Subject'}
                  </Text>
                  {thread.unread_count > 0 && (
                    <Badge label={String(thread.unread_count)} variant="error" />
                  )}
                </View>
                <Text style={styles.threadPreview} numberOfLines={2}>
                  {thread.last_message || 'No messages'}
                </Text>
                <Text style={styles.threadTime}>
                  {thread.last_message_at
                    ? new Date(thread.last_message_at).toLocaleDateString()
                    : ''}
                </Text>
              </Card>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    );
  }

  // Compose View
  if (viewMode === 'compose') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => setViewMode('threads')}>
              <Text style={styles.backText}>‹ Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>New Message</Text>
            <View style={{ width: 50 }} />
          </View>

          <Text style={styles.label}>Subject</Text>
          <TextInput
            style={styles.input}
            placeholder="Message subject..."
            placeholderTextColor={Colors.placeholder}
            value={composeSubject}
            onChangeText={setComposeSubject}
          />

          <Text style={styles.label}>Message</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Type your message..."
            placeholderTextColor={Colors.placeholder}
            value={composeMessage}
            onChangeText={setComposeMessage}
            multiline
            numberOfLines={6}
          />

          <TouchableOpacity
            style={[styles.sendButton, sending && styles.sendButtonDisabled]}
            onPress={sendNewMessage}
            disabled={sending}
          >
            <Text style={styles.sendButtonText}>
              {sending ? 'Sending...' : 'Send Message'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  // Chat View
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Chat Header */}
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={() => setViewMode('threads')}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.chatTitle} numberOfLines={1}>
          {activeThread?.subject || 'Chat'}
        </Text>
        <View style={{ width: 50 }} />
      </View>

      {/* Messages */}
      <FlatList
        data={messages}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.messageList}
        renderItem={({ item }) => (
          <View
            style={[
              styles.messageBubble,
              item.is_mine ? styles.myMessage : styles.theirMessage,
            ]}
          >
            {!item.is_mine && (
              <Text style={styles.senderName}>{item.sender_name}</Text>
            )}
            <Text style={[
              styles.messageContent,
              item.is_mine && { color: Colors.textInverse },
            ]}>
              {item.content}
            </Text>
            <Text style={[
              styles.messageTime,
              item.is_mine && { color: 'rgba(255,255,255,0.7)' },
            ]}>
              {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}
      />

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.chatInput}
          placeholder="Type a message..."
          placeholderTextColor={Colors.placeholder}
          value={messageText}
          onChangeText={setMessageText}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, !messageText.trim() && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!messageText.trim() || sending}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  composeBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  composeBtnText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.sm,
  },
  threadCard: {
    marginBottom: Spacing.md,
  },
  threadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  threadSubject: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
    marginRight: Spacing.sm,
  },
  threadPreview: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 4,
  },
  threadTime: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
  },
  backText: {
    fontSize: FontSize.lg,
    color: Colors.primary,
    fontWeight: '600',
  },
  label: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.sm,
    marginTop: Spacing.md,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    fontSize: FontSize.sm,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: Colors.primary,
    borderRadius: BorderRadius.sm,
    padding: Spacing.md,
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.md,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  chatTitle: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
    flex: 1,
    textAlign: 'center',
  },
  messageList: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  myMessage: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
  },
  theirMessage: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
  },
  senderName: {
    fontSize: FontSize.xs,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 4,
  },
  messageContent: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  messageTime: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
  },
  chatInput: {
    flex: 1,
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.sm,
    color: Colors.text,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.lg,
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: Colors.textInverse,
    fontWeight: '600',
    fontSize: FontSize.sm,
  },
});
