import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { normalizeLessonPlanText } from './lessonPlanTextUtils'

/** Match report card / finance exports (indigo-600) */
const PRIMARY = [79, 70, 229]
const MARGIN = 14
const FOOTER_MM = 10

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

/** JPEG data URL for reliable jsPDF embedding (handles PNG/JPEG sources). */
function compressImageForPdf(img, { maxDimension = 480, quality = 0.72 } = {}) {
  try {
    const srcW = img.naturalWidth || img.width
    const srcH = img.naturalHeight || img.height
    if (!srcW || !srcH) return null

    const scale = Math.min(1, maxDimension / Math.max(srcW, srcH))
    const outW = Math.max(1, Math.round(srcW * scale))
    const outH = Math.max(1, Math.round(srcH * scale))

    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.drawImage(img, 0, 0, outW, outH)

    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    if (!dataUrl || dataUrl.length < 200) return null
    return dataUrl
  } catch {
    return null
  }
}

function formatLessonDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return String(iso)
  }
}

/** A plan is "minimal" when none of the free-text detail fields have content. */
function isMinimalPlan(plan) {
  return (
    !normalizeLessonPlanText(plan.description) &&
    !normalizeLessonPlanText(plan.objectives_text ?? plan.objectives) &&
    !normalizeLessonPlanText(plan.teaching_methods) &&
    !normalizeLessonPlanText(plan.materials_needed)
  )
}

function slugifyForFilename(text) {
  const slug = String(text || '')
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'unknown'
}

function buildFilenameSegment(plans, field, fallback) {
  const values = Array.from(new Set(plans.map((p) => (p[field] || '').trim()).filter(Boolean)))
  if (values.length === 0) return fallback
  if (values.length === 1) return slugifyForFilename(values[0])
  return `multiple-${field === 'class_name' ? 'classes' : 'subjects'}`
}

/** Group plans by class+subject (alphabetical), preserving lesson_date order within each group. */
function groupPlansByClassSubject(plans) {
  const groups = new Map()
  plans.forEach((plan) => {
    const key = `${plan.class_obj ?? plan.class_name ?? ''}::${plan.subject ?? plan.subject_name ?? ''}`
    if (!groups.has(key)) {
      groups.set(key, {
        className: plan.class_name?.trim() || 'Unknown class',
        subjectName: plan.subject_name?.trim() || 'Unknown subject',
        plans: [],
      })
    }
    groups.get(key).plans.push(plan)
  })
  return Array.from(groups.values()).sort((a, b) => {
    const c = a.className.localeCompare(b.className)
    return c !== 0 ? c : a.subjectName.localeCompare(b.subjectName)
  })
}

/** Split a group's plans into runs of consecutive minimal / standard plans, in original order. */
function splitIntoRuns(plans) {
  const runs = []
  plans.forEach((plan) => {
    const minimal = isMinimalPlan(plan)
    const lastRun = runs[runs.length - 1]
    if (lastRun && lastRun.minimal === minimal) {
      lastRun.plans.push(plan)
    } else {
      runs.push({ minimal, plans: [plan] })
    }
  })
  return runs
}

/**
 * Build PDF and trigger browser download.
 * @param {Object} params
 * @param {Array} params.plans — lesson plan objects (same shape as list API)
 * @param {string} params.dateFrom — YYYY-MM-DD
 * @param {string} params.dateTo — YYYY-MM-DD
 * @param {string} [params.academicYearLabel]
 * @param {Object} [params.schoolData] — from schoolsApi.getMySchool() (`name`, `logo` URL)
 */
