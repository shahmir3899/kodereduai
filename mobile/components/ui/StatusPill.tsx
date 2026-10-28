import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

const TONES: Record<Tone, { bg: string; fg: string }> = {
  success: { bg: Colors.successLight, fg: Colors.success },
  warning: { bg: Colors.warningLight, fg: Colors.warning },
  error: { bg: Colors.errorLight, fg: Colors.error },
  info: { bg: Colors.infoLight, fg: Colors.info },
  neutral: { bg: Colors.surfaceSecondary, fg: Colors.textSecondary },
};

export default function StatusPill({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const { bg, fg } = TONES[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'flex-start', paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.full },
  text: { fontSize: FontSize.xs, fontWeight: '600' },
});
