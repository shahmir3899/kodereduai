import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SkeletonBlock } from './Skeleton';
import Icon, { type IconName } from './Icon';
import { emptyIconFor } from '../../services/emptyIcon';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Small loading / error / empty lines for a section inside a card or a screen (a list under a
// heading, a figure block), where the full-screen Skeleton, ErrorState and EmptyState would be too
// big. Use those three for a whole screen.

export function SectionLoading({ lines = 2 }: { lines?: number }) {
  return (
    <View style={styles.loading} accessible accessibilityRole="progressbar" accessibilityLabel="Loading">
      {Array.from({ length: lines }, (_, i) => <SkeletonBlock key={i} width={i === lines - 1 ? '60%' : '100%'} height={12} />)}
    </View>
  );
}

export function SectionError({ message = 'Could not load this.', onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <View style={styles.row} accessibilityRole="alert">
      <Icon name="alert-circle-outline" size={18} color={Colors.error} />
      <Text style={[styles.text, styles.errorText]}>{message}</Text>
      {onRetry ? (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Try again" onPress={onRetry} hitSlop={10} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// The icon defaults to one picked from the message, like EmptyState.
export function SectionEmpty({ message, icon }: { message: string; icon?: IconName }) {
  return (
    <View style={styles.row}>
      <Icon name={icon ?? emptyIconFor(message)} size={18} color={Colors.textTertiary} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs },
  text: { flex: 1, fontSize: FontSize.sm, color: Colors.textSecondary },
  errorText: { color: Colors.errorText },
  retry: { minHeight: 32, justifyContent: 'center' },
  retryText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.primary },
});
