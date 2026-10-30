import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import { examinationsApi, lmsApi } from '../../services/api';
import { useCount, useRecentNotifications } from '../../hooks/useManager';
import { useUnreadMessages } from '../../hooks/useMessaging';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import Card from '../../components/ui/Card';
import SchoolSwitcher from '../../components/nav/SchoolSwitcher';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';

// Content-side counts only, like the web ManagerDashboard: the Manager has no attendance,
// finance or student data.
export default function ManagerDashboard() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const examsOn = isModuleEnabled('examinations');
  const lmsOn = isModuleEnabled('lms');
  const notifOn = isModuleEnabled('notifications');

  const assignments = useCount('assignments', lmsOn, lmsApi.getAssignments, { status: 'PUBLISHED' });
  const questions = useCount('questions', examsOn, examinationsApi.getQuestions);
  const papers = useCount('examPapers', examsOn, examinationsApi.getExamPapers);
  const worksheets = useCount('worksheets', examsOn, examinationsApi.getWorksheets);
  const notifications = useRecentNotifications(notifOn);
  const unread = useUnreadMessages();
  const refreshControl = useRefreshControl(
    assignments.refetch, questions.refetch, papers.refetch, worksheets.refetch, notifications.refetch,
  );

  const go = (route?: string) => route && router.push(route as Href);
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;

  const tiles = [
    { label: 'Active Assignments', value: assignments.data, route: routeFor('manager', '/academics/assignments'), show: lmsOn },
    { label: 'Question Bank', value: questions.data, route: routeFor('manager', '/academics/questions'), show: examsOn },
    { label: 'Exam Papers', value: papers.data, route: routeFor('manager', '/academics/papers'), show: examsOn },
    { label: 'Worksheets', value: worksheets.data, route: routeFor('manager', '/academics/worksheets'), show: examsOn },
  ].filter((t) => t.show);

  const quick = [
    { label: 'Timetable', icon: '📅', route: routeFor('manager', '/academics/timetable'), show: isModuleEnabled('academics') },
    { label: 'Classes', icon: '🏫', route: routeFor('manager', '/classes'), show: isModuleEnabled('students') },
    { label: 'My Leave', icon: '🗓️', route: routeFor('manager', '/hr/leave'), show: isModuleEnabled('hr') },
    { label: unread > 0 ? `Messages (${unread})` : 'Messages', icon: '💬', route: routeFor('manager', '/messages'), show: true },
  ].filter((a) => a.show);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <Text style={styles.greeting}>Welcome back, {name}</Text>
      <SchoolSwitcher />

      {tiles.length > 0 ? (
        <View style={styles.tiles}>
          {tiles.map((t) => (
            <TouchableOpacity accessibilityRole="button" key={t.label} style={styles.tile} disabled={!t.route} onPress={() => go(t.route)}>
              <Text style={styles.tileValue}>{t.value ?? '–'}</Text>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      <Text style={styles.section}>Quick actions</Text>
      <View style={styles.actions}>
        {quick.map((a) => (
          <TouchableOpacity accessibilityRole="button" key={a.label} style={[styles.quick, !a.route && styles.quickOff]} disabled={!a.route} onPress={() => go(a.route)}>
            <Text style={styles.quickIcon}>{a.icon}</Text>
            <Text style={styles.quickLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {notifOn ? (
        <>
          <View style={styles.sectionRow}>
            <Text style={styles.section}>Notifications</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => go(routeFor('manager', '/notifications'))}>
              <Text style={styles.link}>See all</Text>
            </TouchableOpacity>
          </View>
          <Card style={styles.list}>
            {(notifications.data ?? []).length === 0 ? (
              <Text style={styles.muted}>{notifications.isLoading ? 'Loading…' : 'No notifications.'}</Text>
            ) : (
              (notifications.data ?? []).map((n) => (
                <View key={n.id} style={styles.note}>
                  <Text style={[styles.noteTitle, !n.is_read && styles.bold]} numberOfLines={1}>{n.title}</Text>
                  <Text style={styles.noteBody} numberOfLines={2}>{n.message}</Text>
                </View>
              ))
            )}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  greeting: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.lg },
  tile: { width: '47%', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md },
  tileValue: { fontSize: FontSize.xxl, fontWeight: '700', color: Colors.primary },
  tileLabel: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2 },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
  sectionRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  link: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '600', marginBottom: Spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  quick: { width: '22%', minWidth: 72, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: BorderRadius.md, paddingVertical: Spacing.md },
  quickOff: { opacity: 0.4 },
  quickIcon: { fontSize: 22 },
  quickLabel: { fontSize: FontSize.xs, color: Colors.text, marginTop: 4, textAlign: 'center' },
  list: { padding: Spacing.md },
  muted: { fontSize: FontSize.sm, color: Colors.textSecondary },
  note: { paddingVertical: 6 },
  noteTitle: { fontSize: FontSize.sm, color: Colors.text },
  bold: { fontWeight: '700' },
  noteBody: { fontSize: FontSize.xs, color: Colors.textSecondary },
});
