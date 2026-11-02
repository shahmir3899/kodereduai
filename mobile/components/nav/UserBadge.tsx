import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { displayName } from '../../services/profile';
import Avatar from '../ui/Avatar';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The signed-in person: their own photo (initials when there is none), and a tap opens their profile.
// `compact` is the small avatar in the screen header; the default adds the name and role (top of More).
export default function UserBadge({ compact = false }: { compact?: boolean }) {
  const { user, persona } = useAuth();
  const router = useRouter();
  if (!user) return null;
  const name = displayName(user);
  const open = () => router.push(`/(${persona})/my-profile` as never);
  if (compact) {
    return (
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`My profile, ${name}`} onPress={open} style={styles.compact}>
        <Avatar name={name} uri={user.profile_photo_url} size={32} />
      </TouchableOpacity>
    );
  }
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`My profile, ${name}`} onPress={open} style={styles.row}>
      <Avatar name={name} uri={user.profile_photo_url} size={56} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.role} numberOfLines={1}>{user.role_display || user.role}</Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  compact: { marginRight: Spacing.md, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56 },
  text: { flex: 1 },
  name: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  role: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
});
