import React, { useMemo, useState } from 'react';
import { View, FlatList, StyleSheet } from 'react-native';
import { useSubjectsList } from '../../hooks/useManager';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import SearchBar from '../ui/SearchBar';
import ListRow from '../ui/ListRow';
import StatusPill from '../ui/StatusPill';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { Colors, Spacing } from '../../constants/colors';

// Read-only subject list. Adding and editing subjects is for admins, on the web.
export default function SubjectsScreen() {
  const query = useSubjectsList();
  const refreshControl = useRefreshControl(query.refetch);
  const [search, setSearch] = useState('');

  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data ?? []).filter((s) => s.is_active !== false
      && (!term || s.name.toLowerCase().includes(term) || (s.code ?? '').toLowerCase().includes(term)));
  }, [query.data, search]);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={shown}
        keyExtractor={(s) => String(s.id)}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={<View style={styles.search}><SearchBar value={search} onChangeText={setSearch} placeholder="Search subjects..." /></View>}
        ListEmptyComponent={<EmptyState title="No subjects" message="Nothing matches." />}
        renderItem={({ item: s }) => (
          <ListRow title={s.name} subtitle={s.code || undefined}
            right={s.is_elective ? <StatusPill label="Elective" tone="info" /> : undefined} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  search: { padding: Spacing.lg },
});
