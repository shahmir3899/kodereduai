import type { NavGroup, NavItem } from '../navigation/navConfig';

// Filters the menu as the person types: an entry matches when its name, or its group's name, holds
// every typed word (so "fee col" finds "Collect Payments" under Finance only if the words are there).
// Groups with no match are dropped, and a blank query keeps everything.
export function filterGroups(groups: NavGroup[], query: string): NavGroup[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups
    .map((g) => {
      const groupName = g.name.toLowerCase();
      const items = g.items.filter((it) => {
        const hay = `${it.name.toLowerCase()} ${groupName}`;
        return words.every((w) => hay.includes(w));
      });
      return { ...g, items };
    })
    .filter((g) => g.items.length > 0);
}

// Every openable entry (a built screen), each with its group, for resolving pins and recents.
export function openableItems(groups: NavGroup[]): Array<NavItem & { group: string }> {
  return groups.flatMap((g) => g.items.filter((it) => !!it.href).map((it) => ({ ...it, group: g.name })));
}
