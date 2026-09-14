import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'

// localStorage key the persister writes the cache snapshot under. Exported so
// AuthContext can remove it alongside queryClient.clear() on logout/school
// switch — otherwise a stale snapshot could rehydrate for the next person to
// sign in on the same browser (school computers, shared devices).
export const QUERY_PERSIST_KEY = 'eduai-query-cache'

// Only the reference-data tier gets persisted to disk — the same queries we
// gave a 2-5min staleTime (classes, subjects, staff, session rosters,
// academic years). Everything else (balances, notifications, student
// records, exam data) stays in-memory only: it either changes too often to
// benefit, or shouldn't linger in localStorage after the tab closes.
const PERSISTED_QUERY_KEY_ROOTS = new Set([
  'classes',
  'subjects',
  'staff',
  'session-classes',
  'classSubjects',
  'academicYears',
])

export function createAppPersister() {
  return createSyncStoragePersister({
    key: QUERY_PERSIST_KEY,
    storage: window.localStorage,
  })
}

export const queryPersistOptions = {
  // Matches the gcTime ceiling used elsewhere; a persisted entry older than
  // this is discarded on restore rather than shown stale.
  maxAge: 10 * 60 * 1000,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      query.state.status === 'success' && PERSISTED_QUERY_KEY_ROOTS.has(query.queryKey[0]),
  },
}
