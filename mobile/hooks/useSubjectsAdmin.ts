import { useMutation, useQueryClient } from '@tanstack/react-query';
import { academicsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { ClassSubjectRow, ClassTeacherRow, Scope, Subject } from '../services/subjectsAdmin';
import { useScopedQuery } from './useScopedQuery';

// Other screens cache subjects, class subjects and timetables under these roots (some are persisted
// reference data), so every write here refreshes them too.
const ROOTS = ['subjectsAdmin', 'classSubjectsAdmin', 'classTeachersAdmin', 'subjects', 'classSubjects', 'classTeachers', 'timetable', 'examsAdmin'];
const refresh = (qc: ReturnType<typeof useQueryClient>) => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));

export function useSubjectList() {
  return useScopedQuery('subjectsAdmin', ['list'], async () => listOf<Subject>((await academicsApi.getSubjects({ page_size: 9999 })).data));
}

const scopeParams = (s: Scope) => (s.sessionClass != null ? { session_class: s.sessionClass } : { class_obj: s.classObj });

export function useSectionSubjects(scope: Scope | null) {
  return useScopedQuery('classSubjectsAdmin', [scope?.sessionClass ?? null, scope?.classObj ?? null, scope?.academicYear ?? null], async () =>
    listOf<ClassSubjectRow>((await academicsApi.getClassSubjects({ ...scopeParams(scope as Scope), page_size: 9999 })).data).filter((r) => r.is_active !== false),
  { enabled: scope != null });
}

export function useSectionClassTeachers(scope: Scope | null) {
  return useScopedQuery('classTeachersAdmin', [scope?.sessionClass ?? null], async () =>
    listOf<ClassTeacherRow>((await academicsApi.getClassTeachers({ session_class: scope?.sessionClass, page_size: 9999 })).data).filter((r) => r.is_active !== false),
  { enabled: scope?.sessionClass != null });
}

export function useSubjectActions() {
  const qc = useQueryClient();
  const done = () => refresh(qc);
  return {
    createSubject: useMutation({ mutationFn: (d: object) => academicsApi.createSubject(d), onSuccess: done }),
    updateSubject: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => academicsApi.updateSubject(id, data), onSuccess: done }),
    deleteSubject: useMutation({ mutationFn: (id: number) => academicsApi.deleteSubject(id), onSuccess: done }),
    createClassSubject: useMutation({ mutationFn: (d: object) => academicsApi.createClassSubject(d), onSuccess: done }),
    updateClassSubject: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => academicsApi.updateClassSubject(id, data), onSuccess: done }),
    deleteClassSubject: useMutation({ mutationFn: (id: number) => academicsApi.deleteClassSubject(id), onSuccess: done }),
    createClassTeacher: useMutation({ mutationFn: (d: object) => academicsApi.createClassTeacher(d), onSuccess: done }),
    deleteClassTeacher: useMutation({ mutationFn: (id: number) => academicsApi.deleteClassTeacher(id), onSuccess: done }),
  };
}
