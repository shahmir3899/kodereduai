import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useChildOverview } from '../../hooks/useParent';
import { rateTone } from '../../services/studentPortal';
import { formatMoney } from '../../services/feeCollect';
import type { ChildLink } from '../../services/parentPortal';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// One child at a glance (attendance, fees, today, next exam). Tap to open their pages.
export default function ChildCard({ child }: { child: ChildLink }) {
  const router = useRouter();
  const q = useChildOverview(child.student);
  const o = q.data;
  const pending = Number(o?.fee_summary.outstanding) || 0;
  const rate = o?.attendance_summary.attendance_rate;

  return (
    <TouchableOpacity onPress={() => router.push(`/(parent)/children/${child.student}` as Href)}>
      <Card style={styles.card}>
        <View style={styles.top}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(child.student_name || '?').charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{child.student_name}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {[o?.class_name || child.class_name, child.student_roll_number ? `Roll #${child.student_roll_number}` : ''].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
          {o?.today.is_off_day ? <StatusPill label="School closed" tone="neutral" /> : o?.attendance_summary.today ? (
            <StatusPill label={o.attendance_summary.today[0] + o.attendance_summary.today.slice(1).toLowerCase()} tone={o.attendance_summary.today === 'PRESENT' ? 'success' : o.attendance_summary.today === 'ABSENT' ? 'error' : 'info'} />
          ) : null}
        </View>

        {q.isLoading ? <Text style={styles.sub}>Loading…</Text> : q.isError ? <Text style={styles.sub}>Could not load. Pull to refresh.</Text> : o ? (
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text style={[styles.value, rate != null && { color: rateColor(rate) }]}>{rate != null ? `${rate}%` : '–'}</Text>
              <Text style={styles.label}>Attendance</Text>
            </View>
            <View style={styles.stat}>
              <Text style={[styles.value, { color: pending > 0 ? Colors.error : Colors.success }]}>{formatMoney(pending)}</Text>
              <Text style={styles.label}>Fees pending</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.value}>{o.latest_exam ? `${o.latest_exam.percentage}%` : '–'}</Text>
              <Text style={styles.label}>Last exam</Text>
            </View>
          </View>
        ) : null}

        {o?.next_exam ? <Text style={styles.next}>Next exam: {o.next_exam.subject_name} · {o.next_exam.exam_date}</Text> : null}
        {o && o.pending_leave_count > 0 ? <Text style={styles.next}>{o.pending_leave_count} leave request{o.pending_leave_count === 1 ? '' : 's'} awaiting review</Text> : null}
      </Card>
    </TouchableOpacity>
  );
}

const rateColor = (rate: number) => ({ success: Colors.success, warning: Colors.warning, error: Colors.error })[rateTone(rate)];

const styles = StyleSheet.create({
  card: { padding: Spacing.md, marginBottom: Spacing.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: Colors.textInverse, fontWeight: '700', fontSize: FontSize.lg },
  name: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  stats: { flexDirection: 'row', marginTop: Spacing.md, gap: Spacing.md },
  stat: { flex: 1 },
  value: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary },
  next: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm },
});
