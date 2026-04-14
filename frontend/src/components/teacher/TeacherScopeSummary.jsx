import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { academicsApi } from '../../services/api'

export default function TeacherScopeSummary({ compact = false }) {
  const { isTeacher, isModuleEnabled } = useAuth()
  const { activeAcademicYear } = useAcademicYear()

  const yearParams = activeAcademicYear?.id ? { academic_year: activeAcademicYear.id } : undefined

  const { data: classTeacherScopeRes } = useQuery({
    queryKey: ['myClassTeacherAssignments', activeAcademicYear?.id],
    queryFn: () => academicsApi.getMyClassTeacherAssignments(),
    enabled: isTeacher && isModuleEnabled('academics'),
  })

  const { data: subjectTeacherScopeRes } = useQuery({
    queryKey: ['mySubjectAssignments', activeAcademicYear?.id],
    queryFn: () => academicsApi.getMySubjectAssignments(yearParams),
    enabled: isTeacher && isModuleEnabled('academics'),
  })

  const classTeacherAssignments = classTeacherScopeRes?.data || []
  const subjectTeacherAssignments = subjectTeacherScopeRes?.data || []

  const scopeSummary = useMemo(() => {
    const classTeacherClasses = classTeacherAssignments.map((item) => ({
      id: item.id,
      label: `${item.class_name}${item.class_section ? ` - ${item.class_section}` : ''}`,
    }))

    const subjectTeacherClasses = new Map()
    subjectTeacherAssignments.forEach((item) => {
      const key = `${item.class_obj}`
      if (!subjectTeacherClasses.has(key)) {
        subjectTeacherClasses.set(key, {
          classLabel: `${item.class_name}${item.class_section ? ` - ${item.class_section}` : ''}`,
          subjects: [],
        })
      }
      subjectTeacherClasses.get(key).subjects.push(item.subject_code || item.subject_name)
    })

    return {
      classTeacherClasses,
      subjectTeacherClasses: [...subjectTeacherClasses.values()],
    }
  }, [classTeacherAssignments, subjectTeacherAssignments])

  if (!isTeacher || !isModuleEnabled('academics')) {
    return null
  }

  return (
    <div className={`rounded-xl border border-sky-200 bg-sky-50 ${compact ? 'p-4' : 'p-5'}`}>
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h2 className="text-sm font-semibold text-sky-900">Your Teaching Scope</h2>
          <p className="text-xs text-sky-700 mt-1">
            {activeAcademicYear?.name ? `Academic Year: ${activeAcademicYear.name}` : 'Current access scope'}
          </p>
        </div>
        <Link to="/academics/subjects" className="text-xs text-sky-700 hover:text-sky-900 font-medium">
          Manage
        </Link>
      </div>

      <div className={`grid gap-3 ${compact ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1 lg:grid-cols-2'}`}>
        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Class Teacher</p>
          {scopeSummary.classTeacherClasses.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No class-wide assignments.</p>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {scopeSummary.classTeacherClasses.map((item) => (
                <span key={item.id} className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                  {item.label}
                </span>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500">Full class-wide access.</p>
        </div>

        <div className="rounded-lg border border-amber-200 bg-white px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Subject Teacher</p>
          {scopeSummary.subjectTeacherClasses.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500">No subject-only assignments.</p>
          ) : (
            <div className="mt-2 space-y-2">
              {scopeSummary.subjectTeacherClasses.slice(0, compact ? 4 : 6).map((item) => (
                <div key={item.classLabel} className="rounded-md bg-amber-50 px-2.5 py-2 border border-amber-100">
                  <p className="text-sm font-medium text-amber-800">{item.classLabel}</p>
                  <p className="mt-1 text-xs text-amber-700">{item.subjects.join(', ')}</p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-gray-500">Only assigned subjects in each class.</p>
        </div>
      </div>
    </div>
  )
}
