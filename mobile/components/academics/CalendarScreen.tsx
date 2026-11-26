import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useCalendarMonth } from '../../hooks/useManager';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { calendarItems, monthTitle, shiftMonth } from '../../services/manager';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { Colors, FontSize, Spacing, GlyphSize } from '../../constants/colors';
import AppList from '../ui/AppList';
import RecordCard from '../ui/RecordCard';
import { dayShort } from '../../services/dates';

// Read-only month list of school events and off days (Sundays are left out). Editing the
// calendar is for admins, on the web.
export default function CalendarScreen() {
  const now = new Date();
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const query = useCalendarMonth(ym.year, ym.month);
  const refreshControl = useRefreshControl(query.refetch);
  const items = useMemo(() => calendarItems(query.data ?? []), [query.data]);

  return (
    <View style={styles.container}>
      <View style={styles.nav}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => setYm(shiftMonth(ym.year, ym.month, -1))}><Text style={styles.arrow}>‹</Text></TouchableOpacity>
        <Text style={styles.title}>{monthTitle(ym.year, ym.month)}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" onPress={() => setYm(shiftMonth(ym.year, ym.month, 1))}><Text style={styles.arrow}>›</Text></TouchableOpacity>
      </View>
      {query.isLoading ? <Skeleton /> : query.isError && !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <AppList
          data={items}
          keyExtractor={(i) => i.date}
          contentContainerStyle={styles.content}
          refreshControl={refreshControl}
          ListEmptyComponent={<EmptyState title="Nothing this month" message="No events or holidays are scheduled." />}
          renderItem={({ item }) => (
            <RecordCard
              icon="calendar-outline"
              title={dayShort(item.date) || item.date}
              meta={item.names.join(', ')}
              status={item.off ? { label: 'Off day', tone: 'warning' } : undefined}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.lg },
  arrow: { fontSize: GlyphSize.lg, color: Colors.primary, paddingHorizontal: Spacing.md },
  title: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxxl },
});
