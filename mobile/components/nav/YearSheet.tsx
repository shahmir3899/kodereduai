import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import BottomSheet from '../ui/BottomSheet';
import Badge from '../ui/Badge';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Pick the academic year to look at (admin, manager and accountant). The choice is kept per person
// and school; attendance and fee collection ignore it and always use the current year.
export default function YearSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { years, current, actual, isPast, choose } = useAcademicYear();
  const pick = (id: number) => { choose(id === actual?.id ? null : id); onClose(); };
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Academic year">
      <ScrollView>
        {years.map((y) => {
          const selected = y.id === current?.id;
          return (
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected }} key={y.id}
              style={[styles.row, selected && styles.rowOn]} onPress={() => pick(y.id)}>
              <Text style={[styles.name, selected && styles.nameOn]}>{y.name}</Text>
              {y.id === actual?.id ? <Badge label="Current" variant="success" /> : null}
              {selected ? <Text style={styles.tick}>✓</Text> : null}
            </TouchableOpacity>
          );
        })}
        {years.length === 0 ? <Text style={styles.note}>No academic years yet.</Text> : null}
        {isPast ? (
          <View style={styles.warn}>
            <Text style={styles.warnText}>You are looking at a past year. Attendance and fee collection always use the current year.</Text>
          </View>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52, paddingHorizontal: Spacing.lg },
  rowOn: { backgroundColor: Colors.infoLight },
  name: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  nameOn: { color: Colors.primary, fontWeight: '600' },
  tick: { fontSize: FontSize.lg, color: Colors.primary, fontWeight: '700' },
  note: { padding: Spacing.lg, color: Colors.textSecondary },
  warn: { margin: Spacing.lg, padding: Spacing.md, backgroundColor: Colors.warningLight, borderRadius: 8 },
  warnText: { fontSize: FontSize.sm, color: Colors.warningText },
});
