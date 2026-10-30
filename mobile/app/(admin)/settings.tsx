import React from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { allowableRoles } from '../../services/schoolUsers';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// The two tabs of the web Settings page: School profile, and Users and roles.
export default function Settings() {
  const router = useRouter();
  const { effectiveRole, isSuperAdmin } = useAuth();
  const canManageUsers = !isSuperAdmin && allowableRoles(effectiveRole).length > 0;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {canManageUsers ? (
        <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => router.push('/(admin)/users' as Href)}>
          <View style={styles.who}>
            <Text style={styles.name}>Users and roles</Text>
            <Text style={styles.sub}>Add users, change roles, deactivate, reset passwords</Text>
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      ) : null}
      <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={() => router.push('/(admin)/school-profile' as Href)}>
        <View style={styles.who}>
          <Text style={styles.name}>School profile</Text>
          <Text style={styles.sub}>Logo, letterhead, time zone, exam and attendance settings</Text>
        </View>
        <Text style={styles.arrow}>›</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, gap: Spacing.md, minHeight: 64 },
  who: { flex: 1 },
  name: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  sub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  arrow: { fontSize: FontSize.xl, color: Colors.textTertiary },
});
