import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { bootstrapApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { todayString } from '../../services/attendanceEntry';
import {
  departureLine, hasCurriculumData, insightGates, lessonPlanPreview, type DepartureBlock, type LeadershipData,
} from '../../services/leadershipInsights';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Admissions, departures and curriculum counts for school leaders. It is a heavy aggregate on the
// server, so nothing is requested until the section is opened.
export default function LeadershipInsights() {
  const { isModuleEnabled } = useAuth();
  const year = useAcademicYear();
  const gates = insightGates((k) => isModuleEnabled(k));
  const [open, setOpen] = useState(false);

  const q = useScopedQuery<LeadershipData>('leadershipInsights', [year.current?.id ?? null, todayString()], async () =>
    (await bootstrapApi.getLeadershipAcademicInsights({
      reference_date: todayString(),
      ...(year.current?.id ? { academic_year: year.current.id } : {}),
    })).data,
  { enabled: open && !year.isLoading, staleTime: 5 * 60_000 });

  if (!gates.roster && !gates.curriculum) return null;
  const d = q.data;

  return (
    <View>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.toggle} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.section}>School insights</Text>
        <Text style={styles.link}>{open ? 'Hide' : 'Show'}</Text>
      </TouchableOpacity>
      {open ? (
        q.isLoading ? <Skeleton rows={2} />
          : q.isError && !d ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : d ? (
            <>
              {gates.roster ? <Roster d={d} /> : null}
              {gates.curriculum ? <Curriculum d={d} /> : null}
            </>
          ) : null
      ) : null}
    </View>
  );
}

function Roster({ d }: { d: LeadershipData }) {
  const admits = d.admissions ?? {};
  const deps = d.departures ?? {};
  const dep = (label: string, b: DepartureBlock | null | undefined) => b ? (
    <View key={label} style={styles.depRow}>
      <Text style={styles.depLabel}>{label}</Text>
      <Text style={styles.depTotal}>{b.total ?? 0}</Text>
      {departureLine(b) ? <Text style={styles.depDetail} numberOfLines={1}>{departureLine(b)}</Text> : null}
    </View>
  ) : null;
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Admissions &amp; departures</Text>
      <View style={styles.cells}>
        <Cell label="This session" value={admits.session != null ? admits.session.count ?? 0 : '—'} bg={Colors.infoLight} fg={Colors.infoText} />
        <Cell label="Last 90 days" value={admits.rolling_90d?.count ?? 0} bg={Colors.successLight} fg={Colors.successText} />
        <Cell label="Last 30 days" value={admits.rolling_30d?.count ?? 0} bg={Colors.surfaceSecondary} fg={Colors.text} />
      </View>
      {dep('Departures, 30 days', deps.rolling_30d)}
      {dep('Departures, 90 days', deps.rolling_90d)}
      {dep('Departures, this session', deps.session)}
    </Card>
  );
}

function Curriculum({ d }: { d: LeadershipData }) {
  const books = d.lms_books_by_class ?? [];
  const qb = d.question_bank ?? { total: 0, by_subject: [] };
  const lp = lessonPlanPreview(d);
  const labels = d.lesson_plans?.buckets;
  return (
    <Card style={styles.card}>
      <Text style={styles.title}>Curriculum &amp; plans</Text>
      {!hasCurriculumData(d) ? <Text style={styles.muted}>No curriculum or question bank data yet for this school.</Text> : null}
      {books.length > 0 ? (
        <>
          <Text style={styles.eyebrow}>Books by class</Text>
          <View style={styles.chips}>
            {books.map((b) => <Text key={b.class_id} style={styles.chip}>{b.class_name}: {b.book_count}</Text>)}
          </View>
        </>
      ) : null}
      {(qb.total ?? 0) > 0 ? (
        <>
          <Text style={styles.eyebrow}>Question bank</Text>
          <Text style={styles.big}>{qb.total} questions</Text>
          <View style={styles.chips}>
            {(qb.by_subject ?? []).slice(0, 6).map((s) => <Text key={s.subject_id} style={styles.chip}>{s.subject_name}: {s.count}</Text>)}
          </View>
        </>
      ) : null}
      {lp.rows.length > 0 ? (
        <>
          <Text style={styles.eyebrow}>Lesson plans by teacher</Text>
          <View style={styles.lpHead}>
            <Text style={[styles.lpName, styles.lpHeadText]}>Teacher · class</Text>
            <Text style={[styles.lpNum, styles.lpHeadText]}>{labels?.previous_month?.label ?? 'Prev'}</Text>
            <Text style={[styles.lpNum, styles.lpHeadText]}>{labels?.current_month?.label ?? 'Now'}</Text>
            <Text style={[styles.lpNum, styles.lpHeadText]}>{labels?.next_month?.label ?? 'Next'}</Text>
          </View>
          {lp.rows.map((r) => (
            <View key={`${r.teacher_id}-${r.class_id}`} style={styles.lpRow}>
              <Text style={styles.lpName} numberOfLines={1}>{r.teacher_name} · {r.class_name}</Text>
              <Text style={styles.lpNum}>{r.previous_month}</Text>
              <Text style={styles.lpNum}>{r.current_month}</Text>
              <Text style={styles.lpNum}>{r.next_month}</Text>
            </View>
          ))}
          {lp.total > lp.rows.length ? <Text style={styles.muted}>Showing {lp.rows.length} of {lp.total} teacher and class pairs.</Text> : null}
        </>
      ) : null}
    </Card>
  );
}

function Cell({ label, value, bg, fg }: { label: string; value: number | string; bg: string; fg: string }) {
  return (
    <View style={[styles.cell, { backgroundColor: bg }]}>
      <Text style={[styles.cellValue, { color: fg }]}>{value}</Text>
      <Text style={[styles.cellLabel, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', minHeight: 44 },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600', marginBottom: Spacing.md },
  card: { padding: Spacing.md, marginBottom: Spacing.md },
  title: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text, marginBottom: Spacing.sm },
  cells: { flexDirection: 'row', gap: Spacing.sm },
  cell: { flex: 1, borderRadius: BorderRadius.md, padding: Spacing.sm, alignItems: 'center' },
  cellValue: { fontSize: FontSize.xl, fontWeight: '700' },
  cellLabel: { fontSize: 10, textAlign: 'center' },
  depRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  depLabel: { fontSize: FontSize.sm, color: Colors.text },
  depTotal: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  depDetail: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'right' },
  eyebrow: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: { fontSize: FontSize.xs, color: Colors.infoText, backgroundColor: Colors.infoLight, borderRadius: 12, paddingHorizontal: Spacing.sm, paddingVertical: 2, overflow: 'hidden' },
  big: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  muted: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: Spacing.xs },
  lpHead: { flexDirection: 'row', alignItems: 'center', paddingBottom: 2 },
  lpHeadText: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
  lpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  lpName: { flex: 1, fontSize: FontSize.xs, color: Colors.text },
  lpNum: { width: 44, textAlign: 'right', fontSize: FontSize.xs, color: Colors.text },
});
