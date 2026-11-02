import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface SegmentedTabsProps<V extends string> {
  tabs: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  // For more tabs than fit: the bar scrolls sideways and each tab sizes to its label.
  scrollable?: boolean;
}

export default function SegmentedTabs<V extends string>({ tabs, value, onChange, scrollable }: SegmentedTabsProps<V>) {
  const items = tabs.map((t) => (
        <TouchableOpacity
          key={t.value}
          style={[styles.tab, scrollable && styles.tabScroll, t.value === value && styles.tabActive]}
          onPress={() => onChange(t.value)}
          accessibilityRole="tab"
          accessibilityLabel={t.label}
          accessibilityState={{ selected: t.value === value }}
        >
          <Text style={[styles.text, t.value === value && styles.textActive]} numberOfLines={1}>{t.label}</Text>
        </TouchableOpacity>
  ));
  if (scrollable) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollBar} contentContainerStyle={styles.scrollRow} accessibilityRole="tablist">
        {items}
      </ScrollView>
    );
  }
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {items}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceSecondary,
    borderRadius: BorderRadius.md,
    padding: 3,
    marginBottom: Spacing.lg,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, minHeight: 44, justifyContent: 'center', borderRadius: BorderRadius.sm },
  tabScroll: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', paddingHorizontal: Spacing.lg },
  scrollBar: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, marginBottom: Spacing.lg, flexGrow: 0 },
  scrollRow: { padding: 3 },
  tabActive: { backgroundColor: Colors.surface },
  text: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' },
  textActive: { color: Colors.primary, fontWeight: '700' },
});
