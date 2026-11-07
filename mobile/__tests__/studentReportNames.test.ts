import { durationLabel, reportsZipFileName, singleReportFileName, uniqueNames } from '../services/studentReportNames';

describe('student report file names', () => {
  it('names a whole month, custom dates and an academic year', () => {
    expect(durationLabel({ date_from: '2026-11-01', date_to: '2026-11-30' })).toBe('Nov 2026');
    expect(durationLabel({ date_from: '2026-11-01', date_to: '2026-11-20' })).toBe('01 Nov-20 Nov 2026');
    expect(durationLabel({ academic_year: 3 }, '2026-27')).toBe('AY 2026-27');
  });
  it('builds single and zip names', () => {
    const s = { roll: '6', name: 'Muhammad Rahaim', className: 'Class 2 - A' };
    expect(singleReportFileName(s, 'Oct 2026')).toBe('6 - Muhammad Rahaim - Class 2-A (Oct 2026).pdf');
    expect(reportsZipFileName([s, s], 'Oct 2026')).toBe('Class 2-A - (Oct 2026) - 2 reports.zip');
    expect(reportsZipFileName([s, { name: 'x', className: 'Class 3' }], 'Oct 2026')).toContain('Multiple classes');
  });
  it('keeps colliding entries distinct', () => {
    expect(uniqueNames(['a.pdf', 'a.pdf'])).toEqual(['a.pdf', 'a [2].pdf']);
  });
});
