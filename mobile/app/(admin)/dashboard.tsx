import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { bootstrapApi, examinationsApi, sessionsApi, tasksApi } from '../../services/api';
import {
  attendanceRate, buildAttentionItems, buildModuleCards, collectionRate, currentTermName, staffPresentPct, stepDate,
  type DashboardData,
} from '../../services/adminDashboard';
import { todayString } from '../../services/attendanceEntry';
import { listOf } from '../../services/academicYear';
import { insightList } from '../../services/aiInsights';
import { routeFor } from '../../navigation/routes';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { usePrefetchNext } from '../../hooks/usePrefetchNext';
import { REFERENCE_STALE_MS } from '../../services/queryRules';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import StatCard from '../../components/StatCard';
import HeroCard from '../../components/dashboard/HeroCard';
import HomeHero, { HomeShell } from '../../components/dashboard/HomeHero';
import type { Tile } from '../../components/dashboard/StatTiles';
import { pctTone } from '../../services/homeHero';
import { shortYearLabel } from '../../services/headerView';
import AttendanceBreakdown from '../../components/dashboard/AttendanceBreakdown';
import MonthlyFeeCard from '../../components/dashboard/MonthlyFeeCard';
import LeadershipInsights from '../../components/dashboard/LeadershipInsights';
import AIInsightsCard from '../../components/dashboard/AIInsightsCard';
import ModuleOverview from '../../components/dashboard/ModuleOverview';
import SessionHealthCard from '../../components/dashboard/SessionHealthCard';
import SetupProgressCard from '../../components/dashboard/SetupProgressCard';
import PredictorsCard from '../../components/dashboard/PredictorsCard';
import Icon, { type IconName } from '../../components/ui/Icon';
import RecentNotifications from '../../components/dashboard/RecentNotifications';
import { dayHero } from '../../services/dashboardView';
import Card from '../../components/ui/Card';
import AttentionCard from '../../components/ui/AttentionCard';
import { SectionEmpty } from '../../components/ui/SectionState';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import { Colors, FontSize, Spacing, BorderRadius, GlyphSize } from '../../constants/colors';
import TileGrid from '../../components/ui/TileGrid';

const rateColor = (r: number | null) => (r == null ? Colors.textTertiary : r >= 90 ? Colors.success : r >= 75 ? Colors.warning : Colors.error);
const TONE_COLOR = { red: Colors.error, amber: Colors.warning, blue: Colors.info } as const;

