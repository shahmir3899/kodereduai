// File names for downloaded student reports.
//   single PDF: "<Roll> - <Student name> - <Class> (<Duration>).pdf"
//   zip:        "<Class> - (<Duration>) - <N> reports.zip"
// Duration reads the same period the PDF header shows, so a name always matches its content.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Strips characters Windows/macOS reject in file names and tidies whitespace.
export function safePart(text) {
  return String(text ?? '').replace(/[\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim()
}

// "Class 2 - A" -> "Class 2-A": the spaced dash would read as a name-part separator.
export function classLabel(className) {
  return safePart(String(className ?? '').replace(/\s+-\s+/g, '-'))
}

const parts = (iso) => iso.split('-').map(Number)

export function durationLabel(periodParams = {}, academicYearName = '') {
  const { date_from: from, date_to: to, academic_year: yearId } = periodParams
  if (from && to) {
    const [fy, fm, fd] = parts(from)
    const [ty, tm, td] = parts(to)
    const lastDay = new Date(fy, fm, 0).getDate()
    if (fy === ty && fm === tm && fd === 1 && td === lastDay) return `${MONTHS[fm - 1]} ${fy}`
    const left = `${String(fd).padStart(2, '0')} ${MONTHS[fm - 1]}${fy === ty ? '' : ` ${fy}`}`
    return `${left}-${String(td).padStart(2, '0')} ${MONTHS[tm - 1]} ${ty}`
  }
  if (yearId) return academicYearName ? `AY ${safePart(academicYearName)}` : 'Academic year'
  return 'All time'
}

export function singleReportFileName(student, duration) {
  const cls = classLabel(student.class_name)
  const name = [safePart(student.roll_number), safePart(student.name) || 'Student', cls]
    .filter(Boolean).join(' - ')
  return `${name} (${duration}).pdf`
}

export function zipFileName(students, duration) {
  const classes = [...new Set(students.map((s) => classLabel(s.class_name)).filter(Boolean))]
  const cls = classes.length === 1 ? classes[0] : classes.length > 1 ? 'Multiple classes' : 'Students'
  const n = students.length
  return `${cls} - (${duration}) - ${n} ${n === 1 ? 'report' : 'reports'}.zip`
}

// Two students can share name/roll; a repeat gets " (2)" so no entry overwrites another in the zip.
export function uniqueNames(names) {
  const used = new Map()
  return names.map((full) => {
    const dot = full.lastIndexOf('.')
    const base = dot > 0 ? full.slice(0, dot) : full
    const ext = dot > 0 ? full.slice(dot) : ''
    const n = (used.get(full) ?? 0) + 1
    used.set(full, n)
    return n > 1 ? `${base} [${n}]${ext}` : full
  })
}
