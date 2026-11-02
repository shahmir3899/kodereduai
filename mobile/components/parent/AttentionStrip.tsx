import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { AttentionItem, AttentionTone } from '../../services/parentPortal';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONES: Record<AttentionTone, { bg: string; fg: string }> = {
  red: { bg: Colors.errorLight, fg: Colors.errorText },
  amber: { bg: Colors.warningLight, fg: Colors.warningText },
  blue: { bg: Colors.infoLight, fg: Colors.infoText },
};

// What needs a parent's eye today, one tappable chip per item (nothing renders when all is well).
export default function AttentionStrip({ items }: { items: AttentionItem[] }) {
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {items.map((i) => (
        <TouchableOpacity key={i.key} accessibilityRole="button" style={[styles.chip, { backgroundColor: TONES[i.tone].bg }]}
          onPress={() => router.push(i.href as Href)}>
          <Text style={[styles.text, { color: TONES[i.tone].fg }]}>{i.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm, marginTop: Spacing.md },
  chip: { paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.md, minHeight: 40, justifyContent: 'center' },
  text: { fontSize: FontSize.sm, fontWeight: '600' },
});
