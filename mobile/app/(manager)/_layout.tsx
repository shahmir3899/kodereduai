import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'academics', title: 'Academics', icon: 'book-outline' },
  { name: 'messages', title: 'Messages', icon: 'chatbubble-outline', stack: true },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

// Reached from Academics, More or the dashboard; no tab of their own.
const HIDDEN = [
  'schedule', 'subjects', 'calendar', 'classes', 'inbox', 'leave', 'my-attendance',
  'questions', 'papers', 'worksheets', 'paper-builder', 'exam-types', 'exams',
];

const STACKS = ['assignments', 'curriculum'];

const TITLES: Record<string, string> = {
  schedule: 'Timetable', subjects: 'Subjects', calendar: 'Academic Calendar', classes: 'Classes',
  inbox: 'Notifications', leave: 'My Leave', 'my-attendance': 'My Attendance', questions: 'Question Bank',
  papers: 'Question Papers', worksheets: 'Worksheets', 'paper-builder': 'Paper Builder',
  'exam-types': 'Exam Types', exams: 'Exams',
};

export default function ManagerLayout() {
  return <PersonaTabs persona="manager" tabs={TABS} hidden={HIDDEN} stacks={STACKS} titles={TITLES} />;
}
