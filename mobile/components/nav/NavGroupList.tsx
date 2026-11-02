import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, usePathname, type Href } from 'expo-router';
import type { NavGroup, NavItem } from '../../navigation/navConfig';
import { groupIcon, itemIcon } from '../../navigation/navIcons';
import { ALWAYS_OPEN_MAX, plainPath } from '../../services/menuCollapse';
import Icon from '../ui/Icon';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

interface Props {
  groups: NavGroup[];
  onNavigate?: (item: NavItem) => void;
  // Pinned web paths and the star handler; without them the rows show no star.
  pinned?: string[];
  onTogglePin?: (webPath: string) => void;
  // Make the group headers collapse their rows (groups of two or fewer are never collapsed).
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
export default function NavGroupList({ groups, onNavigate, pinned, onTogglePin, isOpen, onToggleGroup }: Props) {
  const router = useRouter();
  const path = usePathname();
  const active = activeHref(groups, path);
  return (
    <>
      {groups.map((group) => {
        const collapsible = !!onToggleGroup && group.items.length > ALWAYS_OPEN_MAX;
        const open = !collapsible || (isOpen ? isOpen(group) : true);
        return (
        <View key={group.name} style={styles.group}>
          {collapsible ? (
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: open }}
              accessibilityLabel={`${group.name}, ${group.items.length} items`}
              style={styles.header} onPress={() => onToggleGroup?.(group)}>
              <View style={styles.headerLeft}>
                <Icon name={groupIcon(group.name)} size={18} color={Colors.textSecondary} />
                <Text style={styles.headerTitle}>{group.name}  ·  {group.items.length}</Text>
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
            <TouchableOpacity accessibilityRole="button"
              key={`${group.name}:${it.webPath}`}
              style={[styles.row, here && styles.rowHere]}
              disabled={!it.href}
              onPress={() => { if (!it.href) return; onNavigate?.(it); router.push(it.href as Href); }}
            >
              <Icon name={itemIcon(it.webPath)} size={20} color={tone} />
              <Text style={[styles.rowText, styles.rowName, here && styles.rowTextHere, !it.href && styles.disabled]}>{it.name}</Text>
              {!it.href && <Text style={styles.soon}>Soon</Text>}
              {it.href && onTogglePin ? (
                <TouchableOpacity accessibilityRole="button" hitSlop={8} style={styles.star}
                  accessibilityLabel={pinned?.includes(it.webPath) ? `Unpin ${it.name}` : `Pin ${it.name}`}
                  onPress={() => onTogglePin(it.webPath)}>
                  <Icon name={pinned?.includes(it.webPath) ? 'star' : 'star-outline'} size={20} color={pinned?.includes(it.webPath) ? Colors.warning : Colors.textTertiary} />
                </TouchableOpacity>
              ) : null}
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
  group: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, marginBottom: Spacing.md, overflow: 'hidden' },
  title: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, paddingBottom: Spacing.xs },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, paddingHorizontal: Spacing.md },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headerTitle: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  rowHere: { backgroundColor: Colors.infoLight },
  rowText: { fontSize: FontSize.md, color: Colors.text },
  rowTextHere: { color: Colors.primary, fontWeight: '600' },
  rowName: { flex: 1 },
  disabled: { color: Colors.textTertiary },
  star: { minWidth: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center', marginRight: -8 },
  soon: { fontSize: FontSize.xs, color: Colors.textTertiary },
});
