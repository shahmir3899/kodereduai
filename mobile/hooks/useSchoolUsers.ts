import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { SchoolUser } from '../services/schoolUsers';
import { useScopedQuery } from './useScopedQuery';

export function useSchoolUsers() {
  return useScopedQuery('schoolUsers', ['list'], async () => listOf<SchoolUser>((await usersApi.getUsers({ page_size: 9999 })).data));
}

export function useSchoolUserActions() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'schoolUsers' });
  return {
    create: useMutation({ mutationFn: (d: object) => usersApi.createUser(d), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => usersApi.updateUser(id, data), onSuccess: done }),
    reset: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => usersApi.resetPassword(id, data) }),
  };
}
