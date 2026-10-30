import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { hrApi } from '../../../services/api';
import { useScopedPagedQuery } from '../../../hooks/useScopedQuery';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../../hooks/useRefreshControl';
import StaffCard from '../../../components/StaffCard';
import SearchBar from '../../../components/ui/SearchBar';
import Skeleton from '../../../components/ui/Skeleton';
import ErrorState from '../../../components/ui/ErrorState';
import EmptyState from '../../../components/ui/EmptyState';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

interface Staff {
  id: number;
  name: string;
  department?: string;
  designation?: string;
  phone?: string;
}

// Paged like the students list: the API returns 20 at a time, and the old screen showed only the
// first page, so a school with more staff than that silently lost the rest.
export default function StaffDirectory() {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);

  // Not the persisted 'staff' root: this list carries phone numbers, which stay in memory only.
  const query = useScopedPagedQuery<Staff>('staffDirectory', [term], async (page) => {
    const params: Record<string, unknown> = { page };
    if (term) params.search = term;
    return (await hrApi.getStaff(params)).data;
  });
  const refreshControl = useRefreshControl(query.refetch);
  const staff = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const header = (
    <View>
      <Text style={styles.title}>Staff Directory</Text>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search staff..." />
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
      ListEmptyComponent={<EmptyState title="No Staff" message={term ? 'No staff match your search.' : 'No staff records found.'} />}
      ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
      renderItem={({ item: s }) => (
        <StaffCard id={s.id} name={s.name} department={s.department} designation={s.designation} phone={s.phone} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
});
