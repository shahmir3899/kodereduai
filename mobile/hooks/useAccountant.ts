import { financeApi } from '../services/api';
import { listOf } from '../services/academicYear';
import {
  normalizeFeeSummary, periodRange, type AccountBalance, type Period, type RecentEntry,
} from '../services/accountant';
import type { FeePayment } from '../services/feeCollect';
import { useAcademicYear } from './useAcademicYear';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

// Read-only finance data for the Accountant. Every root is a money root (services/queryRules.ts),
// so none of it is persisted or served stale.

export function useAccountBalances() {
  return useScopedQuery('accounts', ['balances'], async () =>
    listOf<AccountBalance>((await financeApi.getAccountBalances()).data));
}

export function useRecentEntries(limit = 8) {
  return useScopedQuery('finance', ['recent', limit], async () =>
    listOf<RecentEntry>((await financeApi.getRecentEntries({ limit })).data));
}

// This month's MONTHLY fees, the same definition every web dashboard uses.
export function useMonthFeeSummary() {
  const { current } = useAcademicYear();
  const now = new Date();
  return useScopedQuery('feeSummary', ['month', now.getMonth() + 1, now.getFullYear(), current?.id ?? null], async () =>
    normalizeFeeSummary((await financeApi.getMonthlySummary({
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      fee_type: 'MONTHLY',
      ...(current?.id ? { academic_year: current.id } : {}),
    })).data));
}

export function useFinanceSummary(period: Period) {
  const { from, to } = periodRange(period);
  return useScopedQuery('finance', ['summary', from, to], async () =>
    (await financeApi.getFinanceSummary({ date_from: from, date_to: to })).data as {
      total_income?: number | string; total_expenses?: number | string;
    });
}

export function useOverdueFees(limit = 8) {
  return useScopedQuery('feePayments', ['unpaid', limit], async () =>
    listOf<FeePayment>((await financeApi.getFeePayments({ status: 'UNPAID', ordering: '-due_date', page_size: limit })).data));
}

// A finance list (fee payments, expenses, other income) as an infinite query.
export function useFinanceList<Item>(
  root: 'feePayments' | 'expenses' | 'otherIncome',
  fetcher: (params: Record<string, unknown>) => Promise<{ data: unknown }>,
  filters: Record<string, unknown>,
) {
  return useScopedPagedQuery<Item>(root, ['list', JSON.stringify(filters)], async (page) => {
    const data = (await fetcher({ page, page_size: 20, ...filters })).data as
      { results?: Item[]; next?: string | null; count?: number } | Item[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}
