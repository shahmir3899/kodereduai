import React from 'react';
import CurriculumCoverageScreen from '../../components/lms/CurriculumCoverageScreen';
import TeacherClassGate from '../../components/nav/TeacherClassGate';

export default function TeacherCoverage() {
  return <TeacherClassGate>{(options) => <CurriculumCoverageScreen classOptions={options} />}</TeacherClassGate>;
}
