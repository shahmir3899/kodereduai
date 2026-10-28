import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'self-service', title: 'Self Service', icon: 'calendar-number-outline' },
  { name: 'messages', title: 'Messages', icon: 'chatbubble-outline' },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

export default function StaffLayout() {
  return <PersonaTabs persona="staff" tabs={TABS} />;
}
