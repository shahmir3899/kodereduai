import React from 'react';
import { Image, Text, View, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';

interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: number;
}

// Photo when there is one, otherwise the person's initials.
export default function Avatar({ name, uri, size = 40 }: AvatarProps) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (uri) return <Image source={{ uri }} style={box} resizeMethod="resize" accessibilityIgnoresInvertColors />;
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  return (
    <View style={[styles.fallback, box]}>
      <Text style={[styles.text, { fontSize: size * 0.4 }]}>{initials || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: Colors.infoLight, alignItems: 'center', justifyContent: 'center' },
  text: { color: Colors.primary, fontWeight: '700' },
});
