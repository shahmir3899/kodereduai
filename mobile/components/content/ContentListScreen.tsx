import React, { useMemo, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { useContentList } from '../../hooks/useManager';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import type { ContentRow } from '../../services/manager';
import SearchBar from '../ui/SearchBar';
import ListRow from '../ui/ListRow';
import StatusPill from '../ui/StatusPill';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Spinner from '../ui/Spinner';
import { Colors, Spacing } from '../../constants/colors';

interface Props<Item> {
  root: string;
  fetcher: (params: Record<string, unknown>) => Promise<{ data: unknown }>;
  toRow: (item: Item) => ContentRow;
  searchPlaceholder: string;
  emptyTitle: string;
  onPressRow?: (row: ContentRow) => void;
}

// Searchable, paged, read-only list for the Content Creation screens. Authoring is on the web.
export default function ContentListScreen<Item>({ root, fetcher, toRow, searchPlaceholder, emptyTitle, onPressRow }: Props<Item>) {
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 350);
  const query = useContentList<Item>(root, term, fetcher);
  const refreshControl = useRefreshControl(query.refetch);
  const rows = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.results).map(toRow), [query.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.id)}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.4}
        onEndReached={() => { if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage(); }}
        ListHeaderComponent={<View style={styles.search}><SearchBar value={search} onChangeText={setSearch} placeholder={searchPlaceholder} /></View>}
        ListEmptyComponent={<EmptyState title={emptyTitle} message={term ? 'Nothing matches your search.' : undefined} />}
        ListFooterComponent={query.isFetchingNextPage ? <Spinner /> : null}
        renderItem={({ item }) => (
          <ListRow title={item.title} subtitle={item.subtitle}
            right={item.pill ? <StatusPill label={item.pill} tone="neutral" /> : undefined}
            onPress={onPressRow ? () => onPressRow(item) : undefined} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  search: { padding: Spacing.lg },
});
