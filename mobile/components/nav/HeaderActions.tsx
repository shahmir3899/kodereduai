import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { useAcademicYear } from '../../hooks/useAcademicYear';
import { notificationTapRoute } from '../../services/notificationRoute';
import { routeFor } from '../../navigation/routes';
import { shortYearLabel, shouldShowYearChip, unreadLabel } from '../../services/headerView';
import { isActiveJob, jobsChipLabel } from '../../services/backgroundJobs';
import { useMyJobs } from '../../hooks/useMyJobs';
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
      <Text style={[styles.chipText, isPast && styles.chipTextPast]} numberOfLines={1}>{shortYearLabel(current.name)}{canChoose ? ' ▾' : ''}</Text>
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
function NotificationBell({ light = false }: { light?: boolean }) {
  const { persona } = useAuth();
  const { unreadCount } = useNotifications();
  const router = useRouter();
  const label = unreadLabel(unreadCount);
  return (
    <TouchableOpacity accessibilityRole="button" style={styles.bell} onPress={() => router.push(notificationTapRoute(persona, null) as never)}
      accessibilityLabel={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}>
      <Icon name="notifications-outline" size={22} color={light ? Colors.textInverse : Colors.text} />
      {label ? <View style={styles.badge}><Text style={styles.badgeText}>{label}</Text></View> : null}
    </TouchableOpacity>
  );
}

// Personas that start background jobs (payslips, fee generation, report files) and have a Running jobs screen.
const JOB_PERSONAS = new Set(['admin', 'manager', 'finance']);

// Shown only while one of the person's jobs is waiting or running; opens the Running jobs screen.
function JobsChip({ persona }: { persona: string }) {
  const router = useRouter();
  const q = useMyJobs();
  const active = (q.data ?? []).filter(isActiveJob).length;
  if (active === 0) return null;
  const label = jobsChipLabel(active);
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`${label} running. Open running jobs`} hitSlop={8}
      onPress={() => router.push(`/(${persona})/jobs` as never)} style={styles.jobs}>
      <Icon name="sync-outline" size={14} color={Colors.infoText} />
      <Text style={styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );
}

// Right side of every tab header: year (staff only), notifications, then the user's own photo.
// The year list is not readable by parents, students and drivers, so they do not get the chip.
// `light` is for the blue Home banner (white bell).
export default function HeaderActions({ light = false }: { light?: boolean }) {
  const { persona, isModuleEnabled } = useAuth();
  return (
    <View style={styles.row}>
      {JOB_PERSONAS.has(persona) ? <JobsChip persona={persona} /> : null}
      {shouldShowYearChip(persona) ? <YearChip /> : null}
      {isModuleEnabled('notifications') && routeFor(persona, '/notifications') ? <NotificationBell light={light} /> : null}
      <UserBadge compact />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: { backgroundColor: Colors.infoLight, borderRadius: 12, paddingHorizontal: Spacing.sm, paddingVertical: 2, marginRight: Spacing.xs, maxWidth: 130 },
  jobs: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.infoLight, borderRadius: 12, paddingHorizontal: Spacing.sm, paddingVertical: 2, marginRight: Spacing.xs },
  chipPast: { backgroundColor: Colors.warningLight },
  chipTextPast: { color: Colors.warningText },
  chipText: { fontSize: FontSize.xs, fontWeight: '600', color: Colors.infoText },
  bell: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 6, right: 4, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: Colors.errorText, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: Colors.textInverse, fontSize: FontSize.xxs, fontWeight: '700' },
});
