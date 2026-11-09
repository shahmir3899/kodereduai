import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon, { type IconName } from './ui/Icon';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/colors';
import {
  TONES, BUNDLE_PREVIEW, FOLD_CHARS, NEUTRAL_STRIPE, getEventMeta, isBundle, schoolColor, timeAgo, initials,
  type NotificationEntry, type NotificationRecord,
} from '../services/notificationMeta';

// Long bodies fold to a few lines but never lose text. The "Show more" link is rendered by the
// caller, outside the card's tap area, so tapping it never also opens the notification.
const isLong = (text: string) => text.length > FOLD_CHARS;

function Body({ text, folded, muted, small }: { text: string; folded: boolean; muted: boolean; small?: boolean }) {
  if (!text) return null;
  return <Text style={[small ? styles.bodySmall : styles.body, muted && styles.mutedText]} numberOfLines={folded ? 3 : undefined}>{text}</Text>;
}

interface Props {
  n: NotificationEntry;
  // Show the school name and colour stripe only when the person belongs to several schools.
  multiSchool?: boolean;
  onOpen?: (n: NotificationRecord) => void;
}

// One notification, or a bundle of same-day alerts listing each member with its own body so
// names and amounts stay visible. Memoised: the inbox re-renders on every tap otherwise.
function NotificationItem({ n, multiSchool, onOpen }: Props) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const meta = getEventMeta(n.event_type);
  const tone = TONES[meta.tone];
  const stripe = multiSchool ? schoolColor(n.school) : NEUTRAL_STRIPE;
  const isNew = !n.is_read;
  const when = useMemo(() => timeAgo(n.created_at), [n.created_at]);
  const bundle = isBundle(n) ? n : null;
  const single = bundle ? null : (n as NotificationRecord);
  const children = bundle ? bundle.children : [];
  const visible = open ? children : children.slice(0, BUNDLE_PREVIEW);

  const top = (
    <>
      <View style={styles.head}>
        <View style={[styles.chip, { backgroundColor: tone.bg }]}>
          <Icon name={meta.icon as IconName} size={13} color={tone.fg} />
          <Text style={[styles.chipText, { color: tone.fg }]}>{meta.label}</Text>
        </View>
        {bundle ? <Text style={[styles.count, { backgroundColor: tone.bg, color: tone.fg }]}>{bundle.count}</Text> : null}
        <View style={styles.headRight}>
          {isNew ? <Text style={styles.newPill}>NEW</Text> : null}
          <Text style={styles.time}>{when}</Text>
        </View>
      </View>

      <Text style={[styles.title, isNew ? styles.titleNew : styles.mutedText]}>{n.title || meta.label}</Text>

      {bundle && bundle.total != null ? (
        <Text style={styles.total}>
          <Text style={styles.totalNum}>Rs {bundle.total.toLocaleString('en-PK')}</Text> pending in total
        </Text>
      ) : null}

      {single ? <Body text={single.message} folded={isLong(single.message) && !more} muted={!isNew} /> : null}

      {bundle ? visible.map((c) => (
        <TouchableOpacity key={c.id} accessibilityRole="button" style={styles.member} onPress={() => onOpen?.(c)}>
          <View style={styles.memberText}>
            <Text style={[styles.memberTitle, c.is_read && styles.mutedText]}>
              {c.student_name ? `${c.student_name} · ` : ''}{c.title}
            </Text>
            <Body text={c.message} folded={false} muted={c.is_read} small />
          </View>
          {!c.is_read ? <View style={styles.dot} accessibilityLabel="Unread" /> : null}
        </TouchableOpacity>
      )) : null}

    </>
  );

  const foot = (
      <View style={styles.foot}>
        {single?.student_name ? (
          <View style={styles.student}>
            <Text style={styles.avatar}>{initials(single.student_name)}</Text>
            <Text style={styles.footText} numberOfLines={1}>{single.student_name}</Text>
          </View>
        ) : null}
        {multiSchool && n.school_name ? <Text style={styles.footText} numberOfLines={1}>{n.school_name}</Text> : null}
        {bundle && children.length > BUNDLE_PREVIEW ? (
          <TouchableOpacity accessibilityRole="button" style={styles.showAll} onPress={() => setOpen((v) => !v)}>
            <Text style={styles.showAllText}>{open ? 'Show fewer' : `Show all ${children.length}`}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
  );

  const shell = [styles.card, isNew ? styles.cardNew : styles.cardRead];
  // A single notification's top part is the tap target; "Show more" and the footer sit outside it,
  // and a bundle's members carry their own taps.
  return (
    <View style={shell}>
      <View style={[styles.stripe, { backgroundColor: stripe }]} />
      {single ? (
        <TouchableOpacity accessibilityRole="button" style={styles.tap} activeOpacity={0.7} onPress={() => onOpen?.(single)}>
          {top}
        </TouchableOpacity>
      ) : top}
      {single && isLong(single.message) ? (
        <TouchableOpacity accessibilityRole="button" onPress={() => setMore((v) => !v)} hitSlop={8}>
          <Text style={styles.link}>{more ? 'Show less' : 'Show more'}</Text>
        </TouchableOpacity>
      ) : null}
      {foot}
    </View>
  );
}

export default React.memo(NotificationItem);

const styles = StyleSheet.create({
  card: { borderRadius: BorderRadius.lg, paddingVertical: Spacing.md, paddingLeft: Spacing.lg + 4, paddingRight: Spacing.md, marginBottom: Spacing.sm, overflow: 'hidden', borderWidth: 1, gap: 6 },
  cardNew: { backgroundColor: Colors.surface, borderColor: '#bfdbfe' },
  cardRead: { backgroundColor: Colors.surfaceSecondary, borderColor: Colors.border },
  tap: { gap: 6 },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 11, fontWeight: '600' },
  count: { fontSize: FontSize.xs, fontWeight: '700', borderRadius: 8, paddingHorizontal: 6, overflow: 'hidden' },
  headRight: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  newPill: { fontSize: 9, fontWeight: '700', color: Colors.textInverse, backgroundColor: Colors.primary, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' },
  time: { fontSize: 11, color: Colors.textSecondary },
  title: { fontSize: FontSize.md, lineHeight: 21, color: Colors.text },
  titleNew: { fontWeight: '700' },
  mutedText: { color: Colors.textSecondary },
  body: { fontSize: FontSize.sm, lineHeight: 20, color: Colors.text },
  bodySmall: { fontSize: FontSize.xs, lineHeight: 17, color: Colors.textSecondary },
  link: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.primary, marginTop: 2 },
  total: { fontSize: FontSize.sm, color: Colors.text },
  totalNum: { fontSize: FontSize.lg, fontWeight: '700' },
  member: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: Colors.surfaceSecondary, borderRadius: BorderRadius.md, paddingHorizontal: 10, paddingVertical: 6 },
  memberText: { flex: 1 },
  memberTitle: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary, marginTop: 5 },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  student: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  avatar: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, textAlign: 'center', lineHeight: 18, fontSize: 9, fontWeight: '700', color: Colors.text, overflow: 'hidden' },
  footText: { fontSize: FontSize.xs, color: Colors.textSecondary, flexShrink: 1 },
  showAll: { marginLeft: 'auto', borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: 10, paddingVertical: 3 },
  showAllText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.text },
});
