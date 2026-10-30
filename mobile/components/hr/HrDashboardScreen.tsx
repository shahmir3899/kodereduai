import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useHrStats } from '../../hooks/useHrAdmin';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { attendanceToday, attentionItems, EMPLOYMENT_STATUSES, labelOf } from '../../services/hrAdmin';
import StatCard from '../StatCard';
import Card from '../ui/Card';
import QueryBoundary from '../ui/QueryBoundary';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const LINKS: Array<{ title: string; sub: string; route: string }> = [
  { title: 'Staff directory', sub: 'Add and edit staff', route: '/(admin)/hr/staff' },
  { title: 'Departments and designations', sub: 'Job titles and teams', route: '/(admin)/hr/departments' },
  { title: 'Leave approvals', sub: 'Requests waiting for you', route: '/(admin)/hr/leave-approvals' },
  { title: 'Leave policies', sub: 'Days allowed each year', route: '/(admin)/hr/leave-policies' },
  { title: 'Documents and qualifications', sub: 'IDs, contracts, certificates', route: '/(admin)/hr/documents' },
];

// The HR numbers of the day: headcount, who is on leave, attendance, what waits for a decision.
// The server caches these for a minute and leaves money out, so there are no payroll amounts here.
export default function HrDashboardScreen() {
  const router = useRouter();
  const q = useHrStats();
  const refreshControl = useRefreshControl(q.refetch);
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <QueryBoundary query={q} isEmpty={() => false}>
        {(s) => {
          const items = attentionItems(s);
          return (
            <>
              <View style={styles.row}>
                <StatCard title="Staff" value={s.total_staff} color={Colors.primary} />
                <StatCard title="Working" value={s.active_staff} color={Colors.success} />
                <StatCard title="Departments" value={s.total_departments} color={Colors.secondary} />
              </View>
              <View style={styles.row}>
                <StatCard title="On leave today" value={s.staff_on_leave_today} color={Colors.warning} />
                <StatCard title="Joined (30 days)" value={s.recent_joiners} color={Colors.info} />
              </View>
              <Card>
                <Text style={styles.section}>Attendance today</Text>
                <Text style={styles.big}>{attendanceToday(s)}</Text>
              </Card>
              {items.length > 0 ? (
                <Card>
                  <Text style={styles.section}>Needs attention</Text>
                  {items.map((i) => <Text key={i.key} style={styles.item}>{i.text}</Text>)}
                </Card>
              ) : null}
              {s.department_breakdown.length > 0 ? (
                <Card>
                  <Text style={styles.section}>By department</Text>
                  {s.department_breakdown.map((d) => (
                    <View key={d.department__id} style={styles.line}><Text style={styles.item}>{d.department__name}</Text><Text style={styles.count}>{d.count}</Text></View>
                  ))}
                </Card>
              ) : null}
              {s.status_breakdown.length > 0 ? (
                <Card>
                  <Text style={styles.section}>By status</Text>
                  {s.status_breakdown.map((d) => (
                    <View key={d.employment_status} style={styles.line}><Text style={styles.item}>{labelOf(EMPLOYMENT_STATUSES, d.employment_status)}</Text><Text style={styles.count}>{d.count}</Text></View>
                  ))}
                </Card>
              ) : null}
            </>
          );
        }}
      </QueryBoundary>
      {LINKS.map((l) => (
        <TouchableOpacity key={l.route} accessibilityRole="button" style={styles.link} onPress={() => router.push(l.route as Href)}>
          <View style={styles.flex}><Text style={styles.linkTitle}>{l.title}</Text><Text style={styles.linkSub}>{l.sub}</Text></View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl, gap: Spacing.md },
  row: { flexDirection: 'row', gap: Spacing.md },
  section: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  big: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.primary },
  item: { fontSize: FontSize.sm, color: Colors.text },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  count: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  link: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 60 },
  flex: { flex: 1 },
  linkTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  linkSub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
});
