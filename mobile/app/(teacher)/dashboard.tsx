import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import {
  useMyClassAssignments, useMyStudentsAtRisk, useMyTimetable, useOffDayToday, usePendingSubmissions,
  useSectionProgress, useTeacherExams, useTeacherHomeBundle, useWeekLessonPlans, type TeacherHomeSection,
} from '../../hooks/useTeacher';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { usePrefetchNext } from '../../hooks/usePrefetchNext';
import { day } from '../../services/dates';
import { dayCodeFor, entriesForDay, formatSlotTime } from '../../services/teacher';
import {
  assignmentLabel, attendanceClassId, buildTeacherAttention, examsAwaitingMarks, findPeriod, isPending,
  badgeLabel, matchAssignment, minutesLabel, periodSubtitle, planIsDone, shortDate, studentsAtRiskCount, upcomingExams, weekPlanStats, type WeekPlan,
} from '../../services/teacherDashboard';
import Card from '../../components/ui/Card';
import AttentionCard from '../../components/ui/AttentionCard';
import Skeleton from '../../components/ui/Skeleton';
import StatusPill from '../../components/ui/StatusPill';
import Hero from '../../components/dashboard/HeroCard';
import HomeHero, { HomeShell } from '../../components/dashboard/HomeHero';
import type { Tile } from '../../components/dashboard/StatTiles';
import RecentNotifications from '../../components/dashboard/RecentNotifications';
import MyPerformanceCard from '../../components/hr/performance/MyPerformanceCard';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { SectionEmpty, SectionError, SectionLoading } from '../../components/ui/SectionState';
import TileGrid from '../../components/ui/TileGrid';
import type { IconName } from '../../components/ui/Icon';

const TONE_COLOR = { red: Colors.error, amber: Colors.warning } as const;

