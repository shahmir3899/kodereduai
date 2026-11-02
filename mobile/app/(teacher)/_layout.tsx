import React from 'react';
import PersonaTabs, { type TabSpec } from '../../components/nav/PersonaTabs';

const TABS: TabSpec[] = [
  { name: 'dashboard', title: 'Home', icon: 'home-outline' },
  { name: 'attendance', title: 'Attendance', icon: 'checkbox-outline' },
  { name: 'marks', title: 'Marks', icon: 'create-outline' },
  { name: 'schedule', title: 'Schedule', icon: 'calendar-outline' },
  { name: 'more', title: 'More', icon: 'menu-outline' },
];

// Reached from More or from other screens; no tab of their own.
const HIDDEN = ['my-profile', 'inbox', 'register', 'results', 'assessments', 'exam-schedule', 'report-cards', 'fees', 'leave', 'my-attendance', 'classes', 'lesson-plans', 'questions', 'papers', 'paper-builder'];

const STACKS = ['assignments', 'students', 'curriculum'];

const TITLES: Record<string, string> = {
  'my-profile': 'My Profile',
  inbox: 'Notifications',
  register: 'Attendance Record', results: 'Results', assessments: 'Assessments', 'exam-schedule': 'Exam Schedule',
  'report-cards': 'Report Cards', fees: 'Collect Payments', leave: 'My Leave', 'my-attendance': 'My Attendance',
  classes: 'My Classes', 'lesson-plans': 'Lesson Plans', questions: 'Question Bank', papers: 'Question Papers', 'paper-builder': 'Paper Builder',
};

export default function TeacherLayout() {
  return <PersonaTabs persona="teacher" tabs={TABS} hidden={HIDDEN} stacks={STACKS} titles={TITLES} />;
}
