import React from 'react';
import AssessmentsScreen from '../../components/exams/AssessmentsScreen';
import TeacherClassGate from '../../components/nav/TeacherClassGate';

export default function TeacherAssessments() {
  return <TeacherClassGate>{(options) => <AssessmentsScreen classOptions={options} />}</TeacherClassGate>;
}
