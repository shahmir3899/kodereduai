import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { notificationsApi } from '../services/api';
import {
  registerForPushNotifications,
  configureNotificationHandlers,
} from '../services/notifications';
import { notificationTapRoute } from '../services/notificationRoute';
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
  const { user, persona } = useAuth();
  const router = useRouter();
  const [unreadCount, setUnreadCount] = useState(0);
  const pushTokenRef = useRef<string | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);

  const refreshUnreadCount = useCallback(async () => {
    try {
      const response = await notificationsApi.getUnreadCount();
      setUnreadCount(response.data.unread_count ?? response.data.count ?? 0);
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

  // The web bell polls every 30s; do the same while the app is in front, so a notification that
  // arrives without a push still lights the badge. Paused in the background to spare battery/data.
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => { if (!timer) timer = setInterval(refreshUnreadCount, 30_000); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') { refreshUnreadCount(); start(); } else stop();
    });
    return () => { stop(); sub.remove(); };
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
        const route = notificationTapRoute(persona, data);
        if (route) router.push(route as Href);
        refreshUnreadCount();
      },
    );

    return cleanup;
  }, [user, persona, router, refreshUnreadCount]);

  // Provide cleanup for logout
  useEffect(() => {
    if (user) return;

    // The server-side unregister already happened in AuthContext before sign-out; here only
    // local state is reset.
    pushTokenRef.current = null;
    setPushToken(null);
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
