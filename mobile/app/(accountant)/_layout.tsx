import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'fees', title: 'Fees', icon: 'cash-outline' },
  { name: 'reports', title: 'Reports', icon: 'stats-chart-outline' },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

export default function AccountantLayout() {
  return <PersonaTabs persona="accountant" tabs={TABS} />;
}
