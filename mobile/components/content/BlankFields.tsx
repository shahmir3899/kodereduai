import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Input from '../ui/Input';
import Button from '../ui/Button';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Fill in the blank: one answer per blank, as the web's composer collects them ("+ Add Blank").
export default function BlankFields({ blanks, onChange }: { blanks: string[]; onChange: (next: string[]) => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Blanks (answer for each, optional)</Text>
      {blanks.map((b, i) => (
        <View key={i} style={styles.row}>
          <View style={styles.col}>
            <Input value={b} placeholder={`Blank ${i + 1}`} accessibilityLabel={`Blank ${i + 1}`} onChangeText={(v) => onChange(blanks.map((x, j) => (j === i ? v : x)))} />
          </View>
          {blanks.length > 1 ? (
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove blank ${i + 1}`} style={styles.remove} onPress={() => onChange(blanks.filter((_, j) => j !== i))}>
              <Text style={styles.removeText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      <Button title="+ Add blank" variant="ghost" size="sm" disabled={blanks.length >= 10} onPress={() => onChange([...blanks, ''])} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  col: { flex: 1 },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  removeText: { fontSize: FontSize.lg, color: Colors.error },
});
