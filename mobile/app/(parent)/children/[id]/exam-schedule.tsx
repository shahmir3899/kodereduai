import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ExamScheduleView } from '../../../../components/student/StudentExamScheduleScreen';
import { useChildExamSchedule } from '../../../../hooks/useParent';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExamScheduleView query={useChildExamSchedule(Number(id))} />;
}
