import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Button from './Button';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Shown by the root error boundary when a screen throws while rendering. Plain on purpose: it
// must not depend on auth, queries or the theme provider, which may be what failed.
export default function AppCrashScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>
        The app hit an unexpected problem. Your data is safe. Try again, and if it keeps happening, close and reopen the app.
      </Text>
      <Button title="Try again" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, backgroundColor: Colors.background },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  message: { fontSize: FontSize.md, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.xl },
});
