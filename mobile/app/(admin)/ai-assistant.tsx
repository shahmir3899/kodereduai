import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ChatInterface from '../../components/ChatInterface';
import { financeApi, academicsApi, notificationsApi } from '../../services/api';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'finance' | 'academics' | 'communication';

const TAB_CONFIG = {
  finance: {
    label: 'Finance',
    sendMessage: (msg: string) => financeApi.sendChatMessage({ message: msg }),
    getHistory: () => financeApi.getChatHistory(),
    clearHistory: () => financeApi.clearChatHistory(),
    placeholder: 'Ask about finances...',
    welcome: 'Hi! I can help you with financial queries - fee collection, expenses, reports, and more.',
  },
  academics: {
    label: 'Academics',
    sendMessage: (msg: string) => academicsApi.sendChatMessage({ message: msg }),
    getHistory: () => academicsApi.getChatHistory(),
    clearHistory: () => academicsApi.clearChatHistory(),
    placeholder: 'Ask about academics...',
    welcome: 'Hi! I can help with academic queries - timetables, exams, student performance, and more.',
  },
  communication: {
    label: 'Comms',
    sendMessage: (msg: string) => notificationsApi.sendChatMessage({ message: msg }),
    getHistory: () => Promise.resolve({ data: { history: [] } }),
    clearHistory: undefined,
    placeholder: 'Ask about communication...',
    welcome: 'Hi! I can help you draft notifications, messages, and announcements.',
  },
};

export default function AIAssistant() {
  const [activeTab, setActiveTab] = useState<Tab>('finance');
  const config = TAB_CONFIG[activeTab];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>AI Assistant</Text>
        <View style={styles.tabs}>
          {(Object.keys(TAB_CONFIG) as Tab[]).map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                {TAB_CONFIG[tab].label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <ChatInterface
        key={activeTab}
        sendMessage={config.sendMessage}
        getHistory={config.getHistory}
        clearHistory={config.clearHistory}
        placeholder={config.placeholder}
        welcomeMessage={config.welcome}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { padding: Spacing.lg, paddingBottom: 0 },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.md },
  tabs: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  tab: { flex: 1, paddingVertical: Spacing.sm, alignItems: 'center', borderRadius: BorderRadius.sm, backgroundColor: Colors.surfaceSecondary },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textSecondary },
  tabTextActive: { color: Colors.textInverse },
});
