import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useActiveAllocations, useAllocations, useHostelActions, useRooms, useStudentSearch } from '../../hooks/useHostel';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import {
  allocationLine, buildAllocationPayload, emptyAllocationForm, freeRooms, roomOption, vacateText, validateAllocation, type AllocationForm, type AllocationRow,
} from '../../services/hostel';
import { inventoryErrorMessage } from '../../services/inventory';
import SegmentedTabs from '../ui/SegmentedTabs';
import SearchBar from '../ui/SearchBar';
import Select from '../ui/Select';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Who sleeps where: place a student in a room for the academic year, and vacate a bed. Admin and
// principal only. The server refuses a full room and a second allocation in the same year.
export default function AllocationsScreen() {
  const toast = useToast();
  const actions = useHostelActions();
  const { current: year } = useAcademicYear();
  const [view, setView] = useState<'current' | 'all'>('current');
  const query = useAllocations(view === 'current');
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const rows = useMemo(() => query.data?.pages.flatMap((p) => p.results) ?? [], [query.data]);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<AllocationForm>(emptyAllocationForm());
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 350);
  const students = useStudentSearch(term);
  const rooms = useRooms(null, adding);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const open = () => { setForm(emptyAllocationForm()); setSearch(''); setError(null); setAdding(true); };

  const save = async () => {
    const problem = validateAllocation(form, year?.id);
    if (problem) return setError(problem);
    setError(null);
    try {
      await actions.allocate.mutateAsync(buildAllocationPayload(form, year!.id));
      toast.success(`${form.studentLabel} has a room.`);
      setAdding(false);
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not allocate the room.')); }
  };

  const vacate = async (a: AllocationRow) => {
    if (!(await confirm({ title: 'Vacate this bed?', message: vacateText(a), confirmLabel: 'Vacate', destructive: true }))) return;
    setBusy(a.id);
    try { await actions.vacate.mutateAsync(a.id); toast.success(`${a.student_name} vacated.`); }
    catch (e) { toast.error(inventoryErrorMessage(e, 'Could not vacate the bed.')); }
    finally { setBusy(null); }
  };

  const header = (
    <View style={styles.header}>
      <Button title="+ Allocate a student" size="sm" onPress={open} />
      <SegmentedTabs tabs={[{ value: 'current', label: 'In a room now' }, { value: 'all', label: 'All records' }]} value={view} onChange={(v) => setView(v as 'current' | 'all')} />
    </View>
  );

  if (query.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton variant="list" /></View>;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={(a) => String(a.id)}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        onEndReached={() => query.hasNextPage && !query.isFetchingNextPage && query.fetchNextPage()}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={<EmptyState title="No allocations" message="Allocate a student to a room." />}
        ListFooterComponent={query.isFetchingNextPage ? <ActivityIndicator color={Colors.primary} style={{ margin: Spacing.lg }} /> : null}
        renderItem={({ item: a }) => (
          <View style={styles.row}>
            <View style={styles.flex}>
              <Text style={styles.name}>{a.student_name}</Text>
              <Text style={styles.sub}>{allocationLine(a)}</Text>
              <Text style={styles.sub}>{`${a.academic_year_name ?? ''}${a.allocated_date ? `  ·  from ${a.allocated_date}` : ''}${a.vacated_date ? `  ·  left ${a.vacated_date}` : ''}`.replace(/^  ·  /, '')}</Text>
            </View>
            {a.is_active ? <Button title="Vacate" size="sm" variant="outline" loading={busy === a.id} disabled={busy !== null} onPress={() => vacate(a)} /> : <StatusPill label="Vacated" tone="neutral" />}
          </View>
        )}
      />

      <FormSheet visible={adding} title="Allocate a student" onClose={() => setAdding(false)} onSubmit={save} submitLabel="Allocate" busy={actions.allocate.isPending} error={error}>
        <Text style={styles.sub}>{year ? `For ${year.name}.` : 'There is no current academic year.'}</Text>
        {form.student ? (
          <View style={styles.picked}><Text style={styles.pickedText}>{form.studentLabel}</Text><Button title="Change" size="sm" variant="outline" onPress={() => setForm((f) => ({ ...f, student: null, studentLabel: '' }))} /></View>
        ) : (
          <>
            <SearchBar value={search} onChangeText={setSearch} placeholder="Search a student (2 letters)..." />
            {term.length >= 2 && !students.isLoading && (students.data ?? []).length === 0 ? <Text style={styles.sub}>No student matches.</Text> : null}
            {(students.data ?? []).map((s) => (
              <TouchableOpacity key={s.id} accessibilityRole="button" style={styles.option} onPress={() => setForm((f) => ({ ...f, student: s.id, studentLabel: s.label }))}>
                <Text style={styles.name}>{s.label}</Text>{s.sub ? <Text style={styles.sub}>{s.sub}</Text> : null}
              </TouchableOpacity>
            ))}
          </>
        )}
        <Select<number> label="Room" searchable value={form.room} onChange={(v) => setForm((f) => ({ ...f, room: Number(v) }))} placeholder={rooms.isLoading ? 'Loading rooms...' : 'Choose a room with a free bed'}
          options={freeRooms(rooms.data ?? []).map((r) => ({ value: r.id, label: roomOption(r) }))} />
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  header: { gap: Spacing.md, marginBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  flex: { flex: 1, gap: 2 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  picked: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, justifyContent: 'space-between' },
  pickedText: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.primary },
  option: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, padding: Spacing.md },
});

// Used by the gate pass screen too: students who have a room are the only ones a pass can be made for.
export { useActiveAllocations };
