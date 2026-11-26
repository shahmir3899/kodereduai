import { editDistance, matchScore, normalize, searchSchools, type DirectorySchool } from '../services/schoolSearch';

const FOCUS: DirectorySchool = { code: 'focus', name: 'Focus Grammar School' };
const SCHOOLS: DirectorySchool[] = [
  FOCUS,
  { code: 'demo', name: 'Demo School' },
  { code: 'beacon-house', name: 'Beacon House School System' },
  { code: 'city-grammar', name: 'City Grammar School' },
  { code: 'alhuda', name: 'Al-Huda Public School' },
];

describe('normalize and editDistance', () => {
  it('ignores case and punctuation', () => {
    expect(normalize('Focus Grammar-School.')).toBe('focus grammar school');
    expect(normalize('  Al-Huda  ')).toBe('al huda');
  });
  it('counts single-letter edits', () => {
    expect(editDistance('focs', 'focu', 1)).toBe(1);
    expect(editDistance('focus', 'focus')).toBe(0);
    expect(editDistance('abc', 'xyz', 1)).toBe(2);
  });
});

describe('matchScore', () => {
  it('needs at least two letters', () => {
    expect(matchScore('f', FOCUS)).toBe(0);
  });
  it('ranks exact code, then name start, then word starts, then contains, then near misses', () => {
    expect(matchScore('focus', FOCUS)).toBe(100);
    expect(matchScore('Focus Gram', FOCUS)).toBe(90);
    expect(matchScore('grammar', FOCUS)).toBe(75);
    expect(matchScore('gram sch', FOCUS)).toBe(75);
    expect(matchScore('ammar', FOCUS)).toBe(60);
    expect(matchScore('focs', FOCUS)).toBe(40);
    expect(matchScore('xyz', FOCUS)).toBe(0);
  });
  it('matches the code with or without its dashes', () => {
    expect(matchScore('beacon-house', SCHOOLS[2])).toBe(100);
    expect(matchScore('beaconhouse', SCHOOLS[2])).toBe(100);
    expect(matchScore('alhuda', SCHOOLS[4])).toBe(100);
    // Spaces do not count for the code either: "al huda" is the code alhuda.
    expect(matchScore('al huda', SCHOOLS[4])).toBe(100);
    expect(matchScore('al hu', SCHOOLS[4])).toBe(90);
  });
  it('does not guess on short words', () => {
    expect(matchScore('fox', FOCUS)).toBe(0);
  });
});

describe('searchSchools', () => {
  it('returns the best matches first', () => {
    expect(searchSchools('grammar', SCHOOLS).map((s) => s.code)).toEqual(['city-grammar', 'focus']);
    expect(searchSchools('foc', SCHOOLS)[0].code).toBe('focus');
    expect(searchSchools('school', SCHOOLS)).toHaveLength(5);
  });
  it('caps the list and returns nothing for short or unmatched text', () => {
    expect(searchSchools('school', SCHOOLS, 3)).toHaveLength(3);
    expect(searchSchools('d', SCHOOLS)).toEqual([]);
    expect(searchSchools('zzzz', SCHOOLS)).toEqual([]);
  });
});
