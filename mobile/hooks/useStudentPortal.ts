import { useMutation, useQueryClient } from '@tanstack/react-query';
import { studentPortalApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type {
  ExamScheduleExam, LibraryIssue, PortalAssignment, PortalAttendance, PortalDashboard, PortalFee,
  PortalResultExam, PortalStudent, PortalTimetable, PortalTransport,
} from '../services/studentPortal';
import { useScopedQuery } from './useScopedQuery';

// The signed-in student's own data. Marks, fees and attendance are not on the persisted list
// (services/queryRules.ts), so they live in memory only; fee rows use a money root.

export function useStudentDashboard() {
  return useScopedQuery('studentDashboard', [], async () => (await studentPortalApi.getDashboard()).data as PortalDashboard, { staleTime: 60_000 });
}

export function useStudentProfile() {
  return useScopedQuery('studentProfile', [], async () =>
    ((await studentPortalApi.getProfile()).data as { student: PortalStudent }).student, { staleTime: 5 * 60_000 });
}

export function useStudentAttendance(year: number, month: number) {
  return useScopedQuery('studentAttendance', [year, month], async () =>
    (await studentPortalApi.getAttendance({ month, year })).data as PortalAttendance, { staleTime: 60_000 });
}

// 'feeSummary' is a money root: always stale, never cached across a payment.
export function useStudentFees() {
  return useScopedQuery('feeSummary', ['student'], async () =>
    listOf<PortalFee>((await studentPortalApi.getFees()).data));
}

// 'timetable' is persisted, so the week still shows offline.
export function useStudentTimetable() {
  return useScopedQuery('timetable', ['student'], async () => (await studentPortalApi.getTimetable()).data as PortalTimetable, { staleTime: 5 * 60_000 });
}

export function useStudentExamSchedule() {
  return useScopedQuery('studentExamSchedule', [], async () =>
    listOf<ExamScheduleExam>((await studentPortalApi.getExamSchedule()).data), { staleTime: 5 * 60_000 });
}

export function useStudentResults() {
  return useScopedQuery('studentResults', [], async () =>
    listOf<PortalResultExam>((await studentPortalApi.getExamResults()).data), { staleTime: 60_000 });
}

export function useStudentAssignments() {
  return useScopedQuery('studentAssignments', [], async () =>
    listOf<PortalAssignment>((await studentPortalApi.getAssignments()).data), { staleTime: 30_000 });
}

export function useStudentLibrary() {
  return useScopedQuery('studentLibrary', [], async () =>
    listOf<LibraryIssue>((await studentPortalApi.getLibrary()).data), { staleTime: 60_000 });
}

// The API answers null when no bus is assigned.
export function useStudentTransport() {
  return useScopedQuery<PortalTransport | null>('studentTransport', [], async () =>
    ((await studentPortalApi.getTransport()).data ?? null) as PortalTransport | null, { staleTime: 5 * 60_000 });
}

export function useSubmitAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => studentPortalApi.submitAssignment(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['studentAssignments'] });
      qc.invalidateQueries({ queryKey: ['studentDashboard'] });
    },
  });
}
