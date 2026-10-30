import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Button from './Button';
import { Colors, FontSize, Spacing } from '../../constants/colors';
import { errorCopy, OFFLINE_COPY } from '../../services/errorKind';

interface ErrorStateProps {
  // Overrides the wording derived from `error`.
  message?: string;
  // The failed request's error; picks the wording (no connection, no access, server problem).
  error?: unknown;
  // The load is waiting for a connection and no error has happened yet.
  offline?: boolean;
  onRetry?: () => void;
}

export default function ErrorState({ message, error, offline, onRetry }: ErrorStateProps) {
  const copy = offline ? OFFLINE_COPY : errorCopy(error);
  return (
    <View style={styles.container} accessibilityRole="alert">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.message}>{message ?? copy.message}</Text>
      {onRetry ? <Button title="Try again" onPress={onRetry} variant="outline" size="sm" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl },
  title: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  message: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.lg },
});
