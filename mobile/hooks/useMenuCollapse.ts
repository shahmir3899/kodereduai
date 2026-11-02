import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
import { useAuth } from '../contexts/AuthContext';
import { isGroupOpen, loadOverrides, saveOverrides, toggleGroup, type Overrides } from '../services/menuCollapse';
import type { NavGroup } from '../navigation/navConfig';

// Open and closed menu groups for the signed-in person in the active school (kept on this phone).
export function useMenuCollapse(searching: boolean) {
  const { user, activeSchool } = useAuth();
  const userId = user?.id;
  const schoolId = activeSchool?.id;
  const path = usePathname();
  const [overrides, setOverrides] = useState<Overrides>({});
  const latest = useRef(overrides);
  latest.current = overrides;

  useEffect(() => {
    let live = true;
    setOverrides({});
    loadOverrides(userId, schoolId).then((o) => { if (live) setOverrides(o); });
    return () => { live = false; };
  }, [userId, schoolId]);

  const isOpen = useCallback((g: NavGroup) => isGroupOpen(g, overrides, path, searching), [overrides, path, searching]);
  const toggle = useCallback((g: NavGroup) => {
    const next = toggleGroup(latest.current, g, path);
    setOverrides(next);
    saveOverrides(userId, schoolId, next);
  }, [path, userId, schoolId]);
  return { isOpen, toggle };
}
