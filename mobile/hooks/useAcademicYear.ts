import { useMemo } from 'react';
import { buildClassOptions, type ClassOption } from '../services/attendanceEntry';
import { sessionsApi, classesApi } from '../services/api';
import { listOf, pickAcademicYear, type AcademicYear } from '../services/academicYear';
import { useScopedQuery } from './useScopedQuery';

// Both roots are on the persisted reference-data list (services/queryRules.ts), so the class
// and year pickers still open when the phone is offline.
export function useAcademicYear() {
  const query = useScopedQuery('academicYears', [], async () =>
    listOf<AcademicYear>((await sessionsApi.getAcademicYears()).data),
  { staleTime: 5 * 60_000 });
  const years = query.data ?? [];
  const current = useMemo(() => pickAcademicYear(years), [years]);
  return { years, current, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

export function useSessionClasses(academicYearId: number | null | undefined) {
  return useScopedQuery('session-classes', [academicYearId], async () =>
    listOf<Record<string, unknown>>(
      (await sessionsApi.getSessionClasses({ academic_year: academicYearId, page_size: 9999, is_active: true })).data,
    ),
  { enabled: !!academicYearId, staleTime: 5 * 60_000 });
}

// Fallback for a year with no SessionClass rows.
export function useMasterClasses() {
  return useScopedQuery('classes', [], async () =>
    listOf<Record<string, unknown>>((await classesApi.getClasses({ page_size: 9999 })).data),
  { staleTime: 5 * 60_000 });
}

// Class picker options for one academic year: every session class of that year with the
// master-class fallback. Report cards need a year other than the current one too.
export function useClassOptionsForYear(yearId: number | null | undefined) {
  const sessionClasses = useSessionClasses(yearId);
  const masterClasses = useMasterClasses();
  const options = useMemo(
    () => buildClassOptions((sessionClasses.data ?? []) as never[], (masterClasses.data ?? []) as never[]).options,
    [sessionClasses.data, masterClasses.data],
  );
  return { options, isLoading: !!yearId && sessionClasses.isLoading, isError: false };
}

// Class picker options for attendance screens: the caller's own list (teachers: their sections)
// or, for admins, every session class of the active year with the master-class fallback.
export function useAttendanceClassOptions(override?: ClassOption[]) {
  const year = useAcademicYear();
  const sessionClasses = useSessionClasses(year.current?.id);
  const masterClasses = useMasterClasses();
  const options = useMemo(
    () => override ?? buildClassOptions((sessionClasses.data ?? []) as never[], (masterClasses.data ?? []) as never[]).options,
    [override, sessionClasses.data, masterClasses.data],
  );
  return { year, options, isLoading: year.isLoading || sessionClasses.isLoading };
}
