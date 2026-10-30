import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useNavGroups } from '../../hooks/useNavGroups';
import NavGroupList from './NavGroupList';
import SchoolSwitcher from './SchoolSwitcher';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Everything the role may open that doesn't have its own bottom tab. Entries whose mobile
// screen isn't built yet show as "Soon", so the menu already follows the web's visibility rules.
export default function MoreScreen() {
  const auth = useAuth();
  const groups = useNavGroups();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.school}>
        <SchoolSwitcher />
      </View>
      <NavGroupList groups={groups} />
      <View style={styles.group}>
        <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={auth.logout}>
          <Text style={[styles.rowText, { color: Colors.error }]}>Log out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl },
  school: { marginBottom: Spacing.md },
  group: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, marginBottom: Spacing.md, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  rowText: { fontSize: FontSize.md, color: Colors.text },
});
