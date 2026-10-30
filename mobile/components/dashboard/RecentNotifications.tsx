import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRecentNotifications } from '../../hooks/useManager';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The latest few notifications on a home screen, with a link to the full inbox.
export default function RecentNotifications({ enabled, onSeeAll }: { enabled: boolean; onSeeAll?: () => void }) {
  const q = useRecentNotifications(enabled);
  if (!enabled) return null;
  const items = q.data ?? [];
  return (
    <>
      <View style={styles.row}>
        <Text style={styles.section}>Notifications</Text>
        {onSeeAll ? (
          <TouchableOpacity accessibilityRole="button" onPress={onSeeAll} style={styles.linkBox}>
            <Text style={styles.link}>See all</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Card style={styles.list}>
        {items.length === 0 ? (
          <Text style={styles.muted}>{q.isLoading ? 'Loading…' : q.isError ? 'Could not load notifications.' : 'No notifications.'}</Text>
        ) : items.map((n) => (
          <View key={n.id} style={styles.note}>
            <Text style={[styles.title, !n.is_read && styles.bold]} numberOfLines={1}>{n.title}</Text>
            <Text style={styles.body} numberOfLines={2}>{n.message}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  linkBox: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  list: { padding: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  note: { paddingVertical: 6 },
  title: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '700' },
  body: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
