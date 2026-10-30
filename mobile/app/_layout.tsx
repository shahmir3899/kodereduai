import React from 'react';
import { Text, TextInput } from 'react-native';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { NotificationProvider } from '../contexts/NotificationContext';
import { ToastProvider } from '../components/ui/Toast';
import OfflineBanner from '../components/ui/OfflineBanner';
import { reportCrash, startCrashReporting } from '../services/crashReporting';
import AppCrashScreen from '../components/ui/AppCrashScreen';
import { queryClient, queryPersistOptions, setupQueryManagers } from '../services/queryClient';

startCrashReporting();
setupQueryManagers();

// Honour the phone's text-size setting, but cap it: at the largest settings the dense screens
// (marks and attendance grids, tab labels) overflow and become unusable.
const TEXT_SCALE_CAP = 1.6;
(Text as any).defaultProps = { ...((Text as any).defaultProps ?? {}), maxFontSizeMultiplier: TEXT_SCALE_CAP };
(TextInput as any).defaultProps = { ...((TextInput as any).defaultProps ?? {}), maxFontSizeMultiplier: TEXT_SCALE_CAP };

// Expo Router renders this when any screen throws while rendering, instead of a white screen.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  React.useEffect(() => reportCrash(error), [error]);
  return <AppCrashScreen onRetry={retry} />;
}

function Navigator() {
  const { schoolEpoch } = useAuth();
  return <Slot key={schoolEpoch} />;
}

export default function RootLayout() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={queryPersistOptions}>
      <AuthProvider>
        <NotificationProvider>
          <ToastProvider>
            <StatusBar style="dark" />
            <Navigator />
            <OfflineBanner />
          </ToastProvider>
        </NotificationProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
