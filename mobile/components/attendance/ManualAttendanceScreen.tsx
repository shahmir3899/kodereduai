import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useNavigation } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { attendanceApi, sessionsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import {
  buildRows, buildSavePayload, classParams, countStatuses, isDirty,
  isFutureDate, markAll, setStatus, todayString,
  type AttendanceStatus, type ClassOption, type Row,
} from '../../services/attendanceEntry';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import Select from '../ui/Select';
import DateField from '../ui/DateField';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useToast } from '../ui/Toast';
import { confirm } from '../ui/confirm';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const STATUS_STYLE: Record<'PRESENT' | 'ABSENT' | 'LEAVE', { letter: string; label: string; bg: string; fg: string }> = {
  PRESENT: { letter: 'P', label: 'Present', bg: Colors.successLight, fg: Colors.success },
  ABSENT: { letter: 'A', label: 'Absent', bg: Colors.errorLight, fg: Colors.error },
  LEAVE: { letter: 'L', label: 'Leave', bg: '#ede9fe', fg: Colors.leave },
};
const STATUS_KEYS = ['PRESENT', 'ABSENT', 'LEAVE'] as const;

interface Props {
  // Teachers pass the sections they are assigned to; admins leave it out and get every class.
  classOptions?: ClassOption[];
  // Opens on this section (e.g. from the dashboard's "Mark attendance"); ignored if not in the list.
  initialClassId?: number;
}

