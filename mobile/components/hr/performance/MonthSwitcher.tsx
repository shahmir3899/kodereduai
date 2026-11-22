import React from 'react';
import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import Icon from '../../ui/Icon';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

// Previous / next month. offset 0 = this month; the future is not offered (nothing is due yet).
export default function MonthSwitcher({ offset, label, onChange }: { offset: number; label: string; onChange: (o: number) => void }) {
  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={() => onChange(offset - 1)} accessibilityRole="button" accessibilityLabel="Previous month" hitSlop={10}>
        <Icon name="chevron-back" color={Colors.primary} />
      </TouchableOpacity>
      <Text style={styles.label} accessibilityLiveRegion="polite">{label}</Text>
      <TouchableOpacity
        onPress={() => onChange(offset + 1)}
        disabled={offset >= 0}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: offset >= 0 }}
        hitSlop={10}
      >
        <Icon name="chevron-forward" color={offset >= 0 ? Colors.textTertiary : Colors.primary} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.sm },
  label: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
});
