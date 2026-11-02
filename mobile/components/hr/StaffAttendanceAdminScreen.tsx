import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from 'expo-router';
import { useSaveStaffAttendance, useStaffAttendanceDay, useStaffForAttendance } from '../../hooks/useStaffAdminHr';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { isFutureDate, todayString } from '../../services/attendanceEntry';
import { attendanceTone } from '../../services/myHr';
import {
  STATUS_OPTIONS, buildRows, buildSavePayload, countStatuses, isDirty, markUnmarkedPresent, validateDay,
  type StaffAttendanceRow,
} from '../../services/staffAttendance';
import { staffLeaveErrorMessage } from '../../services/staffLeave';
import DateField from '../ui/DateField';
import Input from '../ui/Input';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE_COLOR = { success: Colors.success, error: Colors.error, warning: Colors.warning, info: Colors.leave } as const;

// Mark the day's attendance for every active staff member (admin and principal). One tap per person,
// optional check-in and check-out times behind a row tap, and one save for the whole day. On an OFF
// day the server records On leave by itself.
export default function StaffAttendanceAdminScreen() {
  const toast = useToast();
  const navigation = useNavigation();
  const [date, setDate] = useState(todayString());
  const staff = useStaffForAttendance();
  const existing = useStaffAttendanceDay(date);
  const save = useSaveStaffAttendance();
  const refreshControl = useRefreshControl(staff.refetch, existing.refetch);

  const [rows, setRows] = useState<StaffAttendanceRow[]>([]);
  const [baseline, setBaseline] = useState<StaffAttendanceRow[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const rowsRef = useRef(rows);
  const baselineRef = useRef(baseline);
  const appliedKey = useRef('');
  rowsRef.current = rows;
  baselineRef.current = baseline;

  // Build the list once per day, and again when fresher data arrives, but never over marks the user made.
  useEffect(() => {
    if (!staff.data || !existing.data) return;
    if (appliedKey.current === date && isDirty(rowsRef.current, baselineRef.current)) return;
    const next = buildRows(staff.data, existing.data);
    appliedKey.current = date;
    setRows(next);
    setBaseline(next);
  }, [date, staff.data, existing.data]);

  const discardOk = useCallback(async () => {
    if (!isDirty(rowsRef.current, baselineRef.current)) return true;
    return confirm({ title: 'Discard changes?', message: 'You have attendance that is not saved.', confirmLabel: 'Discard', destructive: true });
  }, []);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!isDirty(rowsRef.current, baselineRef.current)) return;
      e.preventDefault();
      confirm({ title: 'Leave without saving?', message: 'Your attendance marks will be lost.', confirmLabel: 'Leave', destructive: true })
        .then((ok) => ok && navigation.dispatch(e.data.action));
    });
    return unsubscribe;
  }, [navigation]);

  const changeDate = async (next: string) => {
    if (next === date) return;
    if (isFutureDate(next)) { toast.error('Attendance cannot be marked for a future date.'); return; }
    if (!(await discardOk())) return;
    setRows([]);
    setBaseline([]);
    appliedKey.current = '';
    setDate(next);
  };

  const patch = (id: number, change: Partial<StaffAttendanceRow>) =>
    setRows((rs) => rs.map((r) => (r.staffId === id ? { ...r, ...change } : r)));

  const submit = () => {
    const problem = validateDay(date, rows);
    if (problem) { toast.error(problem); return; }
    save.mutate(buildSavePayload(date, rows), {
      onSuccess: (res) => {
        toast.success(`Saved: ${res.created ?? 0} added, ${res.updated ?? 0} updated.`);
        setBaseline(rowsRef.current);
      },
      onError: (e) => toast.error(staffLeaveErrorMessage(e, 'Could not save attendance.')),
    });
  };

  const counts = countStatuses(rows);
  const marked = rows.length - counts.UNMARKED;
  const dirty = isDirty(rows, baseline);

  const header = (
    <View>
      <DateField label="Date" value={date} onChange={changeDate} maximumDate={new Date()} />
      {rows.length > 0 ? (
        <>
          <View style={styles.counts}>
            {STATUS_OPTIONS.map((o) => (
              <View key={o.value} style={styles.count}>
                <Text style={[styles.countValue, { color: TONE_COLOR[attendanceTone(o.value)] }]}>{counts[o.value]}</Text>
                <Text style={styles.countLabel} numberOfLines={1}>{o.label}</Text>
              </View>
            ))}
            <View style={styles.count}>
              <Text style={[styles.countValue, { color: Colors.textSecondary }]}>{counts.UNMARKED}</Text>
              <Text style={styles.countLabel} numberOfLines={1}>Unmarked</Text>
            </View>
          </View>
          <Button title="Mark all unmarked present" size="sm" variant="outline" onPress={() => setRows(markUnmarkedPresent(rows))} disabled={counts.UNMARKED === 0} style={styles.all} />
        </>
      ) : null}
    </View>
  );

  if (staff.isLoading || existing.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if ((staff.isError && !staff.data) || (existing.isError && !existing.data)) {
    return <ErrorState error={staff.error ?? existing.error} onRetry={() => { staff.refetch(); existing.refetch(); }} />;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={rows}
        keyExtractor={(r) => String(r.staffId)}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="No staff" message="There are no active staff members to mark." />}
        renderItem={({ item: r }) => (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${r.name}. Times and notes`} style={styles.who} onPress={() => setOpen(open === r.staffId ? null : r.staffId)}>
                <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
                <Text style={styles.sub} numberOfLines={1}>{[r.employeeId, r.department].filter(Boolean).join('  ·  ') || 'Tap for times and notes'}</Text>
              </TouchableOpacity>
              <View style={styles.buttons}>
                {STATUS_OPTIONS.map((o) => {
                  const active = r.status === o.value;
                  const color = TONE_COLOR[attendanceTone(o.value)];
                  return (
                    <TouchableOpacity key={o.value} accessibilityRole="button" accessibilityLabel={`${r.name}: ${o.label}`} accessibilityState={{ selected: active }}
                      // Tapping the active status clears it, so a slip is undoable.
                      onPress={() => patch(r.staffId, { status: active ? '' : o.value })}
                      style={[styles.statusBtn, active && { backgroundColor: color, borderColor: color }]}>
                      <Text style={[styles.statusText, active && { color: Colors.textInverse }]}>{o.letter}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            {open === r.staffId ? (
              <View style={styles.more}>
                <View style={styles.times}>
                  <View style={styles.time}><Input label="Check-in" value={r.checkIn} onChangeText={(v) => patch(r.staffId, { checkIn: v })} placeholder="08:30" keyboardType="numbers-and-punctuation" maxLength={5} /></View>
                  <View style={styles.time}><Input label="Check-out" value={r.checkOut} onChangeText={(v) => patch(r.staffId, { checkOut: v })} placeholder="15:00" keyboardType="numbers-and-punctuation" maxLength={5} /></View>
                </View>
                <Input label="Notes" value={r.notes} onChangeText={(v) => patch(r.staffId, { notes: v })} placeholder="Optional" />
              </View>
            ) : null}
          </View>
        )}
      />
      {rows.length > 0 ? (
        <View style={styles.footer}>
          <Text style={styles.legend}>P present  ·  A absent  ·  L late  ·  H half day  ·  V on leave</Text>
          <Button title={`Save attendance (${marked}/${rows.length} marked)`} onPress={submit} loading={save.isPending} disabled={!dirty || save.isPending} fullWidth />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 130 },
  counts: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md, marginBottom: Spacing.sm },
  count: { flex: 1, alignItems: 'center' },
  countValue: { fontSize: FontSize.lg, fontWeight: '700' },
  countLabel: { fontSize: 10, color: Colors.textSecondary },
  all: { alignSelf: 'flex-start', marginBottom: Spacing.md },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  who: { flex: 1, marginRight: Spacing.sm },
  name: { fontSize: FontSize.md, color: Colors.text, fontWeight: '600' },
  sub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: 6 },
  statusBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  statusText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textTertiary },
  more: { marginTop: Spacing.md },
  times: { flexDirection: 'row', gap: Spacing.md },
  time: { flex: 1 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: Spacing.lg, backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, gap: Spacing.xs },
  legend: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
});
