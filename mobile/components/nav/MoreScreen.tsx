import React, { useMemo, useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { useAuth } from '../../contexts/AuthContext';
import { useNavGroups } from '../../hooks/useNavGroups';
import { useAppLock } from '../../contexts/AppLockContext';
import { useToast } from '../ui/Toast';
import NavGroupList from './NavGroupList';
import SearchBar from '../ui/SearchBar';
import { useMenuCollapse } from '../../hooks/useMenuCollapse';
import { filterGroups } from '../../services/menuSearch';
import Icon from '../ui/Icon';
import SchoolBlock from './SchoolBlock';
import YearRow from './YearRow';
import UserBadge from './UserBadge';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Everything the role may open that doesn't have its own bottom tab. Entries whose mobile
// screen isn't built yet show as "Soon", so the menu already follows the web's visibility rules.
// The menu body is shared with the side panel (components/nav/SideMenu.tsx).
export function MoreContent() {
  const auth = useAuth();
  const groups = useNavGroups();
  const lock = useAppLock();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const collapse = useMenuCollapse(query.trim().length > 0);
  const searching = query.trim().length > 0;
  const shown = useMemo(() => filterGroups(groups, query), [groups, query]);
  const toggleLock = async (on: boolean) => {
    const problem = await lock.setEnabled(on);
    if (problem) toast.error(problem);
    else toast.success(on ? 'App lock is on.' : 'App lock is off.');
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={styles.container} contentContainerStyle={styles.content}>
      {/* One card for who and where: the person, the school and the year. */}
      <View style={styles.headerCard}>
        <View style={styles.user}><UserBadge /></View>
        <View style={styles.divider} />
        <SchoolBlock />
        <YearRow />
      </View>
      <View style={styles.search}>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search the menu" />
      </View>
      {searching && shown.length === 0 ? <Text style={styles.none}>Nothing in the menu matches "{query.trim()}".</Text> : null}
      <NavGroupList groups={shown} isOpen={collapse.isOpen} onToggleGroup={collapse.toggle} />
      <View style={styles.footer}>
        <View style={styles.row}>
          <Icon name="finger-print-outline" size={20} color={Colors.textSecondary} />
          <View style={styles.flex}>
            <Text style={styles.rowText}>Fingerprint or face lock</Text>
            <Text style={styles.hint}>Ask for it when the app is opened or comes back after a while.</Text>
          </View>
          <Switch value={lock.enabled} onValueChange={toggleLock} accessibilityLabel="Fingerprint or face lock" />
        </View>
        <View style={styles.divider} />
        <TouchableOpacity accessibilityRole="button" style={styles.row} onPress={auth.logout}>
          <Icon name="log-out-outline" size={20} color={Colors.error} />
          <Text style={[styles.rowText, styles.flex, { color: Colors.error }]}>Log out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default function MoreScreen() {
  return <MoreContent />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl },
  headerCard: { backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, marginBottom: Spacing.md, overflow: 'hidden' },
  user: { padding: Spacing.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginHorizontal: Spacing.md },
  search: { marginBottom: Spacing.md },
  footer: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, marginTop: Spacing.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  rowText: { fontSize: FontSize.md, color: Colors.text },
  flex: { flex: 1 },
  none: { textAlign: 'center', color: Colors.textSecondary, fontSize: FontSize.sm, marginBottom: Spacing.md },
  hint: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
});
