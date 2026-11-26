import React from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { TAB_BUBBLE_RISE } from '../nav/FancyTabBar';
import Button from './Button';
import { Colors, FontSize, Spacing } from '../../constants/colors';

interface FormScreenProps {
  title?: string;
  children: React.ReactNode;
  submitLabel: string;
  onSubmit: () => void;
  busy?: boolean;
  disabled?: boolean;
  // One line under the fields, just above Save, so a failed save is read where the finger is.
  error?: string | null;
  // A second button beside Save (Cancel, Deactivate...).
  secondary?: { label: string; onPress: () => void; variant?: 'outline' | 'danger' | 'secondary' };
  refreshControl?: React.ReactElement<any>;
}

// The one full-page form layout: the fields scroll, and Save stays pinned at the bottom above the
// keyboard, so a long form never hides its button below the fold or under the keyboard.
// Bottom-sheet forms use FormSheet instead.
export default function FormScreen({
  title, children, submitLabel, onSubmit, busy, disabled, error, secondary, refreshControl,
}: FormScreenProps) {
  const insets = useSafeAreaInsets();
  // Inside a tab layout the bar already sits below (and covers the safe area), but its raised
  // circle pokes up into the space above it: keep Save clear of it.
  const inTabs = React.useContext(BottomTabBarHeightContext) !== undefined;
  const bottom = inTabs ? TAB_BUBBLE_RISE + Spacing.xs : insets.bottom;
  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={refreshControl}>
        {title ? <Text style={styles.title}>{title}</Text> : null}
        {children}
      </ScrollView>
      <View style={[styles.footer, { paddingBottom: Spacing.md + bottom }]}>
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
        <View style={styles.buttons}>
          {secondary ? (
            <Button title={secondary.label} variant={secondary.variant ?? 'outline'} onPress={secondary.onPress} disabled={busy} style={styles.flex} />
          ) : null}
          <Button title={submitLabel} onPress={onSubmit} loading={busy} disabled={busy || disabled} style={styles.flex} size="lg" />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  // No gap: the fields (Input, Select, Card...) carry their own spacing, as everywhere else.
  content: { padding: Spacing.lg, paddingBottom: Spacing.xl },
  title: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text, marginBottom: Spacing.lg },
  footer: {
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.sm,
    backgroundColor: Colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border,
  },
  error: { fontSize: FontSize.sm, color: Colors.error },
  buttons: { flexDirection: 'row', gap: Spacing.md },
});
