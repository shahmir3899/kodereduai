import React from 'react';
import StudentsListScreen from '../../../components/students/StudentsListScreen';
import TeacherClassGate from '../../../components/nav/TeacherClassGate';

// The server limits the list to students in the teacher's own sections.
export default function TeacherStudents() {
  return <TeacherClassGate>{(options) => <StudentsListScreen classOptions={options} />}</TeacherClassGate>;
}
