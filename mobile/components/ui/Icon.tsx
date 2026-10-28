import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

export default function Icon({ name, size = 22, color = Colors.text }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}
