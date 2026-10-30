import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { AttendanceView, type MonthData } from '../../../../components/student/StudentAttendanceScreen';
import { useChildAttendance } from '../../../../hooks/useParent';
import { monthSummary } from '../../../../services/parentPortal';

// The parent endpoint returns plain rows, so the month's summary is counted here. A stable
// module-level hook, as the view calls it on every render.
function useChildMonth(year: number, month: number) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useChildAttendance(Number(id), year, month);
  const data = useMemo<MonthData | undefined>(
    () => (q.data ? { records: q.data, summary: monthSummary(q.data) } : undefined),
    [q.data],
  );
  return { data, isLoading: q.isLoading, isError: q.isError, refetch: q.refetch };
}

export default function Screen() {
  return <AttendanceView useMonth={useChildMonth} />;
}
