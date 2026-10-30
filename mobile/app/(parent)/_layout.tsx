import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'children', title: 'Children', icon: 'people-outline', stack: true },
  { name: 'messages', title: 'Messages', icon: 'chatbubble-outline', stack: true },
  { name: 'leave', title: 'Leave', icon: 'document-text-outline' },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

// Opened from Home or More; no tab of their own.
const HIDDEN = ['inbox', 'change-password'];

const TITLES: Record<string, string> = {
  leave: 'Leave Requests',
  inbox: 'Notifications',
  'change-password': 'Change Password',
};

export default function ParentLayout() {
  return <PersonaTabs persona="parent" tabs={TABS} hidden={HIDDEN} titles={TITLES} />;
}
