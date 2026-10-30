import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { setSchoolCode } from '../../../services/auth';
import { parseSchoolCode } from '../../../services/schoolFinder';
import Spinner from '../../../components/ui/Spinner';
import ErrorState from '../../../components/ui/ErrorState';

// Opened by a school's link or QR code (educationai://school/demo): remembers the school and goes to
// its sign-in page. A link that is not a valid code goes back to the school search.
export default function OpenSchoolLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const [bad, setBad] = useState(false);

  useEffect(() => {
    const parsed = parseSchoolCode(String(code ?? ''));
    if (!parsed) return setBad(true);
    setSchoolCode(parsed).then(() => router.replace('/(auth)/login'), () => setBad(true));
  }, [code, router]);

  if (bad) return <ErrorState message="This school link is not valid. Search for your school instead." onRetry={() => router.replace('/(auth)/school')} />;
  return <Spinner fullScreen message="Opening your school..." />;
}
