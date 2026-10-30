import React from 'react';
import AssignmentsListScreen from '../../../components/lms/AssignmentsListScreen';
import TeacherClassGate from '../../../components/nav/TeacherClassGate';

export default function TeacherAssignments() {
  return <TeacherClassGate>{(options) => <AssignmentsListScreen classOptions={options} />}</TeacherClassGate>;
}
