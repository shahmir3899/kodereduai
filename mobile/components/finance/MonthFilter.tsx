import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MONTH_NAMES, stepFeeMonth } from '../../services/feeCollect';
import SegmentedTabs from '../ui/SegmentedTabs';
import { Colors, FontSize, Spacing } from '../../constants/colors';

export type YearMonth = { year: number; month: number };

// "All" or one month with a stepper that cannot go past the current month, as the web's month
// navigation. `value` null means all months.
export default function MonthFilter({ value, onChange }: { value: YearMonth | null; onChange: (v: YearMonth | null) => void }) {
  const now = new Date();
  const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
  const atCurrent = !!value && value.year === current.year && value.month === current.month;
  return (
    <View style={styles.wrap}>
      <SegmentedTabs<'ALL' | 'MONTH'> value={value ? 'MONTH' : 'ALL'} onChange={(v) => onChange(v === 'ALL' ? null : current)}
        tabs={[{ value: 'ALL', label: 'All months' }, { value: 'MONTH', label: 'By month' }]} />
      {value ? (
        <View style={styles.nav}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10} onPress={() => onChange(stepFeeMonth(value.year, value.month, -1, current))}>
            <Text style={styles.arrow}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.title}>{MONTH_NAMES[value.month - 1]} {value.year}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Next month" hitSlop={10} disabled={atCurrent} onPress={() => onChange(stepFeeMonth(value.year, value.month, 1, current))}>
            <Text style={[styles.arrow, atCurrent && styles.off]}>›</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.sm },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  arrow: { fontSize: 28, color: Colors.primary, paddingHorizontal: Spacing.md },
  off: { color: Colors.textTertiary },
  title: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});
