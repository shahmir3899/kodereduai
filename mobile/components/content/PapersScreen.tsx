import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, Switch, type RefreshControlProps } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { usePaperActions, usePaperMakers, usePapersPaged } from '../../hooks/usePapers';
import { useAuth } from '../../contexts/AuthContext';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { PAPER_STATUSES, paperTone, type Paper } from '../../services/paperBuilder';
import { bulkDeleteMessage, bulkDeleteResult, docxFileName, selectedAll, toggleAll, toggleId } from '../../services/questionExtras';
import { useMasterClasses } from '../../hooks/useAcademicYear';
import { useSubjectsList } from '../../hooks/useManager';
import { inventoryErrorMessage } from '../../services/inventory';
import { exportErrorMessage } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import { sharePaperPdf } from '../../services/paperPrint';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Question papers: open one in the builder, share its PDF, delete, or start a new one. A block paper (Paper
// Builder v2) is printed on the phone from the server's page, as the web prints it in the browser; an old paper
// still shares the server's own PDF file.
export default function PapersScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  const toast = useToast();
  const actions = usePaperActions();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const [classFilter, setClassFilter] = useState<number>(-1);
  const [subjectFilter, setSubjectFilter] = useState<number>(-1);
  const [statusFilter, setStatusFilter] = useState('');
  // Same as the web: teachers see all their classes' papers and may narrow to their own; school-wide roles pick a maker.
  const isTeacher = useAuth().effectiveRole === 'TEACHER';
  const [mineOnly, setMineOnly] = useState(false);
  const [madeBy, setMadeBy] = useState<number>(-1);
  const makers = usePaperMakers(!isTeacher);
  const classes = useMasterClasses();
  const subjects = useSubjectsList();
  const query = usePapersPaged(term, { classId: classFilter === -1 ? null : classFilter, subject: subjectFilter === -1 ? null : subjectFilter, status: statusFilter, mine: mineOnly, madeBy: !isTeacher && madeBy !== -1 ? madeBy : null });
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const [busy, setBusy] = useState<number | null>(null);
  // Choosing papers is page-scoped: ids from a list that is no longer on screen must not ride along in a bulk delete.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const filterKey = `${term}|${classFilter}|${subjectFilter}|${statusFilter}|${mineOnly}|${madeBy}`;
  React.useEffect(() => { setSelected([]); }, [filterKey]);
  const rowIds = rows.map((r) => r.id);

  const open = (id?: number) => router.push({ pathname: `${base}/paper-builder`, ...(id ? { params: { id } } : {}) } as Href);

  const share = async (p: Paper) => {
    setBusy(p.id);
    try {
      // Every paper, old or block, is printed on the phone from print-html (the server converts an old one); the
      // server PDF was removed in Paper Builder v2 Phase 7.
      await sharePaperPdf(p.id, p.paper_title);
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const shareDocx = async (p: Paper) => {
    setBusy(p.id);
    try {
      await shareReportFile(() => examinationsApi.generatePaperDocx(p.id), docxFileName(p.paper_title), 'docx');
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const removeSelected = async () => {
    if (selected.length === 0) return;
    if (!(await confirm({ title: 'Delete selected papers?', message: bulkDeleteMessage(selected.length), confirmLabel: 'Delete', destructive: true }))) return;
    try {
      const res = await actions.removeMany.mutateAsync(selected);
      toast.success(bulkDeleteResult(res.data));
      setSelected([]);
      setSelecting(false);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the papers.'));
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
      <Select label="Class" searchable value={classFilter} onChange={setClassFilter} options={[{ value: -1, label: 'All classes' }, ...(classes.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))]} />
      <Select label="Subject" searchable value={subjectFilter} onChange={setSubjectFilter} options={[{ value: -1, label: 'All subjects' }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      <Select label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: '', label: 'Any status' }, ...PAPER_STATUSES.map((s) => ({ value: s.value as string, label: s.label }))]} />
      {isTeacher ? (
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Mine only</Text>
          <Switch value={mineOnly} onValueChange={setMineOnly} accessibilityLabel="Mine only" />
        </View>
      ) : (
        <Select label="Made by" searchable value={madeBy} onChange={setMadeBy} options={[{ value: -1, label: 'Anyone' }, ...(makers.data ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
      )}
      <View style={styles.actions}>
        <Button title="+ New paper" size="sm" onPress={() => open()} />
        <Button title={selecting ? 'Done selecting' : 'Select'} size="sm" variant="outline" onPress={() => { setSelecting((v) => !v); setSelected([]); }} />
      </View>
      {selecting ? (
        <View style={styles.actions}>
          <Button title={selectedAll(rowIds, selected) ? 'Clear page' : 'Select page'} size="sm" variant="ghost" onPress={() => setSelected((s) => toggleAll(rowIds, s))} />
          <Button title={`Delete selected (${selected.length})`} size="sm" variant="danger" disabled={selected.length === 0 || actions.removeMany.isPending} onPress={removeSelected} />
        </View>
      ) : null}
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
            <TouchableOpacity accessibilityRole={selecting ? 'checkbox' : 'button'} accessibilityState={selecting ? { checked: selected.includes(p.id) } : undefined} style={styles.top}
              onPress={() => (selecting ? setSelected((s) => toggleId(s, p.id)) : open(p.id))}>
              {selecting ? <Text style={styles.check}>{selected.includes(p.id) ? '☑' : '☐'}</Text> : null}
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={2}>{p.paper_title}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[p.class_name, p.subject_name, `${Number(p.total_marks)} marks`].filter(Boolean).join('  ·  ')}</Text>
                {p.made_by_name ? <Text style={styles.sub} numberOfLines={1}>Made by {p.made_by_name}</Text> : null}
              </View>
              <StatusPill label={PAPER_STATUSES.find((s) => s.value === p.status)?.label ?? p.status} tone={paperTone(p.status)} />
            </TouchableOpacity>
            <View style={styles.actions}>
              <Button title={p.status === 'DRAFT' ? 'Edit' : 'Open'} size="sm" onPress={() => open(p.id)} disabled={busy !== null || selecting} />
              <Button title="Share PDF" size="sm" variant="outline" onPress={() => share(p)} loading={busy === p.id} disabled={busy !== null} />
              <Button title="Share Word" size="sm" variant="outline" onPress={() => shareDocx(p)} disabled={busy !== null} />
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
  actions: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap' },
  check: { fontSize: FontSize.xl, color: Colors.primary },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  switchLabel: { fontSize: FontSize.md, color: Colors.text },
});
