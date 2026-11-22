import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import BottomSheet from '../../ui/BottomSheet';
import Icon from '../../ui/Icon';
import { useExplainer } from '../../../hooks/useTeacherPerformance';
import type { Win } from '../../../services/teacherPerformance';
import { Colors, FontSize, Spacing } from '../../../constants/colors';

// Phones have no hover, so the info button opens a bottom sheet (the web uses a popover). The text
// comes from the explainer endpoint, built from the school's own settings.
export default function PerformanceInfoButton({ measure, wins, label = 'How the score works' }: {
  measure?: string; wins?: Win[]; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = useExplainer(open);
  const measures = q.data?.measures ?? [];
  const shown = measure ? measures.filter((m) => m.key === measure) : measures;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Icon name="information-circle-outline" size={20} color={Colors.textSecondary} />
      </TouchableOpacity>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={measure ? shown[0]?.label ?? 'How it is scored' : 'How the score works'}>
        <ScrollView contentContainerStyle={styles.body}>
          {q.isLoading || !q.data ? (
            <Text style={styles.muted}>{q.isError ? 'Could not load the rules.' : 'Loading…'}</Text>
          ) : (
            <>
              {!measure && q.data.general.map((line) => <Text key={line} style={styles.bullet}>• {line}</Text>)}
              {shown.map((m) => (
                <View key={m.key} style={styles.rule}>
                  <Text style={styles.ruleTitle}>{m.label} <Text style={styles.muted}>· weight {Number(m.weight)}</Text></Text>
                  <Text style={styles.text}>{m.rule}</Text>
                </View>
              ))}
              {!measure && q.data.bands.length > 0 && (
                <Text style={[styles.muted, styles.gap]}>Bands: {q.data.bands.map((b) => `${b.label} ${b.min}+`).join(' · ')}</Text>
              )}
              {wins && wins.length > 0 && (
                <View style={styles.gap}>
                  <Text style={styles.ruleTitle}>Quickest wins</Text>
                  {wins.map((w) => <Text key={w.key} style={styles.bullet}>• {w.label}: up to {w.points_available} points</Text>)}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </BottomSheet>
    </>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  bullet: { fontSize: FontSize.sm, color: Colors.text, marginBottom: Spacing.xs },
  rule: { marginTop: Spacing.md },
  ruleTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  text: { fontSize: FontSize.sm, color: Colors.text, marginTop: 2 },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  gap: { marginTop: Spacing.md },
});
