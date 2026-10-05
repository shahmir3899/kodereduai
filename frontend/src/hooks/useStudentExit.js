import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { studentExitsApi } from '../services/api'

// The student's open exit case (at most one), plus the actions that move it along.
// Every action returns the updated case from the server, which replaces the cache.
export function useStudentExit(studentId, { enabled = true } = {}) {
  const queryClient = useQueryClient()
  const key = ['studentExit', String(studentId)]

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const res = await studentExitsApi.list({ student: studentId, status: 'OPEN' })
      const rows = res.data?.results || res.data || []
      return rows[0] || null
    },
    enabled: enabled && !!studentId,
    staleTime: 0,
  })

  const store = (res) => {
    queryClient.setQueryData(key, res.data)
    return res
  }

  // After finalizing or cancelling, everything that shows the student is stale.
  const settle = () => {
    queryClient.setQueryData(key, null)
    const id = String(studentId)
    queryClient.invalidateQueries({ queryKey: ['student', id] })
    queryClient.invalidateQueries({ queryKey: ['studentProfileSummary', id] })
    queryClient.invalidateQueries({ queryKey: ['students'] })
  }

  return {
    exitCase: query.data || null,
    isLoading: query.isLoading,
    start: useMutation({ mutationFn: (data) => studentExitsApi.start({ student: studentId, ...data }), onSuccess: store }),
    update: useMutation({ mutationFn: ({ id, data }) => studentExitsApi.update(id, data), onSuccess: store }),
    refresh: useMutation({ mutationFn: (id) => studentExitsApi.refresh(id), onSuccess: store }),
    waive: useMutation({ mutationFn: ({ id, kind, reason }) => studentExitsApi.waive(id, kind, reason), onSuccess: store }),
    unwaive: useMutation({ mutationFn: ({ id, kind }) => studentExitsApi.unwaive(id, kind), onSuccess: store }),
    // Transfers only: hand the pending fees to the new branch instead of waiving them.
    carry: useMutation({ mutationFn: ({ id, kind }) => studentExitsApi.carry(id, kind), onSuccess: store }),
    finalize: useMutation({ mutationFn: (id) => studentExitsApi.finalize(id), onSuccess: settle }),
    cancel: useMutation({ mutationFn: ({ id, reason }) => studentExitsApi.cancel(id, reason), onSuccess: settle }),
  }
}

// The classes (and the rolls already taken) a transferring student can join at the
// destination branch, for the academic year of the leaving date.
export function useDestinationClasses(school, leavingDate, enabled) {
  return useQuery({
    queryKey: ['studentExitDestinationClasses', String(school), leavingDate],
    queryFn: async () => (await studentExitsApi.destinationClasses({ school, leaving_date: leavingDate })).data,
    enabled: !!enabled && !!school && !!leavingDate,
    staleTime: 60_000,
    retry: false,
  })
}

export function useExitDestinations(enabled) {
  return useQuery({
    queryKey: ['studentExitDestinations'],
    queryFn: async () => (await studentExitsApi.destinations()).data || [],
    enabled,
    staleTime: 5 * 60_000,
  })
}
