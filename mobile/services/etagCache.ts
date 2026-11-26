// "Nothing changed" answers for the lists that rarely change. The server tags these list answers
// with an ETag (core.mixins.ListETagMixin); the phone sends the tag back and an unchanged list
// returns as an empty 304, and the copy kept here is handed to the caller as if it had come again.
// Memory only, and cleared with the query cache on logout and school switch. Pure: no React Native
// imports, so Jest can load it.

// List endpoints only (not a single record): the same paths the server mixin covers.
const ETAG_PATHS = new Set([
  '/api/sessions/academic-years/',
  '/api/sessions/terms/',
  '/api/classes/',
  '/api/academics/subjects/',
  '/api/finance/accounts/',
  '/api/finance/expense-categories/',
  '/api/finance/income-categories/',
]);

// A handful of URLs per screen; the cap only stops a long session growing without bound.
const MAX_ENTRIES = 60;

interface Entry { etag: string; data: unknown }
const store = new Map<string, Entry>();

function sortedParams(params: unknown): string {
  if (!params || typeof params !== 'object') return '';
  const obj = params as Record<string, unknown>;
  return JSON.stringify(Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

// The school is part of the key, so one school's copy is never offered for another's request.
export function etagKey(method: string | undefined, url: string | undefined, params: unknown, schoolId: unknown): string | null {
  if ((method ?? 'get').toLowerCase() !== 'get' || !url) return null;
  const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
  if (!ETAG_PATHS.has(path)) return null;
  return `${schoolId ?? ''}|${path}|${sortedParams(params)}`;
}

export function storedEtag(key: string): string | null {
  return store.get(key)?.etag ?? null;
}

export function storedData(key: string): { found: boolean; data: unknown } {
  const hit = store.get(key);
  return hit ? { found: true, data: hit.data } : { found: false, data: undefined };
}

export function rememberEtag(key: string, etag: string | null | undefined, data: unknown): void {
  if (!etag) return;
  store.delete(key);
  store.set(key, { etag, data });
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value as string);
}

export function clearEtagCache(): void {
  store.clear();
}

export const acceptsNotModified = (status: number) => (status >= 200 && status < 300) || status === 304;
