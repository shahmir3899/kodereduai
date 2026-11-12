import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useHostelDashboard } from '../../hooks/useHostel';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { dashboardTiles } from '../../services/hostel';
import Button from '../ui/Button';
import QueryBoundary from '../ui/QueryBoundary';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE = { info: Colors.primary, success: Colors.success, warning: Colors.warning } as const;

// The hostel at a glance, with the way into rooms, who sleeps where, and gate passes. Admin and
// principal only (the hostel lists students and the reasons they leave).
export default function HostelDashboardScreen() {
  const router = useRouter();
  const q = useHostelDashboard();
  const refreshControl = useRefreshControl(q.refetch);
  const go = (p: string) => router.push(p as Href);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <QueryBoundary query={q} emptyTitle="No hostel data" emptyMessage="Add a hostel first.">
        {(d) => (
          <View style={styles.tiles}>
            {dashboardTiles(d).map((t) => (
              <View key={t.label} style={styles.tile}>
                <Text style={[styles.value, { color: TONE[t.tone] }]}>{t.value}</Text>
                <Text style={styles.label}>{t.label}</Text>
              </View>
            ))}
          </View>
        )}
      </QueryBoundary>
      <Button title="Hostels and rooms" onPress={() => go('/(admin)/hostel/rooms')} />
      <Button title="Who sleeps where" variant="outline" onPress={() => go('/(admin)/hostel/allocations')} />
      <Button title="Gate passes" variant="outline" onPress={() => go('/(admin)/hostel/gate-passes')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center' },
  value: { fontSize: FontSize.xl, fontWeight: '800' },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
