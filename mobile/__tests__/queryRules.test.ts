import { QueryClient } from '@tanstack/query-core';
import {
  MONEY_QUERY_ROOTS,
  PERSISTED_QUERY_ROOTS,
  installMoneyRules,
  queryViewState,
  scopedKey,
  shouldPersistQuery,
  shouldRetry,
} from '../services/queryRules';

describe('shouldRetry', () => {
  it('retries a network failure (no response) once', () => {
    expect(shouldRetry(0, new Error('Network Error'))).toBe(true);
    expect(shouldRetry(1, new Error('Network Error'))).toBe(false);
  });

  it('retries a 5xx once', () => {
    expect(shouldRetry(0, { response: { status: 503 } })).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('never retries a %s', (status) => {
    expect(shouldRetry(0, { response: { status } })).toBe(false);
  });
});

describe('persistence whitelist', () => {
  const query = (root: string, status: 'success' | 'error' = 'success') =>
    ({ queryKey: [root, 1], state: { status } }) as never;

  it('persists reference data and the timetable', () => {
    for (const root of ['classes', 'subjects', 'staff', 'academicYears', 'timetable']) {
      expect(shouldPersistQuery(query(root))).toBe(true);
    }
  });

  it.each(['students', 'studentDashboard', 'feePayments', 'marks', 'attendance', 'childFees'])(
    'keeps %s in memory only', (root) => {
      expect(shouldPersistQuery(query(root))).toBe(false);
    },
  );

  it('does not persist a failed query', () => {
    expect(shouldPersistQuery(query('classes', 'error'))).toBe(false);
  });

  it('never persists a money root', () => {
    for (const root of MONEY_QUERY_ROOTS) expect(PERSISTED_QUERY_ROOTS.has(root)).toBe(false);
  });
});

describe('scopedKey', () => {
  it('puts the root first and the school second', () => {
    expect(scopedKey('students', 7, ['abc'])).toEqual(['students', 7, 'abc']);
  });

  it('gives two schools different keys', () => {
    expect(scopedKey('classes', 1)).not.toEqual(scopedKey('classes', 2));
  });
});

describe('money rules', () => {
  it('makes money queries always stale and invalidates them after any mutation', async () => {
    const client = installMoneyRules(new QueryClient());
    expect(client.getQueryDefaults(['feePayments']).staleTime).toBe(0);
    expect(client.getQueryDefaults(['classes']).staleTime).toBeUndefined();

    client.setQueryData(['feePayments', 1], { total: 10 });
    client.setQueryData(['classes', 1], ['A']);

    await client.getMutationCache().build(client, { mutationFn: async () => 'ok' }).execute(undefined);

    expect(client.getQueryState(['feePayments', 1])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['classes', 1])?.isInvalidated).toBe(false);
  });
});

describe('queryViewState', () => {
  const base = { isLoading: false, isError: false, hasData: false, isEmpty: false };

  it('shows loading on the first load', () => {
    expect(queryViewState({ ...base, isLoading: true })).toBe('loading');
  });

  it('shows an error when there is nothing to fall back on', () => {
    expect(queryViewState({ ...base, isError: true })).toBe('error');
  });

  it('keeps showing data when a background refetch fails', () => {
    expect(queryViewState({ ...base, isError: true, hasData: true })).toBe('content');
  });

  it('distinguishes empty from content', () => {
    expect(queryViewState({ ...base, hasData: true, isEmpty: true })).toBe('empty');
    expect(queryViewState({ ...base, hasData: true })).toBe('content');
  });
});
