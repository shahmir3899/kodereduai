import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import {
  addSuggestion, BLOOM_LEVELS, bloomLabel, bloomTone, editRow, newRow, removeRow, type LinkedObjective, type ObjectiveRow,
} from '../../services/lessonPlanObjectives';
import Input from '../ui/Input';
import Select from '../ui/Select';
import Button from '../ui/Button';
import StatusPill from '../ui/StatusPill';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  rows: ObjectiveRow[];
  onChange: (rows: ObjectiveRow[]) => void;
  // Objectives the curriculum lists for the chosen topics, not yet on the plan.
  suggestions: LinkedObjective[];
  suggestionsLoading?: boolean;
  hasTopics: boolean;
}

// What students should be able to do after the lesson: one row each with an optional Bloom level.
// A curriculum objective can be added with a tap; typing over it makes it the teacher's own.
export default function ObjectivesEditor({ rows, onChange, suggestions, suggestionsLoading, hasTopics }: Props) {
  return (
    <View>
      <Text style={styles.label}>Objectives</Text>
      {rows.map((r, i) => (
        <View key={r.key} style={styles.row}>
          <Input value={r.statement} onChangeText={(v) => onChange(editRow(rows, r.key, { statement: v }))}
            placeholder="Students will be able to..." accessibilityLabel={`Objective ${i + 1}`} />
          <View style={styles.line}>
            <View style={styles.bloom}>
              <Select value={r.bloom || null} placeholder="Bloom level" onChange={(v) => onChange(editRow(rows, r.key, { bloom: String(v) }))}
                options={BLOOM_LEVELS.map((b) => ({ value: b.value, label: b.label }))} />
            </View>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove objective ${i + 1}`} style={styles.remove} onPress={() => onChange(removeRow(rows, r.key))}>
              <Text style={styles.removeText}>×</Text>
            </TouchableOpacity>
          </View>
          {r.objectiveId != null ? <Text style={styles.hint}>From the curriculum</Text> : null}
        </View>
      ))}
      <Button title="+ Add objective" size="sm" variant="outline" onPress={() => onChange([...rows, newRow()])} />

      {hasTopics ? (
        <View style={styles.suggest}>
          <Text style={styles.hint}>Objectives from the chosen topics</Text>
          {suggestionsLoading ? <Text style={styles.hint}>Loading…</Text> : suggestions.length === 0 ? (
            <Text style={styles.hint}>None to add: the curriculum lists no more for these topics.</Text>
          ) : suggestions.map((o) => (
            <TouchableOpacity key={o.id} accessibilityRole="button" accessibilityLabel={`Add objective: ${o.statement}`} style={styles.chip}
              onPress={() => onChange(addSuggestion(rows, o))}>
              <Text style={styles.chipText} numberOfLines={3}>{o.statement}</Text>
              {o.bloom_level ? <StatusPill label={bloomLabel(o.bloom_level)} tone={bloomTone(o.bloom_level)} /> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  row: { marginBottom: Spacing.sm },
  line: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  bloom: { flex: 1 },
  remove: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.border },
  removeText: { fontSize: 22, color: Colors.textSecondary },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  suggest: { marginTop: Spacing.md, gap: Spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, minHeight: 44, backgroundColor: Colors.infoLight, borderRadius: BorderRadius.md, padding: Spacing.sm },
  chipText: { flex: 1, fontSize: FontSize.sm, color: Colors.infoText },
});
