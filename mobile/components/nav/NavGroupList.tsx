import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, usePathname, type Href } from 'expo-router';
import type { NavGroup, NavItem } from '../../navigation/navConfig';
import { groupIcon, itemIcon } from '../../navigation/navIcons';
import { plainPath } from '../../services/menuCollapse';
import Icon from '../ui/Icon';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  groups: NavGroup[];
  onNavigate?: (item: NavItem) => void;
  // Make the group headers fold their rows (every group, whatever its size, so they all look alike).
  isOpen?: (group: NavGroup) => boolean;
  onToggleGroup?: (group: NavGroup) => void;
}

// The entry for the screen being shown: the longest menu path that is the current path or sits above
// it, so a detail screen still lights its list and "/finance" does not light on "/finance/accounts".
function activeHref(groups: NavGroup[], path: string): string | null {
  const here = plainPath(path);
  let best: string | null = null;
  let bestLen = -1;
  for (const g of groups) {
    for (const it of g.items) {
      if (!it.href) continue;
      const p = plainPath(it.href);
      if ((here === p || here.startsWith(`${p}/`)) && p.length > bestLen) { best = it.href; bestLen = p.length; }
    }
  }
  return best;
}

// Grouped menu rows with the web sidebar's icons; entries without a built screen show "Soon"
// (shared by More and Academics).
export default function NavGroupList({ groups, onNavigate, isOpen, onToggleGroup }: Props) {
  const router = useRouter();
  const path = usePathname();
  const active = activeHref(groups, path);
  return (
    <>
      {groups.map((group) => {
        const collapsible = !!onToggleGroup;
        const open = !collapsible || (isOpen ? isOpen(group) : true);
        return (
        <View key={group.name} style={styles.group}>
          {collapsible ? (
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }}
              accessibilityLabel={`${group.name}, ${group.items.length} items`}
              style={styles.header} onPress={() => onToggleGroup?.(group)}>
              <View style={styles.headerLeft}>
                <View style={[styles.groupIcon, open && styles.groupIconOpen]}>
                  <Icon name={groupIcon(group.name)} size={16} color={open ? Colors.primary : Colors.textSecondary} />
                </View>
                <Text style={[styles.headerTitle, open && styles.headerTitleOpen]}>{group.name}</Text>
                <Text style={styles.count}>{group.items.length}</Text>
              </View>
              <Icon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          ) : (
            <View style={styles.title}>
              <Icon name={groupIcon(group.name)} size={18} color={Colors.textSecondary} />
              <Text style={styles.headerTitle}>{group.name}</Text>
            </View>
          )}
          {open ? group.items.map((it) => {
            const here = !!it.href && it.href === active;
            const tone = !it.href ? Colors.textTertiary : here ? Colors.primary : Colors.textSecondary;
            return (
            <TouchableOpacity key={`${group.name}:${it.webPath}`} accessibilityRole="button"
              accessibilityState={{ selected: here, disabled: !it.href }}
              style={[styles.row, here && styles.rowHere]} disabled={!it.href}
              onPress={() => { if (!it.href) return; onNavigate?.(it); router.push(it.href as Href); }}
            >
              <Icon name={itemIcon(it.webPath)} size={20} color={tone} />
              <Text style={[styles.rowText, styles.rowName, here && styles.rowTextHere, !it.href && styles.disabled]}>{it.name}</Text>
              {!it.href && <Text style={styles.soon}>Soon</Text>}
            </TouchableOpacity>
            );
          }) : null}
        </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, marginBottom: Spacing.sm, overflow: 'hidden' },
  title: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, paddingBottom: Spacing.xs },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48, paddingHorizontal: Spacing.md },
  headerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  groupIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.surfaceSecondary },
  groupIconOpen: { backgroundColor: Colors.infoLight },
  headerTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  headerTitleOpen: { color: Colors.primary },
  count: { fontSize: FontSize.xs, color: Colors.textSecondary, backgroundColor: Colors.surfaceSecondary, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 4, paddingLeft: Spacing.md + 8, paddingRight: Spacing.md },
  rowHere: { backgroundColor: Colors.infoLight },
  rowText: { fontSize: FontSize.md, color: Colors.text },
  rowTextHere: { color: Colors.primary, fontWeight: '600' },
  rowName: { flex: 1 },
  disabled: { color: Colors.textTertiary },
  soon: { fontSize: FontSize.xs, color: Colors.textTertiary },
});
