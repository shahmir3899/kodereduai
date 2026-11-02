import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { addRecent, EMPTY_SHORTCUTS, loadShortcuts, saveShortcuts, togglePin, type Shortcuts } from '../services/menuShortcuts';

// Pinned and recent menu entries for the signed-in person in the active school (kept on this phone).
export function useMenuShortcuts() {
  const { user, activeSchool } = useAuth();
  const userId = user?.id;
  const schoolId = activeSchool?.id;
  const [shortcuts, setShortcuts] = useState<Shortcuts>(EMPTY_SHORTCUTS);
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    let live = true;
    setShortcuts(EMPTY_SHORTCUTS);
    loadShortcuts(userId, schoolId).then((s) => { if (live) setShortcuts(s); });
    return () => { live = false; };
  }, [userId, schoolId]);

  const update = useCallback((next: Shortcuts) => {
    setShortcuts(next);
    saveShortcuts(userId, schoolId, next);
  }, [userId, schoolId]);

  const pin = useCallback((webPath: string) => update(togglePin(latest.current, webPath)), [update]);
  const visit = useCallback((webPath: string) => update(addRecent(latest.current, webPath)), [update]);
  return { shortcuts, pin, visit };
}
