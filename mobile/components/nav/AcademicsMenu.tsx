import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useNavGroups } from '../../hooks/useNavGroups';
import { academicsGroups } from '../../services/manager';
import NavGroupList from './NavGroupList';
import EmptyState from '../ui/EmptyState';
import { Colors, Spacing } from '../../constants/colors';

// The Academics tab: the role's Academics, Content Creation and Management entries.
export default function AcademicsMenu() {
  const groups = academicsGroups(useNavGroups());
  if (groups.length === 0) return <EmptyState title="Nothing here" message="No academic modules are enabled for this school." />;
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <NavGroupList groups={groups} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md, paddingBottom: Spacing.xl },
});
