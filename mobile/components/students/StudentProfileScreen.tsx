import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { infoRows, monthLine, statusLabel, statusTone, summaryCards } from '../../services/students';
import { balanceOf, feeLabel, formatMoney, statusTone as feeTone, MONTH_NAMES, type FeePayment } from '../../services/feeCollect';
import { formatPercent } from '../../services/examViews';
import {
  useProfileSummary, useStudent, useStudentAttendance, useStudentFees, useStudentResults,
} from '../../hooks/useStudents';
import { usePersonaBase } from '../../hooks/usePersonaBase';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Avatar from '../ui/Avatar';
import Card from '../ui/Card';
import SegmentedTabs from '../ui/SegmentedTabs';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

type Tab = 'info' | 'attendance' | 'results' | 'fees';
const TONE_COLOR = { success: Colors.success, warning: Colors.warning, error: Colors.error, neutral: Colors.text } as const;

interface Props {
  // Admins can open the edit form; everyone else sees the profile only.
  canEdit?: boolean;
}

const denied = (q: { isError: boolean; error: unknown }) => q.isError && (q.error as any)?.response?.status === 403;

// One student, read-only: details, attendance by month, exam results, and fees. The server decides
// what each role may open, so a tab it refuses says so instead of failing.
export default function StudentProfileScreen({ canEdit }: Props) {
  const router = useRouter();
  const base = usePersonaBase();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const studentId = id ? Number(id) : null;
  const [tab, setTab] = useState<Tab>('info');

  const student = useStudent(studentId);
  const summary = useProfileSummary(studentId);
  const attendance = useStudentAttendance(studentId, tab === 'attendance');
  const results = useStudentResults(studentId, tab === 'results');
  const fees = useStudentFees(studentId, tab === 'fees');
  const refreshControl = useRefreshControl(student.refetch, summary.refetch, attendance.refetch, results.refetch, fees.refetch);

  if (student.isLoading) return <Skeleton />;
  if (student.isError && !student.data) {
    return denied(student) ? <EmptyState title="Not available" message="This student is outside your classes." /> : <ErrorState error={student.error} onRetry={() => student.refetch()} />;
  }
  const s = student.data;
  if (!s) return <EmptyState title="Student not found" />;

  const cards = summaryCards(summary.data, !denied(summary));
  const info = infoRows(s);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <View style={styles.head}>
        <Avatar name={s.name} uri={s.photo_url} size={64} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{s.name}</Text>
          <Text style={styles.sub}>{s.roll_number ? `Roll ${s.roll_number}  ·  ` : ''}{s.class_name || ''}</Text>
          {s.status && s.status !== 'ACTIVE' ? <View style={{ marginTop: 4 }}><StatusPill label={statusLabel(s.status)} tone={statusTone(s.status)} /></View> : null}
        </View>
        {canEdit ? (
          <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`${base}/students/${s.id}/edit` as Href)}>
            <Text style={styles.edit}>Edit</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {cards.length > 0 ? (
        <View style={styles.cards}>
          {cards.map((c) => (
            <View key={c.label} style={styles.card}>
              <Text style={[styles.cardValue, { color: TONE_COLOR[c.tone] }]} numberOfLines={1} adjustsFontSizeToFit>{c.value}</Text>
              <Text style={styles.cardLabel} numberOfLines={2}>{c.label}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <SegmentedTabs<Tab> value={tab} onChange={setTab}
        tabs={[{ value: 'info', label: 'Info' }, { value: 'attendance', label: 'Attendance' }, { value: 'results', label: 'Results' }, { value: 'fees', label: 'Fees' }]} />

      {tab === 'info' ? (
        info.length === 0 ? <EmptyState title="No details" /> : (
          <Card style={styles.block}>
            {info.map((r) => (
              <View key={r.label} style={styles.kv}>
                <Text style={styles.k}>{r.label}</Text>
                <Text style={styles.v}>{r.value}</Text>
              </View>
            ))}
          </Card>
        )
      ) : null}

      {tab === 'attendance' ? (
        attendance.isLoading ? <Skeleton rows={3} />
          : denied(attendance) ? <EmptyState title="Not available" message="Attendance isn't available for your role." />
          : attendance.isError && !attendance.data ? <ErrorState error={attendance.error} onRetry={() => attendance.refetch()} />
          : (attendance.data ?? []).length === 0 ? <EmptyState title="No attendance yet" />
          : (attendance.data ?? []).map((m, i) => (
            <Card key={`${m.month}-${i}`} style={styles.block}>
              <View style={styles.rowTop}>
                <Text style={styles.title}>{m.month}</Text>
                <Text style={[styles.rate, { color: (m.rate ?? 0) >= 90 ? Colors.success : (m.rate ?? 0) >= 75 ? Colors.warning : Colors.error }]}>
                  {m.rate == null ? '—' : `${Math.round(m.rate)}%`}
                </Text>
              </View>
              <Text style={styles.sub}>{monthLine(m)}</Text>
            </Card>
          ))
      ) : null}

      {tab === 'results' ? (
        results.isLoading ? <Skeleton rows={3} />
          : denied(results) ? <EmptyState title="Not available" message="Results aren't available for your role." />
          : results.isError && !results.data ? <ErrorState error={results.error} onRetry={() => results.refetch()} />
          : (results.data ?? []).length === 0 ? <EmptyState title="No results yet" />
          : (results.data ?? []).map((g) => (
            <Card key={g.exam_id} style={styles.block}>
              <Text style={styles.title}>{g.exam_name}</Text>
              {g.exam_date ? <Text style={styles.sub}>{g.exam_date}</Text> : null}
              {g.subjects.map((sub, i) => (
                <View key={`${sub.subject}-${i}`} style={styles.kv}>
                  <Text style={styles.k} numberOfLines={1}>{sub.subject}</Text>
                  <Text style={styles.v}>
                    {sub.is_absent ? 'Absent' : sub.marks_obtained == null ? '—' : `${sub.marks_obtained}/${sub.total_marks ?? '—'}`}
                    {sub.percentage != null ? `  ${formatPercent(sub.percentage)}` : ''}{sub.grade ? `  ${sub.grade}` : ''}
                  </Text>
                </View>
              ))}
            </Card>
          ))
      ) : null}

      {tab === 'fees' ? (
        fees.isLoading ? <Skeleton rows={3} />
          : denied(fees) ? <EmptyState title="Not available" message="Fee details aren't available for your role." />
          : fees.isError && !fees.data ? <ErrorState error={fees.error} onRetry={() => fees.refetch()} />
          : (fees.data ?? []).length === 0 ? <EmptyState title="No fee records" />
          : (fees.data as unknown as FeePayment[]).map((f) => (
            <Card key={f.id} style={styles.block}>
              <View style={styles.rowTop}>
                <Text style={styles.title}>{feeLabel(f)}{f.month ? `  ·  ${MONTH_NAMES[f.month - 1] ?? ''} ${f.year}` : `  ·  ${f.year}`}</Text>
                <StatusPill label={f.status} tone={feeTone(f.status)} />
              </View>
              <Text style={styles.sub}>
                Due {formatMoney(Number(f.amount_due))}  ·  Received {formatMoney(Number(f.amount_paid))}  ·  Balance {formatMoney(balanceOf(f))}
              </Text>
            </Card>
          ))
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  name: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  edit: { fontSize: FontSize.md, fontWeight: '600', color: Colors.primary },
  cards: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  card: { flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, alignItems: 'center' },
  cardValue: { fontSize: FontSize.lg, fontWeight: '700' },
  cardLabel: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center' },
  block: { padding: Spacing.md, marginBottom: Spacing.sm },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, gap: Spacing.md },
  k: { fontSize: FontSize.sm, color: Colors.textSecondary, flexShrink: 1 },
  v: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, flexShrink: 1, textAlign: 'right' },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  rate: { fontSize: FontSize.md, fontWeight: '700' },
});
