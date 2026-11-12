import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { notificationTapRoute } from '../../services/notificationRoute';
import { routeFor } from '../../navigation/routes';
import { shouldShowYearChip, unreadLabel } from '../../services/headerView';
import Icon from '../ui/Icon';
import UserBadge from './UserBadge';
import YearSheet from './YearSheet';
import { Colors, FontSize, Spacing } from '../../constants/colors';

// Academic year on staff screens. Admin, manager and finance manager can tap it to choose another year
// (amber while a past year is shown); for everyone else it is display only.
function YearChip() {
  const { current, isPast, canChoose } = useAcademicYear();
  const [open, setOpen] = useState(false);
  if (!current) return null;
  const chip = (
    <View style={[styles.chip, isPast && styles.chipPast]} accessible accessibilityLabel={`Academic year ${current.name}${isPast ? ', a past year' : ''}`}>
      <Text style={[styles.chipText, isPast && styles.chipTextPast]} numberOfLines={1}>{current.name}{canChoose ? ' ▾' : ''}</Text>
    </View>
  );
  if (!canChoose) return chip;
  return (
    <>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Academic year ${current.name}. Change`} hitSlop={8} onPress={() => setOpen(true)}>{chip}</TouchableOpacity>
      <YearSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Opens the person's notifications inbox; the badge is the unread count.
function NotificationBell() {
  const { persona } = useAuth();
  const { unreadCount } = useNotifications();
  const router = useRouter();
  const label = unreadLabel(unreadCount);
  return (
    <TouchableOpacity accessibilityRole="button" style={styles.bell} onPress={() => router.push(notificationTapRoute(persona, null) as never)}
      accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}>
      <Icon name="notifications-outline" size={22} color={Colors.text} />
      {label ? <View style={styles.badge}><Text style={styles.badgeText}>{label}</Text></View> : null}
    </TouchableOpacity>
  );
}

// Right side of every tab header: year (staff only), notifications, then the user's own photo.
// The year list is not readable by parents, students and drivers, so they do not get the chip.
export default function HeaderActions() {
  const { persona, isModuleEnabled } = useAuth();
  return (
    <View style={styles.row}>
      {shouldShowYearChip(persona) ? <YearChip /> : null}
      {isModuleEnabled('notifications') && routeFor(persona, '/notifications') ? <NotificationBell /> : null}
      <UserBadge compact />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: { backgroundColor: Colors.infoLight, borderRadius: 12, paddingHorizontal: Spacing.sm, paddingVertical: 2, marginRight: Spacing.xs, maxWidth: 130 },
  chipPast: { backgroundColor: Colors.warningLight },
  chipTextPast: { color: Colors.warningText },
  chipText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.infoText },
  bell: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: Colors.errorText, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: Colors.textInverse, fontSize: 10, fontWeight: '700' },
});
