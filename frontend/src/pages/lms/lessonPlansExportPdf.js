import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { normalizeLessonPlanText } from './lessonPlanTextUtils'
import { containsArabicScript, renderArabicTextToImage } from '../../utils/pdfArabicRender'

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

/** Draws plain text, or (for Urdu/Arabic content) a pre-rendered image using the browser's own text shaping. */
async function drawAdaptiveText(doc, text, x, y, { fontStyle = 'normal', fontSize = 10, color = [0, 0, 0], align = 'left', maxWidthMm } = {}) {
  if (containsArabicScript(text)) {
    const rendered = await renderArabicTextToImage(text, {
      maxWidthMm: maxWidthMm ?? 120,
      fontSizePt: fontSize,
      color,
      align: align === 'center' ? 'right' : align,
    })
    const drawX = align === 'right' ? x - rendered.widthMm : align === 'center' ? x - rendered.widthMm / 2 : x
    doc.addImage(rendered.dataUrl, 'PNG', drawX, y - rendered.heightMm * 0.75, rendered.widthMm, rendered.heightMm)
    return rendered.heightMm
  }
  doc.setFont('helvetica', fontStyle)
  doc.setFontSize(fontSize)
  doc.setTextColor(...color)
  doc.text(text, x, y, { align })
  return 0
}

/** Extra breathing room around Urdu images, on top of the cell's own padding — plain text sits
 *  flush against that padding fine, but a right-aligned image reads as visually cramped there. */
const ARABIC_IMAGE_MARGIN_MM = 2

/** Pre-renders every Arabic-script string appearing in a table's body rows, keyed by the raw cell value. */
async function prerenderArabicBodyCells(bodyRows, colWidthsMm, { fontSizePt = 9, color = [30, 30, 30], paddingMm = 2.2 } = {}) {
  const images = new Map()
  for (const row of bodyRows) {
    for (let colIndex = 0; colIndex < row.length; colIndex++) {
      const text = String(row[colIndex] ?? '')
      if (!containsArabicScript(text) || images.has(text)) continue
      const colWidth = colWidthsMm[colIndex] ?? 40
      const rendered = await renderArabicTextToImage(text, {
        maxWidthMm: Math.max(colWidth - paddingMm * 2 - ARABIC_IMAGE_MARGIN_MM * 2, 10),
        fontSizePt,
        color,
        align: 'right',
      })
      images.set(text, rendered)
    }
  }
  return images
}

/**
 * autotable didParseCell/didDrawCell pair that substitutes a pre-rendered image for any
 * body cell matching imagesMap. Uses the image's own natural dimensions (it was pre-rendered
 * at exactly this column's target width) rather than re-deriving from data.cell.width — at
 * didParseCell time, column widths from a fixed `columnStyles.cellWidth` haven't been resolved
 * onto the cell yet (that happens later in autotable's layout pass), so relying on
 * data.cell.width there previously produced an undersized row that clipped the image.
 */
function makeArabicCellHooks(doc, imagesMap) {
  return {
    didParseCell(data) {
      if (data.section !== 'body') return
      const rendered = imagesMap.get(String(data.cell.raw ?? ''))
      if (!rendered) return
      data.cell.text = []
      data.cell.styles.minCellHeight = rendered.heightMm + data.cell.padding('vertical') + ARABIC_IMAGE_MARGIN_MM
    },
    didDrawCell(data) {
      if (data.section !== 'body') return
      const rendered = imagesMap.get(String(data.cell.raw ?? ''))
      if (!rendered) return
      const x = data.cell.x + data.cell.width - data.cell.padding('right') - ARABIC_IMAGE_MARGIN_MM - rendered.widthMm
      const y = data.cell.y + (data.cell.height - rendered.heightMm) / 2
      doc.addImage(rendered.dataUrl, 'PNG', x, y, rendered.widthMm, rendered.heightMm)
    },
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
    const consumed = await drawAdaptiveText(doc, displayName, centerX, y + 5, {
      fontStyle: 'bold', fontSize: 11, color: PRIMARY, align: 'center', maxWidthMm: contentW,
    })
    y += consumed > 0 ? consumed + 4 : 7
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

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx]
    const isLast = idx === blocks.length - 1

    if (block.type === 'heading') {
      y = ensureSpace(doc, y, 14, pageH)
      const groupHeading = `${block.group.className} — ${block.group.subjectName}`
      await drawAdaptiveText(doc, groupHeading, MARGIN, y, { fontStyle: 'bold', fontSize: 12, color: PRIMARY, maxWidthMm: contentW })
      y += 3
      doc.setDrawColor(...PRIMARY)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, y, pageW - MARGIN, y)
      y += 5
      if (block.constantTeacher) {
        const teacherLine = `Teacher: ${block.constantTeacher}`
        await drawAdaptiveText(doc, teacherLine, MARGIN, y, { fontStyle: 'normal', fontSize: 9, color: [90, 90, 90], maxWidthMm: contentW })
        y += 6
      } else {
        y += 2
      }
      continue
    }

    y = block.type === 'compact'
      ? await renderCompactTable(doc, block.plans, y, contentW, { showTeacherColumn: block.showTeacherColumn })
      : await renderStandardCard(doc, block.plan, y, pageH, contentW)

    y += 4
    if (!isLast) {
      y = ensureSpace(doc, y, 12, pageH)
      doc.setDrawColor(220, 220, 220)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, y, pageW - MARGIN, y)
      y += 10
    }
  }

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
async function renderCompactTable(doc, plans, startY, contentW, { showTeacherColumn = true } = {}) {
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

  const colWidthsMm = Array.from({ length: head.length }, (_, i) => columnStyles[i]?.cellWidth ?? 20)
  const bodyPaddingMm = 2.2
  const arabicImages = await prerenderArabicBodyCells(body, colWidthsMm, { fontSizePt: 8.5, paddingMm: bodyPaddingMm })
  const { didParseCell, didDrawCell } = makeArabicCellHooks(doc, arabicImages)

  autoTable(doc, {
    startY,
    margin: { left: MARGIN, right: MARGIN, bottom: FOOTER_MM + 4 },
    tableWidth: contentW,
    head: [head],
    body,
    didParseCell,
    didDrawCell,
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
      cellPadding: bodyPaddingMm,
      lineColor: [220, 220, 220],
      lineWidth: 0.1,
    },
    alternateRowStyles: { fillColor: [248, 248, 252] },
    columnStyles,
  })
  return doc.lastAutoTable.finalY
}

