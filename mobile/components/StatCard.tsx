import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import Card from './ui/Card';
import { Colors, FontSize, Spacing } from '../constants/colors';

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  color?: string;
  icon?: React.ReactNode;
  style?: ViewStyle;
}

export default function StatCard({
  title,
  value,
  subtitle,
  color = Colors.primary,
  icon,
  style,
}: StatCardProps) {
  return (
    <Card style={{ ...styles.card, ...style }}>
      <View style={styles.header}>
        {icon && (
          <View style={[styles.iconContainer, { backgroundColor: color + '15' }]}>
            {icon}
          </View>
        )}
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={[styles.value, { color }]}>{value}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 140,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    fontWeight: '500',
    flex: 1,
  },
  value: {
    fontSize: FontSize.xxl,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: Spacing.xs,
  },
});
