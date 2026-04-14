import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { academicsApi } from '../../services/api'

const BADGE_STYLES = {
  class: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
  subject: 'border border-amber-200 bg-amber-50 text-amber-700',
  out: 'border border-rose-200 bg-rose-50 text-rose-700',
}

const HINT_STYLES = {
  class: 'border border-emerald-200 bg-emerald-50/70 text-emerald-800',
  subject: 'border border-amber-200 bg-amber-50/70 text-amber-800',
  out: 'border border-rose-200 bg-rose-50/70 text-rose-800',
}

function normalizeScopeId(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  return String(value)
}

function buildScopeLookup(classTeacherAssignments, subjectTeacherAssignments) {
  const classIds = new Set()
  const classSubjectMap = new Map()

  classTeacherAssignments.forEach((item) => {
    const classId = normalizeScopeId(item.class_obj)
    if (classId) {
      classIds.add(classId)
    }
  })

  subjectTeacherAssignments.forEach((item) => {
    const classId = normalizeScopeId(item.class_obj)
    const subjectId = normalizeScopeId(item.subject)
    if (!classId || !subjectId) {
      return
    }

    if (!classSubjectMap.has(classId)) {
      classSubjectMap.set(classId, new Set())
    }

    classSubjectMap.get(classId).add(subjectId)
  })

  return { classIds, classSubjectMap }
}

function resolveScope({ classIds, classSubjectMap }, classId, subjectId) {
  const normalizedClassId = normalizeScopeId(classId)
  const normalizedSubjectId = normalizeScopeId(subjectId)

  if (!normalizedClassId) {
    return null
  }

  const hasClassAccess = classIds.has(normalizedClassId)
  const subjectIds = classSubjectMap.get(normalizedClassId)
  const hasSubjectAccess = normalizedSubjectId && subjectIds?.has(normalizedSubjectId)

  if (hasClassAccess) {
    return {
      kind: 'class',
      badgeLabel: 'Class Teacher',
      detail: hasSubjectAccess
        ? 'Visible through your class-wide assignment. You also hold the subject assignment.'
        : 'Visible through your class-wide assignment.',
    }
  }

  if (hasSubjectAccess) {
    return {
      kind: 'subject',
      badgeLabel: 'Subject Teacher',
      detail: 'Visible only because this subject is assigned to you in this class.',
    }
  }

  if (!normalizedSubjectId && subjectIds?.size) {
    return {
      kind: 'subject',
      badgeLabel: 'Subject Teacher',
      detail: 'This class is only partially visible. Pick one of your assigned subjects to narrow it fully.',
    }
  }

  return {
    kind: 'out',
    badgeLabel: 'Out of Scope',
    detail: normalizedSubjectId
      ? 'This class and subject are not in your current teacher assignments.'
      : 'This class is not in your current teacher assignments.',
  }
}

export function useTeacherScopeLookup({ academicYearId } = {}) {
  const { isTeacher, isModuleEnabled } = useAuth()
  const { activeAcademicYear } = useAcademicYear()

  const resolvedAcademicYearId = academicYearId ?? activeAcademicYear?.id
  const yearParams = resolvedAcademicYearId ? { academic_year: resolvedAcademicYearId } : undefined
  const isTeacherEnabled = isTeacher && isModuleEnabled('academics')

  const { data: classTeacherScopeRes, isLoading: classScopeLoading } = useQuery({
    queryKey: ['myClassTeacherAssignments', resolvedAcademicYearId],
    queryFn: () => academicsApi.getMyClassTeacherAssignments(),
    enabled: isTeacherEnabled,
  })

  const { data: subjectTeacherScopeRes, isLoading: subjectScopeLoading } = useQuery({
    queryKey: ['mySubjectAssignments', resolvedAcademicYearId],
    queryFn: () => academicsApi.getMySubjectAssignments(yearParams),
    enabled: isTeacherEnabled,
  })

  const scopeLookup = useMemo(
    () => buildScopeLookup(classTeacherScopeRes?.data || [], subjectTeacherScopeRes?.data || []),
    [classTeacherScopeRes?.data, subjectTeacherScopeRes?.data]
  )

  const classifyScope = ({ classId, subjectId }) => resolveScope(scopeLookup, classId, subjectId)

  return {
    classifyScope,
    isTeacherEnabled,
    isLoading: classScopeLoading || subjectScopeLoading,
  }
}

export function TeacherScopeBadge({ scope, className = '' }) {
  if (!scope) {
    return null
  }

  return (
    <span
      title={scope.detail}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE_STYLES[scope.kind] || BADGE_STYLES.subject} ${className}`}
    >
      {scope.badgeLabel}
    </span>
  )
}

export function TeacherScopeHint({
  classId,
  subjectId,
  academicYearId,
  fallbackText = 'Scope badges on records show why each row is visible.',
  className = '',
}) {
  const { classifyScope, isTeacherEnabled, isLoading } = useTeacherScopeLookup({ academicYearId })

  if (!isTeacherEnabled || isLoading) {
    return null
  }

  const scope = classifyScope({ classId, subjectId })

  if (!scope) {
    return (
      <p className={`text-xs text-gray-500 ${className}`}>
        {fallbackText}
      </p>
    )
  }

  return (
    <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${HINT_STYLES[scope.kind] || HINT_STYLES.subject} ${className}`}>
      <TeacherScopeBadge scope={scope} className="mt-0.5" />
      <p>{scope.detail}</p>
    </div>
  )
}

export default TeacherScopeBadge