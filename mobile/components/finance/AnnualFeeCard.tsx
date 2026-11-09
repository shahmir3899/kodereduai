import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { hasAnnualFees, type AnnualFeeSummary } from '../../services/financeDashboard';
import { formatMoney } from '../../services/feeCollect';
import Card from '../ui/Card';
import FeeCollectionBreakdown, { Tile, rateText } from './FeeCollectionBreakdown';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// This year's annual fees: collected, pending and rate, then each category. A multi-school admin
// sees every school added together and then each school on its own, as on the web.
export default function AnnualFeeCard({ summary, loading, onDetails }: { summary: AnnualFeeSummary | null | undefined; loading?: boolean; onDetails?: () => void }) {
  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Annual fee overview{summary?.isMulti ? ' · all schools' : ''}</Text>
        {onDetails ? <TouchableOpacity accessibilityRole="button" onPress={onDetails} hitSlop={8}><Text style={styles.link}>Details</Text></TouchableOpacity> : null}
      </View>
      {loading ? <Text style={styles.muted}>Loading…</Text> : !summary || !hasAnnualFees(summary) ? (
        <Text style={styles.muted}>No annual fee records for this academic year.</Text>
      ) : (
        <>
          <View style={styles.tiles}>
            <Tile label="Collected" value={formatMoney(summary.totalCollected)} bg={Colors.successLight} fg={Colors.successText} />
            <Tile label="Pending" value={formatMoney(summary.totalPending)} bg={Colors.warningLight} fg={Colors.warningText} />
            <Tile label="Rate" value={rateText(summary.rate)} bg={Colors.infoLight} fg={Colors.infoText} />
          </View>
          <FeeCollectionBreakdown summary={summary} alwaysShowCategories />
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
