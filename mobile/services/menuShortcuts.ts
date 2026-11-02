import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavGroup, NavItem } from '../navigation/navConfig';
import { openableItems } from './menuSearch';

// Pinned and recently opened menu entries, kept on this phone per person and school. Entries are
// stored by their web path (stable) and resolved against what the person can open today, so a
// screen they lost access to simply stops showing.
export interface Shortcuts { pins: string[]; recents: string[] }

export const MAX_PINS = 6;
export const MAX_RECENTS = 4;
export const EMPTY_SHORTCUTS: Shortcuts = { pins: [], recents: [] };

export function togglePin(s: Shortcuts, webPath: string): Shortcuts {
  if (s.pins.includes(webPath)) return { ...s, pins: s.pins.filter((p) => p !== webPath) };
  if (s.pins.length >= MAX_PINS) return s;
  return { ...s, pins: [...s.pins, webPath] };
}

// Newest first, no repeats, capped.
export function addRecent(s: Shortcuts, webPath: string): Shortcuts {
  return { ...s, recents: [webPath, ...s.recents.filter((p) => p !== webPath)].slice(0, MAX_RECENTS) };
}

// What to show at the top: pins in pinned order, then recents that are not already pinned.
export function resolveShortcuts(groups: NavGroup[], s: Shortcuts): { pins: NavItem[]; recents: NavItem[] } {
  const byPath = new Map(openableItems(groups).map((it) => [it.webPath, it]));
  const pick = (paths: string[]) => paths.map((p) => byPath.get(p)).filter((it): it is NavItem & { group: string } => !!it);
  return { pins: pick(s.pins), recents: pick(s.recents.filter((p) => !s.pins.includes(p))) };
}

const keyFor = (userId: number | string | undefined, schoolId: number | string | undefined) => `menuShortcuts:${userId ?? 'x'}:${schoolId ?? 'x'}`;

export async function loadShortcuts(userId?: number | string, schoolId?: number | string): Promise<Shortcuts> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, schoolId));
    if (!raw) return EMPTY_SHORTCUTS;
    const v = JSON.parse(raw);
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((p): p is string => typeof p === 'string') : []);
    return { pins: list(v?.pins).slice(0, MAX_PINS), recents: list(v?.recents).slice(0, MAX_RECENTS) };
  } catch { return EMPTY_SHORTCUTS; }
}

// Storage can be unavailable; the shortcuts then just are not kept.
export async function saveShortcuts(userId: number | string | undefined, schoolId: number | string | undefined, s: Shortcuts): Promise<void> {
  try { await AsyncStorage.setItem(keyFor(userId, schoolId), JSON.stringify(s)); } catch { /* not kept */ }
}
