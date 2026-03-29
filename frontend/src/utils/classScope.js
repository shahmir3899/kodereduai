export function getClassSelectorScope(activeAcademicYearId) {
  return activeAcademicYearId ? 'session' : 'master'
}

export function getResolvedMasterClassId(classId, activeAcademicYearId, sessionClasses = []) {
  if (!classId) return ''
  if (!activeAcademicYearId) return String(classId)
  const match = sessionClasses.find(sc => String(sc.id) === String(classId))
  return match?.class_obj ? String(match.class_obj) : ''
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
