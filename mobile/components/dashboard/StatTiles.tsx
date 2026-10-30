import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export interface Tile { label: string; value: string | number | null | undefined; route?: string }

// Two-across number tiles for the manager, accountant and staff homes, so they read as one family.
// A tile with no route is not tappable; a missing value shows a dash, never a made-up 0.
export default function StatTiles({ tiles, onPress }: { tiles: Tile[]; onPress: (route: string) => void }) {
  if (tiles.length === 0) return null;
  return (
    <View style={styles.tiles}>
      {tiles.map((t) => (
        <TouchableOpacity key={t.label} accessibilityRole="button" accessibilityLabel={`${t.label}: ${t.value ?? 'not available'}`}
          style={styles.tile} disabled={!t.route} onPress={() => t.route && onPress(t.route)}>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{t.value ?? '–'}</Text>
          <Text style={styles.label}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.lg },
  tile: { width: '47%', minHeight: 64, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  value: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.primary },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
