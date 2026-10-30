import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export type HeroTone = 'blue' | 'green' | 'gray';

// The one-glance card at the top of a home screen (current period, school day status). Text uses
// the darker status shades so it stays readable on the light tint.
export default function HeroCard({ tone, eyebrow, title, subtitle, action }: {
  tone: HeroTone; eyebrow: string; title: string; subtitle?: string;
  action?: { label: string; onPress: () => void };
}) {
  const bg = tone === 'blue' ? Colors.infoLight : tone === 'green' ? Colors.successLight : Colors.surfaceSecondary;
  const fg = tone === 'blue' ? Colors.infoText : tone === 'green' ? Colors.successText : Colors.neutralText;
  return (
    <View style={[styles.hero, { backgroundColor: bg }]}>
      <Text style={[styles.eyebrow, { color: fg }]}>{eyebrow}</Text>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
      {action ? (
        <TouchableOpacity accessibilityRole="button" style={[styles.btn, { backgroundColor: fg }]} onPress={action.onPress}>
          <Text style={styles.btnText}>{action.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: BorderRadius.lg, padding: Spacing.lg },
  eyebrow: { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'uppercase' },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginTop: Spacing.xs },
  sub: { fontSize: FontSize.sm, color: Colors.neutralText, marginTop: 2 },
  btn: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', borderRadius: BorderRadius.md, paddingHorizontal: Spacing.lg, marginTop: Spacing.md },
  btnText: { color: Colors.textInverse, fontWeight: '700', fontSize: FontSize.sm },
});
