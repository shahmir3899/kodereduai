import {
  appraisalToForm, averageRating, buildAppraisalPayload, emptyAppraisalForm, ratingTone, sortAppraisals, validateAppraisal, type Appraisal,
} from '../services/appraisals';

const a = (over: Partial<Appraisal> = {}): Appraisal => ({
  id: 1, staff_member: 4, staff_member_name: 'A', review_period_start: '2026-01-01', review_period_end: '2026-06-30', rating: 4, ...over,
});

describe('appraisal form', () => {
  const ok = { ...emptyAppraisalForm(), staff: 4, start: '2026-01-01', end: '2026-06-30', rating: 4 };
  it('needs a staff member (on create), a period in order, and a rating of 1 to 5', () => {
    expect(validateAppraisal({ ...ok, staff: null }, true)).toMatch(/staff/);
    expect(validateAppraisal({ ...ok, staff: null }, false)).toBeNull();
    expect(validateAppraisal({ ...ok, start: '' }, true)).toMatch(/period/);
    expect(validateAppraisal({ ...ok, end: '2025-12-31' }, true)).toMatch(/on or after/);
    expect(validateAppraisal({ ...ok, rating: null }, true)).toMatch(/rating/);
    expect(validateAppraisal({ ...ok, rating: 6 }, true)).toMatch(/rating/);
    expect(validateAppraisal(ok, true)).toBeNull();
  });
  it('sends the staff member only when creating and trims the text', () => {
    expect(buildAppraisalPayload({ ...ok, strengths: ' kind ' }, true)).toMatchObject({ staff_member: 4, rating: 4, strengths: 'kind' });
    expect(buildAppraisalPayload(ok, false)).not.toHaveProperty('staff_member');
  });
  it('round-trips', () => {
    expect(appraisalToForm(a({ goals: 'x' }))).toMatchObject({ staff: 4, rating: 4, goals: 'x', start: '2026-01-01' });
  });
});

describe('listing helpers', () => {
  it('orders newest review first and averages ratings', () => {
    expect(sortAppraisals([a({ id: 1, review_period_end: '2026-06-30' }), a({ id: 2, review_period_end: '2026-12-31' })]).map((x) => x.id)).toEqual([2, 1]);
    expect(averageRating([{ rating: 4 }, { rating: 5 }, { rating: 5 }])).toBe(4.7);
    expect(averageRating([])).toBeNull();
  });
  it('colours the rating', () => {
    expect([1, 2, 3, 4, 5].map(ratingTone)).toEqual(['error', 'error', 'warning', 'info', 'success']);
  });
});
