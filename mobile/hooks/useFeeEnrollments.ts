import { useMutation, useQueryClient } from '@tanstack/react-query';
import { financeApi, studentsApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { ClassOption } from '../services/attendanceEntry';
import { categoryParam, classStudentParams, type EnrollStudent, type FeeCategoryKind, type FeeEnrollment } from '../services/feeEnrollments';
import { useScopedQuery } from './useScopedQuery';

// Current enrollments of one optional fee category.
export function useFeeEnrollments(kind: FeeCategoryKind, categoryId: number | null) {
  return useScopedQuery('feeEnrollments', [kind, categoryId], async () =>
    listOf<FeeEnrollment>((await financeApi.getFeeEnrollments({ [categoryParam(kind)]: categoryId, status: 'active' })).data),
  { enabled: categoryId != null });
}

export function useEnrollClassStudents(option: ClassOption | null, academicYearId?: number | null) {
  return useScopedQuery('feeClassStudents', ['enroll', option?.id ?? null, option?.isSession ?? null, academicYearId ?? null], async () =>
    listOf<EnrollStudent>((await studentsApi.getStudents(classStudentParams(option, academicYearId))).data),
  { enabled: option != null });
}

export function useFeeEnrollmentActions() {
  const qc = useQueryClient();
  const done = () => ['feeEnrollments', 'categories', 'feeCategories'].forEach((root) =>
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    enroll: useMutation({ mutationFn: (d: object) => financeApi.bulkEnrollFees(d), onSuccess: done }),
    end: useMutation({ mutationFn: (d: object) => financeApi.endFeeEnrollments(d), onSuccess: done }),
  };
}
