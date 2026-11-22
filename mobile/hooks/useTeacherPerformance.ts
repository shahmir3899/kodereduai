import { teacherPerformanceApi } from '../services/api';
import type { Explainer, ReportResponse, TeacherResponse } from '../services/teacherPerformance';
import { useScopedQuery } from './useScopedQuery';

type Range = { start: string; end: string };

// A 404 means "not on the report" (not a teacher, or no login): an answer, not an error to retry.
const noRetryOn404 = (count: number, err: unknown) =>
  (err as { response?: { status?: number } })?.response?.status !== 404 && count < 2;

export function useTeacherPerformanceReport(range: Range) {
  return useScopedQuery<ReportResponse>('teacher-performance', ['list', range.start, range.end], async () =>
    (await teacherPerformanceApi.getReport(range)).data);
}

export function useTeacherPerformanceDetail(staffId: number | null, range: Range) {
  return useScopedQuery<TeacherResponse>('teacher-performance', ['detail', staffId, range.start, range.end],
    async () => (await teacherPerformanceApi.getTeacher(staffId as number, range)).data,
    { enabled: !!staffId, retry: noRetryOn404 });
}

export function useMyPerformance(range: Range) {
  return useScopedQuery<TeacherResponse>('teacher-performance', ['mine', range.start, range.end],
    async () => (await teacherPerformanceApi.getMine(range)).data,
    { retry: noRetryOn404, staleTime: 5 * 60 * 1000 });
}

export function useExplainer(enabled: boolean) {
  return useScopedQuery<Explainer>('teacher-performance-explainer', [],
    async () => (await teacherPerformanceApi.getExplainer()).data,
    { enabled, staleTime: 5 * 60 * 1000 });
}
