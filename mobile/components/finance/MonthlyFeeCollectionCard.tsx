import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { hasAnnualFees, type AnnualFeeSummary } from '../../services/financeDashboard';
import { formatMoney, MONTH_NAMES } from '../../services/feeCollect';
import Card from '../ui/Card';
import FeeCollectionBreakdown, { Tile } from './FeeCollectionBreakdown';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Port of the web MonthlyFeeCollectionCard: this month's MONTHLY fees as collected, pending and the
// paid / partial / unpaid student counts, then categories and (several schools) each school.
export default function MonthlyFeeCollectionCard({ summary, loading, onDetails }: { summary: AnnualFeeSummary | null | undefined; loading?: boolean; onDetails?: () => void }) {
  const month = MONTH_NAMES[new Date().getMonth()];
  const counts = summary?.counts;
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Monthly fees — {month}{summary?.isMulti ? ' · all schools' : ''}</Text>
        {onDetails ? <TouchableOpacity accessibilityRole="button" onPress={onDetails} hitSlop={8}><Text style={styles.link}>Details</Text></TouchableOpacity> : null}
      </View>
      {loading ? <Text style={styles.muted}>Loading…</Text> : !summary || !hasAnnualFees(summary) ? (
        <Text style={styles.muted}>No monthly fee records for this month.</Text>
      ) : (
        <>
          <View style={styles.tiles}>
            <Tile label="Collected" value={formatMoney(summary.totalCollected)} bg={Colors.successLight} fg={Colors.successText} />
            <Tile label="Pending" value={formatMoney(summary.totalPending)} bg={Colors.warningLight} fg={Colors.warningText} />
            <Tile label="Paid / Partial / Unpaid" value={counts ? `${counts.paid} / ${counts.partial} / ${counts.unpaid}` : '—'} bg={Colors.surface} fg={Colors.text} />
          </View>
          <FeeCollectionBreakdown summary={summary} />
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.lg },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600' },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
});
