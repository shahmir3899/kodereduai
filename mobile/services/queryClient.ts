import { AppState, Platform } from 'react-native';
import type { AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { PERSISTED_QUERY_ROOTS, installMoneyRules, shouldPersistQuery, shouldRetry } from './queryRules';

export const QUERY_PERSIST_KEY = 'eduai-mobile-query-cache';

// A persisted entry older than this is discarded on restore rather than shown stale.
const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,
      // 'offlineFirst' tries the request once even with no connection, so an offline first load
      // fails into an error screen instead of sitting paused (which screens read as "empty").
      networkMode: 'offlineFirst',
      // No point retrying while offline: the retry would just pause and hang the screen.
      retry: (failureCount: number, error: unknown) =>
        onlineManager.isOnline() && shouldRetry(failureCount, error),
      refetchOnReconnect: true,
    },
    // A save must fail now with "no connection", not queue silently and fire later.
    mutations: { networkMode: 'always' },
  },
});
installMoneyRules(queryClient);

// Persisted queries must stay in memory at least as long as they may be restored.
PERSISTED_QUERY_ROOTS.forEach((root) => queryClient.setQueryDefaults([root], { gcTime: PERSIST_MAX_AGE_MS }));

export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: QUERY_PERSIST_KEY,
});

export const queryPersistOptions = {
  persister: queryPersister,
  maxAge: PERSIST_MAX_AGE_MS,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
};

// Called on logout and school switch so the next person (or school) never sees the last one's data.
export async function clearQueryCache(): Promise<void> {
  queryClient.clear();
  try {
    await AsyncStorage.removeItem(QUERY_PERSIST_KEY);
  } catch {
    // Non-fatal: the in-memory cache is already gone and school-scoped keys stop any leak.
  }
}

let managersReady = false;
export function setupQueryManagers(): void {
  if (managersReady) return;
  managersReady = true;

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
  );

  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (status: AppStateStatus) => {
      focusManager.setFocused(status === 'active');
    });
  }
}
