import { useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type { ClassOption } from '../services/attendanceEntry';
import { useAcademicYear, useClassOptionsForYear } from './useAcademicYear';
import { useTeacherClassOptions } from './useTeacher';
import { useClassSubjectRows } from './useAssignments';
import { useSubjectsList } from './useManager';

// Class picker for the content screens (worksheets, papers, question bank), as on the web: the
// sections of the chosen academic year ("Class 1 - A"), and a teacher only their own sections.
// Worksheets, papers and questions are stored against the master class (CLASS_SYSTEM_GUIDE.md), so
// the picked section is turned back into its master class for every request; 5-A and 5-B of the
// same class therefore show the same records, exactly as on the web.
export function useSectionPicker() {
  const { isTeacher } = useAuth();
  const year = useAcademicYear();
  const yearId = year.current?.id ?? null;
  const all = useClassOptionsForYear(isTeacher ? null : yearId);
  // Only a teacher asks for their own sections.
  const mine = useTeacherClassOptions(yearId, isTeacher);
  const source: ClassOption[] = isTeacher ? mine.options : all.options;

  return useMemo(() => {
    const byId = new Map(source.map((o) => [o.id, o]));
    // A section's master class; a master-only option (a year with no sections) is its own id.
    const masterOf = (optionId: number | null | undefined): number | null => {
      if (optionId == null) return null;
      const o = byId.get(optionId);
      if (!o) return null;
      return o.isSession ? o.classObj : o.id;
    };
    // The option to show for a saved master class (a record opened for editing): its first section.
    const optionFor = (masterId: number | null | undefined): number | null => {
      if (masterId == null) return null;
      const hit = source.find((o) => (o.isSession ? o.classObj : o.id) === masterId);
      return hit ? hit.id : null;
    };
    return {
      options: source.map((o) => ({ value: o.id, label: o.label })),
      masterOf,
      optionFor,
      isLoading: isTeacher ? mine.isLoading : all.isLoading,
    };
  }, [source, isTeacher, mine.isLoading, all.isLoading]);
}

// Subjects taught in one master class (the web's useClassSubjects). A class with none set up yet
// falls back to every subject, so the form is never a dead end.
export function useClassSubjectOptions(masterClassId: number | null) {
  const rows = useClassSubjectRows(masterClassId);
  const all = useSubjectsList();
  return useMemo(() => {
    const seen = new Map<number, string>();
    (rows.data ?? []).forEach((r) => { if (!seen.has(r.subject)) seen.set(r.subject, r.subject_name || `Subject ${r.subject}`); });
    if (masterClassId && seen.size === 0 && !rows.isLoading) (all.data ?? []).forEach((s) => seen.set(s.id, s.name));
    return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows.data, rows.isLoading, all.data, masterClassId]);
}
