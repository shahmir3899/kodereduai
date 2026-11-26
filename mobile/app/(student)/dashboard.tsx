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
import HomeHero, { HomeShell } from '../../components/dashboard/HomeHero';
import type { Tile } from '../../components/dashboard/StatTiles';
import RecentNotifications from '../../components/dashboard/RecentNotifications';
import StatusPill from '../../components/ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { SectionEmpty } from '../../components/ui/SectionState';
import TileGrid from '../../components/ui/TileGrid';
import type { IconName } from '../../components/ui/Icon';

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

  const shellName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || '';
  if (query.isLoading) return <HomeShell name={shellName}><Skeleton /></HomeShell>;
  if (query.isError && !query.data) return <HomeShell name={shellName}><ErrorState error={query.error} onRetry={() => query.refetch()} /></HomeShell>;
  const d = query.data!;
  const pending = Number(d.fees.outstanding) || 0;
  const name = d.student?.name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;
  // The four figures that used to be tiles, now in the Home banner card.
  const attTone = { success: 'good', warning: 'warn', error: 'bad' } as const;
  const examTone = { success: 'good', info: 'good', warning: 'warn', error: 'bad', neutral: undefined } as const;
  const heroStats: Tile[] = [
    { label: isOffDay ? offDayNote(dayStatus.data?.[today]) : 'Attendance', value: attendanceTile(d.attendance, isOffDay),
      tone: d.attendance.total_days > 0 && !isOffDay ? attTone[rateTone(d.attendance.rate)] : undefined, route: routeFor('student', '/student/attendance') },
    { label: 'Fees pending', value: formatMoney(pending), tone: pending > 0 ? 'bad' : 'good', route: routeFor('student', '/student/fees') },
    { label: 'Tasks due soon', value: d.upcoming_assignments.length, route: routeFor('student', '/student/assignments') },
    { label: 'Last exam', value: lastExam != null ? `${Math.round(lastExam)}%` : 'N/A', tone: examTone[pctTone(lastExam)], route: routeFor('student', '/student/results') },
  ];

  const quick = [
    { label: 'Attendance', icon: 'checkbox-outline' as IconName, route: routeFor('student', '/student/attendance') },
    { label: 'Results', icon: 'bar-chart-outline' as IconName, route: routeFor('student', '/student/results') },
    { label: 'Tasks', icon: 'checkmark-done-outline' as IconName, route: routeFor('student', '/student/assignments') },
    { label: 'Timetable', icon: 'time-outline' as IconName, route: routeFor('student', '/student/timetable') },
    { label: 'Exams', icon: 'calendar-number-outline' as IconName, route: routeFor('student', '/student/exam-schedule') },
    { label: 'Fees', icon: 'wallet-outline' as IconName, route: routeFor('student', '/student/fees') },
    { label: 'Library', icon: 'library-outline' as IconName, route: routeFor('student', '/student/library') },
    { label: 'Transport', icon: 'bus-outline' as IconName, route: routeFor('student', '/student/transport') },
    { label: 'Study helper', icon: 'sparkles-outline' as IconName, route: routeFor('student', '/student/study-helper') },
  ];
  const recent = (results.data ?? []).slice(0, 4);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <HomeHero name={name ?? ''} onPress={(r) => go(r)}
        subtitle={[d.student?.class_name, d.student?.roll_number ? `Roll #${d.student.roll_number}` : ''].filter(Boolean).join('  ·  ') || undefined}
        stats={heroStats} />

      <Text style={styles.section}>Today&apos;s classes</Text>
      {d.today_timetable.length === 0 ? <SectionEmpty message="No classes today." /> : d.today_timetable.map((p, i) => {
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
      <TileGrid items={quick.map((a) => ({ label: a.label, icon: a.icon, onPress: a.route ? () => go(a.route) : undefined }))} />

      <RecentNotifications enabled={isModuleEnabled('notifications')} onSeeAll={() => go(routeFor('student', '/notifications'))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
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
});
