import { useMutation, useQueryClient } from '@tanstack/react-query';
import { transportApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { AssignmentRow, RouteRow, StopRow } from '../services/routeMap';
import type { BoardingRecord, TransportAssignmentRow, VehicleRow } from '../services/transportAdmin';
import { useScopedQuery } from './useScopedQuery';

export interface TransportStats { total_routes?: number; total_vehicles?: number; total_students?: number }

export function useTransportStats() {
  return useScopedQuery<TransportStats>('transportStats', [], async () => (await transportApi.getDashboardStats()).data as TransportStats, { staleTime: 0 });
}

export function useRoutes() {
  return useScopedQuery<RouteRow[]>('transportRoutes', [], async () => listOf<RouteRow>((await transportApi.getRoutes({ page_size: 500 })).data), { staleTime: 0 });
}

export function useRouteStops(routeId: number | null) {
  return useScopedQuery<StopRow[]>('transportStops', [routeId], async () => listOf<StopRow>((await transportApi.getStops({ route_id: routeId, page_size: 500 })).data),
    { enabled: routeId != null, staleTime: 0 });
}

export function useRouteAssignments(routeId: number | null) {
  return useScopedQuery<AssignmentRow[]>('transportAssignments', [routeId], async () => listOf<AssignmentRow>((await transportApi.getAssignments({ route_id: routeId, is_active: 'true', page_size: 1000 })).data),
    { enabled: routeId != null, staleTime: 0 });
}

export interface ActiveJourney {
  id: number; route: number; route_name?: string; vehicle_number?: string; driver_name?: string; journey_type_display?: string;
  latest_location?: { latitude: number | string; longitude: number | string; timestamp?: string } | null;
}

// Buses on the road now; refreshed every 15 seconds while a screen that shows them is open.
export function useActiveJourneys(enabled: boolean) {
  return useScopedQuery<ActiveJourney[]>('transportActive', [], async () => listOf<ActiveJourney>((await transportApi.getActiveRouteJourneys()).data),
    { enabled, staleTime: 0, refetchInterval: 15_000 });
}

export function useVehicles() {
  return useScopedQuery<VehicleRow[]>('transportVehicles', [], async () => listOf<VehicleRow>((await transportApi.getVehicles({ page_size: 500 })).data), { staleTime: 0 });
}

// The year's assignments, optionally for one route. (The server has no class filter: the web sends
// class_id and it is ignored, so the phone does not offer one.)
export function useYearAssignments(yearId: number | null, routeId: number | null) {
  return useScopedQuery<TransportAssignmentRow[]>('transportAssignments', ['year', yearId, routeId], async () =>
    listOf<TransportAssignmentRow>((await transportApi.getAssignments({
      academic_year: yearId, page_size: 1000, ...(routeId ? { route_id: routeId } : {}),
    })).data), { enabled: yearId != null, staleTime: 0 });
}

export function useBoarding(routeId: number | null, date: string) {
  return useScopedQuery<BoardingRecord[]>('transportBoarding', [routeId, date], async () =>
    listOf<BoardingRecord>((await transportApi.getAttendance({ route_id: routeId, date, page_size: 1000 })).data),
  { enabled: routeId != null && !!date, staleTime: 0 });
}

const ROOTS = ['transportStats', 'transportRoutes', 'transportStops', 'transportAssignments', 'transport-stats', 'transport-routes', 'transportVehicles', 'transportBoarding'];

export function useTransportActions() {
  const qc = useQueryClient();
  const done = () => ROOTS.forEach((r) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === r }));
  return {
    createRoute: useMutation({ mutationFn: (d: object) => transportApi.createRoute(d), onSuccess: done }),
    updateRoute: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => transportApi.updateRoute(id, data), onSuccess: done }),
    deleteRoute: useMutation({ mutationFn: (id: number) => transportApi.deleteRoute(id), onSuccess: done }),
    duplicateRoute: useMutation({ mutationFn: (id: number) => transportApi.duplicateRoute(id), onSuccess: done }),
    createStop: useMutation({ mutationFn: (d: object) => transportApi.createStop(d), onSuccess: done }),
    updateStop: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => transportApi.updateStop(id, data), onSuccess: done }),
    deleteStop: useMutation({ mutationFn: (id: number) => transportApi.deleteStop(id), onSuccess: done }),
    createVehicle: useMutation({ mutationFn: (d: object) => transportApi.createVehicle(d), onSuccess: done }),
    updateVehicle: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => transportApi.updateVehicle(id, data), onSuccess: done }),
    deleteVehicle: useMutation({ mutationFn: (id: number) => transportApi.deleteVehicle(id), onSuccess: done }),
    createAssignment: useMutation({ mutationFn: (d: object) => transportApi.createAssignment(d), onSuccess: done }),
    bulkAssign: useMutation({ mutationFn: (d: object) => transportApi.bulkAssign(d), onSuccess: done }),
    deleteAssignment: useMutation({ mutationFn: (id: number) => transportApi.deleteAssignment(id), onSuccess: done }),
    markBoarding: useMutation({ mutationFn: (d: object) => transportApi.bulkMarkAttendance(d), onSuccess: done }),
  };
}
