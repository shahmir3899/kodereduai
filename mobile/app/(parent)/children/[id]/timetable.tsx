import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TimetableView } from '../../../../components/student/StudentTimetableScreen';
import { useChildTimetable } from '../../../../hooks/useParent';
import { childPeriods } from '../../../../services/parentPortal';

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TimetableView query={useChildTimetable(Number(id))} toPeriods={childPeriods} />;
}
