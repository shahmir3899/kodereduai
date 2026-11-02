import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import ChatInterface from '../../components/ChatInterface';
import { studentPortalApi } from '../../services/api';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The same starters the web offers.
const SUGGESTIONS = [
  'Help me understand fractions',
  'Explain photosynthesis',
  'Quiz me on history',
  'How do I solve quadratic equations?',
  'What are the parts of a cell?',
  'Summarize the water cycle',
];

export default function AIStudyHelper() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>AI Study Helper</Text>
        <Text style={styles.subtitle}>Ask me anything about your subjects</Text>
      </View>
      <ChatInterface
        sendMessage={(message) =>
          studentPortalApi.sendStudyHelperMessage({ message })
        }
        getHistory={() => studentPortalApi.getStudyHelperHistory()}
        clearHistory={() => studentPortalApi.clearStudyHelperHistory()}
        suggestions={SUGGESTIONS}
        placeholder="Ask a study question..."
        welcomeMessage="Hi! I'm your AI study helper. Ask me anything about your subjects - I can help with explanations, practice questions, and more!"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    padding: Spacing.lg,
    paddingBottom: 0,
  },
  title: {
    fontSize: FontSize.xl,
    fontWeight: '700',
    color: Colors.text,
  },
  subtitle: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    marginTop: 4,
  },
});
