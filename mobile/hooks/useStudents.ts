import { studentsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { studentListParams, type MonthAttendance, type ProfileSummary, type StudentRow } from '../services/students';
import type { ClassOption } from '../services/attendanceEntry';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';
import { useAcademicYear } from './useAcademicYear';

// Infinite list of the students the signed-in role may see. The server does the scoping.
export function useStudentsPaged(term: string, option: ClassOption | null) {
  const year = useAcademicYear();
  const yearId = year.current?.id ?? null;
  return useScopedPagedQuery<StudentRow>('students', [term, option?.id ?? null, yearId], async (page) =>
    (await studentsApi.getStudents(studentListParams({ term, option, academicYearId: yearId, page }))).data,
  { enabled: !year.isLoading });
}

export function useStudent(id: number | null) {
  const year = useAcademicYear();
  return useScopedQuery('student', [id, year.current?.id ?? null], async () =>
    (await studentsApi.getStudent(id!)).data as Record<string, unknown> & StudentRow,
  { enabled: !!id && !year.isLoading, staleTime: 30_000 });
}

export function useProfileSummary(id: number | null) {
  return useScopedQuery('studentProfileSummary', [id], async () =>
    (await studentsApi.getProfileSummary(id!)).data as ProfileSummary, { enabled: !!id, staleTime: 30_000 });
}

export function useStudentAttendance(id: number | null, enabled: boolean) {
  return useScopedQuery('studentAttendance', [id], async () =>
    listOf<MonthAttendance>(((await studentsApi.getAttendanceHistory(id!)).data as { months?: unknown })?.months),
  { enabled: !!id && enabled, staleTime: 60_000 });
}

// 'studentFees' is a money root: always fetched fresh, never cached.
export function useStudentFees(id: number | null, enabled: boolean) {
  return useScopedQuery('studentFees', [id], async () =>
    listOf<Record<string, unknown>>((await studentsApi.getFeeLedger(id!)).data), { enabled: !!id && enabled });
}

export interface ExamGroup {
  exam_id: number; exam_name: string; exam_date?: string | null;
  subjects: Array<{ subject: string; marks_obtained: number | null; total_marks: number | null; percentage: number | null; grade: string | null; is_absent?: boolean }>;
}
export function useStudentResults(id: number | null, enabled: boolean) {
  return useScopedQuery('studentExamResults', [id], async () =>
    listOf<ExamGroup>((await studentsApi.getExamResults(id!)).data), { enabled: !!id && enabled, staleTime: 60_000 });
}
