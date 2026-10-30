import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/ui/Spinner';
import { homeRouteFor } from '../navigation/personas';

export default function Index() {
  const { loading, isAuthenticated, persona } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      router.replace('/(auth)/login');
      return;
    }

    router.replace(homeRouteFor(persona) as any);
  }, [loading, isAuthenticated, persona, router]);

  return <Spinner fullScreen message="Loading..." />;
}
