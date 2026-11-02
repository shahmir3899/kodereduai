import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { SchoolSwitchSheet } from './SchoolSwitcher';
import Avatar from '../ui/Avatar';
import Icon from '../ui/Icon';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The active school at the top of the side menu: logo and name, and for someone with more than one
// school a visible "Switch school" row that opens the switcher. With one school it is just the name.
export default function SchoolBlock() {
  const { user, activeSchool } = useAuth();
  const [open, setOpen] = useState(false);
  const name = activeSchool?.name || user?.school_name || '';
  if (!name) return null;
  const many = (user?.schools ?? []).length > 1;
  const body = (
    <>
      <Avatar name={name} uri={activeSchool?.logo ?? null} size={44} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>{name}</Text>
        {many ? <Text style={styles.switch}>Switch school</Text> : null}
      </View>
      {many ? <Icon name="swap-horizontal-outline" size={22} color={Colors.primary} /> : null}
    </>
  );
  return many ? (
    <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`School: ${name}. Switch school`} style={styles.row} onPress={() => setOpen(true)}>
        {body}
      </TouchableOpacity>
      <SchoolSwitchSheet visible={open} onClose={() => setOpen(false)} />
    </>
  ) : (
    <View style={styles.row} accessible accessibilityLabel={`School: ${name}`}>{body}</View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56, backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  text: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  switch: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: '600', marginTop: 2 },
});