/** Full detail card for a plan with description/objectives/teaching-methods/materials content. */
async function renderStandardCard(doc, plan, startY, pageH, contentW) {
  let y = startY
  const title = plan.title?.trim() || 'Untitled'
  const heading = `${formatLessonDate(plan.lesson_date)}  ·  ${title}`
  const barH = 9

  // Heading bar is drawn directly (not via autotable) so Urdu titles can be placed as an image.
  y = ensureSpace(doc, y, barH + 4, pageH)
  doc.setFillColor(...PRIMARY)
  doc.rect(MARGIN, y, contentW, barH, 'F')
  if (containsArabicScript(heading)) {
    const rendered = await renderArabicTextToImage(heading, {
      maxWidthMm: contentW - 6,
      fontSizePt: 10,
      color: [255, 255, 255],
      align: 'right',
    })
    const drawH = Math.min(rendered.heightMm, barH - 2)
    const drawW = rendered.widthMm * (drawH / rendered.heightMm)
    doc.addImage(rendered.dataUrl, 'PNG', MARGIN + contentW - 3 - drawW, y + (barH - drawH) / 2, drawW, drawH)
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(255, 255, 255)
    doc.text(heading, MARGIN + 3, y + barH - 2.5)
  }
  y += barH + 3

  const metaBody = [
    ['Class', plan.class_name || '—'],
    ['Subject', plan.subject_name || '—'],
    ['Teacher', plan.teacher_name || '—'],
    ['Duration', plan.duration_minutes != null ? `${plan.duration_minutes} min` : '—'],
    ['Status', String(plan.status || '—')],
    ...(plan.ai_generated ? [['Source', 'AI-generated']] : []),
  ]
  const metaColWidthsMm = [42, contentW - 42]
  const metaPaddingMm = 2.5
  const metaImages = await prerenderArabicBodyCells(metaBody, metaColWidthsMm, { fontSizePt: 9, paddingMm: metaPaddingMm })
  const { didParseCell, didDrawCell } = makeArabicCellHooks(doc, metaImages)

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN },
    tableWidth: contentW,
    body: metaBody,
    didParseCell,
    didDrawCell,
    theme: 'plain',
    styles: {
      fontSize: 9,
      cellPadding: metaPaddingMm,
      lineColor: [220, 220, 220],
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { cellWidth: metaColWidthsMm[0], fontStyle: 'bold', textColor: [85, 85, 85] },
      1: { cellWidth: metaColWidthsMm[1] },
    },
  })

  y = doc.lastAutoTable.finalY + 6

  y = await writeSection(doc, y, pageH, contentW, 'Description', plan.description)
  y = await writeSection(
    doc,
    y,
    pageH,
    contentW,
    'Objectives',
    normalizeLessonPlanText(plan.objectives_text ?? plan.objectives),
  )
  y = await writeSection(doc, y, pageH, contentW, 'Teaching methods', plan.teaching_methods)
  y = await writeSection(doc, y, pageH, contentW, 'Materials needed', plan.materials_needed)

  if (plan.display_text?.trim()) {
    y = await writeSection(doc, y, pageH, contentW, 'Curriculum / topic summary', plan.display_text)
  }

  if (plan.planned_topics?.length) {
    const bullets = plan.planned_topics
      .map((t) => {
        const ch = t.chapter != null ? ` (Ch. ${t.chapter})` : ''
        return `• ${t.title || 'Topic'}${ch}`
      })
      .join('\n')
    y = await writeSection(doc, y, pageH, contentW, 'Planned topics', bullets)
  }

  if (plan.planned_subtopics?.length) {
    const bullets = plan.planned_subtopics
      .map((st) => `• ${st.title?.trim() || `Sub-topic #${st.id ?? '?'}`}`)
      .join('\n')
    y = await writeSection(doc, y, pageH, contentW, 'Planned sub-topics', bullets)
  }

  if (plan.custom_topics?.length) {
    const bullets = plan.custom_topics.map((label) => `• ${label}`).join('\n')
    y = await writeSection(doc, y, pageH, contentW, 'Custom topics', bullets)
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

async function writeSection(doc, startY, pageH, contentW, heading, rawText) {
  const text = rawText != null && String(rawText).trim() ? String(rawText).trim() : '—'
  let y = startY
  y = ensureSpace(doc, y, 12, pageH)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(55, 55, 55)
  doc.text(heading, MARGIN, y)
  y += 5.5

  if (containsArabicScript(text)) {
    const rendered = await renderArabicTextToImage(text, {
      maxWidthMm: contentW,
      fontSizePt: 9,
      color: [35, 35, 35],
      align: 'right',
    })
    y = ensureSpace(doc, y, rendered.heightMm, pageH)
    doc.addImage(rendered.dataUrl, 'PNG', MARGIN, y, rendered.widthMm, rendered.heightMm)
    return y + rendered.heightMm + 3
  }

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
