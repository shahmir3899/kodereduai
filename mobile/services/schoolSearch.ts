// Name search for the "Find your school" screen. The public school directory (GET
// /api/schools/directory/) is loaded quietly when the screen opens; these rules match what the
// person types against it on the phone. Pure logic, no React Native imports.

export interface DirectorySchool { code: string; name: string; logo?: string | null }

export const MIN_QUERY = 2;
export const MAX_RESULTS = 5;

// Case, dots, dashes and other punctuation do not matter: "Focus Grammar-School." == "focus grammar school".
export function normalize(text: string): string {
  return (text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const compact = (text: string) => normalize(text).replace(/ /g, '');

// Plain edit distance (insert, delete, change one letter), stopping early once past `max`.
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// A typed word is "close" to a name word when one letter is off: compared with the start of the
// name word, since people search while still typing ("focs" for "focus"). Only for 4+ letters,
// where one wrong letter still says something.
function nearWord(typed: string, word: string): boolean {
  if (typed.length < 4) return false;
  for (const len of [typed.length - 1, typed.length, typed.length + 1]) {
    if (len > 0 && len <= word.length && editDistance(typed, word.slice(0, len), 1) <= 1) return true;
  }
  return false;
}

// How well one school matches: higher is better, 0 is no match.
export function matchScore(query: string, school: DirectorySchool): number {
  const q = normalize(query);
  if (q.length < MIN_QUERY) return 0;
  const qc = q.replace(/ /g, '');
  const name = normalize(school.name);
  const code = compact(school.code);
  const words = [...name.split(' '), ...normalize(school.code).split(' ')].filter(Boolean);
  const typed = q.split(' ');

  if (code === qc) return 100;                                      // exact code
  if (name.startsWith(q)) return 90;                                // start of the name
  if (code.startsWith(qc)) return 85;                               // start of the code
  if (typed.every((t) => words.some((w) => w.startsWith(t)))) return 75; // every typed word starts a word
  if (name.includes(q) || code.includes(qc)) return 60;             // anywhere in the name or code
  if (typed.every((t) => words.some((w) => w.startsWith(t) || nearWord(t, w)))) return 40; // one letter off
  return 0;
}

// The best few matches, best first (ties by name).
export function searchSchools(query: string, schools: DirectorySchool[], limit = MAX_RESULTS): DirectorySchool[] {
  return schools
    .map((s) => ({ s, score: matchScore(query, s) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name))
    .slice(0, limit)
    .map((x) => x.s);
}
