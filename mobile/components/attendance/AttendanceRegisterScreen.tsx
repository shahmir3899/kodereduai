import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { attendanceApi, sessionsApi, studentsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import { classParams, type ClassOption } from '../../services/attendanceEntry';
import {
  buildRegister, daysInMonth, isoDay, monthLabel, offDayMap, stepMonth,
  type CalendarDay, type DayCell, type RegisterRecord, type RegisterRow, type RegisterStudent,
} from '../../services/register';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Select from '../ui/Select';
import BottomSheet from '../ui/BottomSheet';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const CELL: Record<DayCell, { bg: string; fg: string; text: string }> = {
  PRESENT: { bg: Colors.successLight, fg: Colors.success, text: 'P' },
  ABSENT: { bg: Colors.errorLight, fg: Colors.error, text: 'A' },
  LEAVE: { bg: '#ede9fe', fg: Colors.leave, text: 'L' },
  NONE: { bg: Colors.surface, fg: Colors.textTertiary, text: '' },
  OFF: { bg: Colors.surfaceSecondary, fg: Colors.textTertiary, text: '' },
  NOT_ENROLLED: { bg: 'transparent', fg: Colors.textTertiary, text: '–' },
};
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

interface Props {
  // Teachers pass their own sections; admins leave it out and get every class.
  classOptions?: ClassOption[];
}

// Read-only monthly register: per-student counts for the month, and a tap opens that student's
// day-by-day calendar. Same data and enrolment rules as the web's Attendance Record page.
export default function AttendanceRegisterScreen({ classOptions }: Props) {
  const { year, options, isLoading: classesLoading } = useAttendanceClassOptions(classOptions);
  const yearId = year.current?.id ?? null;

  const now = new Date();
  const current = { year: now.getFullYear(), month0: now.getMonth() };
  const [ym, setYm] = useState(current);
  const [classId, setClassId] = useState<number | null>(null);
  const [openStudent, setOpenStudent] = useState<RegisterRow | null>(null);

  // Teachers get their first section pre-selected, as on the web.
  useEffect(() => {
    if (classId == null && options.length > 0) setClassId(options[0].id);
  }, [options, classId]);

  const option = options.find((o) => o.id === classId) ?? null;
  const dateFrom = isoDay(ym.year, ym.month0, 1);
  const dateTo = isoDay(ym.year, ym.month0, daysInMonth(ym.year, ym.month0));

  const students = useScopedQuery('attendanceRegisterStudents', [classId, yearId, ym.year, ym.month0], async () => {
    // as_of_*: a student who has left still shows for their last month and earlier.
    const scope = option?.isSession && yearId ? { session_class_id: option.id, academic_year: yearId } : { class_id: option?.classObj ?? option?.id };
    return listOf<RegisterStudent & { class_obj?: number }>(
      (await studentsApi.getStudents({ ...scope, as_of_year: ym.year, as_of_month: ym.month0 + 1, page_size: 500 })).data,
    );
  }, { enabled: !!option });

  const records = useScopedQuery('attendanceRegister', [classId, yearId, dateFrom], async () =>
    listOf<RegisterRecord>((await attendanceApi.getRegisterData({
      ...classParams(option!, yearId), date_from: dateFrom, date_to: dateTo,
    })).data),
  { enabled: !!option });

  const masterClassId = option?.classObj ?? students.data?.[0]?.class_obj;
  const calendar = useScopedQuery('attendanceRegisterCalendar', [ym.year, ym.month0, masterClassId ?? null, yearId], async () =>
    listOf<CalendarDay>(((await sessionsApi.getCalendarMonthView({
      year: ym.year, month: ym.month0 + 1, class_id: masterClassId || undefined, academic_year: yearId || undefined,
    })).data as { days?: CalendarDay[] })?.days),
  { enabled: !!option, staleTime: 5 * 60_000 });

  const refreshControl = useRefreshControl(students.refetch, records.refetch, calendar.refetch);

  const register = useMemo(() => buildRegister({
    students: students.data ?? [],
    records: records.data ?? [],
    offDays: offDayMap(calendar.data ?? []),
    year: ym.year,
    month0: ym.month0,
  }), [students.data, records.data, calendar.data, ym]);

  if (classesLoading) return <Skeleton />;
  if (!year.current) return <EmptyState title="No academic session" message="Set a current academic year on the web app first." />;
  if (options.length === 0) return <EmptyState title="No classes" message="There are no classes to show." />;

  const atCurrent = ym.year === current.year && ym.month0 === current.month0;
  const loading = !!option && (students.isLoading || records.isLoading);
  const failed = !!option && !students.data && !records.data && (students.isError || records.isError);

  const header = (
    <View>
      <Select
        label="Class"
        value={classId}
        options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={setClassId}
        placeholder="Select a class"
      />
      <View style={styles.stepper}>
        <TouchableOpacity accessibilityRole="button" hitSlop={10} onPress={() => setYm(stepMonth(ym.year, ym.month0, -1, current))}>
          <Text style={styles.step}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.month}>{monthLabel(ym.year, ym.month0)}</Text>
        <TouchableOpacity accessibilityRole="button" hitSlop={10} disabled={atCurrent} onPress={() => setYm(stepMonth(ym.year, ym.month0, 1, current))}>
          <Text style={[styles.step, atCurrent && styles.stepOff]}>›</Text>
        </TouchableOpacity>
      </View>
      {!loading && register.rows.length > 0 ? (
        <View style={styles.totals}>
          <Total label="Present" value={register.totals.present} color={Colors.success} />
          <Total label="Absent" value={register.totals.absent} color={Colors.error} />
          <Total label="Leave" value={register.totals.leave} color={Colors.leave} />
          <Total label="Rate" value={register.totals.percent == null ? '—' : `${register.totals.percent}%`} color={Colors.primary} />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={loading || failed ? [] : register.rows}
        keyExtractor={(r) => String(r.id)}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? <Skeleton /> : failed ? <ErrorState onRetry={() => { students.refetch(); records.refetch(); }} />
            : <EmptyState title="No students" message="No students are enrolled in this class for this month." />
        }
        renderItem={({ item }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => setOpenStudent(item)}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.sub}>
                {item.roll ? `Roll ${item.roll}  ·  ` : ''}P {item.present}  A {item.absent}  L {item.leave}
              </Text>
            </View>
            {item.hasLeft ? <StatusPill label="Left" tone="neutral" /> : null}
            <Text style={[styles.pct, { color: pctColor(item.percent) }]}>{item.percent == null ? '—' : `${item.percent}%`}</Text>
          </TouchableOpacity>
        )}
      />

      <BottomSheet visible={!!openStudent} onClose={() => setOpenStudent(null)} title={openStudent ? `${openStudent.name} · ${monthLabel(ym.year, ym.month0)}` : undefined}>
        {openStudent ? <MonthGrid row={openStudent} year={ym.year} month0={ym.month0} /> : null}
      </BottomSheet>
    </View>
  );
}

