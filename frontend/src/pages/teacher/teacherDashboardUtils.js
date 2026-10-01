// Pure helpers for TeacherDashboard — kept out of the component so the
// period / section-matching rules can be tested without mounting the page.

const toMinutes = (t) => {
  if (!t) return null
  const [h, m] = String(t).slice(0, 5).split(':').map(Number)
  return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m
}

/**
 * Where "now" sits in today's timetable (entries must be ordered by slot).
 * Returns { index, state: 'now' | 'next' | null, minutes } where `minutes` is
 * time left in the current period, or until the next one starts.
 * Slots with no start/end time are skipped rather than treated as 00:00.
 */
export function findPeriod(timetable, now) {
  const cur = now.getHours() * 60 + now.getMinutes()
  for (let i = 0; i < timetable.length; i++) {
    const start = toMinutes(timetable[i].slot_start_time)
    const end = toMinutes(timetable[i].slot_end_time)
    if (start != null && end != null && cur >= start && cur < end) {
      return { index: i, state: 'now', minutes: end - cur }
    }
  }
  for (let i = 0; i < timetable.length; i++) {
    const start = toMinutes(timetable[i].slot_start_time)
    if (start != null && cur < start) {
      return { index: i, state: 'next', minutes: start - cur }
    }
  }
  return { index: -1, state: null, minutes: 0 }
}

/**
 * Which of the teacher's class-teacher assignments covers a timetable entry.
 * An entry with a session_class only matches that exact section. A shared
 * (non-override) entry has no session_class and matches on the master class.
 */
export function matchAssignment(entry, assignments) {
  if (!entry) return null
  return assignments.find((a) => {
    if (entry.session_class) return Number(a.session_class) === Number(entry.session_class)
    return Number(a.class_obj) === Number(entry.class_obj)
  }) || null
}

/**
 * Query params that scope enrollment/attendance lookups to ONE section.
 * Falls back to the master class only for legacy assignments with no
 * session_class — using the master id for a sectioned class would mix sections.
 */
export function sectionParams(assignment, academicYearId) {
  const ay = academicYearId ? { academic_year: academicYearId } : {}
  if (assignment.session_class) return { session_class_id: assignment.session_class, ...ay }
  return { class_id: assignment.class_obj, ...ay }
}

/** The id ManualEntryPage expects in ?class= (session class when we have one). */
export function manualEntryClassId(assignment) {
  return assignment.session_class || assignment.class_obj
}

export function assignmentLabel(a) {
  return `${a.class_name}${a.class_section ? ` - ${a.class_section}` : ''}`
}

/** Total count from a paginated list response (works with page_size=1) or a plain array. */
export function countOf(res) {
  const d = res?.data
  if (d == null) return null
  if (typeof d.count === 'number') return d.count
  const list = d.results || d
  return Array.isArray(list) ? list.length : null
}

export function buildTeacherAttentionItems({
  isOffDay = false,
  attendanceOn = true,
  examsOn = true,
  academicsOn = true,
  pendingAttendanceClasses,
  submissionsToGrade,
  examsAwaitingMarks,
  studentsAtRisk,
}) {
  const items = []
  const add = (key, count, label, href, tone) => {
    if (Number(count) > 0) items.push({ key, count: Number(count), label, href, tone })
  }
  if (attendanceOn && !isOffDay) {
    add('att', pendingAttendanceClasses, 'classes still need attendance', '/attendance/manual-entry', 'red')
  }
  if (examsOn) add('marks', examsAwaitingMarks, 'exams awaiting marks entry', '/academics/marks-entry', 'amber')
  if (academicsOn) add('grade', submissionsToGrade, 'submissions to grade', '/academics/assignments', 'amber')
  add('risk', studentsAtRisk, 'students at risk in your classes', '#students-at-risk', 'amber')
  return items
}
