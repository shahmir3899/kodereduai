import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'self-service', title: 'Self Service', icon: 'calendar-number-outline' },
  { name: 'messages', title: 'Messages', icon: 'chatbubble-outline', stack: true },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

// Opened from More or the dashboard; no tab of their own.
const HIDDEN = ['my-profile', 'payslips', 'inventory', 'inbox', 'change-password'];

const TITLES: Record<string, string> = {
  'my-profile': 'My Profile',
  dashboard: 'Home',
  'self-service': 'Self Service',
  payslips: 'My Payslips',
  inventory: 'My Inventory',
  inbox: 'Notifications',
  'change-password': 'Change Password',
};

export default function StaffLayout() {
  return <PersonaTabs persona="staff" tabs={TABS} hidden={HIDDEN} titles={TITLES} />;
}
