import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { authApi } from './api';

/**
 * Register for push notifications:
 * 1. Request permission
 * 2. Get Expo push token
 * 3. POST to backend /api/auth/register-push-token/
 */
export async function registerForPushNotifications(): Promise<string | null> {

  // Check existing permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request if not granted
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission denied');
    return null;
  }

  // Get Expo push token
  const tokenData = await Notifications.getExpoPushTokenAsync();
  const pushToken = tokenData.data;

  // Register with backend
  const deviceType = Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
  try {
    await authApi.registerPushToken({ token: pushToken, device_type: deviceType });
  } catch (error) {
    console.error('Failed to register push token with backend:', error);
  }

  // Configure Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#4F46E5',
    });
  }

  return pushToken;
}

/**
 * Unregister push token from backend (on logout).
 */
export async function unregisterPushToken(token: string): Promise<void> {
  try {
    await authApi.unregisterPushToken({ token });
  } catch (error) {
    console.error('Failed to unregister push token:', error);
  }
}

/**
 * Configure notification handlers (call once on app init).
 */
export function configureNotificationHandlers(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationTapped?: (response: Notifications.NotificationResponse) => void,
) {
  // How to handle notifications when app is in foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  // Foreground notification listener
  const receivedSubscription = Notifications.addNotificationReceivedListener(
    (notification) => {
      onNotificationReceived?.(notification);
    },
  );

  // Notification tap listener (app opened from notification)
  const responseSubscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      onNotificationTapped?.(response);
    },
  );

  return () => {
    receivedSubscription.remove();
    responseSubscription.remove();
  };
}
