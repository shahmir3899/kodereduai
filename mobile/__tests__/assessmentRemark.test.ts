import { buildRemarkRequest, canSuggestRemark, emptyForm, toggleRating } from '../services/assessments';

describe('buildRemarkRequest', () => {
  it('keys ratings by label and skips unrated fields', () => {
    let form = emptyForm();
    form = toggleRating(form, 'social_skills', 4);
    form = toggleRating(form, 'discipline', 2);
    expect(buildRemarkRequest(form, 'teacher')).toEqual({
      ratings: { 'Social Skills': 4, Discipline: 2 },
      remark_type: 'teacher',
    });
  });

  it('sends the teacher remark with the principal draft only', () => {
    const form = { ...toggleRating(emptyForm(), 'listening', 5), teacher_remark: 'Works hard.' };
    expect(buildRemarkRequest(form, 'principal')).toMatchObject({ remark_type: 'principal', teacher_remark: 'Works hard.' });
    expect(buildRemarkRequest(form, 'teacher')).not.toHaveProperty('teacher_remark');
  });
});

describe('canSuggestRemark', () => {
  it('needs at least one rating', () => {
    expect(canSuggestRemark(emptyForm())).toBe(false);
    expect(canSuggestRemark(toggleRating(emptyForm(), 'writing', 3))).toBe(true);
  });
});
