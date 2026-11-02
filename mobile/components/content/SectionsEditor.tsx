import React from 'react';
import { Switch, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import {
  allocatedMarks, autoDistribution, isChoice, makeDivider, makeSection, moveSection, SECTION_TYPES, setChoice, setSlotsCounted, setSlotsShown,
  type Section,
} from '../../services/paperBuilder';
import { typeLabel } from '../../services/questionBank';
import Button from '../ui/Button';
import Input from '../ui/Input';
import Select from '../ui/Select';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  sections: Section[];
  onChange: (next: Section[]) => void;
  // How many questions or items sit in a section, and what to do when a section is removed (its items stay, unassigned or dropped).
  placed: (key: string) => number;
  onRemove: (key: string) => void;
  noun: 'paper' | 'worksheet';
  // With a total, the header shows the allocated marks and "Standard layout" can spread that many marks.
  standardTotal?: number;
}

// The section structure shared by the paper builder and the worksheet builder (the web's PaperStructureBuilder): question
// groups with "attempt any N" choices, and printed dividers.
export default function SectionsEditor({ sections, onChange, placed, onRemove, noun, standardTotal }: Props) {
  const update = (key: string, fn: (s: Section) => Section) => onChange(sections.map((s) => (s.key === key ? fn(s) : s)));
  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>Sections{standardTotal != null ? ` · ${allocatedMarks(sections)} marks` : ''}</Text>
      <Text style={styles.sub}>Optional. Sections print the {noun} as Question 1, 2, 3… with "attempt any N" choices. Without them the {noun} is one list.</Text>
      {sections.map((s, i) => (
        <View key={s.key} style={styles.card}>
          {s.type === 'divider' ? (
            <Input label="Divider (printed heading)" value={s.title} onChangeText={(v) => update(s.key, (x) => ({ ...x, title: v }))} />
          ) : (
            <>
              <Input label="Title" value={s.title} onChangeText={(v) => update(s.key, (x) => ({ ...x, title: v }))} />
              <Select label="Question type" value={s.question_type} onChange={(v) => update(s.key, (x) => ({ ...x, question_type: v }))}
                options={SECTION_TYPES.map((t) => ({ value: t, label: typeLabel(t) }))} />
              <View style={styles.row}>
                <View style={styles.col}><Input label="Questions shown" value={String(s.slotsShown)} onChangeText={(v) => update(s.key, (x) => setSlotsShown(x, v))} keyboardType="number-pad" /></View>
                <View style={styles.col}><Input label="Marks each" value={String(s.marksPerQuestion)} onChangeText={(v) => update(s.key, (x) => ({ ...x, marksPerQuestion: Number(v) || 0 }))} keyboardType="decimal-pad" /></View>
              </View>
              <View style={styles.row}>
                <Text style={[styles.sub, styles.col]}>Student chooses which to attempt</Text>
                <Switch value={isChoice(s)} onValueChange={(on) => update(s.key, (x) => setChoice(x, on))} accessibilityLabel="Student chooses which questions to attempt" />
              </View>
              {isChoice(s) ? <Input label="Questions to attempt" value={String(s.slotsCounted)} onChangeText={(v) => update(s.key, (x) => setSlotsCounted(x, v))} keyboardType="number-pad" /> : null}
              <Input label="Instruction (optional)" value={s.instruction} onChangeText={(v) => update(s.key, (x) => ({ ...x, instruction: v, autoInstruction: false }))} />
              <Text style={styles.sub}>{placed(s.key)} of {s.slotsShown} questions placed here</Text>
            </>
          )}
          <View style={styles.actions}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move section up" style={styles.btn} onPress={() => onChange(moveSection(sections, i, -1))}><Text style={styles.btnText}>↑</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Move section down" style={styles.btn} onPress={() => onChange(moveSection(sections, i, 1))}><Text style={styles.btnText}>↓</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Remove section" style={styles.btn} onPress={() => onRemove(s.key)}><Text style={[styles.btnText, { color: Colors.error }]}>✕</Text></TouchableOpacity>
          </View>
        </View>
      ))}
      <View style={styles.row}>
        <Button title="+ Section" size="sm" variant="outline" onPress={() => onChange([...sections, makeSection(sections.filter((x) => x.type !== 'divider').length)])} />
        <Button title="+ Divider" size="sm" variant="outline" onPress={() => onChange([...sections, makeDivider(sections.filter((x) => x.type === 'divider').length)])} />
        {standardTotal != null ? <Button title="Standard layout" size="sm" variant="ghost" onPress={() => onChange(autoDistribution(standardTotal))} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  heading: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.md },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  card: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  col: { flex: 1, minWidth: 120 },
  actions: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.xs },
  btn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: FontSize.lg, color: Colors.primary },
});
