import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useDepartments, useStaffPaged } from '../../hooks/useHrAdmin';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { staffHasLeft, staffSubtitle } from '../../services/hrAdmin';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import SegmentedTabs from '../ui/SegmentedTabs';
import Button from '../ui/Button';
import Avatar from '../ui/Avatar';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const STATUS_TABS = [{ value: 'ACTIVE', label: 'Working' }, { value: 'LEFT', label: 'Left' }, { value: '', label: 'All' }];

// The school's staff, paged: search, department and working/left filters, add and edit. Admin and
// principal only. (The old list read `name` and `department`, which the API does not send.)
export default function StaffDirectoryScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const [status, setStatus] = useState('ACTIVE');
  const [department, setDepartment] = useState<number | null>(null);
  const departments = useDepartments();
  const query = useStaffPaged(term, status, department);
  const refreshControl = useRefreshControl(query.refetch);
  const staff = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const total = query.data?.pages[0]?.count ?? 0;
  const go = (path: string) => router.push(path as Href);

  const header = (
    <View style={styles.header}>
      <Button title="+ Add staff member" size="sm" onPress={() => go('/(admin)/hr/staff-form')} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search staff..." />
      <SegmentedTabs tabs={STATUS_TABS} value={status} onChange={setStatus} />
      <Select<string | number> label="Department" value={department} onChange={(v) => setDepartment(v === '' ? null : Number(v))} placeholder="All departments"
        options={[{ value: '', label: 'All departments' }, ...(departments.data ?? []).map((d) => ({ value: d.id, label: d.name }))]} />
      <Text style={styles.count}>{`${total} staff`}</Text>
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={staff}
      keyExtractor={(s) => String(s.id)}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
      onEndReachedThreshold={0.5}
      ListEmptyComponent={<EmptyState title="No staff" message={term ? 'No staff match your search.' : 'No staff in this view.'} />}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
      renderItem={({ item: s }) => (
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${s.full_name}. Open`} style={[styles.row, staffHasLeft(s) && styles.left]}
          onPress={() => go(`/(admin)/hr/staff-form?id=${s.id}`)}>
          <Avatar name={s.full_name} />
          <View style={styles.who}>
            <Text style={styles.name} numberOfLines={1}>{s.full_name}</Text>
            <Text style={styles.sub} numberOfLines={1}>{staffSubtitle(s) || s.employee_id || ''}</Text>
          </View>
          {staffHasLeft(s) ? <StatusPill label="Left" tone="neutral" /> : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  count: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 60 },
  left: { opacity: 0.65 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
