import React, { useState } from 'react';
import { FlatList, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import BottomSheet from './BottomSheet';
import SearchBar from './SearchBar';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

export interface SelectOption<V extends string | number = string | number> {
  value: V;
  label: string;
}

interface SelectProps<V extends string | number> {
  label?: string;
  value: V | null | undefined;
  options: SelectOption<V>[];
  onChange: (value: V) => void;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  // Adds a search box in the sheet: for long lists such as a class roster.
  searchable?: boolean;
}

// Picker that opens a bottom sheet, instead of the platform dropdown, so long class and
// student lists scroll and look the same on every device.
export default function Select<V extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select...',
  error,
  disabled,
  searchable,
}: SelectProps<V>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const shown = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.field, error ? styles.fieldError : null, disabled ? styles.fieldDisabled : null]}
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label ?? 'Select'}: ${selected ? selected.label : placeholder}`}
        accessibilityHint="Opens a list to choose from"
        accessibilityState={{ disabled: !!disabled }}
      >
        <Text style={selected ? styles.value : styles.placeholder} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Text style={styles.chevron} accessible={false}>▾</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}

      <BottomSheet visible={open} onClose={() => { setOpen(false); setQuery(''); }} title={label}>
        {searchable ? <View style={styles.search}><SearchBar value={query} onChangeText={setQuery} placeholder="Search..." /></View> : null}
        {/* Virtualised: a class roster can be several hundred rows. */}
        <FlatList
          data={shown}
          keyExtractor={(o) => String(o.value)}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={20}
          windowSize={7}
          ListEmptyComponent={<Text style={styles.empty}>No options</Text>}
          renderItem={({ item: o }) => (
            <TouchableOpacity
              style={[styles.row, o.value === value && styles.rowActive]}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: o.value === value }}
              onPress={() => {
                onChange(o.value);
                setOpen(false);
                setQuery('');
              }}
            >
              <Text style={[styles.rowText, o.value === value && styles.rowTextActive]}>{o.label}</Text>
              {o.value === value ? <Text style={styles.tick}>✓</Text> : null}
            </TouchableOpacity>
          )}
        />
      </BottomSheet>
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
  fieldDisabled: { opacity: 0.5 },
  value: { fontSize: FontSize.md, color: Colors.text, flex: 1 },
  placeholder: { fontSize: FontSize.md, color: Colors.textTertiary, flex: 1 },
  chevron: { fontSize: FontSize.md, color: Colors.textSecondary, marginLeft: Spacing.sm },
  error: { fontSize: FontSize.xs, color: Colors.error, marginTop: Spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  rowActive: { backgroundColor: Colors.infoLight },
  rowText: { fontSize: FontSize.md, color: Colors.text },
  rowTextActive: { color: Colors.primary, fontWeight: '600' },
  tick: { color: Colors.primary, fontWeight: '700' },
  search: { paddingHorizontal: Spacing.lg },
  empty: { padding: Spacing.lg, color: Colors.textSecondary, textAlign: 'center' },
});
