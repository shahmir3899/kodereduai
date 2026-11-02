import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavGroup } from '../navigation/navConfig';

// Which menu groups are open. The person's own taps are kept (per person and school, on this
// phone); a group they never touched follows the defaults below.
export type Overrides = Record<string, boolean>;

// Groups this small are not worth a tap to open, so they stay open.
export const ALWAYS_OPEN_MAX = 2;

// '/(admin)/finance/accounts' -> '/finance/accounts', to compare with the current path.
export const plainPath = (href: string) => href.replace(/\/\([^)]*\)/g, '') || '/';

export function containsPath(group: NavGroup, path: string): boolean {
  const here = plainPath(path);
  return group.items.some((it) => {
    if (!it.href) return false;
    const p = plainPath(it.href);
    return here === p || here.startsWith(`${p}/`);
  });
}

// Searching shows every matching group open; otherwise the person's choice wins, then the default:
// open when small or when it holds the screen they are on.
export function isGroupOpen(group: NavGroup, overrides: Overrides, currentPath: string, searching: boolean): boolean {
  if (searching) return true;
  const own = overrides[group.name];
  if (own !== undefined) return own;
  return group.items.length <= ALWAYS_OPEN_MAX || containsPath(group, currentPath);
}

export function toggleGroup(overrides: Overrides, group: NavGroup, currentPath: string): Overrides {
  return { ...overrides, [group.name]: !isGroupOpen(group, overrides, currentPath, false) };
}

const keyFor = (userId?: number | string, schoolId?: number | string) => `menuCollapse:${userId ?? 'x'}:${schoolId ?? 'x'}`;

export async function loadOverrides(userId?: number | string, schoolId?: number | string): Promise<Overrides> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, schoolId));
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'boolean')) as Overrides;
  } catch { return {}; }
}

export async function saveOverrides(userId: number | string | undefined, schoolId: number | string | undefined, o: Overrides): Promise<void> {
  try { await AsyncStorage.setItem(keyFor(userId, schoolId), JSON.stringify(o)); } catch { /* not kept */ }
}
