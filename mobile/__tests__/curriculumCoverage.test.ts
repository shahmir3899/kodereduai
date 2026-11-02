import { COVERAGE_FILTERS, coverageStats, plannedDateBody, topicName, topicParams, topicStatus } from '../services/curriculumCoverage';

describe('curriculum coverage', () => {
  it('names a topic with its number when it has one', () => {
    expect(topicName({ id: 1, topic_number: 3, title: 'Fractions' })).toBe('3. Fractions');
    expect(topicName({ id: 2, title: 'Intro' })).toBe('Intro');
    expect(topicName({ id: 3, topic_number: '', title: 'Intro' })).toBe('Intro');
  });

  it('labels the four coverage states the way the web does', () => {
    expect(topicStatus({ is_covered: true, is_tested: true })).toEqual({ label: 'Taught & tested', tone: 'success' });
    expect(topicStatus({ is_covered: true, is_tested: false }).label).toBe('Taught only');
    expect(topicStatus({ is_covered: false, is_tested: true }).label).toBe('Tested only');
    expect(topicStatus({}).label).toBe('Not covered');
  });

  it('counts total, taught and tested', () => {
    expect(coverageStats([
      { id: 1, title: 'a', is_covered: true, is_tested: true }, { id: 2, title: 'b', is_covered: true }, { id: 3, title: 'c' },
    ])).toEqual({ total: 3, taught: 2, tested: 1 });
    expect(coverageStats([])).toEqual({ total: 0, taught: 0, tested: 0 });
  });

  it('asks the server with class, subject, and only the filters that are set', () => {
    expect(topicParams({ masterClassId: 7, subjectId: 2, coverage: '', academicYearId: null })).toEqual({ page_size: 999, class_id: 7, subject_id: 2 });
    expect(topicParams({ masterClassId: 7, subjectId: 2, coverage: 'uncovered', academicYearId: 46 }))
      .toEqual({ page_size: 999, class_id: 7, subject_id: 2, coverage: 'uncovered', academic_year: 46 });
    expect(COVERAGE_FILTERS.map((f) => f.value)).toEqual(['', 'taught_only', 'tested_only', 'both', 'uncovered']);
  });

  it('clears a planned date with null', () => {
    expect(plannedDateBody(46, '2026-11-10')).toEqual({ academic_year: 46, planned_date: '2026-11-10' });
    expect(plannedDateBody(46, '')).toEqual({ academic_year: 46, planned_date: null });
    expect(plannedDateBody(46, null)).toEqual({ academic_year: 46, planned_date: null });
  });
});
