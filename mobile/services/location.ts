import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { transportApi } from './api';
import {
  canTrackInBackground, classifySendError, enqueue, flushNewest, permissionState,
  type ActiveJourney, type PermissionState, type Ping, type SendOutcome,
} from './tracking';
import {
  clearTracking, loadActiveJourney, loadBuffer, loadLastOk, saveActiveJourney, saveBuffer, saveLastOk,
} from './trackingStore';

const BACKGROUND_LOCATION_TASK = 'background-location-task';

function pingFrom(location: Location.LocationObject): Ping {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy ?? 0,
    speed: location.coords.speed ?? null,
    at: location.timestamp || Date.now(),
  };
}

async function sendPing(journey: ActiveJourney, ping: Ping): Promise<SendOutcome> {
  const payload = {
    journey_id: journey.id,
    latitude: ping.latitude,
    longitude: ping.longitude,
    accuracy: ping.accuracy,
    speed: ping.speed,
    battery_level: null,
  };
  try {
    if (journey.mode === 'route') await transportApi.updateRouteJourney(payload);
    else await transportApi.updateJourney(payload);
    return 'ok';
  } catch (error) {
    return classifySendError(error);
  }
}

// Queue the fix, then try to deliver it. Reads the journey from storage on every call: the task
// can wake in a fresh process after the app was killed. Returns false when the server says the
// journey is over (tracking is stopped and forgotten).
export async function reportPosition(location: Location.LocationObject): Promise<boolean> {
  const journey = await loadActiveJourney();
  if (!journey) return false;

  const buffer = enqueue(await loadBuffer(), pingFrom(location));
  const result = await flushNewest(buffer, (ping) => sendPing(journey, ping));

  if (result.gone) {
    await stopBackgroundLocationUpdates();
    return false;
  }
  await saveBuffer(result.remaining);
  if (result.sent) await saveLastOk(Date.now());
  return true;
}

/**
 * Define the background location task.
 * This runs even when the app is in the background or has been swiped away.
 */
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: { data: unknown; error: unknown }) => {
  if (error) {
    console.error('Background location error:', error);
    return;
  }
  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;
  await reportPosition(locations[locations.length - 1]);
});

/** Foreground and background permission as the phone currently has them. */
export async function getPermissionState(): Promise<PermissionState> {
  const [fg, bg] = await Promise.all([Location.getForegroundPermissionsAsync(), Location.getBackgroundPermissionsAsync()]);
  return permissionState(fg.status, bg.status);
}

/** Ask for foreground then background ("allow all the time") permission. */
export async function requestPermissionState(): Promise<PermissionState> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return 'denied';
  const bg = await Location.requestBackgroundPermissionsAsync();
  return permissionState(fg.status, bg.status);
}

/** Request location permissions (foreground + background). */
export async function requestLocationPermissions(): Promise<boolean> {
  return canTrackInBackground(await requestPermissionState());
}

/**
 * Get the current GPS position.
 */
export async function getCurrentLocation(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
  } catch {
    return null;
  }
}

async function startTask(mode: 'student' | 'route', notificationBody?: string): Promise<void> {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isStarted) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 30000,
    distanceInterval: 50,
    deferredUpdatesInterval: 30000,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Journey in progress',
      notificationBody: notificationBody || (mode === 'route'
        ? 'Bus location is being shared with parents.'
        : 'Your location is being shared with your parents.'),
      notificationColor: '#4F46E5',
    },
  });
}

/**
 * Start background location updates for a journey, remembering it so tracking survives the app
 * being killed.
 * @param mode - 'student' for student self-tracking, 'route' for driver route journey.
 */
export async function startBackgroundLocationUpdates(
  journeyId: number,
  mode: 'student' | 'route' = 'student',
  notificationBody?: string,
  meta: Pick<ActiveJourney, 'routeName' | 'journeyType' | 'startedAt'> = { startedAt: new Date().toISOString() },
): Promise<void> {
  await saveActiveJourney({ id: journeyId, mode, ...meta });
  await saveBuffer([]);
  await startTask(mode, notificationBody);
}

/** The journey this phone is reporting, if any (survives a restart). */
export const getActiveJourney = loadActiveJourney;

/** When the server last accepted a position, for the "is it still reporting" warning. */
export const getLastReportAt = loadLastOk;

/** Number of positions waiting for signal. */
export async function getQueuedCount(): Promise<number> {
  return (await loadBuffer()).length;
}

/**
 * After the app restarts: put the location task back if a journey is still remembered. The
 * caller checks with the server that the journey is still active.
 */
export async function resumeTracking(): Promise<ActiveJourney | null> {
  const journey = await loadActiveJourney();
  if (!journey) return null;
  await startTask(journey.mode);
  return journey;
}

/**
 * Stop background location updates and forget the journey.
 */
export async function stopBackgroundLocationUpdates(): Promise<void> {
  await clearTracking();
  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
