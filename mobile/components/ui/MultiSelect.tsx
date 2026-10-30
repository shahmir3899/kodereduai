import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from './BottomSheet';
import Button from './Button';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface MultiSelectProps {
  label?: string;
  values: number[];
  options: Array<{ value: number; label: string }>;
  onToggle: (value: number) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}

// Picker that stays open while several options are ticked. The caller decides what a tick does
// (limits, minimum of one), so the rules live next to the data, not in the widget.
export default function MultiSelect({ label, values, options, onToggle, placeholder = 'Select...', disabled, hint }: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const chosen = options.filter((o) => values.includes(o.value));

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity accessibilityRole="button" style={[styles.field, disabled && styles.disabled]} disabled={disabled} onPress={() => setOpen(true)}>
        <Text style={chosen.length ? styles.value : styles.placeholder} numberOfLines={1}>
          {chosen.length ? chosen.map((o) => o.label).join(', ') : placeholder}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </TouchableOpacity>

      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label}>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        <ScrollView>
          {options.map((o) => {
            const on = values.includes(o.value);
            return (
              <TouchableOpacity accessibilityRole="button" key={o.value} style={[styles.row, on && styles.rowOn]} onPress={() => onToggle(o.value)}>
                <Text style={[styles.rowText, on && styles.rowTextOn]}>{o.label}</Text>
                <Text style={styles.tick}>{on ? '☑' : '☐'}</Text>
              </TouchableOpacity>
            );
          })}
          {options.length === 0 ? <Text style={styles.empty}>No options</Text> : null}
        </ScrollView>
        <View style={styles.done}><Button title="Done" onPress={() => setOpen(false)} fullWidth /></View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  field: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  disabled: { opacity: 0.5 },
  value: { fontSize: FontSize.md, color: Colors.text, flex: 1 },
  placeholder: { fontSize: FontSize.md, color: Colors.textTertiary, flex: 1 },
  chevron: { fontSize: FontSize.md, color: Colors.textSecondary, marginLeft: Spacing.sm },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  rowOn: { backgroundColor: Colors.infoLight },
  rowText: { fontSize: FontSize.md, color: Colors.text, flex: 1 },
  rowTextOn: { color: Colors.primary, fontWeight: '600' },
  tick: { fontSize: FontSize.lg, color: Colors.primary },
  empty: { padding: Spacing.lg, color: Colors.textSecondary, textAlign: 'center' },
  done: { padding: Spacing.lg },
});
