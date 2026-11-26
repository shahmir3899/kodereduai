import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Avatar from './Avatar';
import Card from './Card';
import Icon, { type IconName } from './Icon';
import StatusPill from './StatusPill';
import { Colors, FontSize, Spacing } from '../../constants/colors';

type Tone = React.ComponentProps<typeof StatusPill>['tone'];

interface RecordCardProps {
  title: string;
  subtitle?: string;
  // A second, smaller line (department, phone, fee line).
  meta?: string;
  // Photo when there is one, otherwise initials; leave out `name` to hide the avatar.
  avatarName?: string;
  avatarUri?: string | null;
  // For records that are not people (a leave request, a book): an icon in a tinted circle.
  icon?: IconName;
  status?: { label: string; tone?: Tone };
  // Right-hand text such as an amount or a time; shown under the status pill.
  trailing?: string;
  // Colour for `trailing` (a red balance, a green stock-in); a Colors value.
  trailingColor?: string;
  // Lists that pick several rows (bulk pay, convert enquiries): a tick box on the left. Leave
  // undefined for no box. With `onSelect` the box is its own button, so a tap on the row can still
  // open it; without it the box only shows the state and the row's onPress does the toggling.
  selected?: boolean;
  onSelect?: () => void;
  // A red count (unread messages); 0 or nothing shows none. Also makes the title bold.
  badge?: number;
  // Extra content under the row (remarks, a Return or Cancel button). It sits outside the row's
  // button, so it can hold buttons of its own (a button inside a button is invalid on the web).
  footer?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}

// The one list-row card for people and records: avatar or icon, title and subtitle, status pill,
// optional right-hand text and footer. Mirrors the web's RecordCard so lists look the same in both apps.
export default function RecordCard({
  title, subtitle, meta, avatarName, avatarUri, icon, status, trailing, trailingColor, badge, footer, onPress, accessibilityLabel, selected, onSelect,
}: RecordCardProps) {
  const selectable = selected !== undefined;
  const row = (
    <View style={styles.row}>
      {avatarName ? <Avatar name={avatarName} uri={avatarUri} size={44} /> : icon ? (
        <View style={styles.icon}><Icon name={icon} size={22} color={Colors.primary} /></View>
      ) : null}
      <View style={styles.info}>
        <Text style={[styles.title, !!badge && styles.bold]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, !!badge && styles.unreadText]} numberOfLines={1}>{subtitle}</Text> : null}
        {meta ? <Text style={styles.meta} numberOfLines={2}>{meta}</Text> : null}
      </View>
      {status || trailing || badge ? (
        <View style={styles.right}>
          {status ? <StatusPill label={status.label} tone={status.tone} /> : null}
          {trailing ? <Text style={[styles.trailing, trailingColor ? { color: trailingColor } : null]}>{trailing}</Text> : null}
          {badge ? <View style={styles.badge}><Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
        </View>
      ) : null}
      {onPress && !selectable ? <Text style={styles.chevron} accessible={false}>›</Text> : null}
    </View>
  );
  const box = <View style={[styles.box, selected && styles.boxOn]}>{selected ? <Icon name="checkmark" size={16} color={Colors.textInverse} /> : null}</View>;
  const main = onPress ? (
    <TouchableOpacity
      accessibilityRole={selectable && !onSelect ? 'checkbox' : 'button'}
      accessibilityState={selectable && !onSelect ? { checked: !!selected } : undefined}
      accessibilityLabel={accessibilityLabel ?? title} onPress={onPress} activeOpacity={0.7}>
      {row}
    </TouchableOpacity>
  ) : row;
  return (
    <Card style={selected ? { ...styles.card, ...styles.cardSelected } : styles.card}>
      {selectable ? (
        <View style={styles.selectRow}>
          {onSelect ? (
            <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: !!selected }} accessibilityLabel={`Select ${title}`}
              onPress={onSelect} style={styles.boxHit}>{box}</TouchableOpacity>
          ) : <View style={styles.boxHit}>{box}</View>}
          <View style={styles.info}>{main}</View>
        </View>
      ) : main}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.sm },
  cardSelected: { borderWidth: 1, borderColor: Colors.primary },
  selectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  boxHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 56 },
  icon: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.infoLight, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1 },
  title: { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  bold: { fontWeight: '700' },
  subtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  unreadText: { color: Colors.text, fontWeight: '600' },
  meta: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
  trailing: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: Colors.textInverse, fontSize: FontSize.xs, fontWeight: '700' },
  chevron: { fontSize: FontSize.xl, color: Colors.textTertiary },
  footer: { marginTop: Spacing.sm, paddingTop: Spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, gap: Spacing.xs },
});
