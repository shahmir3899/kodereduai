import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, type DimensionValue } from 'react-native';
import { Colors, Spacing, BorderRadius } from '../../constants/colors';

export function SkeletonBlock({ width = '100%', height = 16 }: { width?: DimensionValue; height?: number }) {
  const opacity = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[styles.block, { width, height, opacity }]} />;
}

// Placeholder list shown while a query's first load is in flight.
export default function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <View style={styles.wrap}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={styles.row}>
          <SkeletonBlock width="60%" height={14} />
          <SkeletonBlock width="35%" height={12} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: Spacing.lg },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.lg, marginBottom: Spacing.md, gap: Spacing.sm },
  block: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm },
});
