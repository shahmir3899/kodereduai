import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi } from '../../services/api'

/**
 * Data hook for OtherIncomePage — income tracking.
 */
export function useOtherIncome({ month, year }) {
  const queryClient = useQueryClient()

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => financeApi.getAccounts({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })

  const { data: incomeCategoriesData } = useQuery({
    queryKey: ['incomeCategories'],
    queryFn: () => financeApi.getIncomeCategories({ page_size: 9999 }),
  })

  const { data: otherIncomeData, isLoading } = useQuery({
    queryKey: ['otherIncome', month, year],
    queryFn: () => {
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`
      const endDate = new Date(year, month, 0).toISOString().split('T')[0]
      return financeApi.getOtherIncome({ date_from: startDate, date_to: endDate, page_size: 9999 })
    },
  })

  const incomeMutation = useMutation({
    mutationFn: (data) => financeApi.createOtherIncome(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['otherIncome'] }),
  })

  const deleteIncomeMutation = useMutation({
    mutationFn: (id) => financeApi.deleteOtherIncome(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['otherIncome'] }),
  })

  const createCategoryMutation = useMutation({
    mutationFn: (data) => financeApi.createIncomeCategory(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['incomeCategories'] }),
  })

  const incomeList = otherIncomeData?.data?.results || otherIncomeData?.data || []
  const accountsList = accountsData?.data?.results || accountsData?.data || []
  const incomeCategories = incomeCategoriesData?.data?.results || incomeCategoriesData?.data || []

  return {
    incomeList,
    isLoading,
    accountsList,
    incomeCategories,
    incomeMutation,
    deleteIncomeMutation,
    createCategoryMutation,
  }
}
