import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { attendanceApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useSessionClasses } from './useSessionClasses'

/**
 * Returns class options constrained to teacher assignments.
 * - Teachers get only assigned classes (session-scoped when academic year is active).
 * - Non-teachers get undefined options so ClassSelector falls back to default behavior.
 * - Optionally auto-selects the first available class for teachers.
 */
export default function useTeacherScopedClasses({
  academicYearId,
  selectedClass,
  setSelectedClass,
  autoSelectFirst = false,
  queryKey = 'teacherScopedClasses',
}) {
  const { isTeacher } = useAuth()
  const { sessionClasses } = useSessionClasses(academicYearId)

  const { data: myClassesRes, isLoading } = useQuery({
    queryKey: [queryKey],
    queryFn: () => attendanceApi.getMyAttendanceClasses(),
    enabled: isTeacher,
  })

  const classOptions = useMemo(() => {
    if (!isTeacher) return undefined
    const myClasses = myClassesRes?.data || []
    if (!myClasses.length) return []

    if (academicYearId && sessionClasses?.length) {
      const allowedMasterClassIds = new Set(myClasses.map((c) => Number(c.id)))
      const scoped = sessionClasses
        .filter((sc) => allowedMasterClassIds.has(Number(sc.class_obj)))
        .map((sc) => ({
          id: sc.id,
          class_obj: sc.class_obj,
          name: sc.display_name,
          section: sc.section || '',
          grade_level: sc.grade_level,
          label: sc.label,
        }))
      return scoped.length > 0 ? scoped : myClasses
    }

    return myClasses
  }, [isTeacher, myClassesRes?.data, academicYearId, sessionClasses])

  useEffect(() => {
    if (!autoSelectFirst || !isTeacher || !setSelectedClass) return
    const options = classOptions || []
    if (!options.length) return

    const selected = String(selectedClass || '')
    const hasSelected = selected && options.some((opt) => String(opt.id) === selected)
    if (!hasSelected) {
      setSelectedClass(String(options[0].id))
    }
  }, [autoSelectFirst, isTeacher, classOptions, selectedClass, setSelectedClass])

  return {
    isTeacher,
    showAllOption: !isTeacher,
    classOptions,
    isLoadingTeacherClasses: isLoading,
  }
}
