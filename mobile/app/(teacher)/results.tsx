import React from 'react';
import ResultsScreen from '../../components/exams/ResultsScreen';
import TeacherClassGate from '../../components/nav/TeacherClassGate';

export default function TeacherResults() {
  return <TeacherClassGate>{(options) => <ResultsScreen classOptions={options} />}</TeacherClassGate>;
}
