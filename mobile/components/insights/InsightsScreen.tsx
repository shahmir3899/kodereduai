import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useInsight } from '../../hooks/useInsights';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { cachedText, INSIGHT_TABS, SEVERITY_TONE, summaryText, type InsightKind, type InsightRow } from '../../services/insights';
import SegmentedTabs from '../ui/SegmentedTabs';
import Button from '../ui/Button';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import FormSheet from '../inventory/FormSheet';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Read-only risk cards for admin and principal. Each tab shows the last scan (kept ten minutes);
// "Run a new scan" asks the server again. Students and staff are named, so this stays on the phone
// only while the app is open.
export default function InsightsScreen() {
  const [kind, setKind] = useState<InsightKind>('students');
  const q = useInsight(kind, true);
  const refreshControl = useRefreshControl(q.refetch) as React.ReactElement<RefreshControlProps>;
  const [open, setOpen] = useState<InsightRow | null>(null);
  const s = q.data?.summary;

  const header = (
    <View>
      <SegmentedTabs tabs={INSIGHT_TABS} value={kind} onChange={setKind} />
      {s ? (
        <Card>
          <Text style={styles.summary}>{summaryText(s)}</Text>
          {s.notEnoughData > 0 ? <Text style={styles.sub}>{s.notEnoughData} not scored yet (not enough history).</Text> : null}
          {cachedText(q.data?.cachedAt) ? <Text style={styles.sub}>{cachedText(q.data?.cachedAt)}</Text> : null}
        </Card>
      ) : null}
      <View style={styles.gap} />
      <Button title="Run a new scan" size="sm" variant="outline" onPress={() => q.refetch()} loading={q.isFetching} disabled={q.isFetching} />
    </View>
  );

  if (q.isLoading) return <View style={styles.container}><View style={styles.content}>{header}</View><Skeleton /></View>;
  if (q.isError && !q.data) return <View style={styles.container}><View style={styles.content}>{header}</View><ErrorState error={q.error} onRetry={() => q.refetch()} /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={s?.rows ?? []}
        keyExtractor={(r) => String(r.id)}
        refreshControl={refreshControl}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="Nobody at risk" message="No one is flagged in this scan." />}
        renderItem={({ item: r }) => (
          <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => setOpen(r)}>
            <View style={styles.who}>
              <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.sub} numberOfLines={1}>{[r.subtitle, r.headline].filter(Boolean).join('  ·  ')}</Text>
            </View>
            {r.severity ? <StatusPill label={r.severity} tone={SEVERITY_TONE[r.severity]} /> : null}
          </TouchableOpacity>
        )}
      />

      <FormSheet visible={open !== null} title={open?.name ?? ''} onClose={() => setOpen(null)} onSubmit={() => setOpen(null)} submitLabel="Close">
        {open ? (
          <View style={styles.detail}>
            {open.subtitle ? <Text style={styles.sub}>{open.subtitle}</Text> : null}
            <Text style={styles.name}>{open.headline}</Text>
            {open.details.map((d) => <Text key={d} style={styles.line}>{d}</Text>)}
            {open.action ? <Text style={styles.action}>Suggested: {open.action}</Text> : null}
          </View>
        ) : null}
      </FormSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  summary: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  gap: { height: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginTop: Spacing.sm, gap: Spacing.md },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  detail: { gap: Spacing.xs },
  line: { fontSize: FontSize.sm, color: Colors.text },
  action: { fontSize: FontSize.sm, color: Colors.primary, marginTop: Spacing.sm },
});
