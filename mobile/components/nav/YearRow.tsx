import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import YearSheet from './YearSheet';
import Icon from '../ui/Icon';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// "Academic year" row under the school block in the side menu, for the roles that can choose one.
export default function YearRow() {
  const { current, isPast, canChoose } = useAcademicYear();
  const [open, setOpen] = useState(false);
  if (!canChoose || !current) return null;
  return (
    <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Academic year ${current.name}${isPast ? ', a past year' : ''}. Change`}
        style={[styles.row, isPast && styles.past]} onPress={() => setOpen(true)}>
        <Icon name="calendar-outline" size={22} color={isPast ? Colors.warningText : Colors.primary} />
        <View style={styles.text}>
          <Text style={styles.label}>Academic year</Text>
          <Text style={[styles.name, isPast && styles.pastText]}>{current.name}{isPast ? '  ·  past' : ''}</Text>
        </View>
        <Icon name="chevron-down" size={18} color={Colors.textSecondary} />
      </TouchableOpacity>
      <YearSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md },
  past: { backgroundColor: Colors.warningLight },
  text: { flex: 1 },
  label: { fontSize: FontSize.xs, color: Colors.textSecondary },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  pastText: { color: Colors.warningText },
});
