import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useEarlierAssessments, useStudentAIProfile } from '../../hooks/useStudentInsights';
import { assessmentTitle, hasAssessmentText, ratingLine, riskCards } from '../../services/studentInsights';
import Card from '../ui/Card';
import EmptyState from '../ui/EmptyState';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE = { success: Colors.success, warning: Colors.warning, error: Colors.error, neutral: Colors.text } as const;

// The risk profile the server works out for one student, then its short summary and advice. Shows
// nothing while loading or when the role may not see it, so it never takes space for no reason; a
// failure says so in one line.
export function RiskProfile({ studentId }: { studentId: number }) {
  const q = useStudentAIProfile(studentId);
  const status = (q.error as { response?: { status?: number } } | null)?.response?.status;
  if (q.isLoading) return <Text style={styles.muted}>Loading the risk profile…</Text>;
  if (q.isError) return status === 403 ? null : <Text style={styles.muted}>The risk profile is not available right now.</Text>;
  const ai = q.data;
  const cards = riskCards(ai);
  if (cards.length === 0 && !hasAssessmentText(ai)) return null;
  return (
    <View>
      <Text style={styles.title}>Risk profile</Text>
      <View style={styles.cards}>
        {cards.map((c) => (
          <View key={c.label} style={styles.card} accessible accessibilityLabel={`${c.label}: ${c.value}${c.sub ? `, ${c.sub}` : ''}`}>
            <Text style={[styles.value, { color: TONE[c.tone] }]} numberOfLines={2} adjustsFontSizeToFit>{c.value}</Text>
            <Text style={styles.label}>{c.label}</Text>
            {c.sub ? <Text style={styles.sub} numberOfLines={2}>{c.sub}</Text> : null}
          </View>
        ))}
      </View>
      {hasAssessmentText(ai) ? (
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Assessment</Text>
          {ai?.ai_summary ? <Text style={styles.summaryText}>{ai.ai_summary}</Text> : null}
          {(ai?.recommendations ?? []).map((r, i) => <Text key={i} style={styles.rec}>- {r}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

// Skills and behaviour ratings and remarks recorded at an earlier branch: for the record, never editable.
export function EarlierAssessments({ studentId }: { studentId: number }) {
  const q = useEarlierAssessments(studentId, true);
  if (q.isLoading) return <Text style={styles.muted}>Loading…</Text>;
  if (q.isError) return <Text style={styles.muted}>Could not load the earlier assessments.</Text>;
  const rows = q.data ?? [];
  if (rows.length === 0) return <EmptyState title="Nothing from earlier branches" message="No skills or behaviour assessments were recorded at an earlier branch." />;
  return (
    <Card style={styles.earlier}>
      <Text style={styles.summaryTitle}>From earlier branches (read-only)</Text>
      {rows.map((a) => {
        const line = ratingLine(a.ratings);
        return (
          <View key={a.id} style={styles.item}>
            <Text style={styles.itemTitle}>{assessmentTitle(a)}{a.branch ? `  ·  ${a.branch}` : ''}</Text>
            {line ? <Text style={styles.itemLine}>{line}</Text> : null}
            {a.teacher_remark ? <Text style={styles.itemLine}>Teacher: {a.teacher_remark}</Text> : null}
            {a.principal_remark ? <Text style={styles.itemLine}>Principal: {a.principal_remark}</Text> : null}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary, marginVertical: Spacing.sm },
  title: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  cards: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  card: { width: '48%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  value: { fontSize: FontSize.lg, fontWeight: '700' },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  sub: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  summary: { backgroundColor: Colors.infoLight, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm },
  summaryTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.infoText },
  summaryText: { fontSize: FontSize.sm, color: Colors.infoText, marginTop: 2 },
  rec: { fontSize: FontSize.xs, color: Colors.infoText, marginTop: 4 },
  earlier: { padding: Spacing.md, marginTop: Spacing.sm },
  item: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, paddingTop: Spacing.sm, marginTop: Spacing.sm },
  itemTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  itemLine: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
});
