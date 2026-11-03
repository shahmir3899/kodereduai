import { useMutation, useQueryClient } from '@tanstack/react-query';
import { academicsApi, hrApi, lmsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { LessonPlan } from '../services/lessonPlans';
import type { LinkedObjective } from '../services/lessonPlanObjectives';
import { booksOf } from '../services/lessonPlanTools';
import { useAuth } from '../contexts/AuthContext';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

export function useLessonPlansPaged(status: string, search: string, filters: Record<string, number | string> = {}) {
  return useScopedPagedQuery<LessonPlan>('lessonPlans', ['paged', status, search, JSON.stringify(filters)], async (page) => {
    const data = (await lmsApi.getLessonPlans({ page, page_size: 20, ...filters, ...(status ? { status } : {}), ...(search ? { search } : {}) })).data as
      { results?: LessonPlan[]; next?: string | null; count?: number } | LessonPlan[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}

// A lesson plan belongs to a staff member, not a user: find the signed-in person's staff record.
export function useMyStaffRecordId() {
  const { user } = useAuth();
  return useScopedQuery('staff', ['myRecord', user?.id], async () => {
    const rows = listOf<{ id: number }>((await hrApi.getStaff({ user: user?.id, page_size: 1 })).data);
    return rows[0]?.id ?? null;
  }, { enabled: !!user?.id, staleTime: 5 * 60_000 });
}

export function useLessonPlanActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'lessonPlans' });
  return {
    create: useMutation({ mutationFn: (d: object) => lmsApi.createLessonPlan(d), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lmsApi.updateLessonPlan(id, data), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => lmsApi.deleteLessonPlan(id), onSuccess: refresh }),
    link: useMutation({ mutationFn: ({ id, ids }: { id: number; ids: number[] }) => lmsApi.linkLessonPlanObjectives(id, ids), onSuccess: refresh }),
    publish: useMutation({ mutationFn: (id: number) => lmsApi.publishLessonPlan(id), onSuccess: refresh }),
    publishMany: useMutation({ mutationFn: (ids: number[]) => lmsApi.bulkPublishLessonPlans(ids), onSuccess: refresh }),
    removeMany: useMutation({ mutationFn: (ids: number[]) => lmsApi.bulkDeleteLessonPlans(ids), onSuccess: refresh }),
    bulk: useMutation({ mutationFn: (d: object) => lmsApi.bulkCreateLessonPlans(d), onSuccess: refresh }),
    draft: useMutation({ mutationFn: (d: object) => lmsApi.generateLessonPlan(d) }),
  };
}

// Books (with chapters and topics) for a class and subject, to pick what a lesson covers.
export function useBooksForClassSubject(classObj: number | null | undefined, subject: number | null) {
  return useScopedQuery('bookTree', ['forClassSubject', classObj, subject], async () =>
    booksOf((await lmsApi.getBooksForClassSubject({ class_id: classObj, subject_id: subject, view: 'lesson_plan' })).data),
  { enabled: !!classObj && !!subject, staleTime: 5 * 60_000 });
}

// What the curriculum lists as objectives for the topics a plan covers, one list per topic.
export function useTopicObjectives(topicIds: number[]) {
  return useScopedQuery('topicObjectives', [...topicIds].sort((a, b) => a - b), async () =>
    Promise.all(topicIds.map(async (id) => {
      try {
        return listOf<LinkedObjective>((await lmsApi.getTopicObjectives(id)).data);
      } catch {
        // One topic with no objectives (or none the person may read) must not hide the others.
        return [] as LinkedObjective[];
      }
    })),
  { enabled: topicIds.length > 0, staleTime: 5 * 60_000 });
}

// The subjects of a class with the teacher each one is given to, so a quick plan can name its teacher.
export function useClassSubjectTeachers(masterClassId: number | null | undefined, enabled: boolean) {
  return useScopedQuery('classSubjects', ['teachers', masterClassId ?? null], async () =>
    listOf<{ subject: number; teacher?: number | null; is_active?: boolean }>(
      (await academicsApi.getClassSubjects({ class_obj: masterClassId, page_size: 9999 })).data),
  { enabled: enabled && !!masterClassId, staleTime: 2 * 60_000 });
}
