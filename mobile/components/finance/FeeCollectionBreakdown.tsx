import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { AnnualFeeSummary } from '../../services/financeDashboard';
import { formatMoney } from '../../services/feeCollect';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export const rateText = (r: number | null) => (r == null ? '—' : `${r}%`);

// Same thresholds as the web rate badge: 80+ good, 50+ middling, below that poor.
const rateColor = (r: number | null) => (r == null ? Colors.textSecondary : r >= 80 ? Colors.successText : r >= 50 ? Colors.warningText : Colors.error);

export function Tile({ label, value, bg, fg }: { label: string; value: string; bg: string; fg: string }) {
  return (
    <View style={[styles.tile, { backgroundColor: bg }]}>
      <Text style={[styles.tileLabel, { color: fg }]} numberOfLines={1}>{label}</Text>
      <Text style={[styles.tileValue, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
    </View>
  );
}

// Category rows and, for an admin with several schools, one row per school. Shared by the monthly and
// annual cards so the two cannot drift, as on the web. Monthly shows categories only when there is
// more than one (the headline already is the single category); annual always shows them.
export default function FeeCollectionBreakdown({ summary, alwaysShowCategories = false }: { summary: AnnualFeeSummary; alwaysShowCategories?: boolean }) {
  const showCategories = summary.byCategory.length > (alwaysShowCategories ? 0 : 1);
  const showSchools = summary.isMulti && summary.schools.length > 0;
  if (!showCategories && !showSchools) return null;
  return (
    <View style={styles.wrap}>
      {showCategories ? summary.byCategory.map((c) => (
        <View key={c.name} style={styles.row}>
          <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
          <Text style={styles.amount}>{formatMoney(c.collected)} of {formatMoney(c.due)}  ·  <Text style={{ color: rateColor(c.rate), fontWeight: '700' }}>{rateText(c.rate)}</Text></Text>
        </View>
      )) : null}
      {showSchools ? summary.schools.map((s) => (
        <View key={s.schoolId} style={styles.school}>
          <Text style={styles.name} numberOfLines={1}>{s.schoolName}</Text>
          <Text style={styles.amount}>
            {formatMoney(s.collected)} of {formatMoney(s.due)}  ·  Pending {formatMoney(s.pending)}  ·  <Text style={{ color: rateColor(s.rate), fontWeight: '700' }}>{rateText(s.rate)}</Text>
          </Text>
        </View>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: Spacing.md, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md, paddingTop: Spacing.sm },
  school: { marginTop: Spacing.sm, padding: Spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, borderRadius: BorderRadius.md, gap: 2 },
  name: { flex: 1, fontSize: FontSize.sm, color: Colors.text, fontWeight: '600' },
  amount: { fontSize: FontSize.sm, color: Colors.textSecondary },
  tile: { flex: 1, borderRadius: BorderRadius.md, padding: Spacing.sm, alignItems: 'center' },
  tileLabel: { fontSize: FontSize.xs },
  tileValue: { fontSize: FontSize.md, fontWeight: '700', marginTop: 2 },
});
