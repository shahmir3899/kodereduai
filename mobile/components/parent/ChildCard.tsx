import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useChildOverview } from '../../hooks/useParent';
import { rateTone } from '../../services/studentPortal';
import { formatMoney } from '../../services/feeCollect';
import { CHILD_LINKS, examDelta, feeNote, nextExamWhen, type ChildLink } from '../../services/parentPortal';
import Avatar from '../ui/Avatar';
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
  const delta = examDelta(o?.latest_exam, o?.previous_exam);

  return (
    <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`/(parent)/children/${child.student}` as Href)}>
      <Card style={styles.card}>
        <View style={styles.top}>
          <Avatar name={child.student_name || '?'} uri={child.student_photo_url || o?.photo_url} size={44} />
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
              {o.attendance_summary.total_days > 0 ? <Text style={styles.label}>{o.attendance_summary.present} of {o.attendance_summary.total_days} days</Text> : null}
              {o.attendance_summary.recent?.length ? (
                <View style={styles.dots} accessible accessibilityLabel={`Last marked days: ${o.attendance_summary.recent.map((r) => r.status.toLowerCase()).join(', ')}`}>
                  {o.attendance_summary.recent.map((r) => <View key={r.date} style={[styles.dot, { backgroundColor: DOT[r.status] ?? Colors.border }]} />)}
                </View>
              ) : null}
            </View>
            <View style={styles.stat}>
              <Text style={[styles.value, { color: pending > 0 ? Colors.error : Colors.success }]}>{formatMoney(pending)}</Text>
              <Text style={styles.label}>Fees pending</Text>
              <Text style={styles.label}>{feeNote(pending, Number(o.fee_summary.overdue_amount) || 0)}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.value}>
                {o.latest_exam ? `${Math.round(Number(o.latest_exam.percentage))}%` : '–'}
                {delta ? <Text style={{ fontSize: FontSize.xs, color: delta > 0 ? Colors.success : Colors.error }}> {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</Text> : null}
              </Text>
              <Text style={styles.label}>Last exam</Text>
            </View>
          </View>
        ) : null}

        {o?.next_exam ? <Text style={styles.next}>Next exam: {o.next_exam.subject_name} · {nextExamWhen(o.next_exam.exam_date)}</Text> : null}
        {o && o.pending_leave_count > 0 ? <Text style={styles.next}>{o.pending_leave_count} leave request{o.pending_leave_count === 1 ? '' : 's'} awaiting review</Text> : null}
        <View style={styles.chips}>
          {CHILD_LINKS.map((l) => (
            <TouchableOpacity key={l.label} accessibilityRole="button" accessibilityLabel={`${child.student_name}: ${l.label}`} style={styles.chip}
              onPress={() => router.push(`/(parent)/children/${child.student}${l.path ? `/${l.path}` : ''}` as Href)}>
              <Text style={styles.chipText}>{l.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Apply leave for ${child.student_name}`} style={styles.chip} onPress={() => router.push('/(parent)/leave' as Href)}>
            <Text style={styles.chipText}>Apply leave</Text>
          </TouchableOpacity>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

const DOT: Record<string, string> = { PRESENT: Colors.success, ABSENT: Colors.error, LATE: Colors.warning, LEAVE: Colors.info };

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
  dots: { flexDirection: 'row', gap: 3, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: Spacing.md },
  chip: { minHeight: 36, justifyContent: 'center', backgroundColor: Colors.surfaceSecondary, borderRadius: 6, paddingHorizontal: Spacing.sm },
  chipText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary },
  next: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: Spacing.sm },
});
