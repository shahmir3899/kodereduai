import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useChildOverview } from '../../hooks/useParent';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { formatMoney } from '../../services/feeCollect';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const LINKS: Array<[string, string, string]> = [
  ['attendance', 'Attendance', 'Month calendar and totals'],
  ['fees', 'Fees', 'Ledger and what is pending'],
  ['timetable', 'Timetable', 'Weekly class schedule'],
  ['exam-schedule', 'Exam schedule', 'Published date sheet'],
  ['results', 'Results', 'Published exam marks'],
  ['library', 'Library', 'Books borrowed'],
  ['transport', 'Transport', 'Bus route and stop'],
  ['track', 'Track bus', 'Where the bus is now'],
];

// One child: the headline numbers, then a menu of their pages.
export default function ChildOverviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const studentId = Number(id);
  const query = useChildOverview(studentId);
  const refreshControl = useRefreshControl(query.refetch);

  if (query.isLoading) return <Skeleton />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const o = query.data;
  const a = o.attendance_summary;
  const f = o.fee_summary;
  const overdue = Number(f.overdue_amount) || 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.name}>{o.student_name}</Text>
      <Text style={styles.sub}>{[o.class_name, o.roll_number ? `Roll #${o.roll_number}` : '', o.school_name].filter(Boolean).join('  ·  ')}</Text>
      {o.today.is_off_day ? <Text style={styles.off}>School is closed today{o.today.off_day_types.length ? ` (${o.today.off_day_types.join(', ')})` : ''}.</Text> : null}

      <View style={styles.tiles}>
        <Card style={styles.tile}>
          <Text style={styles.value}>{a.attendance_rate != null ? `${a.attendance_rate}%` : '–'}</Text>
          <Text style={styles.label}>Attendance</Text>
          <Text style={styles.small}>{a.present} present · {a.absent} absent · {a.leave} leave</Text>
        </Card>
        <Card style={styles.tile}>
          <Text style={[styles.value, { color: Number(f.outstanding) > 0 ? Colors.error : Colors.success }]}>{formatMoney(Number(f.outstanding) || 0)}</Text>
          <Text style={styles.label}>Fees pending</Text>
          <Text style={styles.small}>{overdue > 0 ? `${formatMoney(overdue)} overdue` : `${f.unpaid_items} unpaid item${f.unpaid_items === 1 ? '' : 's'}`}</Text>
        </Card>
      </View>

      {o.latest_exam ? (
        <Card style={styles.card}>
          <Text style={styles.label}>Latest exam</Text>
          <Text style={styles.title}>{o.latest_exam.exam_name}: {o.latest_exam.percentage}%</Text>
          {o.previous_exam ? <Text style={styles.small}>Before that: {o.previous_exam.exam_name}, {o.previous_exam.percentage}%</Text> : null}
        </Card>
      ) : null}
      {o.next_exam ? (
        <Card style={styles.card}>
          <Text style={styles.label}>Next exam</Text>
          <Text style={styles.title}>{o.next_exam.subject_name}</Text>
          <Text style={styles.small}>{o.next_exam.exam_name} · {o.next_exam.exam_date}</Text>
        </Card>
      ) : null}

      <Text style={styles.section}>More about {o.student_name.split(' ')[0]}</Text>
      <View style={styles.menu}>
        {LINKS.map(([path, title, hint]) => (
          <TouchableOpacity key={path} style={styles.row} onPress={() => router.push(`/(parent)/children/${studentId}/${path}` as Href)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{title}</Text>
              <Text style={styles.small}>{hint}</Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  name: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  off: { fontSize: FontSize.sm, color: Colors.warning, marginTop: Spacing.sm },
  tiles: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  tile: { flex: 1, padding: Spacing.md },
  value: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  label: { fontSize: FontSize.sm, color: Colors.textSecondary },
  small: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  card: { padding: Spacing.md, marginTop: Spacing.md },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, marginTop: 2 },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.sm },
  menu: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  rowTitle: { fontSize: FontSize.md, color: Colors.text },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
});
