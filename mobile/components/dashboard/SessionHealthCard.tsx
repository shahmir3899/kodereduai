import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { sessionsApi } from '../../services/api';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { healthTiles, pickSummary, type SessionHealthReport, type SessionSummary } from '../../services/sessionHealth';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Retention, attendance, fee collection and pass rate for the year, plus the server's rule-based
// notes. Shows nothing without a year, while loading, or when the report fails: it is a summary,
// not a reason to block the dashboard. When the server can write an AI summary it is fetched after the
// numbers (and cached there), so the card never waits on it; until then the rule-based notes show.
export default function SessionHealthCard({ yearId, yearName }: { yearId: number | null | undefined; yearName?: string }) {
  const q = useScopedQuery<SessionHealthReport | null>('sessionHealth', [yearId], async () => {
    const r = (await sessionsApi.getSessionHealth({ academic_year: yearId })).data as SessionHealthReport;
    return r?.success ? r : null;
  }, { enabled: !!yearId, staleTime: 5 * 60_000, retry: false });
  const aiAvailable = !!q.data?.ai_summary_available;
  const ai = useScopedQuery<SessionSummary | null>('sessionHealthAI', [yearId], async () =>
    ((await sessionsApi.getSessionHealthAISummary({ academic_year: yearId })).data as { ai_summary?: SessionSummary })?.ai_summary ?? null,
  { enabled: !!yearId && aiAvailable, staleTime: 30 * 60_000, retry: false });
  const report = q.data;
  if (!report) return null;

  const tiles = healthTiles(report);
  const s = pickSummary(ai.data, report.ai_summary);
  const writing = aiAvailable && ai.isLoading;
  const groups: Array<{ title: string; items?: string[]; color: string }> = [
    { title: 'Highlights', items: s?.highlights, color: Colors.success },
    { title: 'Concerns', items: s?.concerns, color: Colors.warning },
    { title: 'Action items', items: s?.action_items, color: Colors.info },
  ];

  return (
    <View>
      <View style={styles.head}>
        <Text style={styles.section}>Session health{yearName ? `: ${yearName}` : ''}</Text>
        {s?.source === 'ai' ? <Text style={styles.badge}>AI summary</Text> : writing ? <Text style={styles.writing}>Writing AI summary...</Text> : null}
      </View>
      <View style={styles.grid}>
        {tiles.map((t) => (
          <View key={t.label} style={styles.tile}>
            <Text style={styles.tileLabel}>{t.label}</Text>
            <Text style={styles.tileValue}>{t.value}</Text>
          </View>
        ))}
      </View>
      {groups.filter((g) => g.items && g.items.length > 0).map((g) => (
        <Card key={g.title} style={styles.notes}>
          <Text style={styles.noteTitle}>{g.title}</Text>
          {g.items!.map((it, i) => (
            <View key={i} style={styles.noteRow}>
              <View style={[styles.bullet, { backgroundColor: g.color }]} />
              <Text style={styles.noteText}>{it}</Text>
            </View>
          ))}
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: Spacing.sm },
  badge: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.primary, backgroundColor: Colors.infoLight, paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.full, marginTop: Spacing.xl, marginBottom: Spacing.md },
  writing: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: Spacing.xl, marginBottom: Spacing.md },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  tile: { width: '47%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  tileLabel: { fontSize: FontSize.xs, color: Colors.textSecondary },
  tileValue: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.primary, marginTop: 2 },
  notes: { padding: Spacing.md, marginTop: Spacing.md },
  noteTitle: { fontSize: FontSize.xs, fontWeight: '700', color: Colors.textSecondary, marginBottom: Spacing.xs },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 4 },
  bullet: { width: 6, height: 6, borderRadius: 3, marginTop: 6, marginRight: Spacing.sm },
  noteText: { flex: 1, fontSize: FontSize.sm, color: Colors.text },
});
