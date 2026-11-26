import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon, { type IconName } from './Icon';
import { Colors, FontSize, Spacing } from '../../constants/colors';

export interface ActionTileItem {
  label: string;
  icon: IconName;
  onPress?: () => void;
  // A red count on the tile (things waiting); 0 or nothing shows none.
  badge?: number;
  accessibilityLabel?: string;
}

// Round icon tiles, four to a row, for quick actions and a record's shortcuts. With `collapseAfter`
// only that many show, the last slot becoming "More" until it is tapped.
export default function TileGrid({ items, collapseAfter }: { items: ActionTileItem[]; collapseAfter?: number }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const folded = !!collapseAfter && !open && items.length > collapseAfter;
  const shown = folded ? items.slice(0, collapseAfter - 1) : items;
  return (
    <View style={styles.grid}>
      {shown.map((it) => <ActionTile key={it.label} {...it} />)}
      {folded ? <ActionTile label="More" icon="ellipsis-horizontal" onPress={() => setOpen(true)} accessibilityLabel={`More, ${items.length - shown.length} more`} /> : null}
    </View>
  );
}

export function ActionTile({ label, icon, onPress, badge, accessibilityLabel }: ActionTileItem) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? (badge ? `${label}, ${badge} waiting` : label)}
      disabled={!onPress} onPress={onPress} activeOpacity={0.7} style={[styles.tile, !onPress && styles.off]}>
      <View style={styles.circle}>
        <Icon name={icon} size={22} color={Colors.primary} />
        {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
      </View>
      <Text style={styles.label} numberOfLines={2}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.md },
  tile: { width: '25%', alignItems: 'center', paddingHorizontal: 2, minHeight: 44 },
  off: { opacity: 0.45 },
  circle: { width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.infoLight, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: -2, right: -4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: Colors.errorText, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: Colors.textInverse, fontSize: FontSize.xxs, fontWeight: '700' },
  label: { fontSize: FontSize.xs, color: Colors.text, textAlign: 'center', marginTop: 6 },
});
