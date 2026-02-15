import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, BorderRadius, FontSize, Spacing } from '../../constants/colors';

type BadgeVariant = 'success' | 'error' | 'warning' | 'info' | 'default' | 'purple';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

const variantColors: Record<BadgeVariant, { bg: string; text: string }> = {
  success: { bg: Colors.successLight, text: Colors.success },
  error: { bg: Colors.errorLight, text: Colors.error },
  warning: { bg: Colors.warningLight, text: Colors.warning },
  info: { bg: Colors.infoLight, text: Colors.info },
  default: { bg: Colors.surfaceSecondary, text: Colors.textSecondary },
  purple: { bg: '#f3e8ff', text: '#7c3aed' },
};

export default function Badge({ label, variant = 'default', size = 'sm' }: BadgeProps) {
  const colors = variantColors[variant];

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.bg },
        size === 'md' && styles.badgeMd,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: colors.text },
          size === 'md' && styles.textMd,
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: BorderRadius.full,
    alignSelf: 'flex-start',
  },
  badgeMd: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  text: {
    fontSize: FontSize.xs,
    fontWeight: '600',
  },
  textMd: {
    fontSize: FontSize.sm,
  },
});
