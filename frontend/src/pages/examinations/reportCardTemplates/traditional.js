import autoTable from 'jspdf-autotable'
import { drawStarRow, MONTH_NAMES } from './stars'
import { drawPhotoBox } from './photoBox'
import { formatIssueDate } from '../reportCardData'
import { drawGradeKey, positionText, rowsWithComments } from './common'

const INK = [23, 50, 79]      // frame / header navy
const GOLD = [138, 109, 31]   // section labels
const LINE = [205, 214, 222]
const MARGIN = { left: 14, right: 14 }
const FRAME_INSET = 5

/**
 * Same fields as the enhanced template, laid out as a formal double-ruled
 * progress card - closer to the printed result cards families already know.
 * Deliberately does not fabricate a translated header: a real second
 * language would need the school's own copy, not a guessed transliteration.
 */
export function renderTraditional(doc, data) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const frameX = MARGIN.left
  const frameW = pageWidth - MARGIN.left - MARGIN.right

  const drawFrame = (top) => {
    doc.setDrawColor(...INK)
    doc.setLineWidth(1)
    doc.rect(frameX, top, frameW, pageHeight - top - 14)
    doc.setLineWidth(0.4)
    doc.rect(frameX + 2, top + 2, frameW - 4, pageHeight - top - 18)
  }

  let y = 14
  drawFrame(y)

  const innerX = frameX + FRAME_INSET
  const innerW = frameW - FRAME_INSET * 2
  y += 12

  // --- Header ---
  if (data.logo) {
    doc.addImage(data.logo, 'PNG', pageWidth / 2 - 9, y, 18, 18)
    y += 21
  }
  doc.setFont(undefined, 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...INK)
  doc.text(data.schoolName, pageWidth / 2, y, { align: 'center' })
  y += 6
  if (data.schoolAddress) {
    doc.setFont(undefined, 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(90)
    doc.text(data.schoolAddress, pageWidth / 2, y, { align: 'center' })
    y += 5
  }
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.8)
  doc.line(innerX, y, innerX + innerW, y)
  y += 6

  doc.setFont(undefined, 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...GOLD)
  const examLine = data.examDisplay ? `Progress Report · ${data.examDisplay}` : 'Progress Report'
  doc.text(examLine.toUpperCase(), pageWidth / 2, y + 5, { align: 'center' })
  doc.setTextColor(0)
  y += 12

  // --- Student info box + photo ---
  const photoSize = 22
  const infoTableWidth = innerW - photoSize - 8
  const infoRows = [
    ['Student', data.studentName, 'Class / Section', data.className],
    ['Roll No.', data.rollNumber, 'Guardian', data.guardianName || '—'],
    ['Academic Year', data.academicYear, 'Term', data.termName || '—'],
    ['Date of Issue', { content: formatIssueDate(data.issueDate), colSpan: 3, styles: { fontStyle: 'bold', textColor: INK } }],
  ]
  autoTable(doc, {
    startY: y,
    margin: { left: innerX, right: pageWidth - innerX - infoTableWidth },
    tableWidth: infoTableWidth,
    body: infoRows,
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 3.5, lineColor: LINE, lineWidth: 0.3, textColor: 30 },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [90, 98, 112], cellWidth: infoTableWidth * 0.2 },
      1: { cellWidth: infoTableWidth * 0.3 },
      2: { fontStyle: 'bold', textColor: [90, 98, 112], cellWidth: infoTableWidth * 0.2 },
      3: { cellWidth: infoTableWidth * 0.3 },
    },
  })
  const photo = drawPhotoBox(doc, innerX + infoTableWidth + 6, y + 1, photoSize, data.photo, { frameColor: INK, accentColor: GOLD })
  y = Math.max(doc.lastAutoTable.finalY, y + 1 + photo.height + 1.5) + 8

  // --- Marks table ---
  if (data.subjects.length) {
    const rows = rowsWithComments(data.subjects, s => [
      s.subject_name,
      s.total_marks,
      s.is_absent ? 'Absent' : (s.marks_obtained ?? '-'),
      s.percentage != null ? Number(s.percentage).toFixed(1) : '-',
      s.grade || '-',
    ], 5, { lineWidth: { top: 0, right: 0.3, bottom: 0.3, left: 0.3 } })
    autoTable(doc, {
      startY: y,
      margin: { left: innerX, right: pageWidth - innerX - innerW },
      tableWidth: innerW,
      head: [['Subject', 'Max Marks', 'Obtained', '%', 'Grade']],
      body: rows.body,
      foot: data.summary ? [[
        { content: 'Total', styles: { fontStyle: 'bold' } },
        data.summary.total_marks || '-',
        data.summary.obtained_marks || '-',
        data.summary.percentage != null ? Number(data.summary.percentage).toFixed(1) : '-',
        data.summary.grade || '-',
      ]] : [],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 3, lineColor: LINE, lineWidth: 0.3, halign: 'center' },
      headStyles: { fillColor: INK, textColor: 255, fontStyle: 'bold' },
      footStyles: { fillColor: [244, 236, 214], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 0: { halign: 'left', cellWidth: innerW * 0.34, fontStyle: 'bold' } },
    })
    y = drawGradeKey(doc, data, innerX, doc.lastAutoTable.finalY + 5, innerW) + 4
  }

  // --- Attendance / position boxes ---
  const boxes = []
  if (data.attendance && data.attendance.working_days > 0) {
    const a = data.attendance
    boxes.push(['Attendance', `${a.present} / ${a.working_days} days${a.percentage != null ? ` (${a.percentage}%)` : ''}`])
  }
  if (data.summary?.rank) {
    boxes.push(['Position', positionText(data.summary.rank, data.classSize)])
  }
  if (boxes.length) {
    const colW = innerW / boxes.length
    boxes.forEach(([label, value], i) => {
      const x = innerX + i * colW
      doc.setDrawColor(...INK)
      doc.setLineWidth(0.4)
      doc.rect(x, y, colW, 16)
      doc.setFontSize(7)
      doc.setTextColor(90)
      doc.text(label.toUpperCase(), x + 4, y + 6)
      doc.setFontSize(10.5)
      doc.setFont(undefined, 'bold')
      doc.setTextColor(...INK)
      doc.text(String(value), x + 4, y + 12.5)
      doc.setFont(undefined, 'normal')
      doc.setTextColor(0)
    })
    y += 22
  }

  // --- Skills & Behaviour (all 12 rated fields from the Assessments page) ---
  const skills = data.conduct?.skills || []
  const behaviour = data.conduct?.behaviour || []
  if (skills.length || behaviour.length) {
    const rowHeight = 5.4
    const rowCount = Math.max(skills.length, behaviour.length)
    const sectionHeight = 8 + rowCount * rowHeight + 3
    if (y + sectionHeight > pageHeight - 55) { doc.addPage(); y = 20 }

    doc.setDrawColor(...INK)
    doc.setLineWidth(0.4)
    doc.rect(innerX, y, innerW, sectionHeight)
    doc.setFontSize(7)
    doc.setTextColor(...GOLD)
    const monthLabel = data.conduct.month ? ` — ${MONTH_NAMES[data.conduct.month - 1]}` : ''
    doc.text(`SKILLS & BEHAVIOUR ASSESSMENT${monthLabel}`.toUpperCase(), innerX + 5, y + 6)
    doc.setTextColor(0)

    const colWidth = innerW / 2
    const drawColumn = (items, x, top) => {
      let cy = top
      items.forEach(item => {
        doc.setFontSize(7.5)
        doc.setTextColor(40)
        doc.text(item.label, x, cy + 2)
        drawStarRow(doc, x + colWidth * 0.48, cy, item.rating, { size: 2.4, gap: 0.5, filledColor: INK, emptyColor: [200, 205, 213] })
        cy += rowHeight
      })
      doc.setTextColor(0)
    }
    drawColumn(skills, innerX + 5, y + 10)
    drawColumn(behaviour, innerX + colWidth + 2, y + 10)
    y += sectionHeight + 6
  }

  // --- Overall performance comment (AI/template/edited, from the Results page) ---
  if (data.overallComment) {
    doc.setFontSize(9)
    const commentLines = doc.splitTextToSize(data.overallComment, innerW - 10)
    const commentHeight = Math.max(16, 9 + commentLines.length * 4.4)
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.4)
    doc.rect(innerX, y, innerW, commentHeight)
    doc.setFontSize(7)
    doc.setTextColor(...GOLD)
    doc.text('OVERALL PERFORMANCE', innerX + 5, y + 6)
    doc.setFontSize(9)
    doc.setTextColor(30)
    doc.text(commentLines, innerX + 5, y + 11.5)
    doc.setTextColor(0)
    y += commentHeight + 6
  }

  // --- Remarks box ---
  const remarkText = data.conduct?.teacher_remark || data.conduct?.principal_remark || ''
  const boxLines = doc.splitTextToSize(remarkText || ' ', innerW - 10)
  const remarksHeight = Math.max(16, 9 + boxLines.length * 4.4)
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.4)
  doc.rect(innerX, y, innerW, remarksHeight)
  doc.setFontSize(7)
  doc.setTextColor(...GOLD)
  doc.text("CLASS TEACHER'S REMARKS", innerX + 5, y + 6)
  doc.setFontSize(9)
  doc.setTextColor(30)
  if (remarkText) doc.text(boxLines, innerX + 5, y + 11.5)
  doc.setTextColor(0)
  y += remarksHeight + 8

  // --- Signatures ---
  // Guarantee these fit on the page - with a full 6+ subject table and all 12
  // ratings, content can run past the frame drawn at the top; without this
  // check the sign line would be pushed off the bottom of the page and never
  // render at all.
  const signBlockHeight = 22
  let signInnerX = innerX
  let signInnerW = innerW
  let signaturesOnFreshPage = false
  if (y + signBlockHeight > pageHeight - 16) {
    doc.addPage()
    drawFrame(14)
    y = 14 + FRAME_INSET + 10
    signInnerX = frameX + FRAME_INSET
    signInnerW = frameW - FRAME_INSET * 2
    signaturesOnFreshPage = true
  }
  const signY = signaturesOnFreshPage ? y + 10 : Math.max(y + 6, pageHeight - 34)
  const signWidth = signInnerW / 3
  ;['Class Teacher', 'Principal', 'Parent / Guardian'].forEach((label, i) => {
    const x = signInnerX + i * signWidth
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.3)
    doc.line(x + 8, signY, x + signWidth - 8, signY)
    doc.setFontSize(7.5)
    doc.setTextColor(90)
    doc.text(label.toUpperCase(), x + signWidth / 2, signY + 5, { align: 'center' })
    doc.setTextColor(0)
  })
}
