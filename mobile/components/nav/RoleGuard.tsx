import React from 'react';
import { Redirect, useGlobalSearchParams, usePathname } from 'expo-router';
import { nextWithQuery } from '../../navigation/routes';
import { useAuth } from '../../contexts/AuthContext';
import Spinner from '../ui/Spinner';
import AuraLauncher from '../assistant/AuraLauncher';
import type { Persona } from '../../navigation/personas';

// Mirrors the web's *AccessRoute guards: a deep link or stale tab into another persona's
// group bounces to "/", which routes the user to their own home.
export default function RoleGuard({ persona, children }: { persona: Persona; children: React.ReactNode }) {
  const { loading, isAuthenticated, persona: mine } = useAuth();
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  if (loading) return <Spinner fullScreen message="Loading..." />;
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  // The wanted path and its query ride along so the index can open the same screen in the user's own group.
  if (mine !== persona) return <Redirect href={{ pathname: '/', params: { next: nextWithQuery(pathname, params) } }} />;
  return <>{children}<AuraLauncher /></>;
}
