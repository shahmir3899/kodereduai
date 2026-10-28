import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import { useStudentDashboard } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { dueLabel, rateTone } from '../../services/studentPortal';
import { formatMoney } from '../../services/feeCollect';
import { formatSlotTime } from '../../services/teacher';
import Card from '../../components/ui/Card';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import SchoolSwitcher from '../../components/nav/SchoolSwitcher';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE = { success: Colors.success, warning: Colors.warning, error: Colors.error } as const;

export default function StudentDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const query = useStudentDashboard();
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
    { label: 'Fees', icon: '💰', route: routeFor('student', '/student/fees') },
    { label: 'Exams', icon: '🗓️', route: routeFor('student', '/student/exam-schedule') },
    { label: 'Library', icon: '📚', route: routeFor('student', '/student/library') },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.greeting}>Hello, {name}</Text>
      <Text style={styles.sub}>{[d.student?.class_name, d.student?.roll_number ? `Roll #${d.student.roll_number}` : ''].filter(Boolean).join('  ·  ')}</Text>
      <SchoolSwitcher />

      <View style={styles.tiles}>
        <TouchableOpacity style={styles.tile} onPress={() => go(routeFor('student', '/student/attendance'))}>
          <Text style={[styles.tileValue, { color: d.attendance.total_days > 0 ? TONE[rateTone(d.attendance.rate)] : Colors.textSecondary }]}>
            {d.attendance.total_days > 0 ? `${d.attendance.rate}%` : '–'}
          </Text>
          <Text style={styles.tileLabel}>Attendance</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.tile} onPress={() => go(routeFor('student', '/student/fees'))}>
          <Text style={[styles.tileValue, { color: pending > 0 ? Colors.error : Colors.success }]}>{formatMoney(pending)}</Text>
          <Text style={styles.tileLabel}>Fees pending</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.section}>Today&apos;s classes</Text>
      {d.today_timetable.length === 0 ? <Text style={styles.muted}>No classes today.</Text> : d.today_timetable.map((p, i) => (
        <Card key={`${p.slot}-${i}`} style={styles.period}>
          <Text style={styles.time}>{formatSlotTime(p.start_time)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.subject} numberOfLines={1}>{p.subject || p.slot}</Text>
            <Text style={styles.sub} numberOfLines={1}>{[p.teacher, p.room ? `Room ${p.room}` : ''].filter(Boolean).join('  ·  ')}</Text>
          </View>
        </Card>
      ))}

      <Text style={styles.section}>Upcoming tasks</Text>
      {d.upcoming_assignments.length === 0 ? <Text style={styles.muted}>Nothing due soon.</Text> : d.upcoming_assignments.map((a) => (
        <TouchableOpacity key={a.id} onPress={() => go('/(student)/assignments/detail', { id: a.id })}>
          <Card style={styles.period}>
            <View style={{ flex: 1 }}>
              <Text style={styles.subject} numberOfLines={1}>{a.title}</Text>
              <Text style={styles.sub}>{a.subject}  ·  {dueLabel(a.due_date)}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </Card>
        </TouchableOpacity>
      ))}

      <Text style={styles.section}>Quick links</Text>
      <View style={styles.actions}>
        {quick.map((a) => (
          <TouchableOpacity key={a.label} style={[styles.quick, !a.route && styles.quickOff]} disabled={!a.route} onPress={() => go(a.route)}>
            <Text style={styles.quickIcon}>{a.icon}</Text>
            <Text style={styles.quickLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  tiles: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  tile: { flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  tileValue: { fontSize: FontSize.xl, fontWeight: '700' },
  tileLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  period: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, marginBottom: Spacing.sm },
  time: { width: 76, fontSize: FontSize.sm, fontWeight: '700', color: Colors.primary },
  subject: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  quick: { width: '22%', minWidth: 72, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  quickOff: { opacity: 0.4 },
  quickIcon: { fontSize: 22 },
  quickLabel: { fontSize: FontSize.xs, color: Colors.text, marginTop: 4, textAlign: 'center' },
});
