import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import {
  ASSIGNMENT_TYPES, STATUSES, canClose, canPublish, filterAssignments, isOverdue, type Assignment,
} from '../../services/assignments';
import { todayString, type ClassOption } from '../../services/attendanceEntry';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useAssignmentActions, useAssignments, useSubjectList } from '../../hooks/useAssignments';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import SearchBar from '../ui/SearchBar';
import SegmentedTabs from '../ui/SegmentedTabs';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill, { type Tone } from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const STATUS_TONE: Record<string, Tone> = { DRAFT: 'neutral', PUBLISHED: 'success', CLOSED: 'error' };
const TYPE_TONE: Record<string, Tone> = { HOMEWORK: 'info', DIARY: 'warning', PROJECT: 'neutral', CLASSWORK: 'success', LAB: 'warning' };
type StatusTab = 'ALL' | 'DRAFT' | 'PUBLISHED' | 'CLOSED';

interface Props {
  // Teachers pass their own sections; admins leave it out and get every class.
  classOptions?: ClassOption[];
  // Manager reads the list only: no student submissions, no create/edit/publish/delete.
  readOnly?: boolean;
}

const apiMessage = (e: any, fallback: string) => e?.response?.data?.detail || fallback;

// Homework, projects, classwork, labs and diary entries for the active year.
export default function AssignmentsListScreen({ classOptions, readOnly = false }: Props) {
  const router = useRouter();
  const base = usePersonaBase();
  const toast = useToast();
  const { options } = useAttendanceClassOptions(classOptions);
  const query = useAssignments();
  const subjects = useSubjectList();
  const actions = useAssignmentActions();
  const refreshControl = useRefreshControl(query.refetch);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusTab>('ALL');
  const [classId, setClassId] = useState<number | null>(null);
  const [subject, setSubject] = useState<number | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const option = options.find((o) => o.id === classId) ?? null;
  const today = todayString();
  const shown = useMemo(() => filterAssignments(query.data ?? [], {
    masterClassId: option ? (option.classObj ?? option.id) : null,
    sessionClassId: option?.isSession ? option.id : null,
    sessionScoped: !!option?.isSession,
    subject,
    status: status === 'ALL' ? '' : status,
    type: type ?? '',
    search,
  }), [query.data, option, subject, status, type, search]);

  const go = (path: string, id?: number) =>
    router.push((id != null ? { pathname: `${base}/assignments/${path}`, params: { id } } : `${base}/assignments/${path}`) as Href);

  const run = (promise: Promise<unknown>, ok: string, fail: string) =>
    promise.then(() => toast.success(ok)).catch((e) => toast.error(apiMessage(e, fail)));

  const remove = async (a: Assignment) => {
    const yes = await confirm({ title: 'Delete assignment?', message: `"${a.title}" and its submissions will be deleted.`, confirmLabel: 'Delete', destructive: true });
    if (yes) run(actions.remove.mutateAsync(a.id), 'Assignment deleted.', 'Failed to delete assignment');
  };

  const filtersActive = classId != null || subject != null || type != null;

  const header = (
    <View>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search assignments..." />
      <SegmentedTabs<StatusTab> value={status} onChange={setStatus}
        tabs={[{ value: 'ALL', label: 'All' }, ...STATUSES.map((s) => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))]} />
      <TouchableOpacity onPress={() => setShowFilters((v) => !v)} style={styles.filterToggle}>
        <Text style={styles.filterToggleText}>{showFilters ? 'Hide filters' : filtersActive ? 'Filters (on)' : 'More filters'}</Text>
      </TouchableOpacity>
      {showFilters ? (
        <View>
          <Select label="Class" value={classId} options={options.map((o) => ({ value: o.id, label: o.label }))}
            onChange={setClassId} placeholder="All classes" />
          <Select label="Subject" value={subject} options={(subjects.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
            onChange={setSubject} placeholder="All subjects" />
          <Select label="Type" value={type} options={ASSIGNMENT_TYPES.map((t) => ({ value: t, label: t[0] + t.slice(1).toLowerCase() }))}
            onChange={setType} placeholder="All types" />
          {filtersActive ? (
            <TouchableOpacity onPress={() => { setClassId(null); setSubject(null); setType(null); }}>
              <Text style={styles.clear}>Clear filters</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={shown}
        keyExtractor={(a) => String(a.id)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No assignments" message={readOnly ? 'Nothing matches.' : 'Nothing matches. Tap New assignment to add one.'} />}
        renderItem={({ item: a }) => {
          const late = isOverdue(a, today);
          return (
            <View style={styles.card}>
              <View style={styles.top}>
                <Text style={styles.title} numberOfLines={2}>{a.title}</Text>
                <StatusPill label={a.status} tone={STATUS_TONE[a.status] ?? 'neutral'} />
              </View>
              <Text style={styles.meta}>{a.class_name || 'N/A'} · {a.subject_name || 'N/A'}</Text>
              <View style={styles.row}>
                <StatusPill label={a.assignment_type} tone={TYPE_TONE[a.assignment_type] ?? 'neutral'} />
                <Text style={[styles.due, late && styles.late]}>
                  {a.assignment_type === 'DIARY' ? 'Date' : 'Due'} {a.due_date || '—'}
                </Text>
              </View>
              {readOnly ? null : <View style={styles.actions}>
                <Action label={`Submissions (${a.submission_count ?? 0})`} onPress={() => go('submissions', a.id)} primary />
                <Action label="Edit" onPress={() => go('form', a.id)} />
                {canPublish(a) ? <Action label="Publish" onPress={() => run(actions.publish.mutateAsync(a.id), 'Assignment published!', 'Failed to publish assignment')} /> : null}
                {canClose(a) ? <Action label="Close" onPress={() => run(actions.close.mutateAsync(a.id), 'Assignment closed!', 'Failed to close assignment')} /> : null}
                <Action label="Delete" onPress={() => remove(a)} danger />
              </View>}
            </View>
          );
        }}
      />
      {readOnly ? null : (
        <View style={styles.footer}>
          <Button title="New assignment" onPress={() => go('form')} fullWidth size="lg" />
        </View>
      )}
    </View>
  );
}

function Action({ label, onPress, primary, danger }: { label: string; onPress: () => void; primary?: boolean; danger?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.action}>
      <Text style={[styles.actionText, primary && { color: Colors.primary }, danger && { color: Colors.error }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 100 },
  filterToggle: { alignSelf: 'flex-start', marginBottom: Spacing.md },
  filterToggleText: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  clear: { fontSize: FontSize.sm, color: Colors.error, marginBottom: Spacing.md },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Spacing.sm },
  due: { fontSize: FontSize.xs, color: Colors.textSecondary },
  late: { color: Colors.error, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  action: { paddingVertical: 2 },
  actionText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
});
