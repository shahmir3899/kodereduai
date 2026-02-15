import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import Spinner from '../components/ui/Spinner';

export default function Index() {
  const { loading, isAuthenticated, isParent, isStudent } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;

    if (!isAuthenticated) {
      router.replace('/(auth)/login');
      return;
    }

    // Route to role-appropriate dashboard
    if (isParent) {
      router.replace('/(parent)/dashboard');
    } else if (isStudent) {
      router.replace('/(student)/dashboard');
    } else {
      router.replace('/(admin)/dashboard');
    }
  }, [loading, isAuthenticated, isParent, isStudent, router]);

  return <Spinner fullScreen message="Loading..." />;
}
