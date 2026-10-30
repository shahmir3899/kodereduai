import { useMutation, useQueryClient } from '@tanstack/react-query';
import { hrApi } from '../services/api';
import { listOf } from '../services/academicYear';
import type { Appraisal } from '../services/appraisals';
import type { PayrollSummary, PayslipFull, SalaryStructure } from '../services/payroll';
import { useScopedPagedQuery, useScopedQuery } from './useScopedQuery';

// Salary data is never persisted to the phone: the roots below are money roots (queryRules.ts).

export function usePayrollSummary(month: number, year: number) {
  return useScopedQuery('payroll', ['summary', month, year], async () =>
    (await hrApi.getPayrollSummary({ month, year })).data as PayrollSummary);
}

export function usePayslipsPaged(month: number, year: number, status: string) {
  return useScopedPagedQuery<PayslipFull>('payroll', ['payslips', month, year, status], async (page) => {
    const data = (await hrApi.getPayslips({ month, year, page, page_size: 20, ...(status ? { status } : {}) })).data as
      { results?: PayslipFull[]; next?: string | null; count?: number } | PayslipFull[];
    if (Array.isArray(data)) return { results: data, next: null, count: data.length };
    return { results: data.results ?? [], next: data.next ?? null, count: data.count ?? 0 };
  });
}

export function useSalaryStructures() {
  return useScopedQuery('salaryStructures', ['list'], async () =>
    listOf<SalaryStructure>((await hrApi.getSalaryStructures({ page_size: 1000, is_active: true })).data));
}

export interface StaffOption { id: number; full_name?: string; name?: string; employee_id?: string | null }

export function useStaffOptions(enabled: boolean) {
  return useScopedQuery('staffDirectory', ['options'], async () =>
    listOf<StaffOption>((await hrApi.getStaff({ page_size: 1000, is_active: true })).data), { enabled, staleTime: 60_000 });
}

export function usePayrollActions() {
  const qc = useQueryClient();
  const refresh = () => ['payroll', 'payslips', 'salaryStructures'].forEach((root) => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === root }));
  return {
    generate: useMutation({ mutationFn: (d: object) => hrApi.generatePayslips(d), onSuccess: refresh }),
    approve: useMutation({ mutationFn: (id: number) => hrApi.approvePayslip(id), onSuccess: refresh }),
    markPaid: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => hrApi.markPayslipPaid(id, data), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => hrApi.deletePayslip(id), onSuccess: refresh }),
    createSalary: useMutation({ mutationFn: (d: object) => hrApi.createSalaryStructure(d), onSuccess: refresh }),
    updateSalary: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => hrApi.updateSalaryStructure(id, data), onSuccess: refresh }),
    removeSalary: useMutation({ mutationFn: (id: number) => hrApi.deleteSalaryStructure(id), onSuccess: refresh }),
  };
}

export function useAppraisals() {
  return useScopedQuery('appraisals', ['list'], async () => listOf<Appraisal>((await hrApi.getAppraisals({ page_size: 1000 })).data));
}

export function useAppraisalActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'appraisals' });
  return {
    create: useMutation({ mutationFn: (d: object) => hrApi.createAppraisal(d), onSuccess: refresh }),
    update: useMutation({ mutationFn: ({ id, data }: { id: number; data: object }) => hrApi.updateAppraisal(id, data), onSuccess: refresh }),
    remove: useMutation({ mutationFn: (id: number) => hrApi.deleteAppraisal(id), onSuccess: refresh }),
  };
}
