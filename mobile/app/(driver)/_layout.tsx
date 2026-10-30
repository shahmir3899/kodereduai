import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'journey', title: 'Journey', icon: 'navigate-outline' },
  { name: 'boarding', title: 'Boarding', icon: 'checkmark-done-outline' },
  { name: 'messages', title: 'Messages', icon: 'chatbubble-outline', stack: true },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

// Opened from More; no tab of their own.
const HIDDEN = ['leave', 'my-attendance', 'inbox', 'change-password'];

const TITLES: Record<string, string> = {
  dashboard: 'Driver',
  journey: 'Active Journey',
  boarding: 'Student Boarding',
  leave: 'My Leave',
  'my-attendance': 'My Attendance',
  inbox: 'Notifications',
  'change-password': 'Change Password',
};

export default function DriverLayout() {
  return <PersonaTabs persona="driver" tabs={TABS} hidden={HIDDEN} titles={TITLES} />;
}
