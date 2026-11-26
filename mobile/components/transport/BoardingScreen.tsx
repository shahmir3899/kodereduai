import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useBoarding, useRoutes, useTransportActions, useYearAssignments } from '../../hooks/useTransport';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { todayString } from '../../services/attendanceEntry';
import {
  BOARDING, boardingBody, boardingCounts, boardingMap, boardingSavedMessage, statusFor, type BoardingStatus,
} from '../../services/transportAdmin';
import { inventoryErrorMessage } from '../../services/inventory';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import QueryBoundary from '../ui/QueryBoundary';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE_COLOR: Record<string, string> = { success: Colors.success, warning: Colors.warning, error: Colors.error };

// Who got on the bus (web TransportAttendancePage): a route and a day, each student on the route
// marked Boarded, Not boarded or Absent, saved together. A student with no mark counts as Boarded,
// which is what Save records. Saving is admin and principal only; a teacher sees the marks.
export default function BoardingScreen() {
  const { isSchoolAdminNav: canManage } = useAuth();
  const toast = useToast();
  const year = useAcademicYear({ lockToCurrent: true });
  const yearId = year.current?.id ?? null;
  const routes = useRoutes();
  const [routeId, setRouteId] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const riders = useYearAssignments(yearId, routeId);
  const saved = useBoarding(routeId, date);
  const actions = useTransportActions();
  const refreshControl = useRefreshControl(async () => { await Promise.all([riders.refetch(), saved.refetch()]); });
  const [marks, setMarks] = useState<Record<number, BoardingStatus>>({});
  const [dirty, setDirty] = useState(false);

  // Reload the day's saved marks whenever the route or day (or the saved data) changes.
  useEffect(() => { setMarks(boardingMap(saved.data ?? [])); setDirty(false); }, [saved.data]);

  const active = useMemo(() => (riders.data ?? []).filter((a) => a.is_active !== false), [riders.data]);
  const ids = active.map((a) => a.student);
  const counts = boardingCounts(ids, marks);

  const mark = (studentId: number, s: BoardingStatus) => { setMarks((m) => ({ ...m, [studentId]: s })); setDirty(true); };
  const markAll = (s: BoardingStatus) => { setMarks(Object.fromEntries(ids.map((id) => [id, s]))); setDirty(true); };

  const save = async () => {
    if (!routeId || ids.length === 0) return;
    try {
      const res = await actions.markBoarding.mutateAsync(boardingBody(routeId, date, ids, marks));
      toast.success(boardingSavedMessage(ids.length, res.data as { errors?: unknown[] }));
      setDirty(false);
    } catch (e) { toast.error(inventoryErrorMessage(e, 'Could not save boarding.')); }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Select label="Route" value={routeId} placeholder="Choose a route"
        options={(routes.data ?? []).map((r) => ({ value: r.id, label: r.name }))} onChange={(v) => setRouteId(Number(v))} />
      <DateField label="Day" value={date} onChange={(v) => { if (v) setDate(v); }} />
      {!routeId ? <EmptyState title="Choose a route" message="Pick a route and a day to see who boarded." /> : (
        <QueryBoundary query={riders} emptyTitle="No students on this route" emptyMessage="Assign students to the route first (Student transport).">
          {() => (
            <>
              <Text style={styles.count}>
                {ids.length} student{ids.length === 1 ? '' : 's'}  ·  Boarded {counts.BOARDED}  ·  Not boarded {counts.NOT_BOARDED}  ·  Absent {counts.ABSENT}
              </Text>
              {canManage ? (
                <View style={styles.row}>
                  <Button title="All boarded" size="sm" variant="ghost" onPress={() => markAll('BOARDED')} />
                  <Button title="All absent" size="sm" variant="ghost" onPress={() => markAll('ABSENT')} />
                </View>
              ) : null}
              {active.map((a) => {
                const now = statusFor(marks, a.student);
                return (
                  <Card key={a.id} style={styles.card}>
                    <Text style={styles.name} numberOfLines={1}>{a.student_name}</Text>
                    <Text style={styles.sub}>{[a.student_class_name, a.stop_name].filter(Boolean).join('  ·  ')}</Text>
                    <View style={styles.choices} accessibilityRole="radiogroup">
                      {BOARDING.map((b) => {
                        const on = now === b.value;
                        return (
                          <TouchableOpacity key={b.value} accessibilityRole="radio" accessibilityState={{ selected: on, disabled: !canManage }}
                            accessibilityLabel={`${a.student_name}: ${b.label}`} disabled={!canManage} onPress={() => mark(a.student, b.value)}
                            style={[styles.choice, on && { backgroundColor: TONE_COLOR[b.tone], borderColor: TONE_COLOR[b.tone] }]}>
                            <Text style={[styles.choiceText, on && styles.choiceOn]}>{b.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </Card>
                );
              })}
              {canManage ? (
                <Button title={dirty ? 'Save boarding' : 'Save boarding (no changes)'} onPress={save} loading={actions.markBoarding.isPending}
                  disabled={actions.markBoarding.isPending || ids.length === 0} />
              ) : <Text style={styles.sub}>Only the school admin or principal can mark boarding.</Text>}
            </>
          )}
        </QueryBoundary>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.sm },
  count: { fontSize: FontSize.sm, color: Colors.textSecondary },
  row: { flexDirection: 'row', gap: Spacing.sm },
  card: { gap: 4 },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  choices: { flexDirection: 'row', gap: Spacing.xs, flexWrap: 'wrap', marginTop: 4 },
  choice: { borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.full, paddingHorizontal: Spacing.md, minHeight: 40, justifyContent: 'center' },
  choiceText: { fontSize: FontSize.sm, color: Colors.text },
  choiceOn: { color: Colors.textInverse, fontWeight: '700' },
});
