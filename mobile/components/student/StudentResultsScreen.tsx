import React, { useState } from 'react';
import type { Q } from './types';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useStudentResults } from '../../hooks/useStudentPortal';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { examPercentage, examTotals, pctTone, subjectMarks, subjectResult, type PortalResultExam, type SubjectResult } from '../../services/studentPortal';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import Card from '../ui/Card';
import StatusPill from '../ui/StatusPill';
import type { Tone } from '../ui/StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

const RESULT_PILL: Record<Exclude<SubjectResult, 'none'>, { label: string; tone: Tone }> = {
  pass: { label: 'Pass', tone: 'success' },
  fail: { label: 'Fail', tone: 'error' },
  absent: { label: 'Absent', tone: 'neutral' },
};
const TONE_COLOR: Record<string, string> = {
  success: Colors.success, info: Colors.info, warning: Colors.warning, error: Colors.error, neutral: Colors.textSecondary,
};

// Published exam results, newest first. Tap an exam for its subject marks.
export function ResultsView({ query }: { query: Q<PortalResultExam[]> }) {
  const refreshControl = useRefreshControl(query.refetch);
  const [open, setOpen] = useState<number | null>(null);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const exams = query.data ?? [];
  if (exams.length === 0) return <EmptyState title="No results yet" message="Results show here once the school publishes them." />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      {exams.map((e) => {
        const pct = examPercentage(e);
        const isOpen = open === e.exam_id;
        return (
          <Card key={e.exam_id} style={styles.card}>
            <TouchableOpacity accessibilityRole="button" style={styles.head} onPress={() => setOpen(isOpen ? null : e.exam_id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={2}>{e.exam_name}</Text>
                <Text style={styles.meta}>{[e.exam_type, e.exam_date].filter(Boolean).join('  ·  ')}</Text>
              </View>
              <View style={styles.right}>
                {e.grade ? <StatusPill label={`Grade ${e.grade}`} tone="success" /> : null}
                <Text style={[styles.pct, { color: TONE_COLOR[pctTone(pct)] }]}>{pct != null ? `${pct}%` : '–'}</Text>
              </View>
            </TouchableOpacity>
            {isOpen ? (
              <View style={styles.subjects}>
                {e.subjects.map((s, i) => {
                  const result = subjectResult(s);
                  return (
                    <View key={`${s.subject}-${i}`} style={styles.row}>
                      <Text style={styles.subject} numberOfLines={1}>{s.subject}</Text>
                      <Text style={styles.marks}>{subjectMarks(s)}</Text>
                      <View style={styles.pill}>
                        {result !== 'none' ? <StatusPill label={RESULT_PILL[result].label} tone={RESULT_PILL[result].tone} /> : null}
                      </View>
                    </View>
                  );
                })}
                <View style={[styles.row, styles.total]}>
                  <Text style={[styles.subject, styles.bold]}>Total</Text>
                  <Text style={[styles.marks, styles.bold]}>{(() => { const t = examTotals(e); return t.max > 0 ? `${t.got} / ${t.max}` : '–'; })()}</Text>
                  <View style={styles.pill}>{e.grade ? <StatusPill label={`Grade ${e.grade}`} tone="success" /> : null}</View>
                </View>
              </View>
            ) : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}

export default function StudentResultsScreen() {
  return <ResultsView query={useStudentResults()} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg },
  card: { padding: Spacing.md, marginBottom: Spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  meta: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  pct: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.primary },
  subjects: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  pill: { width: 84, alignItems: 'flex-end' },
  total: { marginTop: Spacing.xs, paddingTop: Spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  bold: { fontWeight: '700' },
  subject: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
  marks: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
});
