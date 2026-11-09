import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import { themeFor } from '../../services/assistantTheme';
import type { Step } from '../../services/assistantState';

function StepLine({ step, showAgent }: { step: Step; showAgent: boolean }) {
  const theme = themeFor(step.sub_agent);
  const mark = step.status === 'running' ? '…' : step.status === 'ok' ? '✓' : '!';
  const tone = step.status === 'failed' ? Colors.error : step.status === 'ok' ? Colors.success : Colors.textTertiary;
  return (
    <View style={styles.line} accessibilityLabel={`${step.label || step.name}, ${step.status === 'ok' ? 'done' : step.status === 'failed' ? 'failed' : 'working'}`}>
      <View style={[styles.dot, { backgroundColor: theme.ring }]} />
      <Text style={[styles.mark, { color: tone }]}>{mark}</Text>
      <Text style={styles.label}>{step.label || step.name.replace(/_/g, ' ')}{showAgent && step.sub_agent ? ` · ${theme.label}` : ''}</Text>
    </View>
  );
}

/** Live while Aura works; after the answer it folds into one line the person can open. */
export default function StepTrail({ steps, agents = [], live = false }: { steps: Step[]; agents?: string[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!steps.length && !live) return null;
  const several = new Set(steps.map((s) => s.sub_agent)).size > 1;

  if (live) {
    const names = agents.map((a) => themeFor(a).label).join(', ');
    return (
      <View style={styles.box} accessibilityLiveRegion="polite">
        <Text style={styles.head}>{steps.length ? 'Working on it' : 'Thinking'}{names ? ` · ${names}` : ''}</Text>
        {steps.map((s) => <StepLine key={s.index} step={s} showAgent={several} />)}
      </View>
    );
  }

  const failed = steps.filter((s) => s.status === 'failed').length;
  return (
    <View style={styles.folded}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${steps.length} steps, ${open ? 'hide' : 'show'}`} accessibilityState={{ expanded: open }} onPress={() => setOpen((o) => !o)} hitSlop={8}>
        <Text style={styles.toggle}>{steps.length} step{steps.length === 1 ? '' : 's'}{failed ? ` · ${failed} failed` : ''} {open ? '▴' : '▾'}</Text>
      </Pressable>
      {open && steps.map((s) => <StepLine key={s.index} step={s} showAgent={several} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.sm },
  head: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginBottom: Spacing.xs },
  folded: { marginBottom: Spacing.xs },
  toggle: { fontSize: FontSize.xs, color: Colors.textSecondary, paddingVertical: Spacing.xs },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  mark: { width: 14, textAlign: 'center', fontSize: FontSize.sm },
  label: { flex: 1, fontSize: FontSize.xs, color: Colors.textSecondary },
});
