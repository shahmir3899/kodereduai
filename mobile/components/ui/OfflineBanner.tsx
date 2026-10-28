import React from 'react';
import { Text, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetInfo } from '@react-native-community/netinfo';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// `isConnected` is null until the first check; only an explicit false counts as offline.
export function useIsOffline(): boolean {
  return useNetInfo().isConnected === false;
}

// A small pill over the top of every screen while the phone has no connection. It does not
// take layout space or touches, so it cannot cover a header button's tap target.
export default function OfflineBanner() {
  const offline = useIsOffline();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + Spacing.xs }]}>
      <Text style={styles.text} accessibilityRole="alert" accessibilityLiveRegion="polite">
        You're offline. Saved lists still work; changes can't be saved.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    backgroundColor: Colors.text,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    zIndex: 1000,
  },
  text: { color: Colors.textInverse, fontSize: FontSize.xs, textAlign: 'center', fontWeight: '600' },
});
