// Pure logic for Performance Appraisals; port of frontend/src/pages/hr/PerformanceAppraisalPage.jsx
// and the rules in backend/hr/serializers.py. Admin and principal only.

export interface Appraisal {
  id: number;
  staff_member: number;
  staff_member_name: string;
  staff_employee_id?: string | null;
  department_name?: string | null;
  review_period_start: string;
  review_period_end: string;
  rating: number;
  strengths?: string;
  areas_for_improvement?: string;
  goals?: string;
  comments?: string;
  reviewer_name?: string | null;
}

export const RATING_LABELS: Record<number, string> = { 1: 'Poor', 2: 'Below expectations', 3: 'Meets expectations', 4: 'Exceeds expectations', 5: 'Outstanding' };

export function ratingTone(rating: number): 'error' | 'warning' | 'info' | 'success' {
  return rating <= 2 ? 'error' : rating === 3 ? 'warning' : rating === 4 ? 'info' : 'success';
}

export interface AppraisalForm {
  staff: number | null;
  start: string;
  end: string;
  rating: number | null;
  strengths: string;
  improvements: string;
  goals: string;
  comments: string;
}

export const emptyAppraisalForm = (): AppraisalForm => ({ staff: null, start: '', end: '', rating: null, strengths: '', improvements: '', goals: '', comments: '' });

export const appraisalToForm = (a: Appraisal): AppraisalForm => ({
  staff: a.staff_member, start: a.review_period_start, end: a.review_period_end, rating: a.rating,
  strengths: a.strengths ?? '', improvements: a.areas_for_improvement ?? '', goals: a.goals ?? '', comments: a.comments ?? '',
});

export function validateAppraisal(f: AppraisalForm, creating: boolean): string | null {
  if (creating && !f.staff) return 'Choose the staff member.';
  if (!f.start || !f.end) return 'Choose the review period.';
  if (f.end < f.start) return 'The end date must be on or after the start date.';
  if (!f.rating || f.rating < 1 || f.rating > 5) return 'Choose a rating from 1 to 5.';
  return null;
}

export function buildAppraisalPayload(f: AppraisalForm, creating: boolean) {
  return {
    ...(creating ? { staff_member: f.staff } : {}),
    review_period_start: f.start,
    review_period_end: f.end,
    rating: f.rating,
    strengths: f.strengths.trim(),
    areas_for_improvement: f.improvements.trim(),
    goals: f.goals.trim(),
    comments: f.comments.trim(),
  };
}

// Newest review first.
export const sortAppraisals = (list: Appraisal[]): Appraisal[] =>
  [...list].sort((a, b) => b.review_period_end.localeCompare(a.review_period_end) || b.id - a.id);

export function averageRating(list: Pick<Appraisal, 'rating'>[]): number | null {
  if (list.length === 0) return null;
  return Math.round((list.reduce((s, a) => s + a.rating, 0) / list.length) * 10) / 10;
}
