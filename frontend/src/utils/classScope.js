import { sortClassOptions } from './classOrdering'

export function getClassSelectorScope(activeAcademicYearId) {
  return activeAcademicYearId ? 'session' : 'master'
}

export function getResolvedMasterClassId(classId, activeAcademicYearId, sessionClasses = []) {
  if (!classId) return ''
  if (!activeAcademicYearId) return String(classId)
  const match = sessionClasses.find(sc => String(sc.id) === String(classId))
  return match?.class_obj ? String(match.class_obj) : ''
}

export function resolveClassIdToMasterClassId(classId, activeAcademicYearId, sessionClasses = []) {
  if (!classId) return ''
  if (!activeAcademicYearId) return String(classId)
  const match = sessionClasses.find(sc => String(sc.id) === String(classId))
  if (match?.class_obj) return String(match.class_obj)
  return String(classId)
}

export function resolveSessionClassId(classId, activeAcademicYearId, sessionClasses = []) {
  if (!classId || !activeAcademicYearId) return ''
  const match = sessionClasses.find(sc => String(sc.id) === String(classId))
  return match ? String(classId) : ''
}

export function buildStudentClassFilterParams({
  classId,
  activeAcademicYearId,
  sessionClasses = [],
  includeAcademicYear = true,
  classKey = 'class_id',
}) {
  const resolvedMasterClassId = resolveClassIdToMasterClassId(classId, activeAcademicYearId, sessionClasses)
  const resolvedSessionClassId = resolveSessionClassId(classId, activeAcademicYearId, sessionClasses)

  const params = {
    ...(resolvedMasterClassId && { [classKey]: resolvedMasterClassId }),
    ...(resolvedSessionClassId && { session_class_id: resolvedSessionClassId }),
  }

  if (includeAcademicYear && activeAcademicYearId) {
    params.academic_year = activeAcademicYearId
  }

  return params
}

export function buildSessionLabeledMasterClassOptions({
  sessionClasses = [],
  masterClasses = [],
  sessionScopedOnly = false,
}) {
  const activeSessionClasses = (sessionClasses || []).filter(sc => sc?.class_obj && sc?.is_active !== false)

  const byMasterClassId = new Map()
  activeSessionClasses.forEach(sc => {
    const key = String(sc.class_obj)
    if (!byMasterClassId.has(key)) {
      byMasterClassId.set(key, [])
    }
    byMasterClassId.get(key).push(sc)
  })

  const masterClassById = new Map(
    (masterClasses || [])
      .filter(cls => !!cls?.id)
      .map(cls => [String(cls.id), cls]),
  )

  const hasSessionScopedData = byMasterClassId.size > 0
  const allMasterIds = sessionScopedOnly && hasSessionScopedData
    ? new Set([...byMasterClassId.keys()])
    : new Set([
      ...masterClassById.keys(),
      ...byMasterClassId.keys(),
    ])

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

  return [...allMasterIds].map(masterId => {
    const masterClass = masterClassById.get(masterId)
    const sessionVariants = byMasterClassId.get(masterId) || []
    const sectionList = [...new Set(
      sessionVariants
        .map(sc => String(sc.section || '').trim())
        .filter(Boolean),
    )].sort((left, right) => collator.compare(left, right))

    const baseName =
      masterClass?.name ||
      sessionVariants[0]?.class_obj_name ||
      sessionVariants[0]?.display_name ||
      sessionVariants[0]?.label ||
      `Class ${masterId}`

    let label = masterClass
      ? `${masterClass.name}${masterClass.section ? ` - ${masterClass.section}` : ''}`
      : baseName

    if (sessionVariants.length === 1) {
      const only = sessionVariants[0]
      label = only.display_name || only.label || `${baseName}${only.section ? ` - ${only.section}` : ''}`
    } else if (sessionVariants.length > 1) {
      label = sectionList.length > 0
        ? `${baseName} (Sections: ${sectionList.join(', ')})`
        : `${baseName} (${sessionVariants.length} session variants)`
    }

    const fallbackId = Number.isNaN(Number(masterId)) ? masterId : Number(masterId)

    return {
      id: masterClass?.id ?? fallbackId,
      class_obj: masterClass?.id ?? fallbackId,
      name: baseName,
      section: '',
      grade_level: masterClass?.grade_level ?? sessionVariants[0]?.grade_level,
      is_active: masterClass?.is_active ?? true,
      label,
      session_variant_count: sessionVariants.length,
      has_section_variants: sessionVariants.length > 1,
    }
  })
}

export function buildSessionClassOptions(sessionClasses = []) {
  return sortClassOptions((sessionClasses || [])
    .filter(sc => !!sc?.id && !!sc?.class_obj && sc?.is_active !== false)
    .map(sc => {
      const displayName = sc.display_name || sc.class_obj_name || `Class ${sc.class_obj}`
      const section = String(sc.section || '').trim()
      const label = sc.label || (section ? `${displayName} - ${section}` : displayName)

      return {
        id: sc.id,
        class_obj: sc.class_obj,
        name: displayName,
        section,
        grade_level: sc.grade_level,
        is_active: sc.is_active,
        label,
      }
    }))
}

export function buildSessionOrMasterClassParams({
  classId,
  activeAcademicYearId,
  sessionClasses = [],
  masterKey = 'class_id',
}) {
  if (!classId) return {}

  if (activeAcademicYearId) {
    const params = {
      session_class_id: classId,
      academic_year: activeAcademicYearId,
    }

    const resolvedMasterClassId = getResolvedMasterClassId(classId, activeAcademicYearId, sessionClasses)
    if (resolvedMasterClassId) {
      params[masterKey] = resolvedMasterClassId
    }

    return params
  }

  return { [masterKey]: classId }
}
