import React from 'react';
import LessonPlansScreen from '../../components/lms/LessonPlansScreen';
import TeacherClassGate from '../../components/nav/TeacherClassGate';

export default function Screen() {
  return <TeacherClassGate>{(options) => <LessonPlansScreen classOptions={options} />}</TeacherClassGate>;
}
