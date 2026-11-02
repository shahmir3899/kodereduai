import React from 'react';
import DailyDiaryScreen from '../../../components/lms/DailyDiaryScreen';
import TeacherClassGate from '../../../components/nav/TeacherClassGate';

export default function TeacherDiary() {
  return <TeacherClassGate>{(options) => <DailyDiaryScreen classOptions={options} />}</TeacherClassGate>;
}
