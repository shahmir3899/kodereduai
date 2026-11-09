import React from 'react';
import { Redirect, router } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import AuraChat from '../components/assistant/AuraChat';
import { assistantEnabled } from '../services/assistantFlag';

// Outside every role group on purpose: one screen for all roles. It has no role guard of its own, so it checks
// for a signed-in user here, and the server decides what Aura may do for that person.
export default function AuraScreen() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated || !assistantEnabled()) return <Redirect href="/" />;
  return <AuraChat onClose={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}
