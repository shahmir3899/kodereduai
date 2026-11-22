import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import BottomSheet from '../../ui/BottomSheet';
import SearchBar from '../../ui/SearchBar';
import Button from '../../ui/Button';
import { pickerGroups, type Registry } from '../../../services/shared/blockDocument';
import { Colors, FontSize, Spacing, BorderRadius } from '../../../constants/colors';

interface Props {
  visible: boolean;
  onClose: () => void;
  registry: Registry;
  early?: boolean;
  used?: string[];
  layout?: boolean;
  /** Structure: tap several types (each tap one more), then add them all as rows. */
  multiple?: boolean;
  onPick?: (type: string) => void;
  onAddMany?: (picked: Array<{ type: string; count: number }>) => void;
}

// The phone's question type picker, the same groups and order as the web's (blocks/TypePicker.jsx): grouped by what
// the teacher wants to ask, the types already in the paper first, early-years groups first for the youngest classes.
export default function TypePickerSheet({ visible, onClose, registry, early = false, used = [], layout = true, multiple = false, onPick, onAddMany }: Props) {
  const [search, setSearch] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const sections = useMemo(() => pickerGroups(registry, { early, used, search, layout }), [registry, early, used, search, layout]);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const close = () => { setSearch(''); setCounts({}); onClose(); };
  const tap = (type: string) => {
    if (!multiple) { onPick?.(type); close(); return; }
    setCounts((prev) => ({ ...prev, [type]: (prev[type] ?? 0) + 1 }));
  };
  const addAll = () => {
    const order = [...new Set(sections.flatMap((s) => s.types.map((t) => t.type)))];
    onAddMany?.(order.filter((type) => (counts[type] ?? 0) > 0).map((type) => ({ type, count: counts[type] })));
    close();
  };

  return (
    <BottomSheet visible={visible} onClose={close} title={multiple ? 'Add questions' : 'Add a question'}>
      <View style={styles.body}>
        <SearchBar value={search} onChangeText={setSearch} placeholder="Search: match, count, essay…" />
        {multiple ? <Text style={styles.sub}>Tap a type once for each question you want.</Text> : null}
        <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
          {sections.length === 0 ? <Text style={styles.sub}>No question type matches “{search}”.</Text> : null}
          {sections.map((section) => (
            <View key={section.id} style={styles.section}>
              <Text style={styles.label} accessibilityRole="header">{section.label}</Text>
              {section.types.map((spec) => {
                const n = counts[spec.type] ?? 0;
                return (
                  <View key={`${section.id}-${spec.type}`} style={[styles.card, n > 0 && styles.cardOn]}>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${spec.label}${n ? `, ${n} chosen` : ''}`} style={styles.cardBody} onPress={() => tap(spec.type)}>
                      <Text style={styles.title}>{spec.label}</Text>
                      {spec.hint ? <Text style={styles.sub}>{String(spec.hint)}</Text> : null}
                    </TouchableOpacity>
                    {n > 0 ? (
                      <View style={styles.count}>
                        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`One less ${spec.label}`} style={styles.less}
                          onPress={() => setCounts((prev) => ({ ...prev, [spec.type]: Math.max(0, n - 1) }))}>
                          <Text style={styles.lessText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.countText}>×{n}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
        {multiple ? <Button title={total ? `Add ${total} row${total === 1 ? '' : 's'}` : 'Add rows'} disabled={!total} onPress={addAll} /> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  list: { maxHeight: 460 },
  section: { gap: Spacing.xs, marginBottom: Spacing.md },
  label: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  title: { fontSize: FontSize.md, color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary },
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm, backgroundColor: Colors.surface },
  cardOn: { borderColor: Colors.primary, backgroundColor: Colors.infoLight },
  cardBody: { flex: 1, padding: Spacing.sm, minHeight: 44, gap: 2 },
  count: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, paddingRight: Spacing.sm },
  less: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  lessText: { fontSize: FontSize.lg, color: Colors.primary },
  countText: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
});
