import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear, useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useRouteStops, useRoutes, useTransportActions, useVehicles, useYearAssignments } from '../../hooks/useTransport';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { studentsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { studentListParams } from '../../services/students';
import {
  TRANSPORT_TYPES, assignRequest, assignmentLine, bulkAssignMessage, emptyAssignForm, unassignedStudents, validateAssign,
  type AssignForm, type TransportAssignmentRow, type TransportType,
} from '../../services/transportAdmin';
import { toggleId } from '../../services/parentLinks';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Select from '../ui/Select';
import SearchBar from '../ui/SearchBar';
import QueryBoundary from '../ui/QueryBoundary';
import AppList from '../ui/AppList';
import StatusPill from '../ui/StatusPill';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, GlyphSize } from '../../constants/colors';

const ALL = 0;
const NONE = 0;

// Which student rides which route this year (web TransportAssignmentsPage). Admin and principal assign
// students (one or many at once) and remove them; a teacher sees the list read-only. There is no edit
// on the web either: to move a student, remove them and assign again.
export default function StudentTransportScreen() {
  const { isSchoolAdminNav: canManage } = useAuth();
  const toast = useToast();
  const year = useAcademicYear({ lockToCurrent: true });
  const yearId = year.current?.id ?? null;
  const routes = useRoutes();
  const [routeId, setRouteId] = useState<number>(ALL);
  const [search, setSearch] = useState('');
  const list = useYearAssignments(yearId, routeId === ALL ? null : routeId);
  const refreshControl = useRefreshControl(list.refetch);
  const actions = useTransportActions();
  const [assigning, setAssigning] = useState(false);

  const term = search.trim().toLowerCase();
  const shown = useMemo(() => (list.data ?? []).filter((a) => !term || (a.student_name || '').toLowerCase().includes(term)),
    [list.data, term]);

  const remove = async (a: TransportAssignmentRow) => {
    if (!(await confirm({ title: 'Remove from transport', message: `Take ${a.student_name} off ${a.route_name}? Their boarding history stays.`, confirmLabel: 'Remove', destructive: true }))) return;
    try {
      await actions.deleteAssignment.mutateAsync(a.id);
      toast.success('Removed from transport.');
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not remove the student.')); }
  };

  return (
    <>
    <AppList
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      data={list.data ? shown : []}
      keyExtractor={(a) => String(a.id)}
      extraData={actions.deleteAssignment.isPending}
      ListHeaderComponent={<View style={styles.header}>
      {canManage ? <Button title="+ Assign students" size="sm" onPress={() => setAssigning(true)} disabled={!yearId} /> : null}
      <Select label="Route" value={routeId}
        options={[{ value: ALL, label: 'All routes' }, ...(routes.data ?? []).map((r) => ({ value: r.id, label: r.name }))]}
        onChange={(v) => setRouteId(Number(v))} />
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search by student name..." />
      {list.data ? <Text style={styles.count}>{shown.length} student{shown.length === 1 ? '' : 's'} on transport{year.current ? ` in ${year.current.name}` : ''}</Text> : null}
      </View>}
      ListEmptyComponent={
        <QueryBoundary query={list} emptyTitle="No students on transport" emptyMessage={canManage ? 'Assign students to a route and stop.' : 'No student is on a route yet.'}>
          {() => null}
        </QueryBoundary>
      }
      renderItem={({ item: a }) => (
          <Card style={styles.card}>
            <View style={styles.head}>
              <Text style={styles.name} numberOfLines={1}>{a.student_name}</Text>
              <StatusPill label={a.transport_type_display || a.transport_type || ''} tone="info" />
            </View>
            <Text style={styles.sub}>{[a.student_roll_number ? `Roll ${a.student_roll_number}` : null, a.student_class_name].filter(Boolean).join('  ·  ')}</Text>
            <Text style={styles.sub}>{assignmentLine(a)}{a.stop_pickup_time ? `  ·  Pickup ${a.stop_pickup_time.slice(0, 5)}` : ''}</Text>
            {canManage ? <Button title="Remove" size="sm" variant="outline" onPress={() => remove(a)} disabled={actions.deleteAssignment.isPending} /> : null}
          </Card>
      )}
    />
    {canManage && yearId ? <AssignSheet visible={assigning} onClose={() => setAssigning(false)} yearId={yearId} /> : null}
    </>
  );
}

interface StudentLite { id: number; name: string; roll_number?: string | null }

function AssignSheet({ visible, onClose, yearId }: { visible: boolean; onClose: () => void; yearId: number }) {
  const toast = useToast();
  const actions = useTransportActions();
  const { options } = useAttendanceClassOptions();
  const routes = useRoutes();
  const vehicles = useVehicles();
  const yearAssignments = useYearAssignments(yearId, null);
  const [classId, setClassId] = useState<number | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [form, setForm] = useState<AssignForm>(emptyAssignForm());
  const [error, setError] = useState<string | null>(null);
  const option = options.find((o) => o.id === classId) ?? null;
  const stops = useRouteStops(form.route);
  const students = useScopedQuery<StudentLite[]>('transportAssignStudents', [classId, yearId], async () =>
    listOf<StudentLite>((await studentsApi.getStudents(studentListParams({ term: '', option, academicYearId: yearId, page: 1, pageSize: 500 }))).data),
  { enabled: visible && !!option, staleTime: 0 });
  const free = unassignedStudents(students.data ?? [], yearAssignments.data ?? []);
  const routeVehicles = (vehicles.data ?? []).filter((v) => v.assigned_route === form.route);
  const sortedStops = [...(stops.data ?? [])].sort((a, b) => a.stop_order - b.stop_order);

  const close = () => { setTicked([]); setForm(emptyAssignForm()); setClassId(null); setError(null); onClose(); };

  const submit = async () => {
    const problem = validateAssign(form, ticked, yearId);
    if (problem) return setError(problem);
    setError(null);
    const req = assignRequest(form, ticked, yearId);
    try {
      if (req.kind === 'single') {
        await actions.createAssignment.mutateAsync(req.body);
        toast.success('Student assigned to transport.');
      } else {
        const res = await actions.bulkAssign.mutateAsync(req.body);
        toast.success(bulkAssignMessage(res.data as { created?: number; skipped?: number }));
      }
      close();
    } catch (e) { setError(inventoryErrorMessage(e, 'Could not assign.')); }
  };

  return (
    <FormSheet visible={visible} title="Assign students" onClose={close} onSubmit={submit}
      submitLabel={ticked.length > 1 ? `Assign ${ticked.length} students` : 'Assign'} error={error}
      busy={actions.createAssignment.isPending || actions.bulkAssign.isPending}>
      <Select label="Class" value={classId} placeholder="Choose a class" searchable
        options={options.map((o) => ({ value: o.id, label: o.label }))} onChange={(v) => { setClassId(Number(v)); setTicked([]); }} />
      {option ? (
        students.isLoading ? <Text style={styles.sub}>Loading students...</Text> : free.length === 0 ? (
          <Text style={styles.sub}>Every student of this class is already on a route this year.</Text>
        ) : (
          <View style={styles.pickBox}>
            <View style={styles.head}>
              <Text style={styles.sub}>{ticked.length} of {free.length} not on a route yet</Text>
              <Button title={ticked.length === free.length ? 'Clear' : 'Tick all'} size="sm" variant="ghost"
                onPress={() => setTicked(ticked.length === free.length ? [] : free.map((s) => s.id))} />
            </View>
            {free.map((s) => (
              <TouchableOpacity key={s.id} accessibilityRole="checkbox" accessibilityState={{ checked: ticked.includes(s.id) }}
                onPress={() => setTicked((t) => toggleId(t, s.id))} style={styles.tick}>
                <Text style={styles.tickBox}>{ticked.includes(s.id) ? '☑' : '☐'}</Text>
                <Text style={styles.tickText}>{s.roll_number ? `${s.roll_number}. ` : ''}{s.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )
      ) : null}
      <Select label="Route" value={form.route} placeholder="Choose a route"
        options={(routes.data ?? []).filter((r) => r.is_active).map((r) => ({ value: r.id, label: r.name }))}
        onChange={(v) => setForm((f) => ({ ...f, route: Number(v), stop: null, vehicle: null }))} />
      {form.route ? (
        <Select label="Stop" value={form.stop} placeholder={sortedStops.length ? 'Choose a stop' : 'This route has no stops yet'}
          options={sortedStops.map((s) => ({ value: s.id, label: `${s.stop_order}. ${s.name}${s.pickup_time ? ` (${s.pickup_time.slice(0, 5)})` : ''}` }))}
          onChange={(v) => setForm((f) => ({ ...f, stop: Number(v) }))} />
      ) : null}
      {form.route ? (
        <Select label="Vehicle (optional)" value={form.vehicle ?? NONE}
          options={[{ value: NONE, label: routeVehicles.length ? 'No vehicle' : 'No vehicle on this route' }, ...routeVehicles.map((v) => ({ value: v.id, label: v.vehicle_number }))]}
          onChange={(v) => setForm((f) => ({ ...f, vehicle: v === NONE ? null : Number(v) }))} />
      ) : null}
      <Select label="Transport" value={form.type} options={TRANSPORT_TYPES.map((t) => ({ value: t.value, label: t.label }))}
        onChange={(v) => setForm((f) => ({ ...f, type: v as TransportType }))} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  // The list's header is one cell, so the form controls need their own spacing.
  header: { gap: Spacing.sm },
  count: { fontSize: FontSize.sm, color: Colors.textSecondary },
  card: { gap: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, flexShrink: 1 },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  pickBox: { gap: 2, marginBottom: Spacing.sm },
  tick: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 40 },
  tickBox: { fontSize: GlyphSize.sm, color: Colors.primary },
  tickText: { fontSize: FontSize.md, color: Colors.text, flexShrink: 1 },
});
