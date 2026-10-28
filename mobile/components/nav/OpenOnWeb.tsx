import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// For features that stay on the web (docs/MOBILE_PLAN.md section 8): say so instead of a dead end.
export default function OpenOnWeb({ title, note }: { title: string; note?: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note ?? 'This is done on the web version for now. Sign in on a computer to use it.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl, backgroundColor: Colors.background },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm, textAlign: 'center' },
  note: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center' },
});
