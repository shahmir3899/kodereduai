import React from 'react';
import MarksEntryScreen from '../../components/exams/MarksEntryScreen';
import TeacherClassGate from '../../components/nav/TeacherClassGate';

// Teachers enter marks for their own sections; the server enforces the scope on save too.
export default function TeacherMarks() {
  return <TeacherClassGate>{(options) => <MarksEntryScreen classOptions={options} />}</TeacherClassGate>;
}
