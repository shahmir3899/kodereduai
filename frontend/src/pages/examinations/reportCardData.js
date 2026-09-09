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
    summary: report.summary || null,
    gradeScales: report.grade_scales || [],
    attendance: report.attendance || null,
    classSize: report.class_size || null,
    conduct: report.conduct_assessment || null,
    promotionStatus: report.promotion_status || null,
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
