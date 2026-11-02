import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { examinationsApi } from '../../services/api';
import { useMasterClasses } from '../../hooks/useAcademicYear';
import { useSubjectsList } from '../../hooks/useManager';
import { useWorksheetActions, useWorksheetsPaged } from '../../hooks/useWorksheets';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  buildEnsurePayload, emptyNewWorksheet, validateNewWorksheet, WORKSHEET_STATUSES, worksheetFileName, worksheetTone, type NewWorksheetForm, type Worksheet,
} from '../../services/worksheets';
import { inventoryErrorMessage } from '../../services/inventory';
import { exportErrorMessage } from '../../services/reports';
import { shareReportFile } from '../../services/reportShare';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Worksheets: practice and homework sheets. Open one in the builder, share its PDF or Word file (the server's own
// files, the same the web downloads), duplicate or delete it, or start a new one. Port of the web Worksheets page.
export default function WorksheetsScreen() {
  const router = useRouter();
  const base = usePersonaBase();
  const toast = useToast();
  const actions = useWorksheetActions();
  const classes = useMasterClasses();
  const subjects = useSubjectsList();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 400);
  const [classFilter, setClassFilter] = useState<number>(-1);
  const [subjectFilter, setSubjectFilter] = useState<number>(-1);
  const [statusFilter, setStatusFilter] = useState('');
  const query = useWorksheetsPaged(term, { classId: classFilter === -1 ? null : classFilter, subject: subjectFilter === -1 ? null : subjectFilter, status: statusFilter });
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewWorksheetForm>(emptyNewWorksheet());
  const [error, setError] = useState<string | null>(null);

  const open = (id: number) => router.push({ pathname: `${base}/worksheet-builder`, params: { id } } as Href);

  const create = async () => {
    const problem = validateNewWorksheet(form);
    if (problem) return setError(problem);
    setError(null);
    try {
      const res = await actions.ensure.mutateAsync(buildEnsurePayload(form));
      const id = (res.data as { id?: number })?.id;
      setCreating(false);
      if (id) open(id);
    } catch (e) {
      setError(inventoryErrorMessage(e, 'Could not create the worksheet.'));
    }
  };

  const share = async (w: Worksheet, kind: 'pdf' | 'docx') => {
    setBusy(`${w.id}-${kind}`);
    try {
      await shareReportFile(() => (kind === 'pdf' ? examinationsApi.generateWorksheetPdf(w.id) : examinationsApi.generateWorksheetDocx(w.id)), worksheetFileName(w.title, kind), kind);
    } catch (e) {
      toast.error((e as { response?: unknown }).response ? exportErrorMessage(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const duplicate = async (w: Worksheet) => {
    setBusy(`${w.id}-dup`);
    try {
      const res = await actions.duplicate.mutateAsync(w.id);
      toast.success('Worksheet duplicated.');
      const id = (res.data as { id?: number })?.id;
      if (id) open(id);
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not duplicate the worksheet.'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (w: Worksheet) => {
    if (!(await confirm({ title: 'Delete worksheet?', message: w.title, confirmLabel: 'Delete', destructive: true }))) return;
    try {
      await actions.remove.mutateAsync(w.id);
      toast.success('Worksheet deleted.');
    } catch (e) {
      toast.error(inventoryErrorMessage(e, 'Could not delete the worksheet.'));
    }
  };

  const header = (
    <View>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search worksheets..." />
      <Select label="Class" searchable value={classFilter} onChange={setClassFilter} options={[{ value: -1, label: 'All classes' }, ...(classes.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))]} />
      <Select label="Subject" searchable value={subjectFilter} onChange={setSubjectFilter} options={[{ value: -1, label: 'All subjects' }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      <Select label="Status" value={statusFilter} onChange={setStatusFilter} options={[{ value: '', label: 'Any status' }, ...WORKSHEET_STATUSES.map((s) => ({ value: s.value as string, label: s.label }))]} />
      <Button title="+ New worksheet" size="sm" onPress={() => { setForm(emptyNewWorksheet()); setError(null); setCreating(true); }} />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(w) => String(w.id)}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No worksheets" message={term ? 'Nothing matches your search.' : 'Make the first practice sheet.'} />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: w }) => (
          <View style={styles.card}>
            <TouchableOpacity accessibilityRole="button" style={styles.top} onPress={() => open(w.id)}>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={2}>{w.title || 'Untitled worksheet'}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[w.class_name, w.subject_name, `${w.item_count ?? w.items?.length ?? 0} item${(w.item_count ?? w.items?.length ?? 0) === 1 ? '' : 's'}`].filter(Boolean).join('  ·  ')}</Text>
              </View>
              <StatusPill label={WORKSHEET_STATUSES.find((s) => s.value === w.status)?.label ?? w.status} tone={worksheetTone(w.status)} />
            </TouchableOpacity>
            <View style={styles.actions}>
              <Button title="PDF" size="sm" variant="outline" onPress={() => share(w, 'pdf')} loading={busy === `${w.id}-pdf`} disabled={busy !== null} />
              <Button title="Word" size="sm" variant="outline" onPress={() => share(w, 'docx')} loading={busy === `${w.id}-docx`} disabled={busy !== null} />
              <Button title="Duplicate" size="sm" variant="outline" onPress={() => duplicate(w)} loading={busy === `${w.id}-dup`} disabled={busy !== null} />
              <Button title="Delete" size="sm" variant="ghost" onPress={() => remove(w)} disabled={busy !== null} />
            </View>
          </View>
        )}
      />

      <FormSheet visible={creating} title="New worksheet" onClose={() => setCreating(false)} onSubmit={create} submitLabel="Create worksheet" busy={actions.ensure.isPending} error={error}>
        <Input label="Title" value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} placeholder="e.g. Fractions Practice Sheet" />
        <Select label="Class" searchable value={form.classObj} onChange={(v) => setForm((f) => ({ ...f, classObj: Number(v), subject: null }))} placeholder="Choose a class"
          options={(classes.data ?? []).map((c) => ({ value: Number(c.id), label: String(c.name) }))} />
        <Select label="Subject (optional)" searchable value={form.subject ?? -1} onChange={(v) => setForm((f) => ({ ...f, subject: v === -1 ? null : Number(v) }))} placeholder="No specific subject"
          options={[{ value: -1, label: 'No specific subject' }, ...(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      </FormSheet>
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
});
