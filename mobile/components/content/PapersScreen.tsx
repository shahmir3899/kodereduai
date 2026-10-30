import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { usePaperActions, usePapersPaged } from '../../hooks/usePapers';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { PAPER_STATUSES, paperFileName, paperTone, type Paper } from '../../services/paperBuilder';
import { inventoryErrorMessage } from '../../services/inventory';
import { exportErrorMessage } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import SearchBar from '../ui/SearchBar';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Question papers: open one in the builder, share its PDF (the server's own file, the same one the
// web downloads), delete, or start a new one.
export default function PapersScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  const toast = useToast();
  const actions = usePaperActions();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const query = usePapersPaged(term);
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const [busy, setBusy] = useState<number | null>(null);

  const open = (id?: number) => router.push({ pathname: `${base}/paper-builder`, ...(id ? { params: { id } } : {}) } as Href);

  const share = async (p: Paper) => {
    setBusy(p.id);
    try {
      await shareReportFile(() => examinationsApi.generatePaperPdf(p.id), paperFileName(p.paper_title), 'pdf');
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (p: Paper) => {
    if (!(await confirm({ title: 'Delete this paper?', message: p.paper_title, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(p.id);
      toast.success('Paper deleted.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the paper.'));
    }
  };

  const header = (
    <View>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search papers..." />
      <Button title="+ New paper" size="sm" onPress={() => open()} />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(p) => String(p.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No papers" message={term ? 'Nothing matches your search.' : 'Build the first question paper.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: p }) => (
          <View style={styles.card}>
            <TouchableOpacity accessibilityRole="button" style={styles.top} onPress={() => open(p.id)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={2}>{p.paper_title}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[p.class_name, p.subject_name, `${Number(p.total_marks)} marks`].filter(Boolean).join('  ·  ')}</Text>
              </View>
              <StatusPill label={PAPER_STATUSES.find((s) => s.value === p.status)?.label ?? p.status} tone={paperTone(p.status)} />
            </TouchableOpacity>
            <View style={styles.actions}>
              <Button title="Share PDF" size="sm" variant="outline" onPress={() => share(p)} loading={busy === p.id} disabled={busy !== null} />
              <Button title="Delete" size="sm" variant="ghost" onPress={() => remove(p)} disabled={busy !== null} />
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
});
