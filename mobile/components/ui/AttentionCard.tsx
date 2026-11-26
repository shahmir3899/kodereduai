import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from './Icon';
import { attentionLook } from '../../services/attentionLook';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export type AttentionTone = 'red' | 'amber' | 'blue';

const TONES: Record<AttentionTone, { bg: string; fg: string }> = {
  red: { bg: Colors.errorLight, fg: Colors.errorText },
  amber: { bg: Colors.warningLight, fg: Colors.warningText },
  blue: { bg: Colors.infoLight, fg: Colors.infoText },
};

// One "Needs attention" item on every Home: a coloured icon for its kind, the count (when there is
// one) and the sentence, and a short action word so it is clear what tapping does.
export default function AttentionCard({ itemKey, count, label, tone, onPress }: {
  itemKey: string;
  count?: number;
  label: string;
  tone: AttentionTone;
  onPress?: () => void;
}) {
  const look = attentionLook(itemKey);
  const t = TONES[tone];
  return (
    <TouchableOpacity accessibilityRole="button" disabled={!onPress} onPress={onPress} activeOpacity={0.7}
      accessibilityLabel={`${count != null ? `${count} ` : ''}${label}${onPress ? `. ${look.action}` : ''}`} style={styles.card}>
      <View style={[styles.icon, { backgroundColor: t.bg }]}>
        <Icon name={look.icon} size={20} color={t.fg} />
      </View>
      {/* One text run, so the count and sentence wrap together. */}
      <Text style={styles.label} numberOfLines={2}>
        {count != null ? <Text style={[styles.count, { color: t.fg }]}>{count} </Text> : null}
        {label}
      </Text>
      {onPress ? (
        <View style={[styles.action, { backgroundColor: t.bg }]}>
          <Text style={[styles.actionText, { color: t.fg }]}>{look.action}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56,
    backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm,
  },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: FontSize.lg, fontWeight: '700' },
  label: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  action: { borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, paddingVertical: 6 },
  actionText: { fontSize: FontSize.xs, fontWeight: '700' },
});