const pctColor = (p: number | null) => (p == null ? Colors.textTertiary : p >= 90 ? Colors.success : p >= 75 ? Colors.warning : Colors.error);

function Total({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <View style={styles.total}>
      <Text style={[styles.totalValue, { color }]}>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

// Calendar for one student: leading blanks so each day sits under its weekday.
function MonthGrid({ row, year, month0 }: { row: RegisterRow; year: number; month0: number }) {
  const lead = new Date(year, month0, 1).getDay();
  const cells: Array<DayCell | null> = [...Array.from({ length: lead }, () => null), ...row.cells];
  return (
    <View style={styles.grid}>
      <View style={styles.gridRow}>
        {WEEKDAYS.map((d, i) => <Text key={i} style={styles.weekday}>{d}</Text>)}
      </View>
      <View style={styles.gridWrap}>
        {cells.map((c, i) => {
          if (c == null) return <View key={`b${i}`} style={styles.cellBox} />;
          const day = i - lead + 1;
          const s = CELL[c];
          return (
            <View key={i} style={styles.cellBox}>
              <View style={[styles.cell, { backgroundColor: s.bg }]}>
                <Text style={[styles.cellDay, { color: s.fg }]}>{day}</Text>
                {s.text ? <Text style={[styles.cellStatus, { color: s.fg }]}>{s.text}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, marginBottom: Spacing.md },
  step: { fontSize: 28, color: Colors.primary, paddingHorizontal: Spacing.sm },
  stepOff: { color: Colors.border },
  month: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, minWidth: 140, textAlign: 'center' },
  totals: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  total: { flex: 1, alignItems: 'center' },
  totalValue: { fontSize: FontSize.lg, fontWeight: '700' },
  totalLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm, gap: Spacing.sm },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  sub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  pct: { fontSize: FontSize.md, fontWeight: '700', minWidth: 48, textAlign: 'right' },
  grid: { paddingHorizontal: Spacing.lg },
  gridRow: { flexDirection: 'row', marginBottom: Spacing.xs },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: '600' },
  gridWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  cellBox: { width: `${100 / 7}%`, padding: 2 },
  cell: { borderRadius: BorderRadius.sm, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, minHeight: 40 },
  cellDay: { fontSize: FontSize.xs },
  cellStatus: { fontSize: FontSize.sm, fontWeight: '700' },
});
