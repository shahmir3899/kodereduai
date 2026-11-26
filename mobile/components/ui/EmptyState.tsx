import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, FontSize, Spacing } from '../../constants/colors';
import Button from './Button';
import Icon, { type IconName } from './Icon';
import { emptyIconFor } from '../../services/emptyIcon';

interface EmptyStateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  // An icon name, your own element, or nothing: then one is picked from the title, so no empty
  // state is text alone. Pass `false` for none.
  icon?: React.ReactNode | IconName | false;
}

export default function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  icon,
}: EmptyStateProps) {
  return (
    <View style={styles.container}>
      {icon === false ? null : (
        <View style={styles.iconContainer}>
          {icon === undefined || typeof icon === 'string' ? (
            <View style={styles.iconCircle}>
              <Icon name={(icon as IconName | undefined) ?? emptyIconFor(title)} size={30} color={Colors.primary} />
            </View>
          ) : icon}
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
      {message && <Text style={styles.message}>{message}</Text>}
      {actionLabel && onAction && (
        <Button
          title={actionLabel}
          onPress={onAction}
          variant="outline"
          size="sm"
          style={styles.button}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxxl,
  },
  iconContainer: {
    marginBottom: Spacing.lg,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.infoLight,
  },
  title: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    color: Colors.text,
    textAlign: 'center',
  },
  message: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  button: {
    marginTop: Spacing.lg,
  },
});
