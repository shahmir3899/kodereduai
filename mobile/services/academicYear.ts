export interface AcademicYear {
  id: number;
  name: string;
  is_current?: boolean;
  is_active?: boolean;
}

// The year the app works in: the one the school marked current, else the first listed. (The web
// also remembers a per-school choice; mobile has no year switcher yet.)
export function pickAcademicYear(years: AcademicYear[]): AcademicYear | null {
  return years.find((y) => y.is_current) || years[0] || null;
}

// DRF list endpoints may return a bare array or a paginated { results } object.
export function listOf<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  const results = (data as { results?: unknown } | null | undefined)?.results;
  return Array.isArray(results) ? (results as T[]) : [];
}
