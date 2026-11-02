import { transportApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type {
  DriverRoute, DriverStop, DriverVehicle, JourneyRow,
} from '../services/driver';
import { sortStops } from '../services/driver';
import { useScopedQuery } from './useScopedQuery';

// The driver's vehicle: null when none is assigned (the API answers 404 for that).
export function useMyVehicle() {
  return useScopedQuery<DriverVehicle | null>('myVehicle', [], async () => {
    try {
      return (await transportApi.getMyVehicle()).data as DriverVehicle;
    } catch (e) {
      if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
      throw e;
    }
  }, { staleTime: 60_000 });
}

export function useRouteDetail(routeId: number | null | undefined) {
  return useScopedQuery<{ route: DriverRoute | null; stops: DriverStop[] }>('driverRoute', [routeId], async () => {
    const [routes, stops] = await Promise.all([
      transportApi.getRoutes({ page_size: 9999 }),
      transportApi.getStops({ route: routeId, page_size: 9999 }),
    ]);
    return {
      route: listOf<DriverRoute>(routes.data).find((r) => r.id === routeId) ?? null,
      stops: sortStops(listOf<DriverStop>(stops.data)),
    };
  }, { enabled: !!routeId, staleTime: 5 * 60_000 });
}

// Recent journeys on the route, newest first: today's trips, and the server's view of a
// journey this phone remembers.
export function useRouteHistory(routeId: number | null | undefined) {
  return useScopedQuery('routeJourneys', [routeId], async () =>
    listOf<JourneyRow>((await transportApi.getRouteJourneyHistory({ route_id: routeId })).data),
  { enabled: !!routeId, staleTime: 0 });
}
