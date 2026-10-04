import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { studentsApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'

// Roll numbers already taken in a student's class, for the roll suggestion in
// the profile edit form. Fetches the school's roster only while `enabled`.
export function useClassmateRolls(student, enabled) {
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()

  const { data } = useQuery({
    queryKey: ['studentEditRollStudents', activeSchool?.id, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      school_id: activeSchool?.id,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
      page_size: 9999,
    }),
    enabled: enabled && !!activeSchool?.id,
    staleTime: 60_000,
  })

  const roster = data?.data?.results || data?.data
  return useMemo(() => {
    if (!student?.class_obj || !roster) return []
    return roster
      .filter((s) => String(s.id) !== String(student.id) && String(s.class_obj || '') === String(student.class_obj))
      .map((s) => s.roll_number)
  }, [roster, student?.id, student?.class_obj])
}
