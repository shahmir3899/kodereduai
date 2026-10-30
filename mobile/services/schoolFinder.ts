// The app's front door: choosing which school you belong to before signing in. Pure logic, no React
// Native imports. A school is picked by searching its name or code, by typing its exact code, or by
// scanning its QR code; each ends with a saved school code. The code is only a front door: sign-in
// is still username and password, and the server decides which schools you may use.

// How many matches the list shows at once; typing more narrows it.
export const DIRECTORY_SHOW = 20;

export interface PublicSchool { subdomain: string; name: string; logo?: string | null }

// A school code is the subdomain: letters, digits and hyphens, never starting with a hyphen.
const CODE = /^[a-z0-9][a-z0-9-]{0,62}$/;
// Host names that are the product's own pages, not a school.
const RESERVED = new Set(['www', 'api', 'localhost', 'app']);

export const isValidCode = (code: string) => CODE.test(code) && !RESERVED.has(code);

// What the school's QR code and share link carry.
export const SCHOOL_LINK_PREFIX = 'educationai://school/';
export const schoolLink = (code: string) => `${SCHOOL_LINK_PREFIX}${code}`;

const BASE_DOMAINS = ['educationai.pk', 'educationai.com.pk', 'kodereduai.pk'];

// Turns whatever was typed, scanned or opened into a school code, or null when it is not one.
// Accepts the bare code, the app link, a school's web address (demo.educationai.pk) and the same
// with a path; anything else (a stranger's QR code) is refused.
export function parseSchoolCode(input: string | null | undefined): string | null {
  const text = (input ?? '').trim().toLowerCase();
  if (!text) return null;

  if (text.startsWith(SCHOOL_LINK_PREFIX)) {
    const code = text.slice(SCHOOL_LINK_PREFIX.length).split(/[/?#]/)[0];
    return isValidCode(code) ? code : null;
  }

  const web = text.match(/^https?:\/\/([^/?#:]+)/);
  if (web) {
    const host = web[1];
    const base = BASE_DOMAINS.find((d) => host.endsWith(`.${d}`));
    if (!base) return null;
    const code = host.slice(0, host.length - base.length - 1).split('.').pop() ?? '';
    return isValidCode(code) ? code : null;
  }

  if (/[\s/:.]/.test(text)) return null;
  return isValidCode(text) ? text : null;
}

// Filters the downloaded list of schools as the person types, from the first letter, with no server
// call. Best matches first: a name that starts with the text, then a word in the name that does, then
// the code, then any other part of the name. Ties keep the list's own (alphabetical) order.
export function filterDirectory(list: PublicSchool[], text: string, limit = DIRECTORY_SHOW): PublicSchool[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ school: PublicSchool; rank: number; index: number }> = [];
  list.forEach((school, index) => {
    const name = school.name.toLowerCase();
    const code = school.subdomain.toLowerCase();
    let rank = -1;
    if (name.startsWith(q)) rank = 0;
    else if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) rank = 1;
    else if (code.startsWith(q)) rank = 2;
    else if (name.includes(q) || code.includes(q)) rank = 3;
    if (rank >= 0) scored.push({ school, rank, index });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.index - b.index).slice(0, limit).map((x) => x.school);
}

export function searchHint(text: string, total: number): string {
  if (total === 0) return 'No school has chosen to be listed yet. Use your school code or QR code below.';
  if (!text.trim()) return 'Type your school name or code.';
  return '';
}

// After sign-in the school the person picked is the active one, if they belong to it; otherwise the
// default membership applies as before.
export function preferredSchool<T extends { subdomain?: string | null; is_default?: boolean }>(schools: T[], code: string | null): T | null {
  if (code) {
    const match = schools.find((s) => (s.subdomain ?? '').toLowerCase() === code);
    if (match) return match;
  }
  return schools.find((s) => s.is_default) ?? schools[0] ?? null;
}

export function lookupFailureText(error: unknown): string {
  const e = error as { response?: { status?: number } } | null;
  if (!e?.response) return 'Could not reach the server. Check your internet connection and try again.';
  if (e.response.status === 404) return 'No school has this code. Check it with your school.';
  if (e.response.status === 429) return 'Too many tries. Wait a minute and try again.';
  return 'Could not look up the school. Please try again.';
}
