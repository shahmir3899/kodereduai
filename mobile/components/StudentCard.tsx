import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Card from './ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/colors';

interface StudentCardProps {
  id: number;
  name: string;
  class_name: string;
  roll_number: string;
  profile_photo_url?: string | null;
  onPress?: (id: number) => void;
}

export default function StudentCard({
  id,
  name,
  class_name,
  roll_number,
  onPress,
}: StudentCardProps) {
  return (
    <TouchableOpacity onPress={() => onPress?.(id)} activeOpacity={0.7}>
      <Card style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.detail}>
            {class_name} | Roll #{roll_number}
          </Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Card>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  avatarText: {
    fontSize: FontSize.lg,
    fontWeight: '700',
    color: Colors.textInverse,
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: FontSize.md,
    fontWeight: '600',
    color: Colors.text,
  },
  detail: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    color: Colors.textTertiary,
  },
});
