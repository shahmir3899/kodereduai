import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useStudentsPaged } from '../../hooks/useStudents';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import SearchBar from '../ui/SearchBar';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface StudentPickerProps {
  value: number | null;
  onChange: (id: number, name: string) => void;
  label?: string;
}

// Search-as-you-type student chooser for forms: a school can have thousands of students, so a
// plain dropdown would be too long. Shows the first few matches and the chosen student.
export default function StudentPicker({ value, onChange, label = 'Student' }: StudentPickerProps) {
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const term = useDebouncedValue(search.trim(), 400);
  const query = useStudentsPaged(term, null);
  const rows = (query.data?.pages[0]?.results ?? []).slice(0, 6);

  return (
    <View>
      <Text style={styles.label}>{label}{chosen ? `: ${chosen}` : ''}</Text>
      <SearchBar value={search} onChangeText={setSearch} placeholder="Search by name or roll number..." />
      {term.length > 0 || value === null ? rows.map((s) => (
        <TouchableOpacity
          key={s.id} accessibilityRole="button" accessibilityState={{ selected: s.id === value }}
          style={[styles.row, s.id === value && styles.selected]}
          onPress={() => { setChosen(s.name); onChange(s.id, s.name); }}
        >
          <Text style={styles.name} numberOfLines={1}>{s.name}</Text>
          <Text style={styles.sub} numberOfLines={1}>{[s.roll_number ? `Roll ${s.roll_number}` : '', s.class_name].filter(Boolean).join('  ·  ')}</Text>
        </TouchableOpacity>
      )) : null}
      {term.length > 0 && !query.isLoading && rows.length === 0 ? <Text style={styles.empty}>No student matches.</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  row: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.sm, padding: Spacing.sm, marginBottom: Spacing.xs, minHeight: 44, justifyContent: 'center' },
  selected: { borderWidth: 2, borderColor: Colors.primary },
  name: { fontSize: FontSize.md, color: Colors.text, fontWeight: '500' },
  sub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  empty: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
