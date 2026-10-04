import { useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '../services/api'

// Cached responses are axios results: { data: student } for one student and
// { data: [students] } or { data: { results: [students] } } for lists.
function patchStudent(student, id, payload) {
  return String(student?.id) === String(id) ? { ...student, ...payload } : student
}

function patchCached(old, id, payload) {
  const body = old?.data
  if (!body) return old
  if (Array.isArray(body)) return { ...old, data: body.map((s) => patchStudent(s, id, payload)) }
  if (Array.isArray(body.results)) {
    return { ...old, data: { ...body, results: body.results.map((s) => patchStudent(s, id, payload)) } }
  }
  return String(body.id) === String(id) ? { ...old, data: { ...body, ...payload } } : old
}

// Saves profile fields with an optimistic cache update: the student detail and
// every cached student list show the new values immediately, and roll back if the
// server rejects the save. Only the fields actually sent are patched, so derived
// values (class name, roll from the enrollment) are never guessed.
//
// Call mutateAsync({ id, payload }). Status changes and reclassify are not routed
// through here: the server validates those heavily, so they wait for its answer.
export function useUpdateStudent({ onSuccess } = {}) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }) => studentsApi.updateStudent(id, payload),

    onMutate: async ({ id, payload }) => {
      const detailKey = ['student', String(id)]
      const listKey = ['students']
      // An in-flight refetch would land after our patch and overwrite it with stale data.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: listKey }),
      ])
      const snapshots = [
        ...queryClient.getQueriesData({ queryKey: detailKey }),
        ...queryClient.getQueriesData({ queryKey: listKey }),
      ]
      queryClient.setQueriesData({ queryKey: detailKey }, (old) => patchCached(old, id, payload))
      queryClient.setQueriesData({ queryKey: listKey }, (old) => patchCached(old, id, payload))
      return { snapshots }
    },

    onError: (_error, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data))
    },

    onSuccess: (response, vars) => onSuccess?.(response, vars),

    onSettled: (_data, _error, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['student', String(id)] })
      queryClient.invalidateQueries({ queryKey: ['studentProfileSummary', String(id)] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
    },
  })
}