export default function AdminDashboard() {
  const { user, isModuleEnabled, isSchoolAdmin } = useAuth();
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
      // The module sections are only built for the modules the school has on.
      sections: 'attendance,hr,finance,admissions,transport,library,hostel,inventory',
    })).data,
  { enabled: !year.isLoading });
  // The dashboard bundle has no exam count, so it is one small call of its own.
  const exams = useScopedQuery<number>('upcomingExams', [year.current?.id ?? null], async () =>
    Number((await examinationsApi.getExams({ status: 'SCHEDULED', page_size: 1, academic_year: year.current?.id })).data?.count ?? 0),
  { enabled: !year.isLoading && isModuleEnabled('examinations'), staleTime: 60_000, retry: false });
  const terms = useScopedQuery('academicTerms', [year.current?.id ?? null], async () =>
    listOf<{ name?: string; start_date?: string; end_date?: string }>((await sessionsApi.getTerms({ academic_year: year.current?.id, page_size: 100 })).data),
  { enabled: !!year.current?.id, staleTime: REFERENCE_STALE_MS, retry: false });
  // Same key as the AI insights card, so the two share one request.
  const ai = useScopedQuery('aiInsights', [], async () => insightList((await tasksApi.getAIInsights()).data),
    { staleTime: 5 * 60_000, retry: false });
  const term = currentTermName(terms.data ?? [], today);
  const refreshControl = useRefreshControl(query.refetch);

  const data = query.data;
  usePrefetchNext('admin', !query.isLoading && !year.isLoading);
  const displayName = user?.first_name || user?.username || 'Admin';
  // Home has no white header, so loading and errors sit under the banner too.
  if (query.isLoading || year.isLoading) return <HomeShell name={displayName}><Skeleton variant="stats" /></HomeShell>;
  if (query.isError && !data) return <HomeShell name={displayName}><ErrorState error={query.error} onRetry={() => query.refetch()} /></HomeShell>;

  const att = data?.attendance;
  const hr = data?.hr;
  const fee = data?.finance;
  const offDay = !!att?.is_off_day;
  const rate = attendanceRate(att);
  const staffPct = staffPresentPct(hr, offDay);
  const feeRate = collectionRate(fee);

  const go = (route?: string) => route && router.push(route as Href);
  // The day's three figures for the Home banner, from the same dashboard bundle.
  const heroStats: Tile[] = [
    ...(isModuleEnabled('attendance') && att ? [
      // Today's presence and what is not marked are in the cards below, so the banner gives the school's size.
      { label: 'Students', value: att.total_students ?? null, route: routeFor('admin', '/students') },
    ] : []),
    ...(isModuleEnabled('hr') && hr ? [{ label: 'Staff present', value: offDay ? 'Off day' : staffPct != null ? `${staffPct}%` : null, tone: offDay ? undefined : pctTone(staffPct), route: routeFor('admin', '/hr/attendance') }] : []),
    ...(isModuleEnabled('finance') && fee ? [{ label: 'Fees collected', value: feeRate != null ? `${feeRate}%` : null, tone: pctTone(feeRate), route: routeFor('admin', '/finance') }] : []),
  ];
  const attention = buildAttentionItems({
    isModuleEnabled,
    data: data ?? {},
    isToday,
    aiAlerts: (ai.data ?? []).filter((i) => i.type === 'alert').length,
    routes: {
      library: routeFor('admin', '/library/issues'),
      inventory: routeFor('admin', '/inventory'),
      attendance: routeFor('admin', '/attendance/manual-entry'),
      unpaid: routeFor('admin', '/finance/fees/collect'),
      leave: routeFor('admin', '/hr/leave'),
      payroll: routeFor('admin', '/hr/payroll'),
      staffAttendance: routeFor('admin', '/hr/attendance'),
      enquiries: routeFor('admin', '/admissions'),
    },
  });

  const cards = buildModuleCards({
    isModuleEnabled,
    data: data ?? {},
    upcomingExams: exams.data ?? null,
    routes: {
      attendance: routeFor('admin', '/attendance/register'),
      finance: routeFor('admin', '/finance'),
      hr: routeFor('admin', '/hr'),
      exams: routeFor('admin', '/academics/exams'),
      admissions: routeFor('admin', '/admissions'),
      transport: routeFor('admin', '/transport'),
      library: routeFor('admin', '/library/issues'),
      hostel: routeFor('admin', '/hostel/gate-passes'),
      inventory: routeFor('admin', '/inventory'),
    },
  });

  const quick: Array<{ label: string; icon: IconName; route?: string; show: boolean }> = [
    { label: 'Attendance', icon: 'checkmark-done-outline' as IconName, route: routeFor('admin', '/attendance/manual-entry'), show: isModuleEnabled('attendance') },
    { label: 'Collect Fee', icon: 'cash-outline' as IconName, route: routeFor('admin', '/finance/fees/collect'), show: isModuleEnabled('finance') },
    { label: 'Students', icon: 'people-outline' as IconName, route: routeFor('admin', '/students'), show: isModuleEnabled('students') },
    { label: 'Enquiries', icon: 'person-add-outline' as IconName, route: routeFor('admin', '/admissions'), show: isModuleEnabled('admissions') },
    { label: 'Staff', icon: 'briefcase-outline' as IconName, route: routeFor('admin', '/hr/staff'), show: isModuleEnabled('hr') },
    { label: 'Send Alert', icon: 'megaphone-outline' as IconName, route: '/(admin)/notifications/send', show: isModuleEnabled('notifications') },
    { label: 'Timetable', icon: 'calendar-outline' as IconName, route: routeFor('admin', '/academics/timetable'), show: isModuleEnabled('academics') },
    { label: 'Results', icon: 'bar-chart-outline' as IconName, route: routeFor('admin', '/academics/results'), show: isModuleEnabled('examinations') },
    { label: 'School Setup', icon: 'settings-outline' as IconName, route: routeFor('admin', '/school-setup'), show: true },
    { label: 'AI Chat', icon: 'chatbubbles-outline' as IconName, route: '/(admin)/ai-assistant', show: true },
  ].filter((a) => a.show);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <HomeHero name={displayName} subtitle={year.current ? `${shortYearLabel(year.current.name)}${term ? `  ·  ${term}` : ''}` : undefined}
        stats={heroStats} onPress={go} />

      {!year.current ? (
        <View style={styles.warn}>
          <Text style={styles.warnTitle}>No academic session set</Text>
          <Text style={styles.warnText}>Create an academic year and mark it current to enable session-aware features.</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.warnBtn} onPress={() => go(routeFor('admin', '/academics/sessions'))}>
            <Text style={styles.warnBtnText}>Set up now</Text>
          </TouchableOpacity>
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
        <Card style={styles.clear}><SectionEmpty message="All clear. Nothing needs attention." /></Card>
      ) : (
        attention.map((it) => (
          <AttentionCard key={it.key} itemKey={it.key} count={it.count} label={it.label} tone={it.tone} onPress={it.href ? () => go(it.href) : undefined} />
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
        {isModuleEnabled('finance') ? (
          <StatCard title="Fee collection" value={feeRate != null ? `${feeRate}%` : '—'} subtitle={fee ? `Monthly fees · PKR ${Number(fee.total_pending || 0).toLocaleString()} pending` : undefined}
            color={feeRate == null ? Colors.textTertiary : feeRate >= 80 ? Colors.success : feeRate >= 50 ? Colors.warning : Colors.error} />
        ) : null}
      </View>

      {cards.length > 0 ? (
        <>
          <Text style={styles.section}>Module overview</Text>
          <ModuleOverview cards={cards} onOpen={go} />
        </>
      ) : null}

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
      <TileGrid items={quick.map((a) => ({ label: a.label, icon: a.icon, onPress: a.route ? () => go(a.route) : undefined }))} />

      <SessionHealthCard yearId={year.current?.id} yearName={year.current?.name} />

      <SetupProgressCard enabled={isSchoolAdmin} />

      <PredictorsCard />

      <AIInsightsCard />

      <LeadershipInsights />

      <RecentNotifications enabled={isModuleEnabled('notifications')} onSeeAll={() => go(routeFor('admin', '/notifications'))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  warn: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.md },
  warnTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.warning },
  warnText: { fontSize: FontSize.xs, color: Colors.warning, marginTop: 2 },
  warnBtn: { alignSelf: 'flex-start', marginTop: Spacing.sm, paddingVertical: 4 },
  warnBtnText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.warning, textDecorationLine: 'underline' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.xl, marginTop: Spacing.lg },
  stepBtn: { fontSize: GlyphSize.lg, color: Colors.primary, paddingHorizontal: Spacing.sm },
  stepDisabled: { color: Colors.border },
  stepDate: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, minWidth: 110, textAlign: 'center' },
  hero: { marginTop: Spacing.lg },
  gap: { marginTop: Spacing.md },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  clear: { padding: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.xl },
  absentCard: { padding: Spacing.md },
  absentRow: { fontSize: FontSize.sm, color: Colors.text, paddingVertical: 3 },
  more: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
});
