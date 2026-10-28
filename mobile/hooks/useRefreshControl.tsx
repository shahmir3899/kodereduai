import React, { useState } from 'react';
import { RefreshControl } from 'react-native';

// Pull-to-refresh bound to one or more queries: `refreshControl={useRefreshControl(q.refetch)}`.
// Only the user's own pull spins the indicator, not background refetches.
export function useRefreshControl(...refetchers: Array<() => Promise<unknown>>) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all(refetchers.map((r) => r()));
    } finally {
      setRefreshing(false);
    }
  };
  return <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />;
}
