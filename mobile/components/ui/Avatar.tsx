import React, { useEffect, useState } from 'react';
import { Image, Text, View, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';

interface AvatarProps {
  name: string;
  uri?: string | null;
  size?: number;
}

// Photo when there is one, otherwise the person's initials. A photo that fails to load (a deleted
// file, a dead link) falls back to the initials instead of leaving an empty circle.
export default function Avatar({ name, uri, size = 40 }: AvatarProps) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  if (uri && !failed) return <Image source={{ uri }} style={box} resizeMethod="resize" onError={() => setFailed(true)} accessibilityIgnoresInvertColors />;
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
