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

export type SkeletonVariant = 'card' | 'list' | 'stats' | 'detail';

// Placeholder shown while a query's first load is in flight. The shape follows what is coming:
// `card` (the default, two lines per card), `list` (avatar and two lines per row), `stats`
// (a grid of figure tiles) or `detail` (a header with a photo, then lines of text).
export default function Skeleton({ rows = 5, variant = 'card' }: { rows?: number; variant?: SkeletonVariant }) {
  return (
    <View style={styles.wrap} accessible accessibilityLabel="Loading" accessibilityRole="progressbar">
      {variant === 'stats' ? (
        <View style={styles.grid}>
          {Array.from({ length: Math.max(2, Math.min(rows, 6)) }, (_, i) => (
            <View key={i} style={styles.tile}>
              <SkeletonBlock width="50%" height={12} />
              <SkeletonBlock width="35%" height={26} />
            </View>
          ))}
        </View>
      ) : variant === 'detail' ? (
        <View>
          <View style={styles.head}>
            <SkeletonBlock width={72} height={72} />
            <View style={styles.headText}>
              <SkeletonBlock width="70%" height={18} />
              <SkeletonBlock width="45%" height={12} />
            </View>
          </View>
          {Array.from({ length: Math.max(3, rows) }, (_, i) => (
            <View key={i} style={styles.line}>
              <SkeletonBlock width="30%" height={12} />
              <SkeletonBlock width="55%" height={12} />
            </View>
          ))}
        </View>
      ) : (
        Array.from({ length: rows }, (_, i) => (
          <View key={i} style={variant === 'list' ? styles.listRow : styles.row}>
            {variant === 'list' ? <SkeletonBlock width={40} height={40} /> : null}
            <View style={variant === 'list' ? styles.listText : styles.cardText}>
              <SkeletonBlock width="60%" height={14} />
              <SkeletonBlock width="35%" height={12} />
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: Spacing.lg },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.lg, marginBottom: Spacing.md, gap: Spacing.sm },
  cardText: { gap: Spacing.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  listText: { flex: 1, gap: Spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  tile: { width: '47%', flexGrow: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.lg, gap: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  headText: { flex: 1, gap: Spacing.sm },
  line: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.sm },
  block: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm },
});
