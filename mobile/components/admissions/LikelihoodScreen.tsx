import React, { useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, type RefreshControlProps } from 'react-native';
import { useRouter } from 'expo-router';
import { useConversionLikelihood } from '../../hooks/useAdmissions';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import { filterScored, LIKELIHOOD_TONE, LIKELIHOODS, sourceLabel, type Likelihood } from '../../services/admissions';
import SegmentedTabs from '../ui/SegmentedTabs';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Open enquiries scored by a rule-based predictor (source history, response time, follow-up
// activity). The last result is kept for five minutes; refresh runs the scoring again.
export default function LikelihoodScreen() {
  const router = useRouter();
  const query = useConversionLikelihood();
  const refreshControl = useRefreshControl(query.refetch) as React.ReactElement<RefreshControlProps>;
  const [level, setLevel] = useState<'' | Likelihood>('');
  const rows = useMemo(() => filterScored(query.data?.enquiries ?? [], level), [query.data, level]);

  if (query.isLoading) return <Skeleton />;
  if (query.isError && !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const total = query.data?.total_open ?? 0;

  const header = (
    <View>
      <Text style={styles.summary}>{total} open enquir{total === 1 ? 'y' : 'ies'} scored</Text>
      <SegmentedTabs tabs={LIKELIHOODS.map((l) => ({ value: l.value, label: l.label }))} value={level} onChange={setLevel} />
      <Button title="Refresh scores" size="sm" variant="outline" onPress={() => query.refetch()} loading={query.isRefetching} disabled={query.isRefetching} />
    </View>
  );

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={(r) => String(r.enquiry_id)}
      refreshControl={refreshControl}
      ListHeaderComponent={header}
      ListEmptyComponent={<EmptyState title={total === 0 ? 'No open enquiries to score' : 'Nothing here'} message={total === 0 ? undefined : 'No enquiries match this level.'} />}
      renderItem={({ item }) => (
        <TouchableOpacity
          accessibilityRole="button" accessibilityLabel={`Open enquiry for ${item.student_name}, ${item.likelihood.toLowerCase()} likelihood`}
          style={[styles.row, { borderLeftColor: item.likelihood === 'HIGH' ? Colors.success : item.likelihood === 'MEDIUM' ? Colors.warning : Colors.border }]}
          onPress={() => router.push({ pathname: '/(admin)/admissions/[id]', params: { id: String(item.enquiry_id) } })}
        >
          <View style={styles.top}>
            <Text style={styles.name} numberOfLines={1}>{item.student_name}</Text>
            <StatusPill label={`${item.likelihood} · ${item.score}`} tone={LIKELIHOOD_TONE[item.likelihood]} />
          </View>
          <Text style={styles.sub}>{sourceLabel(item.source)}</Text>
          {[item.response_detail, item.activity_detail, item.followup_detail].filter(Boolean).map((t) => <Text key={t} style={styles.sub}>{t}</Text>)}
          {item.suggested_action ? <Text style={styles.action}>{item.suggested_action}</Text> : null}
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  summary: { fontSize: FontSize.sm, color: Colors.textSecondary, marginBottom: Spacing.sm },
  row: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, borderLeftWidth: 4, padding: Spacing.md, marginTop: Spacing.sm, gap: 2 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  name: { flex: 1, fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  action: { fontSize: FontSize.sm, color: Colors.text, marginTop: Spacing.xs },
});
