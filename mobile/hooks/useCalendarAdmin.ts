import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { listParams, type CalendarEntry } from '../services/calendarAdmin';
import { useAcademicYear } from './useAcademicYear';
import { useScopedQuery } from './useScopedQuery';

// The entries that start, end or run inside a month, for the active academic year.
export function useCalendarEntries(year: number, month: number) {
  const { current } = useAcademicYear();
  return useScopedQuery('calendarEntries', [current?.id ?? null, year, month], async () =>
    listOf<CalendarEntry>((await sessionsApi.getCalendarEntries(listParams(current!.id, year, month))).data),
  { enabled: !!current?.id, staleTime: 0 });
}

// An OFF day changes attendance, the dashboard and the month view, so every write refreshes them.
const ROOTS = ['calendarEntries', 'calendarMonth', 'adminDashboard', 'manualDayStatus', 'attendanceRegister'];

export function useCalendarActions() {
  const qc = useQueryClient();
  const done = () => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));
  return {
    create: useMutation({ mutationFn: (d: object) => sessionsApi.createCalendarEntry(d), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => sessionsApi.updateCalendarEntry(id, data), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: number) => sessionsApi.deleteCalendarEntry(id), onSuccess: done }),
  };
}
