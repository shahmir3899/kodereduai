import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { schoolsApi } from '../../services/api';
import { useScopedQuery } from '../../hooks/useScopedQuery';
import { routeFor } from '../../navigation/routes';
import { missingSteps, nextStepLink, progressTone, type SetupModule, type SetupProgress } from '../../services/setupProgress';
import Card from '../ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

const TONE = { success: Colors.success, info: Colors.primary, warning: Colors.warning };

// School setup progress (web SchoolCompletionWidget), school admin only. Each module's bar opens the
// screen that finishes its next step when the phone has one; otherwise the row names what is
// missing and the step is done on the web. Hidden while loading or on an error: it is a nudge.
export default function SetupProgressCard({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const q = useScopedQuery<SetupProgress | null>('schoolCompletion', [], async () => (await schoolsApi.getCompletion()).data as SetupProgress,
    { enabled, staleTime: 5 * 60_000, retry: false });
  const c = q.data;
  if (!enabled || !c || !c.modules?.length) return null;

  if (c.overall_percentage >= 100) {
    return <Card style={styles.done}><Text style={styles.doneText}>All modules fully set up.</Text></Card>;
  }

  const row = (m: SetupModule) => {
    const link = nextStepLink(m);
    const route = link ? routeFor('admin', link) : undefined;
    const color = TONE[progressTone(m.percentage)];
    const missing = missingSteps(m);
    return (
      <TouchableOpacity key={m.key} disabled={!route} onPress={() => route && router.push(route as Href)} style={styles.row}
        accessibilityRole={route ? 'button' : undefined} accessibilityLabel={`${m.label}, ${m.percentage}% set up${missing ? `. Missing: ${missing}` : ''}`}>
        <View style={styles.rowHead}>
          <Text style={styles.label} numberOfLines={1}>{m.label}</Text>
          <Text style={[styles.pct, { color }]}>{m.percentage}%</Text>
        </View>
        <View style={styles.track}><View style={[styles.fill, { width: `${m.percentage}%`, backgroundColor: color }]} /></View>
        {missing ? <Text style={styles.missing} numberOfLines={2}>{missing}{route ? '' : '  ·  on the web'}</Text> : null}
      </TouchableOpacity>
    );
  };

  return (
    <View>
      <Text style={styles.section}>School setup</Text>
      <Card style={styles.card}>
        <Text style={styles.overall}>{c.overall_percentage}% set up  ·  {c.completed_steps} of {c.total_steps} steps</Text>
        {c.modules.map(row)}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  card: { padding: Spacing.md, gap: Spacing.md },
  overall: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  row: { gap: 4 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: FontSize.sm, color: Colors.text, flex: 1 },
  pct: { fontSize: FontSize.xs, fontWeight: '700' },
  track: { height: 6, borderRadius: BorderRadius.full, backgroundColor: Colors.surfaceSecondary, overflow: 'hidden' },
  fill: { height: 6, borderRadius: BorderRadius.full },
  missing: { fontSize: FontSize.xs, color: Colors.textSecondary },
  done: { padding: Spacing.md, marginTop: Spacing.xl, backgroundColor: Colors.successLight },
  doneText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.success },
});
