import React from 'react';
import AssignmentFormScreen from '../../../components/lms/AssignmentFormScreen';
import TeacherClassGate from '../../../components/nav/TeacherClassGate';

export default function TeacherAssignmentForm() {
  return <TeacherClassGate>{(options) => <AssignmentFormScreen classOptions={options} />}</TeacherClassGate>;
}
