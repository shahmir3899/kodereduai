import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { ManagedTerm, ManagedYear } from '../services/academicSessions';
import { useScopedQuery } from './useScopedQuery';

// Years and terms feed the year picker, attendance, fees and exams, so every write refreshes every
// query that carries a year or term.
const ROOTS = ['academicYears', 'sessionYears', 'sessionTerms', 'terms', 'yearSummary', 'academicYear'];

export function useManagedYears() {
  return useScopedQuery('sessionYears', ['list'], async () =>
    listOf<ManagedYear>((await sessionsApi.getAcademicYears({ page_size: 9999 })).data));
}

export function useAllTerms() {
  return useScopedQuery('sessionTerms', ['all'], async () =>
    listOf<ManagedTerm>((await sessionsApi.getTerms({ page_size: 9999 })).data));
}

export function useYearSummary(yearId: number | null) {
  return useScopedQuery('yearSummary', [yearId], async () => (await sessionsApi.getYearSummary(yearId as number)).data as { classes_count?: number; enrollment_count?: number; terms_count?: number },
  { enabled: yearId != null });
}

export function useSessionActions() {
  const qc = useQueryClient();
  const done = () => ROOTS.forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    createYear: useMutation({ mutationFn: (d: object) => sessionsApi.createAcademicYear(d), onSuccess: done }),
    updateYear: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => sessionsApi.updateAcademicYear(id, data), onSuccess: done }),
    deleteYear: useMutation({ mutationFn: (id: number) => sessionsApi.deleteAcademicYear(id), onSuccess: done }),
    setCurrent: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => sessionsApi.setCurrentYear(id, data), onSuccess: done }),
    createTerm: useMutation({ mutationFn: (d: object) => sessionsApi.createTerm(d), onSuccess: done }),
    updateTerm: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => sessionsApi.updateTerm(id, data), onSuccess: done }),
    deleteTerm: useMutation({ mutationFn: (id: number) => sessionsApi.deleteTerm(id), onSuccess: done }),
    importPreview: useMutation({ mutationFn: (d: object) => sessionsApi.importTermsPreview(d) }),
    importApply: useMutation({ mutationFn: (d: object) => sessionsApi.importTermsApply(d), onSuccess: done }),
  };
}