// Same flow as the web's Manual Entry page: pick a class and a day, mark each enrolled student,
// save in one request. Needs a connection to save (no offline writes).
export default function ManualAttendanceScreen({ classOptions, initialClassId }: Props) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigation = useNavigation();

  const { year, options, isLoading: classesLoading } = useAttendanceClassOptions(classOptions);

  const [classId, setClassId] = useState<number | null>(null);
  const [date, setDate] = useState(todayString());
  const [rows, setRows] = useState<Row[]>([]);
  const [baseline, setBaseline] = useState<Row[]>([]);
  const rowsRef = useRef<Row[]>([]);
  const baselineRef = useRef<Row[]>([]);
  const appliedKey = useRef('');
  rowsRef.current = rows;
  baselineRef.current = baseline;

  // Teachers get their first section pre-selected (as on the web); a deep link picks its own.
  // Switching class is a discard-guarded action, so this only runs while nothing is unsaved.
  useEffect(() => {
    if (!classOptions || classOptions.length === 0) return;
    if (isDirty(rowsRef.current, baselineRef.current)) return;
    const wanted = initialClassId && classOptions.some((o) => o.id === initialClassId) ? initialClassId : null;
    if (wanted && wanted !== classId) setClassId(wanted);
    else if (classId == null) setClassId(classOptions[0].id);
  }, [classOptions, initialClassId, classId]);

  const option = options.find((o) => o.id === classId) ?? null;
  const yearId = year.current?.id ?? null;
  const params = useMemo(() => (option ? classParams(option, yearId) : {}), [option, yearId]);
  const dirty = isDirty(rows, baseline);

  // Fresh on every open: attendance must never come from a minute-old cache.
  const live = { staleTime: 0 };
  const dayStatus = useScopedQuery('manualDayStatus', [date, option?.classObj ?? null, yearId], async () => {
    const res = await sessionsApi.getCalendarDayStatus({
      date_from: date,
      date_to: date,
      class_id: option?.classObj || undefined,
      academic_year: yearId || undefined,
    });
    return (res.data?.days?.[date] ?? null) as { is_off_day?: boolean; off_day_types?: string[] } | null;
  }, { enabled: !!option, ...live });

  const enrolled = useScopedQuery('attendanceEnrollments', [classId, date, yearId], async () =>
    listOf<{ student: number; student_name: string; roll_number?: string }>(
      (await sessionsApi.getEnrollments({ ...params, academic_year: yearId, active_on: date, page_size: 500 })).data,
    ), { enabled: !!option && !!yearId, ...live });

  const existing = useScopedQuery('attendanceRecords', [classId, date, yearId], async () =>
    listOf<{ student?: number; student_id?: number; status: string }>(
      (await attendanceApi.getRecords({ ...params, date, academic_year: yearId, page_size: 500 })).data,
    ), { enabled: !!option, ...live });

  const isOffDay = !!dayStatus.data?.is_off_day;

  // Load the grid once per class + day, and again when fresher data arrives, but never over
  // marks the user has already made.
  const key = `${classId}|${date}|${yearId}`;
  useEffect(() => {
    if (!enrolled.data || !existing.data) return;
    if (appliedKey.current === key && isDirty(rowsRef.current, baselineRef.current)) return;
    const next = buildRows(enrolled.data, existing.data);
    appliedKey.current = key;
    setRows(next);
    setBaseline(next);
  }, [key, enrolled.data, existing.data]);

  const discardOk = useCallback(async () => {
    if (!isDirty(rowsRef.current, baselineRef.current)) return true;
    return confirm({ title: 'Discard changes?', message: 'You have attendance that is not saved.', confirmLabel: 'Discard', destructive: true });
  }, []);

  // Back button / swipe with unsaved marks.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!isDirty(rowsRef.current, baselineRef.current)) return;
      e.preventDefault();
      confirm({ title: 'Leave without saving?', message: 'Your attendance marks will be lost.', confirmLabel: 'Leave', destructive: true })
        .then((ok) => ok && navigation.dispatch(e.data.action));
    });
    return unsubscribe;
  }, [navigation]);

  const changeClass = async (id: number) => {
    if (id === classId || !(await discardOk())) return;
    setRows([]);
    setBaseline([]);
    appliedKey.current = '';
    setClassId(id);
  };

  const changeDate = async (next: string) => {
    if (next === date) return;
    if (isFutureDate(next)) {
      toast.error('Attendance cannot be marked for a future date.');
      return;
    }
    if (!(await discardOk())) return;
    setDate(next);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = buildSavePayload(params, yearId, date, rows);
      if (!payload) throw new Error('NOTHING_MARKED');
      return (await attendanceApi.bulkEntry(payload)).data as { created?: number; updated?: number; errors?: unknown[] };
    },
    onSuccess: (res) => {
      setBaseline(rowsRef.current);
      toast.success(`Saved: ${res.created ?? 0} added, ${res.updated ?? 0} updated.`);
      if (res.errors && res.errors.length > 0) {
        Alert.alert('Some students were not saved', res.errors.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('\n'));
      }
      queryClient.invalidateQueries({ queryKey: ['attendanceRecords'] });
      queryClient.invalidateQueries({ queryKey: ['attendanceRegister'] });
      queryClient.invalidateQueries({ queryKey: ['adminDashboard'] });
      queryClient.invalidateQueries({ queryKey: ['teacherSectionProgress'] });
    },
    onError: (error: any) => {
      if (error?.message === 'NOTHING_MARKED') {
        toast.error('Mark at least one student first.');
      } else if (!error?.response) {
        toast.error('No connection. Check your internet and try again.');
      } else {
        toast.error(error.response?.data?.detail || 'Could not save attendance.');
      }
    },
  });

  const counts = countStatuses(rows);
  const marked = rows.length - counts.notSet;

  if (classesLoading) return <Skeleton />;
  if (year.isError && !year.current) return <ErrorState onRetry={() => year.refetch()} />;
  if (!year.current) {
    return <EmptyState title="No academic session" message="Set a current academic year on the web app first." />;
  }

  const header = (
    <View>
      <Select
        label="Class"
        value={classId}
        options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={changeClass}
        placeholder="Select a class"
      />
      <DateField label="Date" value={date} onChange={changeDate} maximumDate={new Date()} />

      {isOffDay ? (
        <View style={styles.offDay}>
          <Text style={styles.offDayText}>
            OFF day{dayStatus.data?.off_day_types?.length ? `: ${dayStatus.data.off_day_types.join(', ')}` : ''}. Attendance is not applicable.
          </Text>
        </View>
      ) : null}

      {option && rows.length > 0 ? (
        <>
          <View style={styles.counts}>
            <Text style={[styles.count, { color: Colors.success }]}>P {counts.present}</Text>
            <Text style={[styles.count, { color: Colors.error }]}>A {counts.absent}</Text>
            <Text style={[styles.count, { color: Colors.leave }]}>L {counts.leave}</Text>
            <Text style={[styles.count, { color: Colors.textSecondary }]}>Not set {counts.notSet}</Text>
          </View>
          <View style={styles.markAll}>
            {STATUS_KEYS.map((k) => (
              <TouchableOpacity
                key={k}
                disabled={isOffDay}
                style={[styles.markAllBtn, { backgroundColor: STATUS_STYLE[k].bg }, isOffDay && styles.disabled]}
                onPress={() => setRows((r) => markAll(r, k))}
              >
                <Text style={[styles.markAllText, { color: STATUS_STYLE[k].fg }]}>All {STATUS_STYLE[k].label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );

  const loadingRows = !!option && (enrolled.isLoading || existing.isLoading);
  const loadFailed = !!option && !rows.length && (enrolled.isError || existing.isError);

  return (
    <View style={styles.container}>
      <FlatList
        data={option && !loadingRows ? rows : []}
        keyExtractor={(r) => String(r.studentId)}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListEmptyComponent={
          !option ? <EmptyState title="Pick a class" message="Choose a class to mark attendance." />
            : loadingRows ? <Skeleton />
            : loadFailed ? <ErrorState onRetry={() => { enrolled.refetch(); existing.refetch(); }} />
            : <EmptyState title="No students" message="No students are enrolled in this class on this date." />
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              {item.roll ? <Text style={styles.roll}>Roll {item.roll}</Text> : null}
            </View>
            <View style={styles.buttons}>
              {STATUS_KEYS.map((k) => {
                const active = item.status === k;
                return (
                  <TouchableOpacity
                    key={k}
                    disabled={isOffDay}
                    accessibilityLabel={`${STATUS_STYLE[k].label} for ${item.name}`}
                    style={[styles.statusBtn, active && { backgroundColor: STATUS_STYLE[k].bg, borderColor: STATUS_STYLE[k].fg }, isOffDay && styles.disabled]}
                    // Tapping the active status clears it, so a slip is undoable.
                    onPress={() => setRows((r) => setStatus(r, item.studentId, active ? 'NOT_SET' : (k as AttendanceStatus)))}
                  >
                    <Text style={[styles.statusText, active && { color: STATUS_STYLE[k].fg }]}>{STATUS_STYLE[k].letter}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}
      />

      {option && rows.length > 0 ? (
        <View style={styles.footer}>
          <Button
            title={`Save attendance (${marked}/${rows.length} marked)`}
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={isOffDay || !dirty}
            fullWidth
            size="lg"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 100 },
  offDay: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  offDayText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  counts: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  count: { fontSize: FontSize.sm, fontWeight: '700' },
  markAll: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  markAllBtn: { flex: 1, alignItems: 'center', paddingVertical: Spacing.sm, borderRadius: BorderRadius.md },
  markAllText: { fontSize: FontSize.xs, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  who: { flex: 1, marginRight: Spacing.sm },
  name: { fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  roll: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  buttons: { flexDirection: 'row', gap: Spacing.sm },
  statusBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  statusText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.textTertiary },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
});
