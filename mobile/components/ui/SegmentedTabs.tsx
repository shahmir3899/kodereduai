import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface SegmentedTabsProps<V extends string> {
  tabs: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
}

export default function SegmentedTabs<V extends string>({ tabs, value, onChange }: SegmentedTabsProps<V>) {
  return (
    <View style={styles.bar} accessibilityRole="tablist">
      {tabs.map((t) => (
        <TouchableOpacity
          key={t.value}
          style={[styles.tab, t.value === value && styles.tabActive]}
          onPress={() => onChange(t.value)}
          accessibilityRole="tab"
          accessibilityLabel={t.label}
          accessibilityState={{ selected: t.value === value }}
        >
          <Text style={[styles.text, t.value === value && styles.textActive]} numberOfLines={1}>{t.label}</Text>
        </TouchableOpacity>
      ))}
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
  tabActive: { backgroundColor: Colors.surface },
  text: { fontSize: FontSize.sm, color: Colors.textSecondary, fontWeight: '500' },
  textActive: { color: Colors.primary, fontWeight: '700' },
});
