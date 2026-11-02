import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { confirm } from './ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/colors';

interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  created_at?: string;
}

interface ChatInterfaceProps {
  sendMessage: (message: string) => Promise<{ data: { response?: string; message?: string; reply?: string; history?: ChatMessage[] } }>;
  getHistory: () => Promise<{ data: ChatMessage[] | { history?: ChatMessage[]; messages?: ChatMessage[] } }>;
  clearHistory?: () => Promise<unknown>;
  placeholder?: string;
  welcomeMessage?: string;
  // Tap-to-ask starters, shown while the chat has no history.
  suggestions?: string[];
}

export default function ChatInterface({
  sendMessage: sendMessageApi,
  getHistory,
  clearHistory,
  placeholder = 'Type a message...',
  welcomeMessage = 'Hello! How can I help you today?',
  suggestions,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const response = await getHistory();
      const data = response.data;
      const history = Array.isArray(data) ? data : (data.history || data.messages || []);
      if (history.length > 0) {
        setMessages(history);
      } else {
        setMessages([{ role: 'assistant', content: welcomeMessage }]);
      }
    } catch {
      setMessages([{ role: 'assistant', content: welcomeMessage }]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleSend = async (text?: string) => {
    const userMessage = (text ?? input).trim();
    if (!userMessage || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const response = await sendMessageApi(userMessage);
      const data = response.data;
      const reply = data.response || data.message || data.reply || 'Sorry, I could not process your request.';
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (e: any) {
      // The study helper answers limits ("Daily limit reached") with a readable error.
      const reason = e?.response?.data?.error;
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: typeof reason === 'string' ? reason : 'Sorry, something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    if (!clearHistory) return;
    const yes = await confirm({
      title: 'Clear chat',
      message: 'Delete this whole conversation? Your saved chat cannot be brought back.',
      confirmLabel: 'Clear chat',
      destructive: true,
    });
    if (!yes) return;
    try {
      await clearHistory();
      setMessages([{ role: 'assistant', content: welcomeMessage }]);
    } catch {
      Alert.alert('Error', 'Failed to clear chat history.');
    }
  };

  const fresh = messages.length === 1 && messages[0].role === 'assistant' && !loading;

  if (historyLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      {/* Header with clear button */}
      {clearHistory && (
        <View style={styles.header}>
          <TouchableOpacity accessibilityRole="button" onPress={handleClear}>
            <Text style={styles.clearText}>Clear Chat</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(_, index) => String(index)}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === 'user' ? styles.userBubble : styles.assistantBubble,
            ]}
          >
            <Text
              style={[
                styles.bubbleText,
                item.role === 'user' && { color: Colors.textInverse },
              ]}
            >
              {item.content}
            </Text>
          </View>
        )}
      />

      {fresh && suggestions?.length ? (
        <View style={styles.suggestions}>
          {suggestions.map((q) => (
            <TouchableOpacity key={q} accessibilityRole="button" style={styles.chip} onPress={() => handleSend(q)}>
              <Text style={styles.chipText}>{q}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* Loading indicator */}
      {loading && (
        <View style={styles.typingIndicator}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.typingText}>Thinking...</Text>
        </View>
      )}

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.placeholder}
          value={input}
          onChangeText={setInput}
          multiline
          maxLength={2000}
          editable={!loading}
        />
        <TouchableOpacity accessibilityRole="button"
          style={[styles.sendBtn, (!input.trim() || loading) && styles.sendBtnDisabled]}
          onPress={() => handleSend()}
          disabled={!input.trim() || loading}
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
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  chip: { backgroundColor: Colors.surface, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border },
  chipText: { fontSize: FontSize.sm, color: Colors.text },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    padding: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  clearText: {
    fontSize: FontSize.xs,
    color: Colors.error,
    fontWeight: '600',
  },
  messageList: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  bubble: {
    maxWidth: '85%',
    padding: Spacing.md,
    borderRadius: BorderRadius.lg,
    marginBottom: Spacing.sm,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bubbleText: {
    fontSize: FontSize.sm,
    color: Colors.text,
    lineHeight: 20,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  typingText: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
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
  input: {
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
