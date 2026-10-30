import { useMutation, useQueryClient } from '@tanstack/react-query';
import { lettersApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { Letter, TemplateMap } from '../services/letters';
import { useScopedQuery } from './useScopedQuery';

export function useLetters() {
  return useScopedQuery('letters', ['list'], async () => listOf<Letter>((await lettersApi.getLetters({ limit: 50 })).data));
}

export function useLetterTemplates() {
  return useScopedQuery('letterTemplates', [], async () => (await lettersApi.getTemplates()).data as TemplateMap, { staleTime: 60 * 60_000 });
}

export function useLetterActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'letters' });
  return {
    create: useMutation({ mutationFn: (d: object) => lettersApi.createLetter(d), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => lettersApi.updateLetter(id, data), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => lettersApi.deleteLetter(id), onSuccess: refresh }),
    prefill: useMutation({ mutationFn: (d: object) => lettersApi.prefill(d) }),
  };
}
