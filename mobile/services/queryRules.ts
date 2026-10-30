import type { Query, QueryClient } from '@tanstack/query-core';

// Pure rules shared by the app's QueryClient. No React Native imports so Jest can load it.

// Only reference data that rarely changes is written to the phone's (unencrypted) storage;
// everything else — money, marks, attendance, student records — lives in memory only, so a lost
// or shared phone can't show them and an offline screen says "offline" instead of a stale balance.
export const PERSISTED_QUERY_ROOTS = new Set([
  'classes',
  'subjects',
  'staff',
  'session-classes',
  'classSubjects',
  'academicYears',
  'timetable',
  // Public list of schools for the front screen; nothing private in it.
  'schoolDirectory',
]);

// Money numbers must never come from a cache: these roots are always stale, and any successful
// mutation invalidates them (same rule as frontend/src/financeQueryRules.js). A new money query
// must use one of these roots, or add its root here.
export const MONEY_QUERY_ROOTS = [
  'finance',
  'feePayments',
  'feeSummary',
  'studentFees',
  'studentFeeLedger',
  'childFees',
  'otherIncome',
  'expenses',
  'accounts',
  'paymentStatus',
  'payslips',
  'payroll',
  'salaryStructures',
  'appraisals',
  'letters',
  'discounts',
  'scholarships',
  'studentDiscounts',
  'feeStructures',
  'feeCategories',
  // Admin dashboard bundles the monthly fee numbers with attendance and HR.
  'adminDashboard',
];
const MONEY_ROOT_SET = new Set<unknown>(MONEY_QUERY_ROOTS);

// Retry only failures that may be transient (no response, or a 5xx). A 4xx is the server
// answering "no" and asking again won't change it.
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === undefined || status >= 500;
}

export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  return query.state.status === 'success' && PERSISTED_QUERY_ROOTS.has(query.queryKey[0] as string);
}

// [root, schoolId, ...params]: the school id is part of every key, so data fetched for one
// school can never be served for another.
export function scopedKey(root: string, schoolId: number, params: readonly unknown[] = []): unknown[] {
  return [root, schoolId, ...params];
}

export function installMoneyRules(queryClient: QueryClient): QueryClient {
  MONEY_QUERY_ROOTS.forEach((root) => queryClient.setQueryDefaults([root], { staleTime: 0 }));
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') {
      queryClient.invalidateQueries({
        predicate: (query) => MONEY_ROOT_SET.has(query.queryKey[0]),
      });
    }
  });
  return queryClient;
}

export type QueryViewState = 'loading' | 'offline' | 'error' | 'empty' | 'content';

// What a screen should show for a query. Data already in hand wins over an error (a failed
// background refetch shouldn't blank a list the user is reading).
export function queryViewState(q: {
  isLoading: boolean;
  isError: boolean;
  hasData: boolean;
  isEmpty: boolean;
  // Fetch is waiting for a connection. Without this an offline first load matches none of the
  // other flags and fell through to "empty", telling the user there was nothing to see.
  isPaused?: boolean;
}): QueryViewState {
  if (q.hasData) return q.isEmpty ? 'empty' : 'content';
  if (q.isError) return 'error';
  if (q.isPaused) return 'offline';
  if (q.isLoading) return 'loading';
  return 'empty';
}
