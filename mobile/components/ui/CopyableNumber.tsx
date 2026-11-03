import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { BorderRadius, Colors, FontSize, Spacing } from '../../constants/colors';

// A number the reader will quote elsewhere (a Kuickpay consumer number), with a Copy button. The
// text is also selectable, so a long press works if the clipboard is unavailable.
export default function CopyableNumber({ value, textStyle }: { value: string; textStyle?: TextStyle }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!value) return null;

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(value);
      setState('copied');
    } catch {
      setState('failed');
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  };

  return (
    <View style={styles.row}>
      <Text selectable style={[styles.number, textStyle]} testID="copyable-number">{value}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Copy ${value}`} style={styles.button} onPress={copy}>
        <Text style={styles.buttonText}>{state === 'copied' ? 'Copied' : state === 'failed' ? 'Hold to select' : 'Copy'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  number: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text, fontVariant: ['tabular-nums'] },
  button: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm, paddingVertical: 4, backgroundColor: Colors.surface,
  },
  buttonText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.primary },
});
