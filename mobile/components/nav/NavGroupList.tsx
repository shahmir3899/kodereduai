import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import type { NavGroup } from '../../navigation/navConfig';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Grouped menu rows; entries without a built screen show "Soon" (shared by More and Academics).
export default function NavGroupList({ groups }: { groups: NavGroup[] }) {
  const router = useRouter();
  return (
    <>
      {groups.map((group) => (
        <View key={group.name} style={styles.group}>
          <Text style={styles.groupTitle}>{group.name}</Text>
          {group.items.map((it) => (
            <TouchableOpacity
              key={`${group.name}:${it.webPath}`}
              style={styles.row}
              disabled={!it.href}
              onPress={() => it.href && router.push(it.href as Href)}
            >
              <Text style={[styles.rowText, !it.href && styles.disabled]}>{it.name}</Text>
              {!it.href && <Text style={styles.soon}>Soon</Text>}
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  group: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, marginBottom: Spacing.md, overflow: 'hidden' },
  groupTitle: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', padding: Spacing.md, paddingBottom: Spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md },
  rowText: { fontSize: FontSize.md, color: Colors.text },
  disabled: { color: Colors.textTertiary },
  soon: { fontSize: FontSize.xs, color: Colors.textTertiary },
});
