import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { notificationsApi } from '../services/api';
import {
  registerForPushNotifications,
  unregisterPushToken,
  configureNotificationHandlers,
} from '../services/notifications';
import { useAuth } from './AuthContext';

interface NotificationContextType {
  unreadCount: number;
  pushToken: string | null;
  refreshUnreadCount: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType>({
  unreadCount: 0,
  pushToken: null,
  refreshUnreadCount: async () => {},
});

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const pushTokenRef = useRef<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const response = await notificationsApi.getUnreadCount();
      setUnreadCount(response.data.count ?? response.data.unread_count ?? 0);
    } catch {
      // silent
    }
  }, []);

  // Register push token on login
  useEffect(() => {
    if (!user) return;

    (async () => {
      const token = await registerForPushNotifications();
      pushTokenRef.current = token;
      setPushToken(token);
    })();

    refreshUnreadCount();
  }, [user, refreshUnreadCount]);

  // Configure notification handlers
  useEffect(() => {
    if (!user) return;

    const cleanup = configureNotificationHandlers(
      // On notification received in foreground
      () => {
        refreshUnreadCount();
      },
      // On notification tapped
      (response: Notifications.NotificationResponse) => {
        const data = response.notification.request.content.data;
        if (data?.screen) {
          router.push(data.screen as string);
        }
        refreshUnreadCount();
      },
    );

    return cleanup;
  }, [user, router, refreshUnreadCount]);

  // Provide cleanup for logout
  useEffect(() => {
    if (user) return;

    // User logged out — unregister token
    if (pushTokenRef.current) {
      unregisterPushToken(pushTokenRef.current);
      pushTokenRef.current = null;
      setPushToken(null);
    }
    setUnreadCount(0);
  }, [user]);

  return (
    <NotificationContext.Provider value={{ unreadCount, pushToken, refreshUnreadCount }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationContext);
}
