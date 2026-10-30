import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { schoolDirectoryApi } from '../services/api';
import { getSchoolCode } from '../services/auth';
import { shouldSearch, SEARCH_DEBOUNCE_MS, type PublicSchool } from '../services/schoolFinder';
import { useDebouncedValue } from './useDebouncedValue';

// Name or code search for the front screen. Not school-scoped (nobody is signed in) and never cached
// beyond a minute: a school that just switched itself on should show up.
export function useSchoolSearch(text: string) {
  const term = useDebouncedValue(text.trim(), SEARCH_DEBOUNCE_MS);
  return useQuery({
    queryKey: ['schoolSearch', term],
    queryFn: async () => (await schoolDirectoryApi.search(term)).data as PublicSchool[],
    enabled: shouldSearch(term),
    staleTime: 60_000,
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
