import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { REFERENCE_STALE_MS, scopedKey } from '../services/queryRules';
import { fetchMasterClasses, fetchSessionClasses, SESSION_CLASSES_STALE_MS, useAcademicYear } from './useAcademicYear';
import { fetchMyAttendanceClasses } from './useTeacher';
import { fetchAccountNames } from './useFees';
import { fetchActiveExamTypes } from './useExamsAdmin';
import { fetchEntryCategories } from '../components/finance/EntryFields';

type HomeRole = 'admin' | 'teacher' | 'finance';

// Once a role's Home has loaded, quietly load the pickers its most-opened next screens wait on,
// so those screens skip their first loading block. Only pickers: attendance and money figures are
// always fetched fresh when their screen opens (staleTime 0), so loading them early would either be
// thrown away or show old numbers. The parent Home already loads each child's overview itself.
// Same keys, fetchers and stale times as the screens' own hooks, so a fresh entry is not reloaded.
export function usePrefetchNext(role: HomeRole, homeReady: boolean) {
  const queryClient = useQueryClient();
  const { activeSchool, isModuleEnabled } = useAuth();
  const year = useAcademicYear();
  const schoolId = activeSchool?.id ?? 0;
  // Attendance and fee collection work in the school's current year; teachers' screens follow the
  // chosen year (which for a teacher is always the current one).
  const yearId = role === 'admin' ? year.actual?.id ?? null : year.current?.id ?? null;
  const attendanceOn = isModuleEnabled('attendance');
  const examsOn = isModuleEnabled('examinations');
  const financeOn = isModuleEnabled('finance');

  useEffect(() => {
    if (!homeReady || !schoolId || year.isLoading) return;
    const load = <T,>(root: string, params: unknown[], queryFn: () => Promise<T>, staleTime: number) =>
      // Errors are swallowed by prefetchQuery: the screen loads it again on open if this failed.
      queryClient.prefetchQuery({ queryKey: scopedKey(root, schoolId, params), queryFn, staleTime });

    if (role === 'teacher') {
      // Attendance and Marks open behind the teacher's own class list.
      if (attendanceOn || examsOn) {
        load('myAttendanceClasses', [yearId], fetchMyAttendanceClasses, 60_000);
        if (yearId) load('session-classes', [yearId], () => fetchSessionClasses(yearId), SESSION_CLASSES_STALE_MS);
      }
      if (examsOn) load('examTypes', [], fetchActiveExamTypes, 5 * 60_000);
    }
    if (role === 'admin') {
      // Mark attendance and Collect fees both open on the class picker; collecting also needs the accounts.
      if (attendanceOn || financeOn) {
        if (yearId) load('session-classes', [yearId], () => fetchSessionClasses(yearId), SESSION_CLASSES_STALE_MS);
        load('classes', [], fetchMasterClasses, REFERENCE_STALE_MS);
      }
      if (financeOn) load('accounts', [], fetchAccountNames, REFERENCE_STALE_MS);
    }
    if (role === 'finance' && financeOn) {
      // The expense and income lists filter by category.
      load('categories', ['expense'], () => fetchEntryCategories('expense'), REFERENCE_STALE_MS);
      load('categories', ['income'], () => fetchEntryCategories('income'), REFERENCE_STALE_MS);
    }
  }, [homeReady, schoolId, year.isLoading, yearId, role, attendanceOn, examsOn, financeOn, queryClient]);
}
