// Money numbers must never come from the browser cache. Two rules, installed once per
// QueryClient: (1) these query roots are always stale, so every mount refetches, and
// (2) any successful mutation invalidates them, so a payment/transfer/expense saved on one
// screen can't leave an old balance mounted on another. Invalidation is blanket rather than
// per-mutation on purpose — only currently-mounted money queries actually refetch.
// Category lists (annual-categories, monthly-categories) are reference data and stay cached.
export const MONEY_QUERY_ROOTS = [
  'accounts', 'accountBalances', 'accountBalancesAll', 'accountLedger', 'ledgerPreview',
  'transfers', 'recentTransfers', 'monthlyClosings', 'recentEntries',
  'expenses', 'expenseCategorySummary', 'expenseCategoryReport',
  'financeSummary', 'financeSummaryDash', 'financeSummaryDashboard',
  'monthlyTrend', 'monthlyTrend6',
  'feeSummary', 'feeSummaryDashboard', 'feeSummaryAllDashboard', 'annualFeeDashboard',
  'feePayments', 'overdueFees', 'fee-dup-check', 'generate-preview', 'resolve-fee-amount',
  'otherIncome', 'studentFees', 'childFees', 'paymentStatus',
  'feeStructures', 'feeStructures-all', 'feeStructures-class',
  'annual-fee-structures-all', 'annual-fee-structures-class', 'monthly-fee-structures-all',
  'disc-tab-structures', 'single-struct-structures',
  'disc-tab-assignments', 'disc-tab-discounts-list', 'disc-tab-scholarships-list',
]

const MONEY_ROOT_SET = new Set(MONEY_QUERY_ROOTS)

export function installFinanceQueryRules(queryClient) {
  MONEY_QUERY_ROOTS.forEach((root) => {
    queryClient.setQueryDefaults([root], { staleTime: 0 })
  })
  queryClient.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') {
      queryClient.invalidateQueries({
        predicate: (query) => MONEY_ROOT_SET.has(query.queryKey[0]),
      })
    }
  })
  return queryClient
}
