import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { getActiveJourney, getLastReportAt, getPermissionState, getQueuedCount } from '../services/location';
import type { ActiveJourney, PermissionState } from '../services/tracking';

// What this phone is currently reporting, read from storage each time the screen is focused
// (the background task writes it, and it survives the app being killed).
export function useTrackedJourney() {
  const [journey, setJourney] = useState<ActiveJourney | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [queued, setQueued] = useState(0);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const [j, ok, q, p] = await Promise.all([getActiveJourney(), getLastReportAt(), getQueuedCount(), getPermissionState().catch(() => null)]);
    setJourney(j);
    setLastOk(ok);
    setQueued(q);
    setPermission(p);
    setLoaded(true);
  }, []);

  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));

  return { journey, lastOk, queued, permission, loaded, refresh };
}
