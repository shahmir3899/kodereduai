import React, { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/ui/Spinner';
import { homeRouteFor } from '../navigation/personas';
import { ownRouteForPath } from '../navigation/routes';
import { getSchoolCode } from '../services/auth';

export default function Index() {
  const { loading, isAuthenticated, persona } = useAuth();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      // A new phone has no school yet: start on the school search. Later launches open that
      // school's sign-in page.
      getSchoolCode().then(
        (code) => router.replace(code ? '/(auth)/login' : '/(auth)/school'),
        () => router.replace('/(auth)/login'),
      );
      return;
    }

    router.replace((next && ownRouteForPath(persona, next)) || (homeRouteFor(persona) as any));
  }, [loading, isAuthenticated, persona, router, next]);

  return <Spinner fullScreen message="Loading..." />;
}