export async function exportLessonPlansPDF({
  plans,
  dateFrom,
  dateTo,
  academicYearLabel = '',
  schoolData = null,
}) {
  const generatedAt = new Date()
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const contentW = pageW - 2 * MARGIN
  const centerX = pageW / 2

  // --- Cover: logo + school name + title bar (first page only) ---
  let y = 10
  if (schoolData?.logo) {
    try {
      const img = await loadImage(schoolData.logo)
      const logoMm = 16
      const compressed = compressImageForPdf(img, { maxDimension: 400, quality: 0.75 })
      if (compressed) {
        doc.addImage(compressed, 'JPEG', centerX - logoMm / 2, y, logoMm, logoMm)
      } else {
        doc.addImage(img, 'PNG', centerX - logoMm / 2, y, logoMm, logoMm)
      }
      y += logoMm + 4
    } catch {
      // CORS or broken URL — continue without logo
    }
  }

  const displayName = (schoolData?.name || '').trim()
  if (displayName) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...PRIMARY)
    doc.text(displayName, centerX, y, { align: 'center' })
    y += 7
  }

  const barH = 9
  doc.setFillColor(...PRIMARY)
  doc.rect(0, y, pageW, barH, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Lesson plans', centerX, y + barH - 2.5, { align: 'center' })
  y += barH + 6

  doc.setTextColor(33, 33, 33)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  if (academicYearLabel) {
    doc.text(`Academic year: ${academicYearLabel}`, MARGIN, y)
    y += 6
  }
  doc.text(`Lesson dates: ${formatLessonDate(dateFrom)} to ${formatLessonDate(dateTo)}`, MARGIN, y)
  y += 6
  doc.setTextColor(90, 90, 90)
  doc.setFontSize(9)
  doc.text(`Plans included: ${plans.length}`, MARGIN, y)
  y += 8

  doc.setDrawColor(...PRIMARY)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, pageW - MARGIN, y)
  y += 8

  // Group by class/subject (class+subject is always constant within a group by
  // construction, so it's always shown as a heading rather than repeated per row).
  // Within each group, batch consecutive "minimal" plans into a single compact
  // table and render "standard" plans as full detail cards, in original date order.
  const groups = groupPlansByClassSubject(plans)

  const blocks = []
  groups.forEach((group) => {
    const teacherNames = Array.from(
      new Set(group.plans.map((p) => (p.teacher_name || '').trim()).filter(Boolean)),
    )
    const constantTeacher = teacherNames.length === 1 ? teacherNames[0] : null

    blocks.push({ type: 'heading', group, constantTeacher })

    splitIntoRuns(group.plans).forEach((run) => {
      if (run.minimal) {
        blocks.push({ type: 'compact', plans: run.plans, showTeacherColumn: !constantTeacher })
      } else {
        run.plans.forEach((plan) => blocks.push({ type: 'standard', plan }))
      }
    })
  })

  blocks.forEach((block, idx) => {
    const isLast = idx === blocks.length - 1

    if (block.type === 'heading') {
      y = ensureSpace(doc, y, 14, pageH)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(12)
      doc.setTextColor(...PRIMARY)
      doc.text(`${block.group.className} — ${block.group.subjectName}`, MARGIN, y)
      y += 3
      doc.setDrawColor(...PRIMARY)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, y, pageW - MARGIN, y)
      y += 5
      if (block.constantTeacher) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor(90, 90, 90)
        doc.text(`Teacher: ${block.constantTeacher}`, MARGIN, y)
        y += 6
      } else {
        y += 2
      }
      return
    }

    y = block.type === 'compact'
      ? renderCompactTable(doc, block.plans, y, contentW, { showTeacherColumn: block.showTeacherColumn })
      : renderStandardCard(doc, block.plan, y, pageH, contentW)

    y += 4
    if (!isLast) {
      y = ensureSpace(doc, y, 12, pageH)
      doc.setDrawColor(220, 220, 220)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, y, pageW - MARGIN, y)
      y += 10
    }
  })

  // Footer: generated timestamp (left) + page number (center), every page
  const total = doc.internal.getNumberOfPages()
  const generatedLabel = `Generated: ${generatedAt.toLocaleString()}`
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130, 130, 130)
    doc.setFont('helvetica', 'normal')
    doc.text(generatedLabel, MARGIN, pageH - FOOTER_MM / 2)
    doc.text(`Page ${i} of ${total}`, pageW / 2, pageH - FOOTER_MM / 2, { align: 'center' })
  }

  const classSeg = buildFilenameSegment(plans, 'class_name', 'all-classes')
  const subjectSeg = buildFilenameSegment(plans, 'subject_name', 'all-subjects')
  doc.save(`lesson-plans_${classSeg}_${subjectSeg}_${dateFrom}_${dateTo}.pdf`)
}

/**
 * One row per lesson for plans with no free-text detail
 * (date, chapter/topic, [teacher], duration, status, AI).
 * The Teacher column is dropped when every plan in this batch shares the same
 * teacher — that's already printed once above as "Teacher: X" instead.
 */
