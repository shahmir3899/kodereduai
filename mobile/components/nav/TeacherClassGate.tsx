import React from 'react';
import Skeleton from '../ui/Skeleton';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { useTeacherClassOptions } from '../../hooks/useTeacher';
import type { ClassOption } from '../../services/attendanceEntry';

// Renders a class-scoped screen with the teacher's own sections, or the right empty state.
export default function TeacherClassGate({ children }: { children: (options: ClassOption[]) => React.ReactNode }) {
  const classes = useTeacherClassOptions();
  if (classes.isLoading) return <Skeleton />;
  if (classes.isError) return <ErrorState onRetry={() => classes.refetch()} />;
  if (classes.options.length === 0) {
    return <EmptyState title="No classes assigned" message="Ask your school admin to assign you as a class teacher." />;
  }
  return <>{children(classes.options)}</>;
}
