import React from 'react';
import { Redirect, usePathname } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import Spinner from '../ui/Spinner';
import type { Persona } from '../../navigation/personas';

// Mirrors the web's *AccessRoute guards: a deep link or stale tab into another persona's
// group bounces to "/", which routes the user to their own home.
export default function RoleGuard({ persona, children }: { persona: Persona; children: React.ReactNode }) {
  const { loading, isAuthenticated, persona: mine } = useAuth();
  const pathname = usePathname();
  if (loading) return <Spinner fullScreen message="Loading..." />;
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  // The wanted path rides along so the index can open the same screen in the user's own group.
  if (mine !== persona) return <Redirect href={{ pathname: '/', params: { next: pathname } }} />;
  return <>{children}</>;
}
