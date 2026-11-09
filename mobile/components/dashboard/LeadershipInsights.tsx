import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { bootstrapApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { todayString } from '../../services/attendanceEntry';
import {
  departureLine, hasCurriculumData, insightGates, lessonPlanClassRows, lessonPlanPreview, teachersBehind, type DepartureBlock, type LeadershipData, type PlanMonth,
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
  const [month, setMonth] = useState<PlanMonth>('current_month');
  const classRows = lessonPlanClassRows(d, month);
  const behind = teachersBehind(d);
  const hasTree = (d.lesson_plans?.by_class?.length ?? 0) > 0;
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
      {hasTree ? (
        <>
          <Text style={styles.eyebrow}>Lesson plans by class</Text>
          <View style={styles.monthTabs}>
            {([['previous_month', 'Previous'], ['current_month', 'Current'], ['next_month', 'Next']] as Array<[PlanMonth, string]>).map(([k, label]) => (
              <TouchableOpacity key={k} accessibilityRole="button" accessibilityState={{ selected: month === k }} style={[styles.monthTab, month === k && styles.monthTabOn]} onPress={() => setMonth(k)}>
                <Text style={[styles.monthTabText, month === k && styles.monthTabTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.muted}>{labels?.[month]?.label ?? ''}</Text>
          {classRows.length === 0 ? <Text style={styles.muted}>No lesson plans in this month.</Text> : null}
          {classRows.map((c) => (
            <View key={c.class_id} style={styles.lpClass}>
              <View style={styles.lpClassHead}>
                <Text style={styles.lpClassName} numberOfLines={1}>{c.class_name}</Text>
                <Text style={styles.lpClassCount}>{c[month]} plans</Text>
              </View>
              {c.teachers.map((t) => (
                <Text key={t.teacher_id} style={styles.lpTeacher}>
                  {t.teacher_name}{' — '}
                  {t.subjects.map((s, i) => `${i ? ', ' : ''}${s.subject_name} (${s[month]})`).join('')}
                </Text>
              ))}
            </View>
          ))}
        </>
      ) : null}
      {behind.length > 0 ? (
        <>
          <Text style={styles.eyebrow}>Teachers behind schedule</Text>
          {behind.map((t) => (
            <View key={t.teacher_id} style={styles.lpClassHead}>
              <Text style={styles.lpClassName} numberOfLines={1}>{t.teacher_name}</Text>
              <Text style={styles.lpClassCount}>
                {`${t.current} this month (${t.previous} last)${t.drafts ? ` · ${t.drafts} draft${t.drafts === 1 ? '' : 's'}` : ''}`}
              </Text>
            </View>
          ))}
        </>
      ) : null}
      {!hasTree && lp.rows.length > 0 ? (
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
  monthTabs: { flexDirection: 'row', gap: Spacing.xs },
  monthTab: { paddingHorizontal: Spacing.md, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: Colors.border },
  monthTabOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  monthTabText: { fontSize: FontSize.xs, color: Colors.text },
  monthTabTextOn: { color: '#fff' },
  lpClass: { paddingVertical: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  lpClassHead: { flexDirection: 'row', alignItems: 'center' },
  lpClassName: { flex: 1, fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  lpClassCount: { fontSize: FontSize.xs, color: Colors.textSecondary },
  lpTeacher: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2, paddingLeft: Spacing.sm },
  lpNum: { width: 44, textAlign: 'right', fontSize: FontSize.xs, color: Colors.text },
});
