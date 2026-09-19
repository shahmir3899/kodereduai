// Helpers shared by the report card templates, so the two layouts can't drift on
// how positions, the grade key and per-subject comments are worked out.

export function ordinal(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return String(n)
  const tens = v % 100
  if (tens >= 11 && tens <= 13) return `${v}th`
  return `${v}${{ 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'}`
}

export function positionText(rank, classSize) {
  return classSize ? `${ordinal(rank)} of ${classSize}` : ordinal(rank)
}

// "A+ 90-100 | A 80-89 ..." - highest band first, from the school's own grade scale.
export function gradeKeyText(gradeScales) {
  const scales = (gradeScales || []).filter(g => g.grade_label && g.min_percentage != null && g.max_percentage != null)
  if (!scales.length) return ''
  const num = (v) => String(Math.round(Number(v) * 100) / 100)
  const parts = [...scales]
    .sort((a, b) => Number(b.min_percentage) - Number(a.min_percentage))
    .map(g => `${g.grade_label} ${num(g.min_percentage)}–${num(g.max_percentage)}%`)
  return `Grade key:  ${parts.join('   ·   ')}`
}

/**
 * Prints the grade key as one unboxed line, shrinking the type until it fits the
 * width (down to a floor) so it never wraps into a second line for normal scales.
 * Returns the y to continue from.
 */
export function drawGradeKey(doc, data, x, y, width) {
  const text = gradeKeyText(data.gradeScales)
  if (!text) return y
  let size = 7.5
  doc.setFont(undefined, 'normal')
  doc.setFontSize(size)
  while (size > 5.5 && doc.getTextWidth(text) > width) {
    size -= 0.25
    doc.setFontSize(size)
  }
  doc.setTextColor(110)
  doc.text(doc.splitTextToSize(text, width), x, y)
  doc.setTextColor(0)
  return y + 5
}

/**
 * Builds table body rows where each subject that has a comment gets a second,
 * full-width row directly beneath it. `meta[i]` says which subject row i belongs to
 * (needed because autoTable's own row index no longer matches the subject index).
 */
export function rowsWithComments(subjects, buildRow, colSpan, commentStyles = {}) {
  const body = []
  const meta = []
  subjects.forEach((s, subjectIdx) => {
    body.push(buildRow(s))
    meta.push({ subjectIdx, isComment: false })
    if (s.comment) {
      body.push([{
        content: s.comment,
        colSpan,
        styles: {
          halign: 'left', fontStyle: 'italic', fontSize: 8, textColor: [95, 100, 115],
          cellPadding: { top: 0.5, right: 4, bottom: 3, left: 4 },
          ...commentStyles,
        },
      }])
      meta.push({ subjectIdx, isComment: true })
    }
  })
  return { body, meta }
}
