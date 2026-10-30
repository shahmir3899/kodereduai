import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { bootstrapApi } from '../../services/api';
import {
  attendanceRate, buildAttentionItems, staffPresentPct, stepDate,
  type DashboardData,
} from '../../services/adminDashboard';
import { todayString } from '../../services/attendanceEntry';
import { routeFor } from '../../navigation/routes';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import StatCard from '../../components/StatCard';
import HeroCard from '../../components/dashboard/HeroCard';
import AttendanceBreakdown from '../../components/dashboard/AttendanceBreakdown';
import MonthlyFeeCard from '../../components/dashboard/MonthlyFeeCard';
import LeadershipInsights from '../../components/dashboard/LeadershipInsights';
import RecentNotifications from '../../components/dashboard/RecentNotifications';
import { dayHero } from '../../services/dashboardView';
import Card from '../../components/ui/Card';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import SchoolSwitcher from '../../components/nav/SchoolSwitcher';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const rateColor = (r: number | null) => (r == null ? Colors.textTertiary : r >= 90 ? Colors.success : r >= 75 ? Colors.warning : Colors.error);
const TONE_COLOR = { red: Colors.error, amber: Colors.warning, blue: Colors.info } as const;

export default function AdminDashboard() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const today = todayString();
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const year = useAcademicYear();

  // One request for every section (the web dashboard does the same). Finance is money, so
  // the 'adminDashboard' root is never cached (services/queryRules.ts).
  const query = useScopedQuery<DashboardData>('adminDashboard', [date, year.current?.id ?? null], async () =>
    (await bootstrapApi.getAdminDashboard({
      date,
      academic_year: year.current?.id,
      sections: 'attendance,hr,finance,admissions',
    })).data,
  { enabled: !year.isLoading });
  const refreshControl = useRefreshControl(query.refetch);

  const data = query.data;
  if (query.isLoading || year.isLoading) return <Skeleton />;
  if (query.isError && !data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const att = data?.attendance;
  const hr = data?.hr;
  const fee = data?.finance;
  const offDay = !!att?.is_off_day;
  const rate = attendanceRate(att);
  const staffPct = staffPresentPct(hr, offDay);

  const go = (route?: string) => route && router.push(route as Href);
  const attention = buildAttentionItems({
    isModuleEnabled,
    data: data ?? {},
    isToday,
    routes: {
      attendance: routeFor('admin', '/attendance/manual-entry'),
      unpaid: routeFor('admin', '/finance/fees/collect'),
      leave: routeFor('admin', '/hr/leave'),
      payroll: routeFor('admin', '/hr/payroll'),
      enquiries: routeFor('admin', '/admissions'),
    },
  });

  const quick: Array<{ label: string; icon: string; route?: string; show: boolean }> = [
    { label: 'Attendance', icon: '✅', route: routeFor('admin', '/attendance/manual-entry'), show: isModuleEnabled('attendance') },
    { label: 'Collect Fee', icon: '💰', route: routeFor('admin', '/finance/fees/collect'), show: isModuleEnabled('finance') },
    { label: 'Students', icon: '👥', route: routeFor('admin', '/students'), show: isModuleEnabled('students') },
    { label: 'Staff', icon: '🏢', route: routeFor('admin', '/hr/staff'), show: isModuleEnabled('hr') },
    { label: 'Send Alert', icon: '📢', route: '/(admin)/notifications/send', show: isModuleEnabled('notifications') },
    { label: 'Timetable', icon: '📅', route: routeFor('admin', '/academics/timetable'), show: isModuleEnabled('academics') },
    { label: 'Results', icon: '📊', route: routeFor('admin', '/academics/results'), show: isModuleEnabled('examinations') },
    { label: 'AI Chat', icon: '🤖', route: '/(admin)/ai-assistant', show: true },
  ].filter((a) => a.show);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.greeting}>Welcome, {user?.first_name || user?.username || 'Admin'}</Text>
      <SchoolSwitcher />
      {year.current ? <Text style={styles.year}>{year.current.name}</Text> : null}

      {!year.current ? (
        <View style={styles.warn}>
          <Text style={styles.warnTitle}>No academic session set</Text>
          <Text style={styles.warnText}>Create an academic year and mark it current on the web app to enable session-aware features.</Text>
        </View>
      ) : null}

      {/* Day stepper: look at a past day's attendance */}
      <View style={styles.stepper}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous day" onPress={() => setDate(stepDate(date, -1, today))} hitSlop={10}><Text style={styles.stepBtn}>‹</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => setDate(today)} disabled={isToday}>
          <Text style={styles.stepDate}>{isToday ? 'Today' : date}</Text>
        </TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next day" onPress={() => setDate(stepDate(date, 1, today))} disabled={isToday} hitSlop={10}>
          <Text style={[styles.stepBtn, isToday && styles.stepDisabled]}>›</Text>
        </TouchableOpacity>
      </View>

      {/* The day at a glance */}
      {isModuleEnabled('attendance') && att ? (
        <View style={styles.hero}>
          <HeroCard {...dayHero({ isOffDay: offDay, offTypes: att.off_day_types, rate, present: att.present_count, total: att.total_students })}
            eyebrow={isToday ? 'Today' : date} />
          {!offDay ? <View style={styles.gap}><AttendanceBreakdown report={att} /></View> : null}
        </View>
      ) : null}

      {/* Needs attention */}
      <Text style={styles.section}>Needs attention</Text>
      {attention.length === 0 ? (
        <Card style={styles.clear}><Text style={styles.clearText}>All clear. Nothing needs attention.</Text></Card>
      ) : (
        attention.map((it) => (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next day" key={it.key} disabled={!it.href} onPress={() => go(it.href)}>
            <Card style={styles.attention}>
              <Text style={[styles.attCount, { color: TONE_COLOR[it.tone] }]}>{it.count}</Text>
              <Text style={styles.attLabel}>{it.label}</Text>
              {it.href ? <Text style={styles.arrow}>›</Text> : null}
            </Card>
          </TouchableOpacity>
        ))
      )}

      {/* Key numbers. A section that failed to load shows a dash, never a made-up 0. */}
      <View style={styles.grid}>
        {isModuleEnabled('attendance') ? (
          <>
            <StatCard title="Students" value={att ? att.total_students : '—'} subtitle={att ? (offDay ? 'OFF day' : `${att.present_count} present`) : undefined} color={Colors.primary} />
            <StatCard title="Attendance" value={offDay ? 'N/A' : rate != null ? `${rate}%` : '—'} subtitle={att && !offDay ? `${att.absent_count} absent · ${att.leave_count} leave` : undefined} color={offDay ? Colors.textTertiary : rateColor(rate)} />
          </>
        ) : null}
        {isModuleEnabled('hr') ? (
          <StatCard title="Staff present" value={hr ? (staffPct != null ? `${staffPct}%` : offDay ? 'N/A' : '—') : '—'} subtitle={hr ? `${hr.staff_on_leave_today} on leave · ${hr.active_staff} active` : undefined} color={Colors.success} />
        ) : null}
      </View>

      {isModuleEnabled('finance') && fee ? (
        <View style={styles.gap}>
          <MonthlyFeeCard fee={fee} onDetails={() => go(routeFor('admin', '/finance/fees/collect'))} />
        </View>
      ) : null}

      {/* Absent students for the chosen day */}
      {att?.absent_students && att.absent_students.length > 0 ? (
        <>
          <Text style={styles.section}>Absent {isToday ? 'today' : date}</Text>
          <Card style={styles.absentCard}>
            {att.absent_students.slice(0, 10).map((s) => (
              <Text key={s.id} style={styles.absentRow} numberOfLines={1}>
                {s.student_name || 'Student'}{s.class_name ? `  ·  ${s.class_name}` : ''}
              </Text>
            ))}
            {att.absent_students.length > 10 ? <Text style={styles.more}>+ {att.absent_students.length - 10} more</Text> : null}
          </Card>
        </>
      ) : null}

      <Text style={styles.section}>Quick actions</Text>
      <View style={styles.actions}>
        {quick.map((a) => (
          <TouchableOpacity accessibilityRole="button" key={a.label} style={[styles.action, !a.route && styles.actionOff]} disabled={!a.route} onPress={() => go(a.route)}>
            <Text style={styles.actionIcon}>{a.icon}</Text>
            <Text style={styles.actionLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <LeadershipInsights />

      <RecentNotifications enabled={isModuleEnabled('notifications')} onSeeAll={() => go(routeFor('admin', '/notifications'))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  year: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  warn: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.md },
  warnTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.warning },
  warnText: { fontSize: FontSize.xs, color: Colors.warning, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, marginTop: Spacing.lg },
  stepBtn: { fontSize: 28, color: Colors.primary, paddingHorizontal: Spacing.sm },
  stepDisabled: { color: Colors.border },
  stepDate: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, minWidth: 110, textAlign: 'center' },
  hero: { marginTop: Spacing.lg },
  gap: { marginTop: Spacing.md },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  clear: { padding: Spacing.md },
  clearText: { color: Colors.success, fontSize: FontSize.sm, fontWeight: '600' },
  attention: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, marginBottom: Spacing.sm },
  attCount: { fontSize: FontSize.xl, fontWeight: '700', minWidth: 44 },
  attLabel: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.xl },
  absentCard: { padding: Spacing.md },
  absentRow: { fontSize: FontSize.sm, color: Colors.text, paddingVertical: 3 },
  more: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  action: { width: '22%', minWidth: 72, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  actionOff: { opacity: 0.4 },
  actionIcon: { fontSize: 22 },
  actionLabel: { fontSize: FontSize.xs, color: Colors.text, marginTop: 4, textAlign: 'center' },
});
