import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import Avatar from '../ui/Avatar';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// The active school's logo, so the app looks like the school's own. `compact` is the small logo in
// the screen header; the default adds the school's name (the top of More). A school with no logo
// shows nothing in the header and its initials in the larger badge.
export default function SchoolBadge({ compact = false }: { compact?: boolean }) {
  const { activeSchool, user } = useAuth();
  const name = activeSchool?.name || user?.school_name || '';
  const logo = activeSchool?.logo ?? null;
  if (compact) {
    return logo ? <View style={styles.compact}><Avatar name={name || 'School'} uri={logo} size={30} /></View> : null;
  }
  if (!name) return null;
  return (
    <View style={styles.row} accessible accessibilityLabel={`School: ${name}`}>
      <Avatar name={name} uri={logo} size={48} />
      <Text style={styles.name} numberOfLines={2}>{name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  compact: { marginRight: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  name: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
});
