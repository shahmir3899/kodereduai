import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { attendanceSegments, type SegmentKey } from '../../services/dashboardView';
import type { AttendanceSection } from '../../services/adminDashboard';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing } from '../../constants/colors';

const COLOR: Record<SegmentKey, string> = {
  present_count: Colors.present, leave_count: Colors.leave, absent_count: Colors.absent, not_marked_count: Colors.textTertiary,
};

// Student attendance as one bar with a count for each of the four states. The counts are written
// out below the bar, so colour is never the only signal.
export default function AttendanceBreakdown({ report }: { report: AttendanceSection }) {
  const segments = attendanceSegments(report);
  const total = report.total_students;
  return (
    <Card style={styles.card}>
      <View style={styles.bar} accessible accessibilityLabel={`${report.present_count} of ${total} students present`}>
        {total > 0 ? segments.filter((s) => s.key !== 'not_marked_count').map((s) => (
          <View key={s.key} style={{ width: `${s.pct}%`, backgroundColor: COLOR[s.key] }} />
        )) : null}
      </View>
      <View style={styles.legend}>
        {segments.map((s) => (
          <View key={s.key} style={styles.item}>
            <View style={[styles.dot, { backgroundColor: COLOR[s.key] }]} />
            <Text style={styles.text}>{s.label}: {s.count}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.md },
  bar: { flexDirection: 'row', height: 12, borderRadius: 6, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.lg, rowGap: Spacing.xs, marginTop: Spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { fontSize: FontSize.sm, color: Colors.text },
});
