import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Card from './ui/Card';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/colors';

interface StaffCardProps {
  id: number;
  name: string;
  department?: string;
  designation?: string;
  phone?: string;
  onPress?: (id: number) => void;
}

export default function StaffCard({
  id,
  name,
  department,
  designation,
  phone,
  onPress,
}: StaffCardProps) {
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
          {designation && <Text style={styles.designation}>{designation}</Text>}
          {department && <Text style={styles.department}>{department}</Text>}
        </View>
        {phone && <Text style={styles.phone}>{phone}</Text>}
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
    backgroundColor: Colors.secondary,
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
  designation: {
    fontSize: FontSize.xs,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  department: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    marginTop: 1,
  },
  phone: {
    fontSize: FontSize.xs,
    color: Colors.primary,
  },
});
