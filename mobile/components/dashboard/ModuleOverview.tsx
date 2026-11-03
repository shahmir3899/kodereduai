import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { HealthStatus, ModuleCard } from '../../services/adminDashboard';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

const DOT: Record<HealthStatus, string> = {
  green: Colors.success, yellow: Colors.warning, red: Colors.error, gray: Colors.textTertiary,
};

// One tile per enabled module with a single number and a status dot, as on the web home. A tile
// with no mobile screen behind it is not tappable.
export default function ModuleOverview({ cards, onOpen }: { cards: ModuleCard[]; onOpen: (route: string) => void }) {
  if (cards.length === 0) return null;
  return (
    <View style={styles.grid}>
      {cards.map((c) => (
        <TouchableOpacity key={c.key} style={styles.cell} disabled={!c.route} accessibilityRole="button"
          accessibilityLabel={`${c.label}: ${c.metric} ${c.metricLabel}`} onPress={() => c.route && onOpen(c.route)}>
          <Card style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.label} numberOfLines={1}>{c.label}</Text>
              <View style={[styles.dot, { backgroundColor: DOT[c.status] }]} />
            </View>
            <Text style={styles.metric} numberOfLines={1} adjustsFontSizeToFit>
              {c.metric}<Text style={styles.metricLabel}> {c.metricLabel}</Text>
            </Text>
          </Card>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  cell: { width: '47%' },
  card: { padding: Spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { flex: 1, fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  dot: { width: 8, height: 8, borderRadius: 4, marginLeft: Spacing.xs },
  metric: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginTop: Spacing.xs },
  metricLabel: { fontSize: FontSize.xs, fontWeight: '400', color: Colors.textSecondary },
});
