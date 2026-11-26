import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { AttentionItem } from '../../services/parentPortal';
import AttentionCard from '../ui/AttentionCard';
import { Spacing } from '../../constants/colors';

// What needs a parent's eye today, one card per item (nothing renders when all is well). Same card
// as the staff Homes' "Needs attention", so every role reads these alike.
export default function AttentionStrip({ items }: { items: AttentionItem[] }) {
  const router = useRouter();
  if (items.length === 0) return null;
  return (
    <View style={styles.wrap}>
      {items.map((i) => (
        <AttentionCard key={i.key} itemKey={i.key} label={i.label} tone={i.tone} onPress={() => router.push(i.href as Href)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.xs },
});
