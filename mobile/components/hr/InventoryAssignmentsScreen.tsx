import React, { useMemo } from 'react';
import { FlatList, View, Text, StyleSheet } from 'react-native';
import { useMyInventory } from '../../hooks/useStaff';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { sortAssignments } from '../../services/accountant';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Items assigned to the signed-in person, read-only (the API allows staff only this list).
export default function InventoryAssignmentsScreen() {
  const q = useMyInventory();
  const refreshControl = useRefreshControl(q.refetch);
  const rows = useMemo(() => sortAssignments(q.data ?? []), [q.data]);
  if (q.isLoading) return <Skeleton />;
  if (q.isError && !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(a) => String(a.id)}
      refreshControl={refreshControl}
      ListEmptyComponent={<EmptyState title="Nothing assigned" message="Items assigned to you will show here." />}
      renderItem={({ item: a }) => (
        <View style={styles.row}>
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>{a.item_name}</Text>
            <Text style={styles.sub} numberOfLines={2}>
              {[`${Number(a.quantity)} ${a.item_unit ?? ''}`.trim(), a.assigned_date ? `since ${a.assigned_date}` : '', a.condition_on_assign_display].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
          <StatusPill label={a.is_active ? 'With you' : 'Returned'} tone={a.is_active ? 'info' : 'neutral'} />
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
