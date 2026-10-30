import { academicsApi, examinationsApi, lmsApi, notificationsApi, sessionsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import { notificationsOf, timetableEntriesOf, type CalendarDay } from '../services/manager';
import type { TimetableEntry } from '../services/teacher';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

// Read-only data for the Manager screens.

// One class's weekly grid. `classObj` is the master class, `sessionClassId` the section.
// 'timetable' is a persisted root, so a visited class still shows offline.
export function useClassTimetable(classObj: number | null, sessionClassId: number | null) {
  return useScopedQuery('timetable', ['class', classObj, sessionClassId], async () =>
    timetableEntriesOf((await academicsApi.getTimetableByClass(classObj as number, sessionClassId)).data) as TimetableEntry[],
  { enabled: !!classObj, staleTime: 5 * 60_000 });
}

export function useSubjectsList() {
  return useScopedQuery('subjects', ['list'], async () =>
    listOf<{ id: number; name: string; code?: string; is_elective?: boolean; is_active?: boolean }>(
      (await academicsApi.getSubjects({ page_size: 9999 })).data),
  { staleTime: 5 * 60_000 });
}

export function useCalendarMonth(year: number, month: number) {
  return useScopedQuery('calendarMonth', [year, month], async () =>
    ((await sessionsApi.getCalendarMonthView({ year, month })).data?.days ?? []) as CalendarDay[],
  { staleTime: 60_000 });
}

// A list endpoint as an infinite, searchable query. `fetcher` is one of the *Api.get* calls.
export function useContentList<Item>(
  root: string,
  search: string,
  fetcher: (params: Record<string, unknown>) => Promise<{ data: unknown }>,
  enabled = true,
) {
  return useScopedPagedQuery<Item>(root, [search], async (page) => {
    const data = (await fetcher({ page, page_size: 20, ...(search ? { search } : {}) })).data as
      { results?: Item[]; next?: string | null; count?: number } | Item[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  }, { enabled });
}

export const questionsFetcher = examinationsApi.getQuestions;
export const papersFetcher = examinationsApi.getExamPapers;
export const worksheetsFetcher = examinationsApi.getWorksheets;
export const booksFetcher = lmsApi.getBooks;

export function useBookTree(bookId: number) {
  return useScopedQuery('bookTree', [bookId], async () => (await lmsApi.getBookTree(bookId)).data, { staleTime: 5 * 60_000 });
}

// One cheap request per tile: page_size=1 and read `count`, as the web dashboard does.
export function useCount(root: string, enabled: boolean, fetcher: (params: Record<string, unknown>) => Promise<{ data: unknown }>, extra: Record<string, unknown> = {}) {
  return useScopedQuery<number | null>(root, ['count', JSON.stringify(extra)], async () => {
    const data = (await fetcher({ page_size: 1, ...extra })).data as { count?: number } | unknown[];
    return Array.isArray(data) ? data.length : (data.count ?? 0);
  }, { enabled, staleTime: 60_000 });
}

export function useRecentNotifications(enabled: boolean, limit = 5) {
  return useScopedQuery('myNotifications', ['recent', limit], async () =>
    notificationsOf((await notificationsApi.getMyNotifications({ page_size: limit })).data).slice(0, limit),
  { enabled, staleTime: 30_000 });
}
