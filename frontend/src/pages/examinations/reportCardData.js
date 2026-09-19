export const DEFAULT_SIGNATURE_LABELS = {
  class_teacher: 'Class Teacher',
  principal: 'Principal',
  parent: 'Parent',
}

// "1st Term Exam 2026-27 - Playgroup" -> "1st Term Exam": table headers are narrow, and the
// class suffix and year are already on the card.
export function shortExamName(name) {
  const text = String(name || '')
  return text
    .replace(/\s+[-\u2013]\s+.*$/, '')
    .replace(/\s*\d{4}\s*[-/]\s*\d{2,4}\s*$/, '')
    .trim() || text
}

export function formatIssueDate(iso) {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Normalizes the ReportCardView API response + school profile into one plain
 * object that every template (enhanced, traditional, ...) renders from.
 * Keeping this in one place is what guarantees the formats never drift apart
 * on which fields they show.
 */
export async function buildReportData({ report, schoolData }) {
  let logo = null
  if (schoolData?.logo) {
    try {
      logo = await loadImage(schoolData.logo)
    } catch {
      // Logo failed to load (missing file, CORS, etc.) - render without it.
    }
  }

  let photo = null
  if (report.photo_url) {
    try {
      photo = await loadImage(report.photo_url)
    } catch {
      // Student photo is optional - fall back to initials in the template.
    }
  }

  return {
    schoolName: report.school_name || schoolData?.name || 'Report Card',
    schoolAddress: schoolData?.address || '',
    schoolContact: [schoolData?.contact_email, schoolData?.contact_phone].filter(Boolean).join(' | '),
    logo,
    studentName: report.student_name || '-',
    rollNumber: report.roll_number || '-',
    className: report.class_name || '-',
    guardianName: report.guardian_name || '',
    photo,
    academicYear: report.academic_year_name || '',
    // The exam(s) that produced these marks - a term can hold more than one
    // (Quiz/Midterm/Final), so this is never just the term name.
    examDisplay: report.exam_display || report.term_name || '',
    termName: report.term_name || '',
    subjects: report.subjects || [],
    // Oldest first; the one flagged is_main decides the result, the rest are history
    // (unless the school weights exams, in which case `weighted` is true).
    exams: report.exams || [],
    weighted: !!report.weighted,
    classAvgUnit: report.class_avg_unit || 'marks',
    earlierExamNames: report.earlier_exam_names || [],
    summary: report.summary || null,
    gradeScales: report.grade_scales || [],
    attendance: report.attendance || null,
    classSize: report.class_size || null,
    conduct: report.conduct_assessment || null,
    overallComment: report.overall_comment || '',
    // Promotion only exists on a final-exam report; NOT_APPLICABLE stays off the card.
    promotion: {
      applicable: !!report.promotion_applicable,
      status: report.promotion_status || 'NOT_APPLICABLE',
    },
    // Defaults to the day the PDF is generated until someone sets a date on the page.
    issueDate: report.issue_date || new Date().toISOString().slice(0, 10),
    signatureLabels: { ...DEFAULT_SIGNATURE_LABELS, ...(report.signature_labels || {}) },
  }
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}
