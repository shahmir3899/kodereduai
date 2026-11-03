import { COVERAGE_FILTERS, SCHEDULE_FILTERS, coverageStats, plannedDateBody, scheduleStatus, topicName, topicParams, topicStatus } from '../services/curriculumCoverage';

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
    ])).toEqual({ total: 3, taught: 2, tested: 1, late: 0, overdue: 0 });
    expect(coverageStats([])).toEqual({ total: 0, taught: 0, tested: 0, late: 0, overdue: 0 });
  });

  it('asks the server with class, subject, and only the filters that are set', () => {
    expect(topicParams({ masterClassId: 7, subjectId: 2, coverage: '', academicYearId: null })).toEqual({ page_size: 999, class_id: 7, subject_id: 2 });
    expect(topicParams({ masterClassId: 7, subjectId: 2, coverage: 'uncovered', academicYearId: 46 }))
      .toEqual({ page_size: 999, class_id: 7, subject_id: 2, coverage: 'uncovered', academic_year: 46 });
    expect(COVERAGE_FILTERS.map((f) => f.value)).toEqual(['', 'taught_only', 'tested_only', 'both', 'uncovered']);
  });

  it('counts late and overdue topics', () => {
    const stats = coverageStats([
      { id: 1, title: 'a', coverage_status: 'late' }, { id: 2, title: 'b', coverage_status: 'overdue' },
      { id: 3, title: 'c', coverage_status: 'overdue' }, { id: 4, title: 'd', coverage_status: 'on_time' },
    ]);
    expect(stats.late).toBe(1);
    expect(stats.overdue).toBe(2);
  });

  it('labels the schedule status, with days for late and overdue, and nothing without one', () => {
    expect(scheduleStatus({ coverage_status: 'late', coverage_days: 3 })).toEqual({ label: 'Late · 3d', tone: 'warning' });
    expect(scheduleStatus({ coverage_status: 'overdue', coverage_days: 4 })).toEqual({ label: 'Overdue · 4d', tone: 'error' });
    expect(scheduleStatus({ coverage_status: 'on_time', coverage_days: 0 })).toEqual({ label: 'On time', tone: 'success' });
    expect(scheduleStatus({ coverage_status: null })).toBeNull();
    expect(scheduleStatus({})).toBeNull();
  });

  it('sends the schedule filter only when a year is in scope', () => {
    expect(topicParams({ masterClassId: 7, subjectId: 2, coverage: '', schedule: 'late', academicYearId: 46 }))
      .toEqual({ page_size: 999, class_id: 7, subject_id: 2, coverage_status: 'late', academic_year: 46 });
    expect(topicParams({ masterClassId: 7, subjectId: 2, coverage: '', schedule: 'late', academicYearId: null }))
      .toEqual({ page_size: 999, class_id: 7, subject_id: 2 });
    expect(SCHEDULE_FILTERS.map((f) => f.value)).toEqual(['', 'overdue', 'late', 'on_time', 'upcoming', 'not_planned', 'unscheduled']);
  });

  it('clears a planned date with null', () => {
    expect(plannedDateBody(46, '2026-11-10')).toEqual({ academic_year: 46, planned_date: '2026-11-10' });
    expect(plannedDateBody(46, '')).toEqual({ academic_year: 46, planned_date: null });
    expect(plannedDateBody(46, null)).toEqual({ academic_year: 46, planned_date: null });
  });
});
