import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { routeFor } from '../../navigation/routes';
import { examinationsApi, lmsApi } from '../../services/api';
import { useCount } from '../../hooks/useManager';
import { useUnreadMessages } from '../../hooks/useMessaging';
import { useRefreshControl } from '../../hooks/useRefreshControl';
import StatTiles from '../../components/dashboard/StatTiles';
import RecentNotifications from '../../components/dashboard/RecentNotifications';
import HomeHero from '../../components/dashboard/HomeHero';
import { splitTiles } from '../../services/homeHero';
import { Colors, FontSize, Spacing, BorderRadius } from '../../constants/colors';
import TileGrid from '../../components/ui/TileGrid';
import type { IconName } from '../../components/ui/Icon';

// Content-side counts only, like the web ManagerDashboard: the Manager has no attendance,
// finance or student data.
export default function ManagerDashboard() {
  const { user, isModuleEnabled } = useAuth();
  const router = useRouter();
  const examsOn = isModuleEnabled('examinations');
  const lmsOn = isModuleEnabled('lms');
  const notifOn = isModuleEnabled('notifications');

  const lessonPlans = useCount('lessonPlans', lmsOn, lmsApi.getLessonPlans);
  const assignments = useCount('assignments', lmsOn, lmsApi.getAssignments, { status: 'PUBLISHED' });
  const questions = useCount('questions', examsOn, examinationsApi.getQuestions);
  const papers = useCount('examPapers', examsOn, examinationsApi.getExamPapers);
  const worksheets = useCount('worksheets', examsOn, examinationsApi.getWorksheets);
    const unread = useUnreadMessages();
  const refreshControl = useRefreshControl(
    lessonPlans.refetch, assignments.refetch, questions.refetch, papers.refetch, worksheets.refetch,
  );

  const go = (route?: string) => route && router.push(route as Href);
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || user?.username;

  // No Lesson Plans screen for a manager (the web hides it too), so that tile is a count only.
  const tiles = [
    { label: 'Lesson Plans', value: lessonPlans.data, route: undefined, show: lmsOn },
    { label: 'Active Assignments', value: assignments.data, route: routeFor('manager', '/academics/assignments'), show: lmsOn },
    { label: 'Question Bank', value: questions.data, route: routeFor('manager', '/academics/questions'), show: examsOn },
    { label: 'Exam Papers', value: papers.data, route: routeFor('manager', '/academics/papers'), show: examsOn },
    { label: 'Worksheets', value: worksheets.data, route: routeFor('manager', '/academics/worksheets'), show: examsOn },
  ].filter((t) => t.show);

  const quick = [
    { label: 'Question Bank', icon: 'help-circle-outline' as IconName, route: routeFor('manager', '/academics/questions'), show: examsOn },
    { label: 'Paper Builder', icon: 'construct-outline' as IconName, route: routeFor('manager', '/academics/paper-builder'), show: examsOn },
    { label: 'Assignments', icon: 'document-text-outline' as IconName, route: routeFor('manager', '/academics/assignments'), show: lmsOn },
    { label: 'Timetable', icon: 'time-outline' as IconName, route: routeFor('manager', '/academics/timetable'), show: isModuleEnabled('academics') },
    { label: 'Classes', icon: 'school-outline' as IconName, route: routeFor('manager', '/classes'), show: isModuleEnabled('students') },
    { label: 'My Leave', icon: 'calendar-outline' as IconName, route: routeFor('manager', '/hr/leave'), show: isModuleEnabled('hr') },
    { label: unread > 0 ? `Messages (${unread})` : 'Messages', icon: 'chatbubbles-outline' as IconName, route: routeFor('manager', '/messages'), show: true },
  ].filter((a) => a.show);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} refreshControl={refreshControl}>
      <HomeHero name={name ?? ""} stats={splitTiles(tiles).hero} onPress={go} />
      <StatTiles tiles={splitTiles(tiles).rest} onPress={go} />

      <Text style={styles.section}>Quick actions</Text>
      <TileGrid items={quick.map((a) => ({ label: a.label, icon: a.icon, onPress: a.route ? () => go(a.route) : undefined }))} />

      <RecentNotifications enabled={notifOn} onSeeAll={() => go(routeFor('manager', '/notifications'))} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxxl },
  section: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.text, marginTop: Spacing.xl, marginBottom: Spacing.md },
});
