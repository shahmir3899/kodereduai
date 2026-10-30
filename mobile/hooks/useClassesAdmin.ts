import { useMutation, useQueryClient } from '@tanstack/react-query';
import { classesApi, sessionsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { MasterClass, SessionClassRow } from '../services/classesAdmin';
import { useAcademicYear } from './useAcademicYear';
import { useScopedQuery } from './useScopedQuery';

// Classes feed every class picker in the app (some persisted as reference data), so a change here
// refreshes all of those roots.
const ROOTS = ['classesAdmin', 'sessionClassesAdmin', 'classes', 'session-classes', 'sessionClasses', 'students', 'studentsList', 'classSubjects', 'timetable'];
const refresh = (qc: ReturnType<typeof useQueryClient>) => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));

export function useMasterClassList() {
  return useScopedQuery('classesAdmin', ['master'], async () => listOf<MasterClass>((await classesApi.getClasses({ page_size: 9999 })).data));
}

export function useYearSections() {
  const { current } = useAcademicYear();
  return useScopedQuery('sessionClassesAdmin', [current?.id ?? null], async () =>
    listOf<SessionClassRow>((await sessionsApi.getSessionClasses({ academic_year: current?.id, page_size: 9999 })).data).filter((c) => c.is_active !== false),
  { enabled: !!current?.id, staleTime: 0 });
}

export function useClassActions() {
  const qc = useQueryClient();
  const done = () => refresh(qc);
  return {
    createMaster: useMutation({ mutationFn: (d: object) => classesApi.createClass(d), onSuccess: done }),
    updateMaster: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => classesApi.updateClass(id, data), onSuccess: done }),
    deleteMaster: useMutation({ mutationFn: (id: number) => classesApi.deleteClass(id), onSuccess: done }),
    createSection: useMutation({ mutationFn: (d: object) => sessionsApi.createSessionClass(d), onSuccess: done }),
    updateSection: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => sessionsApi.updateSessionClass(id, data), onSuccess: done }),
    deleteSection: useMutation({ mutationFn: (id: number) => sessionsApi.deleteSessionClass(id), onSuccess: done }),
    initialize: useMutation({ mutationFn: (d: object) => sessionsApi.initializeSessionClasses(d), onSuccess: done }),
  };
}
