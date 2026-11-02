import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { schoolDirectoryApi } from '../services/api';
import { getSchoolCode } from '../services/auth';
import type { PublicSchool } from '../services/schoolFinder';

// The school saved on this phone, with its name and logo for the sign-in page.
export function useSavedSchool() {
  const [code, setCode] = useState<string | null | undefined>(undefined);
  useEffect(() => { getSchoolCode().then(setCode, () => setCode(null)); }, []);
  const info = useQuery({
    queryKey: ['schoolInfo', code],
    queryFn: async () => {
      const d = (await schoolDirectoryApi.info(code as string)).data as PublicSchool;
      return { subdomain: d.subdomain, name: d.name, logo: d.logo };
    },
    enabled: !!code,
    staleTime: 10 * 60_000,
    retry: false,
  });
  return { code, school: info.data ?? null, loading: code === undefined || (!!code && info.isLoading), error: info.error };
}
