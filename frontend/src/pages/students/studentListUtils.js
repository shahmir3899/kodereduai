import { sortClassOptions } from '../../utils/classOrdering'

// Pure list logic extracted from StudentsPage so it can be tested without
// rendering the page. Behaviour is unchanged from the inline useMemos.

const matchesSearch = (student, search) => {
  const needle = search.toLowerCase()
  return student.name?.toLowerCase().includes(needle) || student.roll_number?.toLowerCase().includes(needle)
}

export function compareRollNumbers(leftRoll, rightRoll) {
  const leftRaw = String(leftRoll || '').trim()
  const rightRaw = String(rightRoll || '').trim()
  const leftParsed = Number.parseInt(leftRaw, 10)
  const rightParsed = Number.parseInt(rightRaw, 10)
  const leftIsNumeric = Number.isFinite(leftParsed)
  const rightIsNumeric = Number.isFinite(rightParsed)

  if (leftIsNumeric && rightIsNumeric) return leftParsed - rightParsed
  if (leftIsNumeric) return -1
  if (rightIsNumeric) return 1

  return leftRaw.localeCompare(rightRaw, undefined, { numeric: true, sensitivity: 'base' })
}

const compareText = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, {
  numeric: true,
  sensitivity: 'base',
})

// Class filter options for the chips: session classes when an academic year is
// active, master classes otherwise.
export function buildClassFilterOptions({ scope, sessionClasses, classes }) {
  const baseOptions = scope === 'session'
    ? sessionClasses
      .filter((sc) => !!sc.class_obj)
      .map((sc) => ({
        id: sc.id,
        class_obj: sc.class_obj,
        name: sc.display_name || `Class ${sc.class_obj}`,
        label: sc.label || (sc.section
          ? `${sc.display_name || `Class ${sc.class_obj}`} - ${sc.section}`
          : (sc.display_name || `Class ${sc.class_obj}`)),
        grade_level: sc.grade_level,
        section: sc.section || '',
      }))
    : classes

  return sortClassOptions(baseOptions).map((cls) => ({
    id: String(cls.id),
    label: cls.label || cls.name,
  }))
}

export function filterStudents({
  students,
  selectedClassIds,
  resolvedSelectedClasses,
  scope,
  sessionClasses,
  search,
  showInactive,
}) {
  const sessionClassMap = new Map((sessionClasses || []).map((sc) => [String(sc.id), sc]))
  const selectedSessionMatchers = selectedClassIds
    .map((selectedId) => {
      const sc = sessionClassMap.get(String(selectedId))
      if (!sc) return null
      return {
        sessionClassId: String(sc.id),
        masterClassId: sc.class_obj ? String(sc.class_obj) : '',
        hasSection: !!sc.section,
      }
    })
    .filter(Boolean)

  return students.filter((student) => {
    if (resolvedSelectedClasses.length > 0) {
      if (scope === 'session') {
        const matchesAnySelectedSession = selectedSessionMatchers.some((matcher) => {
          const studentSessionClassId = String(student.session_class_obj || '')
          // Prefer exact session_class_obj match (most reliable — handles shared master class)
          if (studentSessionClassId && matcher.sessionClassId) {
            return studentSessionClassId === matcher.sessionClassId
          }
          // Fallback: match by master class ID (only safe when no section)
          if (!matcher.hasSection && matcher.masterClassId) {
            return String(student.class_obj || '') === matcher.masterClassId
          }
          return false
        })
        if (!matchesAnySelectedSession) return false
      } else if (!resolvedSelectedClasses.includes(student.class_obj?.toString())) {
        return false
      }
    }
    if (search && !matchesSearch(student, search)) return false
    // Hide inactive records by default (Record State), toggled via the filter bar
    if (!showInactive && !student.is_active) return false
    return true
  })
}

// Roll order when focused on one class, otherwise grade -> class name -> roll -> name.
// Sorts in place; callers pass the fresh array filterStudents returned.
export function sortStudents(students, { selectedClassIds, resolvedSelectedClasses, classGradeMap }) {
  const isSingleClassFilter = selectedClassIds.length === 1 || resolvedSelectedClasses.length === 1

  return students.sort((a, b) => {
    if (isSingleClassFilter) {
      const rollCompare = compareRollNumbers(a.roll_number, b.roll_number)
      return rollCompare !== 0 ? rollCompare : compareText(a.name, b.name)
    }

    const gradeA = classGradeMap[a.class_obj] ?? 999
    const gradeB = classGradeMap[b.class_obj] ?? 999
    if (gradeA !== gradeB) return gradeA - gradeB

    const classNameCompare = compareText(a.class_name, b.class_name)
    if (classNameCompare !== 0) return classNameCompare

    const rollCompare = compareRollNumbers(a.roll_number, b.roll_number)
    return rollCompare !== 0 ? rollCompare : compareText(a.name, b.name)
  })
}

const LEFT_STATUSES = ['WITHDRAWN', 'TRANSFERRED', 'GRADUATED']

// "Left" = no longer here: withdrawn, transferred, graduated, or switched off.
export const hasLeft = (student) => LEFT_STATUSES.includes(student.status) || !student.is_active

export function computeStats(students) {
  const active = students.filter((s) => !hasLeft(s)).length
  const byClass = {}
  students.forEach((s) => {
    const className = s.class_name || 'Unassigned'
    byClass[className] = (byClass[className] || 0) + 1
  })
  return { total: students.length, active, inactive: students.length - active, byClass }
}

export function summarizeByGender(students) {
  const counts = { male: 0, female: 0, other: 0, unknown: 0 }
  students.forEach((s) => {
    const g = (s.gender || '').toString().trim().toLowerCase()
    if (g === 'male' || g === 'm') counts.male += 1
    else if (g === 'female' || g === 'f') counts.female += 1
    else if (g) counts.other += 1
    else counts.unknown += 1
  })
  return counts
}

// Per-class counts for the chips. Uses the search filter only (not the class
// filter), so every chip stays visible; zero-count chips are dimmed by the UI.
export function buildClassChipData({ allStudents, search, classFilterOptions, scope, sessionClasses }) {
  const counts = {}
  allStudents.forEach((s) => {
    if (search && !matchesSearch(s, search)) return
    const key = s.class_obj ? String(s.class_obj) : null
    if (key) counts[key] = (counts[key] || 0) + 1
  })

  // Session class ID -> session class (needed when scope is session)
  const sessionById = {}
  sessionClasses.forEach((sc) => {
    sessionById[String(sc.id)] = sc
  })

  return classFilterOptions.map((option) => {
    const sessionClass = scope === 'session' ? sessionById[String(option.id)] : null
    const masterClassId = scope === 'session'
      ? (sessionClass?.class_obj ? String(sessionClass.class_obj) : '')
      : option.id

    const count = scope === 'session'
      ? allStudents.filter((s) => {
        const studentSessionClassId = String(s.session_class_obj || '')
        // Prefer exact session_class_obj match
        if (studentSessionClassId && option.id) {
          return studentSessionClassId === String(option.id)
        }
        // Fallback for students without session_class_obj annotation (non-academic-year scope)
        const studentClassId = String(s.class_obj || '')
        return masterClassId ? studentClassId === masterClassId : false
      }).length
      : (masterClassId ? (counts[masterClassId] || 0) : 0)

    return { id: option.id, name: option.label, count }
  })
}
