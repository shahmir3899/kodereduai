import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ManualAttendanceScreen from '../../components/attendance/ManualAttendanceScreen';
import Skeleton from '../../components/ui/Skeleton';
import ErrorState from '../../components/ui/ErrorState';
import EmptyState from '../../components/ui/EmptyState';
import { useTeacherClassOptions } from '../../hooks/useTeacher';

// Teachers mark only the sections they are assigned to; the server enforces it on save too.
export default function TeacherAttendance() {
  const classes = useTeacherClassOptions();
  const { class: classParam } = useLocalSearchParams<{ class?: string }>();
  if (classes.isLoading) return <Skeleton />;
  if (classes.isError) return <ErrorState onRetry={() => classes.refetch()} />;
  if (classes.options.length === 0) {
    return <EmptyState title="No classes assigned" message="Ask your school admin to assign you as a class teacher." />;
  }
  return <ManualAttendanceScreen classOptions={classes.options} initialClassId={classParam ? Number(classParam) : undefined} />;
}
