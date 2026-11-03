import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { sessionsApi } from '../../services/api';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { healthTiles, type SessionHealthReport } from '../../services/sessionHealth';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Retention, attendance, fee collection and pass rate for the year, plus the server's rule-based
// notes. Shows nothing without a year, while loading, or when the report fails: it is a summary,
// not a reason to block the dashboard. The AI-written summary stays on the web.
export default function SessionHealthCard({ yearId, yearName }: { yearId: number | null | undefined; yearName?: string }) {
  const q = useScopedQuery<SessionHealthReport | null>('sessionHealth', [yearId], async () => {
    const r = (await sessionsApi.getSessionHealth({ academic_year: yearId })).data as SessionHealthReport;
    return r?.success ? r : null;
  }, { enabled: !!yearId, staleTime: 5 * 60_000, retry: false });
  const report = q.data;
  if (!report) return null;

  const tiles = healthTiles(report);
  const s = report.ai_summary;
  const groups: Array<{ title: string; items?: string[]; color: string }> = [
    { title: 'Highlights', items: s?.highlights, color: Colors.success },
    { title: 'Concerns', items: s?.concerns, color: Colors.warning },
    { title: 'Action items', items: s?.action_items, color: Colors.info },
  ];

  return (
    <View>
      <Text style={styles.section}>Session health{yearName ? `: ${yearName}` : ''}</Text>
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
