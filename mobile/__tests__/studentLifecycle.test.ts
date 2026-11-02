import {
  awayLine, buildInvitePayload, buildOutcomePayload, buildReportRequest, enrollmentLine, enrollmentRows, enrollmentTone, exitBanner,
  inviteShareText, offeredOutcomes, placementsLine, reportPeriodParams, studentReportFileName, validateOutcome, webOnlyOutcomes,
} from '../services/studentLifecycle';

describe('outcomes', () => {
  const allowed = ['LEFT', 'TRANSFERRED', 'GRADUATED', 'REPEAT', 'REMOVE'];

  it('offers only Graduated and Repeat, and only when the server allows them', () => {
    expect(offeredOutcomes(allowed).map((o) => o.value)).toEqual(['GRADUATED', 'REPEAT']);
    expect(offeredOutcomes(['LEFT', 'REMOVE', 'REPEAT']).map((o) => o.value)).toEqual(['REPEAT']);
    expect(offeredOutcomes(undefined)).toEqual([]);
  });

  it('lists the checklist outcomes as web-only', () => {
    expect(webOnlyOutcomes(allowed)).toEqual(['Left school', 'Transferred']);
    expect(webOnlyOutcomes(['READMIT', 'GRADUATED'])).toEqual(['Re-admit']);
  });

  it('needs an outcome and a reason, and trims the reason', () => {
    expect(validateOutcome('', 'x')).toContain('Choose');
    expect(validateOutcome('REPEAT', '  ')).toContain('reason');
    expect(validateOutcome('REPEAT', 'failed maths')).toBeNull();
    expect(buildOutcomePayload('REPEAT', ' failed maths ')).toEqual({ outcome: 'REPEAT', reason: 'failed maths' });
  });
});

describe('enrollment history', () => {
  it('reads a list or the older { enrollments } shape', () => {
    expect(enrollmentRows([{ class_name: 'A' }])).toHaveLength(1);
    expect(enrollmentRows({ enrollments: [{ class_name: 'A' }, { class_name: 'B' }] })).toHaveLength(2);
    expect(enrollmentRows(null)).toEqual([]);
  });

  it('describes a row and picks a tone', () => {
    expect(enrollmentLine({ class_name: 'Grade 1', section: 'A', roll_number: '4' })).toBe('Grade 1  ·  Section A  ·  Roll 4');
    expect(enrollmentLine({ class_name: 'Grade 1 - A', section: 'Grade 1 - A' })).toBe('Grade 1 - A');
    expect(enrollmentTone('ACTIVE')).toBe('success');
    expect(enrollmentTone('PROMOTED')).toBe('info');
    expect(enrollmentTone('LEFT')).toBe('neutral');
  });

  it('lists mid-year moves with the last day of each class, not the exclusive end date', () => {
    const line = placementsLine({
      placements: [
        { class_name: 'Grade 1 - A', roll_number: '4', start_date: '2026-04-01', end_date: '2026-09-01' },
        { class_name: 'Grade 1 - B', roll_number: '2', start_date: '2026-09-01', end_date: null },
      ],
    });
    expect(line).toBe('Moved during the year: Grade 1 - A (roll 4, 2026-04-01 to 2026-08-31) → Grade 1 - B (roll 2, 2026-09-01 onward)');
    expect(placementsLine({ placements: [{ start_date: '2026-04-01' }] })).toBeNull();
  });

  it('writes an away period with its reason', () => {
    expect(awayLine({ start: '2026-05-01', end: null, reason: 'illness' })).toBe('2026-05-01 to now  ·  illness');
    expect(awayLine({ start: '2026-05-01', end: '2026-06-01' })).toBe('2026-05-01 to 2026-06-01');
  });
});

describe('exitBanner', () => {
  const exit = {
    exit_type: 'TRANSFERRED', status: 'FINALIZED', leaving_date: '2026-08-10', reason: 'moved city', destination_school_name: 'North Branch',
    items: [{ kind: 'FEES', kind_label: 'Pending fees', state: 'WAIVED', summary: 'PKR 500', waived_by_name: 'Admin', waiver_reason: 'sibling' }, { kind: 'BOOKS', state: 'CLEARED' }],
  };

  it('shows while the student is out, with waived items', () => {
    expect(exitBanner(exit, 'TRANSFERRED')).toEqual({
      headline: 'Transferred to North Branch on 2026-08-10', reason: 'moved city',
      waived: ['Pending fees waived (PKR 500) by Admin: sibling'],
    });
  });

  it('is hidden after a re-activation, when not finalised, or with no exit', () => {
    expect(exitBanner(exit, 'ACTIVE')).toBeNull();
    expect(exitBanner({ ...exit, status: 'DRAFT' }, 'TRANSFERRED')).toBeNull();
    expect(exitBanner(null, 'TRANSFERRED')).toBeNull();
  });
});

describe('parent invite', () => {
  it('sends the relation and only a normalised phone when one is typed', () => {
    expect(buildInvitePayload(7, 'FATHER', '')).toEqual({ student_id: 7, relation: 'FATHER' });
    expect(buildInvitePayload(7, 'MOTHER', ' 03001234567 ')).toEqual({ student_id: 7, relation: 'MOTHER', parent_phone: '+923001234567' });
  });

  it('shares the code with the app instructions', () => {
    expect(inviteShareText('Ali', 'ABC123')).toContain('ABC123');
    expect(inviteShareText('Ali', 'ABC123')).toContain('Ali');
  });
});

describe('report period', () => {
  const custom = { from: '', to: '' };

  it('uses whole calendar months', () => {
    expect(reportPeriodParams('this_month', '2026-11-18', 1, custom)).toEqual({ date_from: '2026-11-01', date_to: '2026-11-30' });
    expect(reportPeriodParams('last_month', '2026-11-18', 1, custom)).toEqual({ date_from: '2026-10-01', date_to: '2026-10-31' });
  });

  it('wraps back over the new year and handles February', () => {
    expect(reportPeriodParams('last_month', '2027-01-05', 1, custom)).toEqual({ date_from: '2026-12-01', date_to: '2026-12-31' });
    expect(reportPeriodParams('this_month', '2028-02-10', 1, custom)).toEqual({ date_from: '2028-02-01', date_to: '2028-02-29' });
  });

  it('sends the academic year id, or says there is none', () => {
    expect(reportPeriodParams('this_year', '2026-11-18', 46, custom)).toEqual({ academic_year: 46 });
    expect(reportPeriodParams('this_year', '2026-11-18', null, custom)).toHaveProperty('error');
  });

  it('checks custom dates', () => {
    expect(reportPeriodParams('custom', '2026-11-18', 1, custom)).toHaveProperty('error');
    expect(reportPeriodParams('custom', '2026-11-18', 1, { from: '2026-11-10', to: '2026-11-01' })).toHaveProperty('error');
    expect(reportPeriodParams('custom', '2026-11-18', 1, { from: '2026-11-01', to: '2026-11-10' })).toEqual({ date_from: '2026-11-01', date_to: '2026-11-10' });
  });

  it('builds the request and a safe file name', () => {
    expect(buildReportRequest(7, { academic_year: 46 })).toEqual({ report_type: 'STUDENT_COMPREHENSIVE', parameters: { student_id: 7, academic_year: 46 } });
    expect(studentReportFileName('Ali Raza / Jr.')).toBe('Ali-Raza-Jr.-report.pdf');
    expect(studentReportFileName('')).toBe('student-report.pdf');
  });
});
