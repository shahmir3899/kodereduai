import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'fees', title: 'Fees', icon: 'cash-outline' },
  { name: 'reports', title: 'Reports', icon: 'stats-chart-outline' },
  { name: 'messages', title: 'Messages', icon: 'chatbubble-outline', stack: true },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

// Opened from Reports, More or the dashboard; no tab of their own.
const HIDDEN = ['my-profile', 'accounts', 'income', 'expenses', 'inventory', 'inventory-items', 'inventory-movements', 'inventory-assignments', 'inventory-reorder', 'leave', 'my-attendance', 'payslips', 'inbox', 'change-password'];

const TITLES: Record<string, string> = {
  'my-profile': 'My Profile',
  dashboard: 'Finance',
  fees: 'Fee Records',
  reports: 'Finance Reports',
  accounts: 'Accounts',
  income: 'Other Income',
  expenses: 'Expenses',
  inventory: 'Inventory',
  'inventory-items': 'Inventory Items',
  'inventory-movements': 'Stock Movements',
  'inventory-assignments': 'Assignments',
  'inventory-reorder': 'Reorder Prediction',
  leave: 'My Leave',
  'my-attendance': 'My Attendance',
  payslips: 'My Payslips',
  inbox: 'Notifications',
  'change-password': 'Change Password',
};

export default function AccountantLayout() {
  return <PersonaTabs persona="accountant" tabs={TABS} hidden={HIDDEN} titles={TITLES} />;
}
