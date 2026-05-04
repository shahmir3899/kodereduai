import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

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
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return String(iso)
  }
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
  doc.text(`Lesson dates: ${dateFrom} to ${dateTo}`, MARGIN, y)
  y += 6
  doc.setTextColor(90, 90, 90)
  doc.setFontSize(9)
  doc.text(`Generated: ${new Date().toLocaleString()}`, MARGIN, y)
  y += 5
  doc.text(`Plans included: ${plans.length}`, MARGIN, y)
  y += 8

  doc.setDrawColor(...PRIMARY)
  doc.setLineWidth(0.5)
  doc.line(MARGIN, y, pageW - MARGIN, y)
  y += 8

  const n = plans.length

  plans.forEach((plan, idx) => {
    const planLabel = `Plan ${idx + 1} of ${n}`
    const title = plan.title?.trim() || 'Untitled'

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      tableWidth: contentW,
      head: [[{ content: `${planLabel}: ${title}`, colSpan: 2 }]],
      headStyles: {
        fillColor: PRIMARY,
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 10,
        cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
        valign: 'middle',
      },
      body: [
        ['Lesson date', formatLessonDate(plan.lesson_date)],
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
    y = writeSection(doc, y, pageH, contentW, 'Objectives', plan.objectives)
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

    y += 4
    if (idx < n - 1) {
      y = ensureSpace(doc, y, 16, pageH)
      doc.setDrawColor(220, 220, 220)
      doc.setLineWidth(0.3)
      doc.line(MARGIN, y, pageW - MARGIN, y)
      y += 10
    }
  })

  // Page numbers
  const total = doc.internal.getNumberOfPages()
  for (let i = 1; i <= total; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(130, 130, 130)
    doc.setFont('helvetica', 'normal')
    doc.text(`Page ${i} of ${total}`, pageW / 2, pageH - FOOTER_MM / 2, { align: 'center' })
  }

  doc.save(`lesson-plans_${dateFrom}_${dateTo}.pdf`)
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
