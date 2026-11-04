import React, { useEffect, useRef } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import BottomSheet from '../ui/BottomSheet';
import Button from '../ui/Button';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface FormSheetProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
  busy?: boolean;
  error?: string | null;
  // A second save that keeps the sheet open ("Add and write another"); scrollTopKey changes -> the form scrolls back up.
  secondaryLabel?: string;
  onSecondary?: () => void;
  scrollTopKey?: number;
  children: React.ReactNode;
}

// One bottom-sheet form shell for the inventory writes: fields, an inline error, one save button.
export default function FormSheet({ visible, title, onClose, onSubmit, submitLabel, busy, error, secondaryLabel, onSecondary, scrollTopKey, children }: FormSheetProps) {
  const scroller = useRef<ScrollView>(null);
  useEffect(() => { if (scrollTopKey) scroller.current?.scrollTo({ y: 0, animated: false }); }, [scrollTopKey]);
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <ScrollView ref={scroller} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {children}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <Button title={submitLabel} onPress={onSubmit} loading={busy} disabled={busy} />
        {secondaryLabel && onSecondary ? <Button title={secondaryLabel} variant="outline" onPress={onSecondary} disabled={busy} /> : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, gap: Spacing.sm },
  error: { color: Colors.error, fontSize: FontSize.sm, marginVertical: Spacing.xs },
});
