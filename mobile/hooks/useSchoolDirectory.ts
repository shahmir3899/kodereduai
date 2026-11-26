import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { schoolDirectoryApi } from '../services/api';
import type { DirectorySchool } from '../services/schoolSearch';

const KEY = 'schoolDirectory:v1';

interface Stored { etag: string | null; items: DirectorySchool[] }

function isSchool(x: unknown): x is DirectorySchool {
  const s = x as DirectorySchool;
  return !!s && typeof s.code === 'string' && typeof s.name === 'string';
}

// Every active school's code and name, for the "Find your school" name search. It is never shown
// as a list; it is only searched. The copy kept on the phone is used at once (search works
// instantly, even offline), and the screen quietly asks the server whether it changed: an
// unchanged list costs one empty 304. When nothing can be loaded the list stays empty and the
// exact-code lookup still works.
export function useSchoolDirectory(): DirectorySchool[] {
  const [items, setItems] = useState<DirectorySchool[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      let stored: Stored | null = null;
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const v = raw ? JSON.parse(raw) : null;
        if (v && Array.isArray(v.items)) stored = { etag: typeof v.etag === 'string' ? v.etag : null, items: v.items.filter(isSchool) };
      } catch { /* storage unavailable: start from the server */ }
      if (live && stored) setItems(stored.items);

      try {
        const res = await schoolDirectoryApi.list(stored?.etag);
        if (res.status === 304 || !Array.isArray(res.data)) return;
        const fresh = (res.data as unknown[]).filter(isSchool);
        if (live) setItems(fresh);
        const etag = (res.headers?.etag as string | undefined) ?? null;
        try { await AsyncStorage.setItem(KEY, JSON.stringify({ etag, items: fresh })); } catch { /* not kept */ }
      } catch { /* offline or server down: keep the stored copy */ }
    })();
    return () => { live = false; };
  }, []);

  return items;
}
