import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { format } from 'date-fns';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface DateFieldProps {
  label?: string;
  value: string | null | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  minimumDate?: Date;
  maximumDate?: Date;
}

// Browser-only stand-in for DateField, used when testing the app in a web browser, where the native
// date picker does not exist. A plain date input takes the same 'yyyy-MM-dd' value. DateField only
// renders it when Platform.OS is 'web', so on a phone it never runs.
export default function DateField({ label, value, onChange, error, minimumDate, maximumDate }: DateFieldProps) {
  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {React.createElement('input', {
        type: 'date',
        'aria-label': label ?? 'Date',
        value: value ?? '',
        min: minimumDate ? format(minimumDate, 'yyyy-MM-dd') : undefined,
        max: maximumDate ? format(maximumDate, 'yyyy-MM-dd') : undefined,
        onChange: (e: { target: { value: string } }) => { if (e.target.value) onChange(e.target.value); },
        style: {
          padding: 12, fontSize: 15, borderRadius: BorderRadius.md, backgroundColor: Colors.surface,
          border: `1px solid ${error ? Colors.error : Colors.border}`, color: Colors.text,
        },
      })}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: Spacing.lg },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  error: { color: Colors.error, fontSize: FontSize.xs, marginTop: Spacing.xs },
});
