import { bulkMetaBody, captionsOf, reportMetaError, singleMetaBody } from '../services/reportCard';

const card = { studentId: 7, yearId: 3, examIds: [11, 12] };

describe('captions', () => {
  it('fills a missing or blank caption with the default', () => {
    expect(captionsOf({ principal: 'Head Teacher', parent: '  ' })).toEqual({
      class_teacher: 'Class Teacher', principal: 'Head Teacher', parent: 'Parent',
    });
    expect(captionsOf(undefined).class_teacher).toBe('Class Teacher');
  });
});

describe('single card body', () => {
  it('always names the card and sends only the field being changed', () => {
    expect(singleMetaBody(card, { promotion_status: 'PROMOTED' })).toEqual({
      student_id: 7, academic_year_id: 3, exam_ids: [11, 12], promotion_status: 'PROMOTED',
    });
    expect(singleMetaBody(card, { issue_date: '2026-11-24' })).toEqual({
      student_id: 7, academic_year_id: 3, exam_ids: [11, 12], issue_date: '2026-11-24',
    });
  });

  it('trims captions, caps them at 40 characters and drops empty ones', () => {
    const body = singleMetaBody(card, { signature_labels: { class_teacher: '  Form Tutor ', principal: '', parent: 'x'.repeat(50) } });
    expect(body.signature_labels).toEqual({ class_teacher: 'Form Tutor', parent: 'x'.repeat(40) });
  });
});

describe('class body', () => {
  const base = {
    yearId: 3, examIds: [12], studentIds: [1, 2, 3], overwrite: false,
    current: { 1: { promotion_applicable: true }, 2: { promotion_applicable: true }, 3: { promotion_applicable: false } },
    promotions: { 1: 'PROMOTED' as const }, issueDate: '', captions: {},
  };

  it('sends promotions only for students a final exam can promote, defaulting to not applicable', () => {
    const body = bulkMetaBody(base);
    expect(body).toEqual({
      academic_year_id: 3, exam_ids: [12], student_ids: [1, 2, 3], overwrite: false,
      promotions: { 1: 'PROMOTED', 2: 'NOT_APPLICABLE' },
    });
  });

  it('leaves promotions out when no student can be promoted, and adds date and filled captions', () => {
    const body = bulkMetaBody({
      ...base, current: { 1: { promotion_applicable: false } }, issueDate: '2026-12-01',
      captions: { principal: ' Head ', parent: '' },
    });
    expect(body.promotions).toBeUndefined();
    expect(body.issue_date).toBe('2026-12-01');
    expect(body.signature_labels).toEqual({ principal: 'Head' });
  });
});

describe('errors', () => {
  it("shows the server's reason", () => {
    expect(reportMetaError({ response: { status: 403, data: { detail: 'Only admins or the class teacher can edit report card details.' } } }))
      .toBe('Only admins or the class teacher can edit report card details.');
    expect(reportMetaError({ response: { status: 400, data: { promotion_status: ['Promotion can only be set for a final exam.'] } } }))
      .toBe('Promotion can only be set for a final exam.');
    expect(reportMetaError(new Error('x'))).toMatch(/No connection/);
  });
});
