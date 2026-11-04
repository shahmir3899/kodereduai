import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import type { QuestionForm } from '../../services/questionBank';
import { Colors, FontSize, Spacing } from '../../constants/colors';

type Setter = <K extends keyof QuestionForm>(k: K, v: QuestionForm[K]) => void;

// Matching: two columns, and each left item picks its right partner. Shared by the question bank and the paper builder,
// so a matching question is saved in the one shape the server accepts (left_items, right_items, index pairs).
export default function MatchingFields({ form, set }: { form: Pick<QuestionForm, 'left' | 'right' | 'pairs'>; set: Setter }) {
  return (
    <View style={styles.matching}>
      <Text style={styles.sub}>Left column, then right column. Choose the partner of each left item.</Text>
      {form.left.map((l, i) => (
        <View key={`l${i}`} style={styles.matchRow}>
          <View style={styles.matchCol}><Input value={l} placeholder={`Left ${i + 1}`} onChangeText={(v) => set('left', form.left.map((x, j) => (j === i ? v : x)))} /></View>
          <View style={styles.matchCol}>
            <Select hiddenLabel={`Partner of left item ${i + 1}`} value={form.pairs[i] ?? -1} placeholder="Partner" onChange={(v) => set('pairs', form.pairs.map((x, j) => (j === i ? (v === -1 ? null : v) : x)))}
              options={[{ value: -1, label: 'No partner' }, ...form.right.map((r, ri) => ({ value: ri, label: r.trim() || `Right ${ri + 1}` })).filter((o) => form.right[o.value].trim())]} />
          </View>
        </View>
      ))}
      {form.right.map((r, i) => (
        <Input key={`r${i}`} value={r} placeholder={`Right ${i + 1}`} onChangeText={(v) => set('right', form.right.map((x, j) => (j === i ? v : x)))} />
      ))}
      <View style={styles.matchRow}>
        <Button title="+ Left item" variant="ghost" size="sm" disabled={form.left.length >= 8} onPress={() => { set('left', [...form.left, '']); set('pairs', [...form.pairs, null]); }} />
        <Button title="+ Right item" variant="ghost" size="sm" disabled={form.right.length >= 8} onPress={() => set('right', [...form.right, ''])} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  matching: { gap: Spacing.xs },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  matchCol: { flex: 1 },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
});
