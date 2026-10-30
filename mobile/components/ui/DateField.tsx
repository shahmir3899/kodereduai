import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { format } from 'date-fns';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface DateFieldProps {
  label?: string;
  // 'yyyy-MM-dd' — the format every API in this app takes.
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  minimumDate?: Date;
  maximumDate?: Date;
}

// Parses 'yyyy-MM-dd' as a local date; new Date('2026-01-05') is UTC midnight and shows the
// previous day west of UTC.
function parse(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function DateField({ label, value, onChange, placeholder = 'Select date', error, minimumDate, maximumDate }: DateFieldProps) {
  const [open, setOpen] = useState(false);

  const handle = (event: DateTimePickerEvent, date?: Date) => {
    // Android closes its dialog itself; iOS keeps the inline picker until toggled.
    if (Platform.OS === 'android') setOpen(false);
    if (event.type === 'set' && date) onChange(format(date, 'yyyy-MM-dd'));
  };

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity style={[styles.field, error ? styles.fieldError : null]} onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Date'}: ${value ? format(parse(value), 'dd MMMM yyyy') : placeholder}`}
        accessibilityHint="Opens a date picker">
        <Text style={value ? styles.value : styles.placeholder}>
          {value ? format(parse(value), 'dd MMM yyyy') : placeholder}
        </Text>
        <Text style={styles.icon} accessible={false}>📅</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {open ? (
        <DateTimePicker
          value={value ? parse(value) : new Date()}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handle}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  fieldError: { borderColor: Colors.error },
  value: { fontSize: FontSize.md, color: Colors.text },
  placeholder: { fontSize: FontSize.md, color: Colors.textTertiary },
  icon: { fontSize: FontSize.md },
  error: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs },
});
