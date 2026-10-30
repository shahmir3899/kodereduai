import React from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import Spinner from '../ui/Spinner';
import type { Persona } from '../../navigation/personas';

// Mirrors the web's *AccessRoute guards: a deep link or stale tab into another persona's
// group bounces to "/", which routes the user to their own home.
export default function RoleGuard({ persona, children }: { persona: Persona; children: React.ReactNode }) {
  const { loading, isAuthenticated, persona: mine } = useAuth();
  if (loading) return <Spinner fullScreen message="Loading..." />;
  if (!isAuthenticated) return <Redirect href="/(auth)/login" />;
  if (mine !== persona) return <Redirect href="/" />;
  return <>{children}</>;
}
