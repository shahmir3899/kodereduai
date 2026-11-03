import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import { useStudentDashboard, useStudentDayStatus, useStudentResults } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { assignmentTypeTone, attendanceTile, dueLabel, examPercentage, isCurrentPeriod, lastExamPct, offDayNote, pctTone, rateTone } from '../../services/studentPortal';
import { schoolToday } from '../../services/schoolTime';
import { formatMoney } from '../../services/feeCollect';
import { formatSlotTime } from '../../services/teacher';
import Card from '../../components/ui/Card';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import SchoolSwitcher from '../../components/nav/SchoolSwitcher';
import RecentNotifications from '../../components/dashboard/RecentNotifications';
import StatusPill from '../../components/ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE = { success: Colors.success, warning: Colors.warning, error: Colors.error } as const;
const PCT_COLOR = { success: Colors.success, info: Colors.info, warning: Colors.warning, error: Colors.error, neutral: Colors.textSecondary } as const;

export default function StudentDashboard() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const query = useStudentDashboard();
  const results = useStudentResults();
  const today = schoolToday();
  const dayStatus = useStudentDayStatus(today, today, query.data?.student?.class_obj);
  const isOffDay = !!dayStatus.data?.[today]?.is_off_day;
  const nowHm = new Date().toTimeString().slice(0, 5);
  const lastExam = lastExamPct(results.data);
  const refreshControl = useRefreshControl(query.refetch);
  const go = (route?: string, params?: Record<string, string | number>) =>
    route && router.push((params ? { pathname: route, params } : route) as Href);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const d = query.data!;
  const pending = Number(d.fees.outstanding) || 0;
  const name = d.student?.name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;

  const quick = [
    { label: 'Attendance', icon: '✅', route: routeFor('student', '/student/attendance') },
    { label: 'Results', icon: '📊', route: routeFor('student', '/student/results') },
    { label: 'Tasks', icon: '📝', route: routeFor('student', '/student/assignments') },
    { label: 'Timetable', icon: '⏰', route: routeFor('student', '/student/timetable') },
    { label: 'Exams', icon: '🗓️', route: routeFor('student', '/student/exam-schedule') },
    { label: 'Fees', icon: '💰', route: routeFor('student', '/student/fees') },
    { label: 'Library', icon: '📚', route: routeFor('student', '/student/library') },
    { label: 'Transport', icon: '🚌', route: routeFor('student', '/student/transport') },
    { label: 'Study helper', icon: '🤖', route: routeFor('student', '/student/study-helper') },
  ];
  const recent = (results.data ?? []).slice(0, 4);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.greeting}>Hello, {name}</Text>
      <Text style={styles.sub}>{[d.student?.class_name, d.student?.roll_number ? `Roll #${d.student.roll_number}` : ''].filter(Boolean).join('  ·  ')}</Text>
      <SchoolSwitcher />

      <View style={styles.tiles}>
        <TouchableOpacity accessibilityRole="button" style={styles.tile} onPress={() => go(routeFor('student', '/student/attendance'))}>
          <Text style={[styles.tileValue, { color: d.attendance.total_days > 0 && !isOffDay ? TONE[rateTone(d.attendance.rate)] : Colors.textSecondary }]}>
            {attendanceTile(d.attendance, isOffDay)}
          </Text>
          <Text style={styles.tileLabel}>{isOffDay ? offDayNote(dayStatus.data?.[today]) : 'Attendance'}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.tile} onPress={() => go(routeFor('student', '/student/fees'))}>
          <Text style={[styles.tileValue, { color: pending > 0 ? Colors.error : Colors.success }]}>{formatMoney(pending)}</Text>
          <Text style={styles.tileLabel}>Fees pending</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.tile} onPress={() => go(routeFor('student', '/student/assignments'))}>
          <Text style={styles.tileValue}>{d.upcoming_assignments.length}</Text>
          <Text style={styles.tileLabel}>Tasks due soon</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" style={styles.tile} onPress={() => go(routeFor('student', '/student/results'))}>
          <Text style={[styles.tileValue, { color: PCT_COLOR[pctTone(lastExam)] }]}>{lastExam != null ? `${Math.round(lastExam)}%` : 'N/A'}</Text>
          <Text style={styles.tileLabel}>Last exam</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Today&apos;s classes</Text>
      {d.today_timetable.length === 0 ? <Text style={styles.muted}>No classes today.</Text> : d.today_timetable.map((p, i) => {
        const current = !isOffDay && isCurrentPeriod(p.start_time, p.end_time, nowHm);
        return (
        <Card key={`${p.slot}-${i}`} style={current ? { ...styles.period, ...styles.periodNow } : styles.period}>
          <View style={styles.timeBox}>
            <Text style={styles.time}>{formatSlotTime(p.start_time)}</Text>
            {p.end_time ? <Text style={styles.endTime}>{formatSlotTime(p.end_time)}</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.subject} numberOfLines={1}>{p.subject || p.slot}</Text>
            <Text style={styles.sub} numberOfLines={1}>{[p.teacher, p.room ? `Room ${p.room}` : ''].filter(Boolean).join('  ·  ')}</Text>
          </View>
          {current ? <StatusPill label="Now" tone="info" /> : null}
        </Card>
        );
      })}

      <Text style={styles.section}>Upcoming tasks</Text>
      {d.upcoming_assignments.length === 0 ? <Text style={styles.muted}>Nothing due soon.</Text> : d.upcoming_assignments.map((a) => (
        <TouchableOpacity accessibilityRole="button" key={a.id} onPress={() => go('/(student)/assignments/detail', { id: a.id })}>
          <Card style={styles.period}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subject} numberOfLines={1}>{a.title}</Text>
              <Text style={styles.sub}>{a.subject}  ·  {dueLabel(a.due_date)}</Text>
            </View>
            {a.type ? <StatusPill label={a.type} tone={assignmentTypeTone(a.type)} /> : null}
            <Text style={styles.arrow}>›</Text>
          </Card>
        </TouchableOpacity>
      ))}

      {recent.length > 0 ? (
        <>
          <View style={styles.headRow}>
            <Text style={styles.section}>Recent results</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => go(routeFor('student', '/student/results'))} style={styles.linkBox}>
              <Text style={styles.link}>View all</Text>
            </TouchableOpacity>
          </View>
          {recent.map((r) => {
            const pct = examPercentage(r);
            return (
              <Card key={r.exam_id} style={styles.period}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.subject} numberOfLines={1}>{r.exam_name}</Text>
                  <Text style={styles.sub}>{[r.exam_type, r.exam_date].filter(Boolean).join('  ·  ')}</Text>
                </View>
                {r.grade ? <StatusPill label={`Grade ${r.grade}`} tone="success" /> : null}
                <Text style={[styles.pct, { color: PCT_COLOR[pctTone(pct)] }]}>{pct != null ? `${pct}%` : '–'}</Text>
              </Card>
            );
          })}
        </>
      ) : null}

      <Text style={styles.section}>Quick links</Text>
      <View style={styles.actions}>
        {quick.map((a) => (
          <TouchableOpacity accessibilityRole="button" key={a.label} style={[styles.quick, !a.route && styles.quickOff]} disabled={!a.route} onPress={() => go(a.route)}>
            <Text style={styles.quickIcon}>{a.icon}</Text>
            <Text style={styles.quickLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <RecentNotifications enabled={isModuleEnabled('notifications')} onSeeAll={() => go(routeFor('student', '/notifications'))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.lg },
  tile: { width: '47%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  tileValue: { fontSize: FontSize.xl, fontWeight: '700' },
  tileLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  period: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, marginBottom: Spacing.sm },
  timeBox: { width: 76 },
  time: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  endTime: { fontSize: FontSize.xs, color: Colors.textTertiary },
  periodNow: { borderWidth: 1, borderColor: Colors.info, backgroundColor: Colors.infoLight },
  subject: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  headRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  linkBox: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'flex-end' },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  pct: { fontSize: FontSize.lg, fontWeight: '700' },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  quick: { width: '22%', minWidth: 72, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  quickOff: { opacity: 0.4 },
  quickIcon: { fontSize: 22 },
  quickLabel: { fontSize: FontSize.xs, color: Colors.text, marginTop: 4, textAlign: 'center' },
});
