import React from 'react';
import { ScrollView, View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useNavGroups } from '../../hooks/useNavGroups';
import { useAppLock } from '../../contexts/AppLockContext';
import { useToast } from '../ui/Toast';
import NavGroupList from './NavGroupList';
import SchoolSwitcher from './SchoolSwitcher';
import SchoolBadge from './SchoolBadge';
import UserBadge from './UserBadge';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Everything the role may open that doesn't have its own bottom tab. Entries whose mobile
// screen isn't built yet show as "Soon", so the menu already follows the web's visibility rules.
export default function MoreScreen() {
  const auth = useAuth();
  const groups = useNavGroups();
  const lock = useAppLock();
  const toast = useToast();
  const toggleLock = async (on: boolean) => {
    const problem = await lock.setEnabled(on);
    if (problem) toast.error(problem);
    else toast.success(on ? 'App lock is on.' : 'App lock is off.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.school}>
        <UserBadge />
      </View>
      <View style={styles.school}>
        <SchoolBadge />
        <SchoolSwitcher />
      </View>
      <NavGroupList groups={groups} />
      <View style={styles.group}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.rowText}>Fingerprint or face lock</Text>
            <Text style={styles.hint}>Ask for it when the app is opened or comes back after a while.</Text>
          </View>
          <Switch value={lock.enabled} onValueChange={toggleLock} accessibilityLabel="Fingerprint or face lock" />
        </View>
      </View>
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
  flex: { flex: 1, marginRight: Spacing.md },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
});
