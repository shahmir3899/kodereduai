import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { transportApi } from './api';

const BACKGROUND_LOCATION_TASK = 'background-location-task';

let activeJourneyId: number | null = null;
let journeyMode: 'student' | 'route' = 'student';

/**
 * Define the background location task.
 * This runs even when the app is in the background.
 */
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: { data: unknown; error: unknown }) => {
  if (error) {
    console.error('Background location error:', error);
    return;
  }

  if (!activeJourneyId) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const latest = locations[locations.length - 1];

  const payload = {
    journey_id: activeJourneyId,
    latitude: latest.coords.latitude,
    longitude: latest.coords.longitude,
    accuracy: latest.coords.accuracy ?? 0,
    speed: latest.coords.speed,
    battery_level: null,
  };

  try {
    if (journeyMode === 'route') {
      await transportApi.updateRouteJourney(payload);
    } else {
      await transportApi.updateJourney(payload);
    }
  } catch (err) {
    console.error('Failed to send location update:', err);
  }
});

/**
 * Request location permissions (foreground + background).
 */
export async function requestLocationPermissions(): Promise<boolean> {
  const { status: foreground } = await Location.requestForegroundPermissionsAsync();
  if (foreground !== 'granted') return false;

  const { status: background } = await Location.requestBackgroundPermissionsAsync();
  return background === 'granted';
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

/**
 * Start background location updates for a journey.
 * @param journeyId - The journey ID to send updates for.
 * @param mode - 'student' for student self-tracking, 'route' for driver route journey.
 * @param notificationBody - Custom notification body text.
 */
export async function startBackgroundLocationUpdates(
  journeyId: number,
  mode: 'student' | 'route' = 'student',
  notificationBody?: string,
): Promise<void> {
  activeJourneyId = journeyId;
  journeyMode = mode;

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
        ? 'Bus location is being tracked.'
        : 'Your location is being shared with your parents.'),
      notificationColor: '#4F46E5',
    },
  });
}

/**
 * Stop background location updates.
 */
export async function stopBackgroundLocationUpdates(): Promise<void> {
  activeJourneyId = null;

  const isStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
}
