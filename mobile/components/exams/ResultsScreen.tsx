import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { examinationsApi } from '../../services/api';
import { listOf } from '../../services/academicYear';
import type { ClassOption } from '../../services/attendanceEntry';
import { formatPercent, resultStatus, summarizeResults, type ResultRow } from '../../services/examViews';
import { useAttendanceClassOptions } from '../../hooks/useAcademicYear';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Select from '../ui/Select';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  // Teachers pass their own sections; admins leave it out and get every class.
  classOptions?: ClassOption[];
}

const RANK_COLOR: Record<number, string> = { 1: '#eab308', 2: '#9ca3af', 3: '#d97706' };

// Ranked results for one exam, with a pass/fail summary. Read-only: the AI comment tools stay
// on the web.
export default function ResultsScreen({ classOptions }: Props) {
  const { year, options, isLoading: classesLoading } = useAttendanceClassOptions(classOptions);
  const yearId = year.current?.id ?? null;
  const [classId, setClassId] = useState<number | null>(null);
  const [examId, setExamId] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  // Teachers get their first section pre-selected, as on the web.
  useEffect(() => {
    if (classOptions && classOptions.length > 0 && classId == null) setClassId(classOptions[0].id);
  }, [classOptions, classId]);

  const option = options.find((o) => o.id === classId) ?? null;
  const masterClassId = option ? (option.classObj ?? option.id) : null;
  const sectionId = option?.isSession ? option.id : null;

  const examsQ = useScopedQuery('resultsExams', [yearId, masterClassId, sectionId], async () =>
    listOf<{ id: number; name: string }>((await examinationsApi.getExams({
      academic_year: yearId || undefined,
      class_obj: masterClassId || undefined,
      // Whole-class exams plus this section's own, not a sibling section's.
      session_class_id: sectionId || undefined,
    })).data),
  { enabled: !!option, staleTime: 60_000 });

  // Fresh each time: results change as marks are entered.
  const resultsQ = useScopedQuery('examResults', [examId, sectionId], async () =>
    listOf<ResultRow>((await examinationsApi.getExamResults(examId!, sectionId ? { session_class_id: sectionId } : undefined)).data),
  { enabled: !!examId, staleTime: 0 });

  const refreshControl = useRefreshControl(examsQ.refetch, resultsQ.refetch);
  const rows = resultsQ.data ?? [];
  const summary = useMemo(() => summarizeResults(rows), [rows]);

  if (classesLoading) return <Skeleton />;
  if (!year.current) return <EmptyState title="No academic session" message="Set a current academic year on the web app first." />;
  if (options.length === 0) return <EmptyState title="No classes" message="There are no classes to show." />;

  const header = (
    <View>
      <Select label="Class" value={classId} options={options.map((o) => ({ value: o.id, label: o.label }))}
        onChange={(id) => { setClassId(id); setExamId(null); setOpen(null); }} placeholder="Select a class" />
      <Select label="Exam" value={examId} options={(examsQ.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
        onChange={(id) => { setExamId(id); setOpen(null); }}
        placeholder={option && !examsQ.isLoading && (examsQ.data ?? []).length === 0 ? 'No exams for this class' : 'Select exam'}
        disabled={!option} />

      {summary ? (
        <>
          <View style={styles.cards}>
            <Stat label="Students" value={summary.total} color={Colors.text} />
            <Stat label="Passed" value={summary.pass} color={Colors.success} />
            <Stat label={summary.incomplete > 0 ? `Failed · ${summary.incomplete} incomplete` : 'Failed'} value={summary.fail} color={Colors.error} />
            <Stat label="Average" value={summary.average == null ? '—' : `${summary.average.toFixed(1)}%`} color={Colors.primary} />
          </View>
          {summary.toppers.length > 0 ? (
            <View style={styles.topper}>
              <Text style={styles.topperTitle}>★ Topper{summary.toppers.length > 1 ? 's' : ''}: {summary.toppers.join(', ')}</Text>
              <Text style={styles.topperSub}>Total {summary.topperTotal}  ·  {formatPercent(summary.topperPercent)}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );

  const loading = !!examId && resultsQ.isLoading;
  const failed = !!examId && !resultsQ.data && resultsQ.isError;

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={examId && !loading && !failed ? rows : []}
      keyExtractor={(r) => String(r.student_id)}
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      ListEmptyComponent={
        !examId ? <EmptyState title="Pick an exam" message="Choose a class and an exam to see ranked results." />
          : loading ? <Skeleton />
          : failed ? <ErrorState error={resultsQ.error} onRetry={() => resultsQ.refetch()} />
          : <EmptyState title="No results" message="No results data is available for this exam yet." />
      }
      renderItem={({ item }) => {
        const status = resultStatus(item);
        const expanded = open === item.student_id;
        return (
          <TouchableOpacity accessibilityRole="button" style={[styles.row, status === 'fail' && styles.rowFail]} onPress={() => setOpen(expanded ? null : item.student_id)}>
            <View style={styles.main}>
              <View style={[styles.rank, { backgroundColor: item.rank != null && RANK_COLOR[item.rank] ? RANK_COLOR[item.rank] : Colors.surfaceSecondary }]}>
                <Text style={[styles.rankText, item.rank != null && RANK_COLOR[item.rank] ? { color: Colors.textInverse } : null]}>{item.rank ?? '—'}</Text>
              </View>
              <View style={styles.who}>
                <Text style={styles.name} numberOfLines={1}>{item.student_name}</Text>
                <Text style={styles.sub}>
                  {item.roll_number ? `Roll ${item.roll_number}  ·  ` : ''}{item.total_obtained ?? '—'}/{item.total_possible ?? '—'}  ·  {formatPercent(item.percentage)}
                </Text>
              </View>
              <View style={styles.right}>
                {item.grade ? <Text style={styles.grade}>{item.grade}</Text> : null}
                <StatusPill label={status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Incomplete'}
                  tone={status === 'pass' ? 'success' : status === 'fail' ? 'error' : 'warning'} />
              </View>
            </View>
            {expanded ? (
              <View style={styles.detail}>
                {(item.marks ?? []).map((m, i) => (
                  <View key={m.subject_id ?? i} style={styles.markRow}>
                    <Text style={styles.markSubject} numberOfLines={1}>{m.subject_name}</Text>
                    <Text style={styles.markValue}>
                      {m.is_absent ? 'Absent' : m.marks_obtained == null ? '—' : m.marks_obtained}{m.total_marks != null ? ` / ${m.total_marks}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
          </TouchableOpacity>
        );
      }}
    />
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  cards: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  stat: { flex: 1, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.sm, alignItems: 'center' },
  statValue: { fontSize: FontSize.lg, fontWeight: '700' },
  statLabel: { fontSize: 10, color: Colors.textSecondary, textAlign: 'center' },
  topper: { backgroundColor: Colors.warningLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md },
  topperTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  topperSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  rowFail: { backgroundColor: Colors.errorLight },
  main: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  rank: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rankText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '500', color: Colors.text },
  sub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  grade: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.info },
  detail: { marginTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  markRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  markSubject: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  markValue: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
});
