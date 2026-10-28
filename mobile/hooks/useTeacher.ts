import { useMemo } from 'react';
import { academicsApi, attendanceApi, examinationsApi, lmsApi, sessionsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { teacherClassOptions, type TimetableEntry } from '../services/teacher';
import { countOf, sectionParams, type Assignment, type ExamLite, type SectionProgress } from '../services/teacherDashboard';
import { todayString } from '../services/attendanceEntry';
import { useScopedQuery } from './useScopedQuery';
import { useAcademicYear, useSessionClasses } from './useAcademicYear';

// Sections this teacher may mark attendance for, in the active academic year or another one
// (report cards can look back at a past year).
export function useTeacherClassOptions(yearIdOverride?: number | null) {
  const year = useAcademicYear();
  const yearId = yearIdOverride ?? year.current?.id ?? null;
  const sessionClasses = useSessionClasses(yearId);
  const mine = useScopedQuery('myAttendanceClasses', [yearId], async () =>
    listOf<{ id: number; name: string; section?: string; grade_level?: number | string }>(
      (await attendanceApi.getMyClasses()).data,
    ), { enabled: !year.isLoading });

  const options = useMemo(
    () => teacherClassOptions(mine.data ?? [], (sessionClasses.data ?? []) as never[]),
    [mine.data, sessionClasses.data],
  );
  return {
    options,
    isLoading: year.isLoading || mine.isLoading || (!!yearId && sessionClasses.isLoading),
    isError: mine.isError && !mine.data,
    refetch: () => Promise.all([mine.refetch(), sessionClasses.refetch()]),
  };
}

// 'timetable' is on the persisted reference list, so the week still shows offline.
export function useMyTimetable() {
  const year = useAcademicYear();
  return useScopedQuery('timetable', ['mine', year.current?.id ?? null], async () =>
    listOf<TimetableEntry>(
      (await academicsApi.getMyTimetable(year.current?.id ? { academic_year: year.current.id } : undefined)).data,
    ), { enabled: !year.isLoading, staleTime: 5 * 60_000 });
}

export function useMyClassAssignments() {
  const year = useAcademicYear();
  return useScopedQuery('myClassAssignments', [year.current?.id ?? null], async () =>
    listOf<Assignment>(
      (await academicsApi.getMyClassTeacherAssignments(year.current?.id ? { academic_year: year.current.id } : undefined)).data,
    ), { enabled: !year.isLoading });
}

// Calendar day-status for today: is the school closed?
export function useOffDayToday(enabled = true) {
  const today = todayString();
  const q = useScopedQuery('offDay', [today], async () => {
    const res = await sessionsApi.getCalendarDayStatus({ date_from: today, date_to: today });
    return (res.data?.days?.[today] ?? null) as { is_off_day?: boolean; off_day_types?: string[] } | null;
  }, { enabled, staleTime: 5 * 60_000 });
  const types = q.data?.off_day_types ?? [];
  return {
    isOffDay: !!q.data?.is_off_day,
    label: q.data?.is_off_day ? `OFF day${types.length ? `: ${types.join(', ')}` : ''}` : null,
  };
}

// Per assigned section: enrolled students vs attendance records today. Queried by session
// class (not the master class) so 5-A and 5-B never blend into one number.
export function useSectionProgress(assignments: Assignment[], enabled: boolean) {
  const year = useAcademicYear();
  const today = todayString();
  const ids = assignments.map((a) => a.id).join(',');
  return useScopedQuery<SectionProgress[]>('teacherSectionProgress', [today, year.current?.id ?? null, ids], async () =>
    Promise.all(assignments.map(async (a): Promise<SectionProgress> => {
      const params = sectionParams(a, year.current?.id ?? null);
      try {
        const [enrol, records] = await Promise.all([
          sessionsApi.getEnrollments({ ...params, active_on: today, page_size: 1 }),
          attendanceApi.getRecords({ ...params, date: today, page_size: 1 }),
        ]);
        return { assignment: a, total: countOf(enrol.data), marked: countOf(records.data), failed: false };
      } catch {
        return { assignment: a, total: null, marked: null, failed: true };
      }
    })),
  { enabled: enabled && assignments.length > 0, staleTime: 0 });
}

export function usePendingSubmissions(enabled: boolean) {
  return useScopedQuery('pendingSubmissions', [], async () => {
    const data = (await lmsApi.getSubmissions({ status: 'SUBMITTED', page_size: 10 })).data;
    return {
      count: countOf(data),
      items: listOf<{ id: number; student_name?: string; assignment_title?: string }>(data),
    };
  }, { enabled, staleTime: 0 });
}

// Class teachers only: the server scopes it to the teacher's own sections (empty for subject-only).
export function useMyStudentsAtRisk(enabled: boolean) {
  const year = useAcademicYear();
  return useScopedQuery('myStudentsAtRisk', [year.current?.id ?? null], async () =>
    (await academicsApi.getMyStudentsAtRisk({ ...(year.current?.id && { academic_year: year.current.id }), limit: 5 })).data as {
      attendance?: { at_risk_count?: number; students?: RiskStudent[] };
      academic?: { at_risk_count?: number; students?: RiskStudent[] };
    },
  { enabled: enabled && !year.isLoading, staleTime: 10 * 60_000 });
}

export interface RiskStudent {
  student_id: number;
  student_name: string;
  class_name?: string;
  severity?: string;
  suggested_action?: string;
}

export function useTeacherExams(enabled: boolean) {
  const year = useAcademicYear();
  return useScopedQuery('teacherExams', [year.current?.id ?? null], async () =>
    listOf<ExamLite>((await examinationsApi.getExams({ ...(year.current?.id && { academic_year: year.current.id }), page_size: 10 })).data),
  { enabled: enabled && !year.isLoading, staleTime: 60_000 });
}
