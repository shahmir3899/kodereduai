import React from 'react';
import { Slot } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { NotificationProvider } from '../contexts/NotificationContext';
import { ToastProvider } from '../components/ui/Toast';
import OfflineBanner from '../components/ui/OfflineBanner';
import { queryClient, queryPersistOptions, setupQueryManagers } from '../services/queryClient';

setupQueryManagers();

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
