import {
  useQuery,
  useInfiniteQuery,
  keepPreviousData,
  type QueryFunctionContext,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { scopedKey } from '../services/queryRules';

type Opts<T> = Omit<UseQueryOptions<T>, 'queryKey' | 'queryFn'>;

// useQuery with the active school id folded into the key and the query held back until a
// school is known.
export function useScopedQuery<T>(
  root: string,
  params: readonly unknown[],
  queryFn: (ctx: QueryFunctionContext) => Promise<T>,
  options: Opts<T> = {},
) {
  const { activeSchool } = useAuth();
  const schoolId = activeSchool?.id ?? 0;
  return useQuery<T>({
    ...options,
    queryKey: scopedKey(root, schoolId, params),
    queryFn,
    enabled: schoolId > 0 && (options.enabled ?? true),
  });
}

// DRF list endpoints return { results, next, count }: the next page is the one after the last
// loaded, until `next` is null.
export function useScopedPagedQuery<Item>(
  root: string,
  params: readonly unknown[],
  fetchPage: (page: number) => Promise<{ results: Item[]; next: string | null; count: number }>,
  options: { enabled?: boolean } = {},
) {
  const { activeSchool } = useAuth();
  const schoolId = activeSchool?.id ?? 0;
  return useInfiniteQuery({
    queryKey: scopedKey(root, schoolId, params),
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    // Typing in a search box changes the key; keeping the old pages avoids a full-screen reload
    // (and losing the input's focus) on every new term.
    placeholderData: keepPreviousData,
    enabled: schoolId > 0 && (options.enabled ?? true),
  });
}
