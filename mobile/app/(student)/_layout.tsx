import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'schedule', title: 'Schedule', icon: 'calendar-outline' },
  { name: 'assignments', title: 'Tasks', icon: 'create-outline', stack: true },
  { name: 'results', title: 'Results', icon: 'ribbon-outline' },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

// Opened from More or the Home screen; no tab of their own. location-sharing is a leftover
// driver-style screen with no link to it; it stays hidden until it is confirmed unused.
const HIDDEN = ['attendance', 'fees', 'exam-schedule', 'library', 'transport', 'ai-helper', 'profile', 'inbox', 'change-password', 'location-sharing'];

const TITLES: Record<string, string> = {
  attendance: 'Attendance',
  fees: 'Fees',
  'exam-schedule': 'Exam Schedule',
  library: 'Library',
  transport: 'Transport',
  'ai-helper': 'AI Study Helper',
  profile: 'My Profile',
  inbox: 'Notifications',
  'change-password': 'Change Password',
};

export default function StudentLayout() {
  return <PersonaTabs persona="student" tabs={TABS} hidden={HIDDEN} titles={TITLES} />;
}