function renderCompactTable(doc, plans, startY, contentW, { showTeacherColumn = true } = {}) {
  const head = showTeacherColumn
    ? ['Date', 'Lesson / Topic', 'Teacher', 'Duration', 'Status', 'AI']
    : ['Date', 'Lesson / Topic', 'Duration', 'Status', 'AI']

  const body = plans.map((p) => {
    const row = [formatLessonDate(p.lesson_date), p.title?.trim() || p.display_text?.trim() || 'Untitled']
    if (showTeacherColumn) row.push(p.teacher_name || '—')
    row.push(
      p.duration_minutes != null ? `${p.duration_minutes} min` : '—',
      String(p.status || '—'),
      p.ai_generated ? 'AI' : '—',
    )
    return row
  })

  const columnStyles = showTeacherColumn
    ? {
        0: { cellWidth: 22 },
        1: { cellWidth: contentW - 22 - 35 - 20 - 18 - 12 },
        2: { cellWidth: 35 },
        3: { cellWidth: 20 },
        4: { cellWidth: 18 },
        5: { cellWidth: 12, halign: 'center' },
      }
    : {
        0: { cellWidth: 22 },
        1: { cellWidth: contentW - 22 - 20 - 18 - 12 },
        2: { cellWidth: 20 },
        3: { cellWidth: 18 },
        4: { cellWidth: 12, halign: 'center' },
      }

  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_MM + 4 },
    tableWidth: contentW,
    head: [head],
    body,
    theme: 'grid',
    headStyles: {
      fillColor: PRIMARY,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: 2.5,
    },
    bodyStyles: {
      fontSize: 8.5,
      cellPadding: 2.2,
      lineColor: [220, 220, 220],
      lineWidth: 0.1,
    },
    alternateRowStyles: { fillColor: [248, 248, 252] },
    columnStyles,
  })
  return doc.lastAutoTable.finalY
}

/** Full detail card for a plan with description/objectives/teaching-methods/materials content. */
function renderStandardCard(doc, plan, startY, pageH, contentW) {
  let y = startY
  const title = plan.title?.trim() || 'Untitled'
  const heading = `${formatLessonDate(plan.lesson_date)}  ·  ${title}`

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: contentW,
    head: [[{ content: heading, colSpan: 2 }]],
    headStyles: {
      fillColor: PRIMARY,
      textColor: 255,
      fontStyle: 'bold',
      fontSize: 10,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      valign: 'middle',
    },
    body: [
      ['Class', plan.class_name || '—'],
      ['Subject', plan.subject_name || '—'],
      ['Teacher', plan.teacher_name || '—'],
      [
        'Duration',
        plan.duration_minutes != null ? `${plan.duration_minutes} min` : '—',
      ],
      ['Status', String(plan.status || '—')],
      ...(plan.ai_generated ? [['Source', 'AI-generated']] : []),
    ],
    theme: 'plain',
    styles: {
      fontSize: 9,
      cellPadding: 2.5,
      lineColor: [220, 220, 220],
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { cellWidth: 42, fontStyle: 'bold', textColor: [85, 85, 85] },
      1: { cellWidth: contentW - 42 },
    },
  })

  y = doc.lastAutoTable.finalY + 6

  y = writeSection(doc, y, pageH, contentW, 'Description', plan.description)
  y = writeSection(
    doc,
    y,
    pageH,
    contentW,
    'Objectives',
    normalizeLessonPlanText(plan.objectives_text ?? plan.objectives),
  )
  y = writeSection(doc, y, pageH, contentW, 'Teaching methods', plan.teaching_methods)
  y = writeSection(doc, y, pageH, contentW, 'Materials needed', plan.materials_needed)

  if (plan.display_text?.trim()) {
    y = writeSection(doc, y, pageH, contentW, 'Curriculum / topic summary', plan.display_text)
  }

  if (plan.planned_topics?.length) {
    const bullets = plan.planned_topics
      .map((t) => {
        const ch = t.chapter != null ? ` (Ch. ${t.chapter})` : ''
        return `• ${t.title || 'Topic'}${ch}`
      })
      .join('\n')
    y = writeSection(doc, y, pageH, contentW, 'Planned topics', bullets)
  }

  if (plan.planned_subtopics?.length) {
    const bullets = plan.planned_subtopics
      .map((st) => `• ${st.title?.trim() || `Sub-topic #${st.id ?? '?'}`}`)
      .join('\n')
    y = writeSection(doc, y, pageH, contentW, 'Planned sub-topics', bullets)
  }

  return y
}

function ensureSpace(doc, y, neededMm, pageH) {
  if (y + neededMm > pageH - FOOTER_MM) {
    doc.addPage()
    return MARGIN + 4
  }
  return y
}

function writeSection(doc, startY, pageH, contentW, heading, rawText) {
  const text = rawText != null && String(rawText).trim() ? String(rawText).trim() : '—'
  let y = startY
  y = ensureSpace(doc, y, 12, pageH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(55, 55, 55)
  doc.text(heading, MARGIN, y)
  y += 5.5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(35, 35, 35)

  const lines = doc.splitTextToSize(text, contentW)
  const lineH = 4.4
  for (let i = 0; i < lines.length; i++) {
    y = ensureSpace(doc, y, lineH + 1, pageH)
    doc.text(lines[i], MARGIN, y)
    y += lineH
  }

  return y + 3
}
