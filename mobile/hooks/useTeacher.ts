import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { academicsApi, attendanceApi, bootstrapApi, examinationsApi, lmsApi, sessionsApi } from '../services/api';
import { scopedKey } from '../services/queryRules';
import { notificationsOf } from '../services/manager';
import { listOf } from '../services/academicYear';
import { teacherClassOptions, type TimetableEntry } from '../services/teacher';
import { countOf, sectionParams, weekRange, type WeekPlan, type Assignment, type ExamLite, type SectionProgress } from '../services/teacherDashboard';
import { todayString } from '../services/attendanceEntry';
import { buildScopeLookup, resolveScope } from '../services/teacherScope';
import { useAuth } from '../contexts/AuthContext';
import { useScopedQuery } from './useScopedQuery';
import { useAcademicYear, useSessionClasses } from './useAcademicYear';

export const fetchMyAttendanceClasses = async () =>
  listOf<{ id: number; name: string; section?: string; grade_level?: number | string }>(
    (await attendanceApi.getMyClasses()).data,
  );

// Sections this teacher may mark attendance for, in the active academic year or another one
// (report cards can look back at a past year).
export function useTeacherClassOptions(yearIdOverride?: number | null) {
  const year = useAcademicYear();
  const yearId = yearIdOverride ?? year.current?.id ?? null;
  const sessionClasses = useSessionClasses(yearId);
  const mine = useScopedQuery('myAttendanceClasses', [yearId], fetchMyAttendanceClasses, { enabled: !year.isLoading });

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
export function useMyTimetable(enabled = true) {
  const year = useAcademicYear();
  return useScopedQuery('timetable', ['mine', year.current?.id ?? null], async () =>
    listOf<TimetableEntry>(
      (await academicsApi.getMyTimetable(year.current?.id ? { academic_year: year.current.id } : undefined)).data,
    ), { enabled: enabled && !year.isLoading, staleTime: 5 * 60_000 });
}

export function useMyClassAssignments(enabled = true) {
  const year = useAcademicYear();
  return useScopedQuery('myClassAssignments', [year.current?.id ?? null], async () =>
    listOf<Assignment>(
      (await academicsApi.getMyClassTeacherAssignments(year.current?.id ? { academic_year: year.current.id } : undefined)).data,
    ), { enabled: enabled && !year.isLoading });
}

// Class teacher / subject teacher: why a row is visible to this teacher. Only teachers load it;
// for anyone else classify() gives null and no badge shows.
export function useTeacherScope() {
  const { isTeacher, isModuleEnabled } = useAuth();
  const year = useAcademicYear();
  const enabled = isTeacher && isModuleEnabled('academics') && !year.isLoading;
  const params = year.current?.id ? { academic_year: year.current.id } : undefined;
  const classes = useScopedQuery('myClassAssignments', [year.current?.id ?? null], async () =>
    listOf<{ class_obj?: number | null }>((await academicsApi.getMyClassTeacherAssignments(params)).data), { enabled });
  const subjects = useScopedQuery('mySubjectAssignments', [year.current?.id ?? null], async () =>
    listOf<{ class_obj?: number | null; subject?: number | null }>((await academicsApi.getMySubjectAssignments(params)).data), { enabled });
  const lookup = useMemo(() => buildScopeLookup(classes.data ?? [], subjects.data ?? []), [classes.data, subjects.data]);
  const ready = enabled && !classes.isLoading && !subjects.isLoading;
  return { classify: (classId: unknown, subjectId?: unknown) => (ready ? resolveScope(lookup, classId, subjectId) : null) };
}

// This week's lesson plans (the dashboard panel). The server limits them to the teacher's own.
export function useWeekLessonPlans(enabled: boolean) {
  const { from, to } = weekRange(new Date());
  return useScopedQuery('lessonPlans', ['week', from, to], async () =>
    listOf<WeekPlan>((await lmsApi.getLessonPlans({ date_from: from, date_to: to, page_size: 30 })).data), { enabled, staleTime: 60_000 });
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
      items: listOf<{ id: number; student_name?: string; assignment_title?: string; submitted_at?: string | null }>(data),
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

// ─── Teacher Home in one request ─────────────────────────────────────────────────────────────

export type TeacherHomeSection =
  | 'timetable' | 'class_assignments' | 'section_progress' | 'off_day' | 'pending_submissions'
  | 'students_at_risk' | 'exams' | 'week_plans' | 'notifications';

type Bundle = Partial<Record<TeacherHomeSection, unknown>>;
const NOTIFICATIONS_LIMIT = 5;

// The Home used to open ~10 requests (two more per section for attendance progress). The server's
// bundle answers them all at once; this writes each answer into the cache key its own hook uses,
// with the same parsing, so the Home and the screens behind it read it without fetching again.
//
// `own(section)` tells a hook whether to fetch for itself: while the bundle loads, no; after it,
// only when its section came back null (failed there) or the whole bundle failed (an older
// server without the endpoint, or no connection).
export function useTeacherHomeBundle(sections: TeacherHomeSection[]) {
  const { activeSchool } = useAuth();
  const queryClient = useQueryClient();
  const year = useAcademicYear();
  const schoolId = activeSchool?.id ?? 0;
  const yearId = year.current?.id ?? null;
  const today = todayString();
  const { from, to } = weekRange(new Date());
  const wanted = sections.join(',');

  const q = useScopedQuery<Bundle>('teacherHome', [yearId, today, from, to, wanted], async () => {
    const data = (await bootstrapApi.getTeacherDashboard({
      sections: wanted, date: today, week_from: from, week_to: to, notifications_limit: NOTIFICATIONS_LIMIT,
      ...(yearId ? { academic_year: yearId } : {}),
    })).data as Bundle;
    const seed = (root: string, params: unknown[], value: unknown) => queryClient.setQueryData(scopedKey(root, schoolId, params), value);
    const has = (k: TeacherHomeSection) => data[k] !== undefined && data[k] !== null;

    if (has('timetable')) seed('timetable', ['mine', yearId], listOf<TimetableEntry>(data.timetable));
    const assignments = has('class_assignments') ? listOf<Assignment>(data.class_assignments) : null;
    if (assignments) seed('myClassAssignments', [yearId], assignments);
    if (assignments && has('section_progress')) {
      const rows = data.section_progress as Array<{ assignment_id: number; total: number | null; marked: number | null; failed: boolean }>;
      const byId = new Map(rows.map((r) => [r.assignment_id, r]));
      seed('teacherSectionProgress', [today, yearId, assignments.map((a) => a.id).join(',')],
        assignments.map((a): SectionProgress => {
          const r = byId.get(a.id);
          return r ? { assignment: a, total: r.total, marked: r.marked, failed: r.failed } : { assignment: a, total: null, marked: null, failed: true };
        }));
    }
    if (has('off_day')) seed('offDay', [today], ((data.off_day as { days?: Record<string, unknown> }).days?.[today] ?? null));
    if (has('pending_submissions')) seed('pendingSubmissions', [], { count: countOf(data.pending_submissions), items: listOf(data.pending_submissions) });
    if (has('students_at_risk')) seed('myStudentsAtRisk', [yearId], data.students_at_risk);
    if (has('exams')) seed('teacherExams', [yearId], listOf<ExamLite>(data.exams));
    if (has('week_plans')) seed('lessonPlans', ['week', from, to], listOf<WeekPlan>(data.week_plans));
    if (has('notifications')) seed('myNotifications', ['recent', NOTIFICATIONS_LIMIT], notificationsOf(data.notifications).slice(0, NOTIFICATIONS_LIMIT));
    return data;
  // No retry: a failed bundle falls straight back to the separate requests, which retry themselves.
  }, { enabled: !year.isLoading, staleTime: 0, retry: false });

  const own = (section: TeacherHomeSection) =>
    q.isError || (q.isSuccess && (q.data?.[section] === undefined || q.data?.[section] === null));
  return { loading: year.isLoading || q.isLoading, ok: q.isSuccess, own, refetch: q.refetch };
}