export default function TeacherDashboard() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const now = new Date();
  const attendanceOn = isModuleEnabled('attendance');
  const academicsOn = isModuleEnabled('academics');
  const examsOn = isModuleEnabled('examinations');

  // One request fills every section below (and the notifications card); a section the bundle
  // could not give fetches on its own, so an older server still gets a working Home.
  const sections: TeacherHomeSection[] = [
    'timetable', 'class_assignments',
    ...(attendanceOn ? ['section_progress', 'off_day'] as const : []),
    ...(academicsOn ? ['pending_submissions', 'students_at_risk', 'week_plans'] as const : []),
    ...(examsOn ? ['exams'] as const : []),
    ...(isModuleEnabled('notifications') ? ['notifications'] as const : []),
  ];
  const bundle = useTeacherHomeBundle(sections);
  const own = bundle.own;
  usePrefetchNext('teacher', !bundle.loading);

  const off = useOffDayToday(attendanceOn && own('off_day'));
  const timetable = useMyTimetable(own('timetable'));
  const assignmentsQ = useMyClassAssignments(own('class_assignments'));
  const assignments = assignmentsQ.data ?? [];
  const progress = useSectionProgress(assignments, attendanceOn && own('section_progress'));
  const submissions = usePendingSubmissions(academicsOn && own('pending_submissions'));
  const risk = useMyStudentsAtRisk(academicsOn && assignments.length > 0 && own('students_at_risk'));
  const exams = useTeacherExams(examsOn && own('exams'));
  const weekPlans = useWeekLessonPlans(academicsOn && own('week_plans'));

  // A pull refreshes the bundle once, plus only the sections that are fetching on their own.
  const refreshControl = useRefreshControl(
    ...(bundle.ok ? [bundle.refetch] : []),
    ...([
      ['timetable', timetable.refetch], ['class_assignments', assignmentsQ.refetch], ['section_progress', progress.refetch],
      ['pending_submissions', submissions.refetch], ['students_at_risk', risk.refetch], ['exams', exams.refetch], ['week_plans', weekPlans.refetch],
    ] as const).filter(([key]) => own(key)).map(([, refetch]) => refetch),
  );

  const today = useMemo(() => entriesForDay(timetable.data ?? [], dayCodeFor(now)), [timetable.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const period = findPeriod(today, now);
  const heroEntry = period.index >= 0 ? today[period.index] : null;
  const heroAssignment = matchAssignment(heroEntry, assignments);
  const rows = progress.data ?? [];
  const heroRow = heroAssignment ? rows.find((r) => r.assignment.id === heroAssignment.id) : undefined;

  const allExams = exams.data ?? [];
  const upcoming = upcomingExams(allExams);
  const riskData = risk.data;

  const go = (route?: string, params?: Record<string, string | number>) =>
    route && router.push((params ? { pathname: route, params } : route) as Href);

  const attention = buildTeacherAttention({
    isModuleEnabled,
    isOffDay: off.isOffDay,
    pendingAttendanceClasses: rows.filter(isPending).length,
    submissionsToGrade: submissions.data?.count ?? null,
    examsAwaitingMarks: examsAwaitingMarks(allExams),
    studentsAtRisk: studentsAtRiskCount(riskData),
    routes: {
      attendance: routeFor('teacher', '/attendance/manual-entry'),
      marks: routeFor('teacher', '/academics/marks-entry'),
      assignments: routeFor('teacher', '/academics/assignments'),
    },
  });

  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username || '';
  if (bundle.loading || (timetable.isLoading && assignmentsQ.isLoading)) return <HomeShell name={name}><Skeleton /></HomeShell>;

  // The teacher's day at a glance for the Home banner. The to-dos (attendance, marks, grading,
  // students at risk) are in "Needs attention" below, so they are not repeated here.
  const plans = weekPlanStats(weekPlans.data ?? []);
  const heroStats: Tile[] = [
    { label: 'Classes today', value: off.isOffDay ? 'Off day' : timetable.isLoading ? null : today.length, route: routeFor('teacher', '/academics/timetable') },
    ...(academicsOn ? [{ label: 'Plans done this week', value: weekPlans.isLoading ? null : plans.total === 0 ? 0 : `${plans.done}/${plans.total}`, tone: plans.total > 0 && plans.done < plans.total ? 'warn' as const : undefined, route: routeFor('teacher', '/academics/lesson-plans') }] : []),
    { label: assignments.length === 1 ? 'My class' : 'My classes', value: assignmentsQ.isLoading ? null : assignments.length, route: routeFor('teacher', '/classes') },
  ];

  const attendanceRoute = routeFor('teacher', '/attendance/manual-entry');

  // What the teacher should be doing right now.
  let hero: React.ReactNode;
  if (off.isOffDay) {
    hero = <Hero tone="gray" eyebrow="Today" title="No school today" subtitle={off.label ?? undefined} />;
  } else if (timetable.isLoading) {
    hero = <Skeleton rows={1} />;
  } else if (today.length === 0) {
    hero = <Hero tone="gray" eyebrow="Today" title="No classes scheduled today" />;
  } else if (!heroEntry) {
    hero = <Hero tone="green" eyebrow="Today" title="All classes done for today" subtitle={`${today.length} period${today.length === 1 ? '' : 's'} taught`} />;
  } else {
    const unmarked = heroRow ? isPending(heroRow) : false;
    hero = (
      <Hero
        tone={period.state === 'now' ? 'blue' : 'gray'}
        eyebrow={period.state === 'now' ? `Now · ${period.minutes} min left` : `Next · starts in ${minutesLabel(period.minutes)}`}
        title={`${heroEntry.subject_name || 'Free period'} — ${heroEntry.class_name ?? ''}`}
        subtitle={`${formatSlotTime(heroEntry.slot_start_time)} – ${formatSlotTime(heroEntry.slot_end_time)}${heroEntry.room ? ` · Room ${heroEntry.room}` : ''}`}
        action={attendanceOn && heroAssignment && attendanceRoute
          ? { label: unmarked ? 'Mark attendance' : 'View attendance', onPress: () => go(attendanceRoute, { class: attendanceClassId(heroAssignment) }) }
          : undefined}
      />
    );
  }

  const quick = [
    { label: 'Attendance', icon: 'checkbox-outline' as IconName, route: attendanceRoute, show: attendanceOn, badge: off.isOffDay ? 0 : rows.filter(isPending).length },
    { label: 'Timetable', icon: 'time-outline' as IconName, route: routeFor('teacher', '/academics/timetable'), show: true, badge: 0 },
    { label: 'Lesson Plans', icon: 'book-outline' as IconName, route: routeFor('teacher', '/academics/lesson-plans'), show: academicsOn, badge: 0 },
    { label: 'Marks', icon: 'create-outline' as IconName, route: routeFor('teacher', '/academics/marks-entry'), show: examsOn, badge: examsAwaitingMarks(allExams) },
    { label: 'Assignments', icon: 'document-text-outline' as IconName, route: routeFor('teacher', '/academics/assignments'), show: academicsOn, badge: submissions.data?.count ?? 0 },
    { label: 'Collect Fees', icon: 'cash-outline' as IconName, route: routeFor('teacher', '/finance/fees/collect'), show: isModuleEnabled('finance'), badge: 0 },
    { label: 'My Leave', icon: 'calendar-outline' as IconName, route: routeFor('teacher', '/hr/leave'), show: isModuleEnabled('hr'), badge: 0 },
    { label: 'Notifications', icon: 'notifications-outline' as IconName, route: routeFor('teacher', '/notifications'), show: isModuleEnabled('notifications'), badge: 0 },
  ].filter((a) => a.show);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <HomeHero name={name} stats={heroStats} onPress={(r) => go(r)} />
      {off.label ? <Text style={styles.off}>{off.label}</Text> : null}

      {isModuleEnabled('hr') ? <MyPerformanceCard /> : null}

      <Text style={styles.section}>Needs attention</Text>
      {attention.length === 0 ? (
        <Card style={styles.clear}><SectionEmpty message="All clear. Nothing needs attention." /></Card>
      ) : (
        attention.map((it) => (
          <AttentionCard key={it.key} itemKey={it.key} count={it.count} label={it.label} tone={it.tone} onPress={it.href ? () => go(it.href) : undefined} />
        ))
      )}

      <View style={{ height: Spacing.lg }} />
      {hero}

      <Text style={styles.section}>Today&apos;s timetable</Text>
      {today.length === 0 ? (
        <SectionEmpty message="No classes scheduled today." />
      ) : (
        today.map((e, idx) => {
          const current = !off.isOffDay && period.state === 'now' && idx === period.index;
          return (
            <Card key={e.id} style={current ? { ...styles.period, ...styles.periodNow } : styles.period}>
              <View style={styles.time}>
                <Text style={styles.timeText}>{formatSlotTime(e.slot_start_time)}</Text>
                {current ? <Text style={styles.nowTag}>NOW</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.subject} numberOfLines={1}>{e.subject_name || e.slot_name || 'Period'}</Text>
                <Text style={styles.cls} numberOfLines={1}>{periodSubtitle(e)}</Text>
              </View>
              {e.slot_name ? <Text style={styles.slot}>{e.slot_name}</Text> : null}
            </Card>
          );
        })
      )}

      {attendanceOn && assignments.length > 0 ? (
        <>
          <Text style={styles.section}>My sections today</Text>
          {assignments.map((a) => {
            const row = rows.find((r) => r.assignment.id === a.id);
            const pending = row ? isPending(row) : false;
            return (
              <TouchableOpacity accessibilityRole="button" key={a.id} disabled={!attendanceRoute} onPress={() => go(attendanceRoute, { class: attendanceClassId(a) })}>
                <Card style={styles.section2}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.subject}>{assignmentLabel(a)}</Text>
                    <Text style={styles.cls}>
                      {!row || progress.isLoading ? 'Checking…' : row.failed ? 'Could not load' : `${row.marked}/${row.total} marked`}
                    </Text>
                  </View>
                  {row && !row.failed ? (
                    <StatusPill label={off.isOffDay ? 'OFF day' : pending ? 'Pending' : (row.total || 0) > 0 ? 'Done' : 'No students'} tone={off.isOffDay ? 'neutral' : pending ? 'warning' : 'success'} />
                  ) : null}
                </Card>
              </TouchableOpacity>
            );
          })}
        </>
      ) : null}

      {academicsOn && (submissions.data?.items.length ?? 0) > 0 ? (
        <>
          <Text style={styles.section}>Submissions to grade</Text>
          <Card style={styles.list}>
            {submissions.data!.items.slice(0, 5).map((s) => (
              <Text key={s.id} style={styles.listRow} numberOfLines={1}>
                {s.student_name || 'Student'}{s.assignment_title ? `  ·  ${s.assignment_title}` : ''}{shortDate(s.submitted_at) ? `  ·  ${shortDate(s.submitted_at)}` : ''}
              </Text>
            ))}
            {(submissions.data!.count ?? 0) > 5 ? <Text style={styles.muted}>+ {(submissions.data!.count ?? 0) - 5} more</Text> : null}
          </Card>
        </>
      ) : null}

      {upcoming.length > 0 ? (
        <>
          <Text style={styles.section}>Upcoming exams</Text>
          {upcoming.map((e) => (
            <Card key={e.id} style={styles.section2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.subject} numberOfLines={1}>{e.name}</Text>
                <Text style={styles.cls} numberOfLines={1}>{e.class_name}{e.start_date ? `  ·  ${day(e.start_date) || e.start_date}` : ''}</Text>
              </View>
              <StatusPill label={e.status} tone={e.status === 'PUBLISHED' ? 'success' : 'info'} />
              {e.status === 'PUBLISHED' && examsOn && routeFor('teacher', '/academics/marks-entry') ? (
                <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Enter marks for ${e.name}`} hitSlop={8} style={styles.enter}
                  onPress={() => go(routeFor('teacher', '/academics/marks-entry'), { exam: e.id })}>
                  <Text style={styles.link}>Enter marks</Text>
                </TouchableOpacity>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}

      {studentsAtRiskCount(riskData) > 0 ? (
        <>
          <Text style={styles.section}>Students needing attention</Text>
          {[...(riskData?.attendance?.students ?? []), ...(riskData?.academic?.students ?? [])].slice(0, 6).map((s, i) => (
            <Card key={`${s.student_id}-${i}`} style={styles.risk}>
              <View style={styles.riskTop}>
                <Text style={styles.subject} numberOfLines={1}>{s.student_name}</Text>
                {s.severity ? <StatusPill label={s.severity} tone={s.severity === 'HIGH' ? 'error' : s.severity === 'MEDIUM' ? 'warning' : 'info'} /> : null}
              </View>
              {s.class_name ? <Text style={styles.cls}>{s.class_name}</Text> : null}
              {s.suggested_action ? <Text style={styles.action}>{s.suggested_action}</Text> : null}
            </Card>
          ))}
        </>
      ) : null}

      {academicsOn ? (
        <>
          <View style={styles.headRow}>
            <Text style={styles.section}>Lesson plans this week</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.linkBox} onPress={() => go(routeFor('teacher', '/academics/lesson-plans'))}>
              <Text style={styles.link}>View all</Text>
            </TouchableOpacity>
          </View>
          <WeekPlans plans={weekPlans.data ?? []} loading={weekPlans.isLoading} failed={weekPlans.isError && !weekPlans.data} onRetry={() => weekPlans.refetch()} />
        </>
      ) : null}

      <Text style={styles.section}>Quick actions</Text>
      <TileGrid items={quick.map((a) => ({ label: a.label, icon: a.icon, badge: a.badge, onPress: a.route ? () => go(a.route) : undefined }))} />

      <RecentNotifications enabled={isModuleEnabled('notifications')} onSeeAll={() => go(routeFor('teacher', '/notifications'))} />
    </ScrollView>
  );
}

function WeekPlans({ plans, loading, failed, onRetry }: { plans: WeekPlan[]; loading: boolean; failed: boolean; onRetry: () => void }) {
  const stats = weekPlanStats(plans);
  if (loading) return <Card style={styles.list}><SectionLoading /></Card>;
  if (failed) return <Card style={styles.list}><SectionError message="Could not load lesson plans." onRetry={onRetry} /></Card>;
  if (stats.total === 0) return <Card style={styles.list}><SectionEmpty message="No lesson plans this week." /></Card>;
  return (
    <Card style={styles.list}>
      <View style={styles.barRow}>
        <View style={styles.bar} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: stats.total, now: stats.done }}>
          <View style={[styles.barFill, { width: `${(stats.done / stats.total) * 100}%` }]} />
        </View>
        <Text style={styles.barText}>{stats.done}/{stats.total}</Text>
      </View>
      <Text style={styles.muted}>{stats.done} done  ·  {stats.published} published  ·  {stats.draft} draft</Text>
      {plans.slice(0, 4).map((p) => (
        <View key={p.id} style={styles.planRow}>
          <View style={styles.planText}>
            <Text style={styles.listRow} numberOfLines={1}>{p.title || p.topic || 'Lesson plan'}</Text>
            <Text style={styles.cls} numberOfLines={1}>{[p.subject_name, p.class_name].filter(Boolean).join(' — ')}</Text>
          </View>
          <StatusPill label={planIsDone(p) ? 'Done' : p.status === 'PUBLISHED' ? 'Published' : 'Draft'} tone={planIsDone(p) ? 'success' : p.status === 'PUBLISHED' ? 'info' : 'neutral'} />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  off: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.xs },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  clear: { padding: Spacing.md },
  period: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, marginBottom: Spacing.sm },
  periodNow: { borderWidth: 1, borderColor: Colors.info, backgroundColor: Colors.infoLight },
  time: { width: 76, marginRight: Spacing.md },
  timeText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  nowTag: { fontSize: FontSize.xxs, fontWeight: '700', color: Colors.info },
  subject: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, flexShrink: 1 },
  cls: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  section2: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, marginBottom: Spacing.sm },
  list: { padding: Spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  linkBox: { minHeight: 44, justifyContent: 'center' },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  bar: { flex: 1, height: 10, borderRadius: BorderRadius.full, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: Colors.success },
  barText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  planRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingTop: Spacing.sm, marginTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  planText: { flex: 1 },
  listRow: { fontSize: FontSize.sm, color: Colors.text, paddingVertical: 3 },
  risk: { padding: Spacing.md, marginBottom: Spacing.sm },
  riskTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  action: { fontSize: FontSize.xs, color: Colors.text, marginTop: Spacing.xs },
  slot: { fontSize: FontSize.xs, color: Colors.textTertiary, marginLeft: Spacing.sm },
  enter: { marginLeft: Spacing.sm, minHeight: 44, justifyContent: 'center' },
});
