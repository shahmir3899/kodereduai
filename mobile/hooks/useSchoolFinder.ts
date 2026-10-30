import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { schoolDirectoryApi } from '../services/api';
import { getSchoolCode } from '../services/auth';
import type { PublicSchool } from '../services/schoolFinder';

// Every school that chose to be listed, downloaded once and filtered on the phone as you type. It is
// public data, so it is kept on the phone and works offline after the first load.
export function useSchoolDirectory() {
  return useQuery({
    queryKey: ['schoolDirectory'],
    queryFn: async () => (await schoolDirectoryApi.directory()).data as PublicSchool[],
    staleTime: 10 * 60_000,
    retry: 1,
  });
}

// The school saved on this phone, with its name and logo for the sign-in page.
export function useSavedSchool() {
  const [code, setCode] = useState<string | null | undefined>(undefined);
  useEffect(() => { getSchoolCode().then(setCode, () => setCode(null)); }, []);
  const info = useQuery({
    queryKey: ['schoolInfo', code],
    queryFn: async () => (await schoolDirectoryApi.info(code as string)).data as PublicSchool,
    enabled: !!code,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return { code, school: info.data ?? null, loading: code === undefined || (!!code && info.isLoading), error: info.error };
}
