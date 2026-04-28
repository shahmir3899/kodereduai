export type LandingMetrics = {
  schools: string;
  classes: string;
  students: string;
  activeStudents: string;
  teachers: string;
  countries: string;
  lastUpdated: string;
};

export const FALLBACK_METRICS: LandingMetrics = {
  schools: '1,200+',
  classes: '3,500+',
  students: '450K+',
  activeStudents: '430K+',
  teachers: '35K+',
  countries: '45',
  lastUpdated: 'Live',
};

const formatLastUpdated = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const toDisplayValue = (value: unknown, fallback: string): string => {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M+`;
    if (value >= 100_000)   return `${Math.round(value / 1000)}K+`;
    if (value >= 1_000)     return `${Math.round(value).toLocaleString()}+`;
    return `${Math.round(value)}`;
  }
  return fallback;
};

const pickValue = (source: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  }
  return undefined;
};

export const fetchMainAppMetrics = async (): Promise<LandingMetrics> => {
  const fallbackApiBase = import.meta.env.DEV
    ? ''
    : 'https://kodereduai-api.onrender.com';
  const baseUrl = (import.meta.env.PUBLIC_MAIN_APP_API_BASE_URL || fallbackApiBase).replace(/\/$/, '');
  const metricsPath = import.meta.env.PUBLIC_LANDING_METRICS_PATH || '/api/public/landing-metrics/';
  const schoolId = import.meta.env.PUBLIC_SCHOOL_ID;

  const url = baseUrl ? `${baseUrl}${metricsPath}` : metricsPath;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (schoolId) headers['X-School-ID'] = schoolId;

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Metrics failed: ${response.status}`);

  const payload = (await response.json()) as Record<string, unknown>;

  return {
    schools:   toDisplayValue(pickValue(payload, ['schools', 'schools_count', 'total_schools']), FALLBACK_METRICS.schools),
    classes:   toDisplayValue(pickValue(payload, ['classes', 'classes_count', 'total_classes']), FALLBACK_METRICS.classes),
    students:  toDisplayValue(pickValue(payload, ['students', 'students_count', 'total_students']), FALLBACK_METRICS.students),
    activeStudents: toDisplayValue(
      pickValue(payload, ['active_students', 'activeStudents', 'active_students_count']),
      FALLBACK_METRICS.activeStudents,
    ),
    teachers:  toDisplayValue(pickValue(payload, ['teachers', 'teachers_count', 'total_teachers', 'staff_count']), FALLBACK_METRICS.teachers),
    countries: toDisplayValue(pickValue(payload, ['countries', 'countries_count']), FALLBACK_METRICS.countries),
    lastUpdated: formatLastUpdated(
      pickValue(payload, ['last_updated', 'lastUpdated', 'updated_at']),
      FALLBACK_METRICS.lastUpdated,
    ),
  };
};
