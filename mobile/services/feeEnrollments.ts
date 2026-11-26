import type { ClassOption } from './attendanceEntry';

// One student's place in an optional (enrolled-only) fee such as Robotics or Karate.
export interface FeeEnrollment {
  id: number;
  student: number;
  student_name: string;
  student_roll?: string;
  class_label?: string;
  start_date: string;
  end_date: string | null;
  amount: string | number | null;
  is_active: boolean;
}

export interface EnrollStudent { id: number; name: string; roll_number?: string | null }

export type FeeCategoryKind = 'monthly' | 'annual';

export const categoryParam = (kind: FeeCategoryKind) => (kind === 'monthly' ? 'monthly_category' : 'annual_category');

// The students of one class or section this year, the way the rest of the app asks for them.
export function classStudentParams(option: ClassOption | null, academicYearId?: number | null): Record<string, unknown> {
  const params: Record<string, unknown> = { is_active: true, page_size: 9999 };
  if (academicYearId) params.academic_year = academicYearId;
  if (option) {
    if (option.isSession) {
      params.session_class_id = option.id;
      if (option.classObj) params.class_id = option.classObj;
    } else params.class_id = option.id;
  }
  return params;
}

// Students not already enrolled: the server would skip them anyway, so they are not offered.
export const enrollable = (students: EnrollStudent[], enrolled: FeeEnrollment[]) => {
  const taken = new Set(enrolled.map((e) => e.student));
  return students.filter((s) => !taken.has(s.id));
};

export function enrollPayload(kind: FeeCategoryKind, categoryId: number, studentIds: number[], startDate: string,
  price: string, academicYearId?: number | null): Record<string, unknown> {
  return {
    [categoryParam(kind)]: categoryId,
    student_ids: studentIds,
    start_date: startDate,
    amount: price.trim() ? price.trim() : null,
    ...(academicYearId ? { academic_year: academicYearId } : {}),
  };
}

export const priceLabel = (e: FeeEnrollment) => (e.amount == null ? 'Default price' : `Rs ${Number(e.amount).toLocaleString()}`);
