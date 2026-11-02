import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { buildClassOptions, type ClassOption } from '../services/attendanceEntry';
import { sessionsApi, classesApi } from '../services/api';
import { listOf, pickAcademicYear, type AcademicYear } from '../services/academicYear';
import { useScopedQuery } from './useScopedQuery';
import { canChooseYear, isPastYear, resolveYear, saveYearChoice, scopeKey, yearStore } from '../services/yearChoice';

// Both roots are on the persisted reference-data list (services/queryRules.ts), so the class
// and year pickers still open when the phone is offline.
//
// `current` is the year the screen works in. Admin, manager and accountant can choose another year
// (kept per person and school); everyone else, and screens that pass `lockToCurrent` (attendance,
// fee collection: they write today's records), always get the school's current year, `actual`.
export function useAcademicYear(opts: { lockToCurrent?: boolean } = {}) {
  const { user, activeSchool, persona } = useAuth();
  const userId = user?.id;
  const schoolId = activeSchool?.id;
  const scope = scopeKey(userId, schoolId);
  const query = useScopedQuery('academicYears', [], async () =>
    listOf<AcademicYear>((await sessionsApi.getAcademicYears()).data),
  { staleTime: 5 * 60_000 });
  const years = query.data ?? [];
  const allowed = canChooseYear(persona);

  useEffect(() => { if (allowed) yearStore.ensureLoaded(userId, schoolId); }, [allowed, userId, schoolId]);
  const choice = useSyncExternalStore(yearStore.subscribe, () => yearStore.get(scope), () => null);

  const actual = useMemo(() => pickAcademicYear(years), [years]);
  const current = useMemo(() => resolveYear(years, choice, { allowed, lockToCurrent: opts.lockToCurrent }), [years, choice, allowed, opts.lockToCurrent]);
  const choose = useCallback((id: number | null) => {
    yearStore.set(scope, id);
    saveYearChoice(userId, schoolId, id);
  }, [scope, userId, schoolId]);

  return { years, current, actual, isPast: isPastYear(current, actual), canChoose: allowed, choose, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
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
  const year = useAcademicYear({ lockToCurrent: true });
  const sessionClasses = useSessionClasses(year.current?.id);
  const masterClasses = useMasterClasses();
  const options = useMemo(
    () => override ?? buildClassOptions((sessionClasses.data ?? []) as never[], (masterClasses.data ?? []) as never[]).options,
    [override, sessionClasses.data, masterClasses.data],
  );
  return { year, options, isLoading: year.isLoading || sessionClasses.isLoading };
}
