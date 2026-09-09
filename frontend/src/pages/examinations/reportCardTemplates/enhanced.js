import autoTable from 'jspdf-autotable'
import { drawStarRow, MONTH_NAMES } from './stars'
import { drawPhotoBox } from './photoBox'

const PRIMARY = [79, 70, 229]
const PRIMARY_SOFT = [246, 246, 251]
const GOOD = [31, 138, 95]
const MARGIN = { left: 14, right: 14 }

/**
 * Same field set as the traditional template, styled to match the app's own
 * indigo/sans-serif look - a fuller version of the card that ships today.
 */
export function renderEnhanced(doc, data) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const tableWidth = pageWidth - MARGIN.left - MARGIN.right
  let y = 16

  // --- Header: logo, school, student photo ---
  if (data.logo) {
    doc.addImage(data.logo, 'PNG', MARGIN.left, y, 16, 16)
  }
  doc.setFont(undefined, 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...PRIMARY)
  doc.text(data.schoolName, data.logo ? MARGIN.left + 20 : MARGIN.left, y + 6)
  doc.setFont(undefined, 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(120)
  const metaLine = `${data.className}${data.rollNumber ? `  ·  Roll No. ${data.rollNumber}` : ''}`
  doc.text(metaLine, data.logo ? MARGIN.left + 20 : MARGIN.left, y + 12)

  const photoSize = 18
  drawPhotoBox(doc, pageWidth - MARGIN.right - photoSize, y - 1, photoSize, data.photo)
  doc.setTextColor(0)
  y += 22

  doc.setDrawColor(...PRIMARY)
  doc.setLineWidth(0.6)
  doc.line(MARGIN.left, y, pageWidth - MARGIN.right, y)
  y += 8

  // --- Title row ---
  doc.setFont(undefined, 'bold')
  doc.setFontSize(12.5)
  doc.setTextColor(...PRIMARY)
  doc.text(`Report Card — ${data.studentName}`, MARGIN.left, y)
  doc.setFont(undefined, 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(110)
  const termLine = [data.academicYear, data.examDisplay].filter(Boolean).join(' · ')
  doc.text(termLine, pageWidth - MARGIN.right, y, { align: 'right' })
  doc.setTextColor(0)
  y += 7

  if (data.guardianName) {
    doc.setFontSize(9)
    doc.setTextColor(110)
    doc.text(`Guardian: ${data.guardianName}`, MARGIN.left, y)
    doc.setTextColor(0)
    y += 6
  }
  y += 2

  // --- Stat strip: attendance, rank, overall grade ---
  const stats = []
  if (data.attendance && data.attendance.total > 0) {
    stats.push({ label: 'Attendance', value: `${data.attendance.percentage}%`, color: GOOD })
  }
  if (data.summary?.rank) {
    stats.push({ label: 'Position', value: data.classSize ? `${data.summary.rank} / ${data.classSize}` : `${data.summary.rank}`, color: PRIMARY })
  }
  if (data.summary?.grade) {
    stats.push({ label: 'Overall', value: data.summary.grade, color: PRIMARY })
  }
  if (stats.length) {
    const tileWidth = tableWidth / stats.length
    stats.forEach((s, i) => {
      const x = MARGIN.left + i * tileWidth
      doc.setFillColor(...PRIMARY_SOFT)
      doc.roundedRect(x, y, tileWidth - 4, 16, 2, 2, 'F')
      doc.setFontSize(7.5)
      doc.setTextColor(140)
      doc.text(s.label.toUpperCase(), x + 5, y + 6)
      doc.setFontSize(13)
      doc.setFont(undefined, 'bold')
      doc.setTextColor(...s.color)
      doc.text(String(s.value), x + 5, y + 13)
      doc.setFont(undefined, 'normal')
    })
    doc.setTextColor(0)
    y += 22
  }

  // --- Marks table ---
  if (data.subjects.length) {
    autoTable(doc, {
      startY: y,
      margin: MARGIN,
      tableWidth,
      head: [['Subject', 'Total', 'Obtained', '%', 'Grade', 'Status']],
      body: data.subjects.map(s => [
        s.subject_name,
        s.total_marks,
        s.is_absent ? 'Absent' : (s.marks_obtained ?? '-'),
        s.percentage != null ? `${Number(s.percentage).toFixed(1)}%` : '-',
        s.grade || '-',
        s.is_pass === true ? 'Pass' : s.is_pass === false ? 'Fail' : '-',
      ]),
      foot: data.summary ? [[
        { content: 'Total', styles: { fontStyle: 'bold' } },
        data.summary.total_marks || '-',
        data.summary.obtained_marks || '-',
        data.summary.percentage != null ? `${Number(data.summary.percentage).toFixed(1)}%` : '-',
        data.summary.grade || '-',
        data.summary.overall_pass === true ? 'Pass' : data.summary.overall_pass === false ? 'Fail' : '-',
      ]] : [],
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: { top: 3, right: 4, bottom: 3, left: 4 } },
      headStyles: { fillColor: PRIMARY, fontSize: 9, fontStyle: 'bold' },
      footStyles: { fillColor: PRIMARY_SOFT, textColor: 20, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: tableWidth * 0.28 },
        1: { cellWidth: tableWidth * 0.14, halign: 'center' },
        2: { cellWidth: tableWidth * 0.16, halign: 'center' },
        3: { cellWidth: tableWidth * 0.14, halign: 'center' },
        4: { cellWidth: tableWidth * 0.14, halign: 'center' },
        5: { cellWidth: tableWidth * 0.14, halign: 'center' },
      },
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // --- Remarks ---
  const remarkText = data.conduct?.teacher_remark || data.conduct?.principal_remark
  if (remarkText) {
    const boxLines = doc.splitTextToSize(remarkText, tableWidth - 14)
    const boxHeight = 12 + boxLines.length * 4.6
    doc.setFillColor(...PRIMARY_SOFT)
    doc.rect(MARGIN.left, y, tableWidth, boxHeight, 'F')
    doc.setDrawColor(...PRIMARY)
    doc.setLineWidth(1.2)
    doc.line(MARGIN.left, y, MARGIN.left, y + boxHeight)
    doc.setFontSize(7.5)
    doc.setTextColor(110, 100, 220)
    doc.text("CLASS TEACHER'S REMARKS", MARGIN.left + 6, y + 7)
    doc.setFontSize(9.5)
    doc.setFont(undefined, 'italic')
    doc.setTextColor(50)
    doc.text(boxLines, MARGIN.left + 6, y + 13)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(0)
    y += boxHeight + 10
  }

  // --- Skills & Behaviour (all 12 rated fields from the Assessments page) ---
  const skills = data.conduct?.skills || []
  const behaviour = data.conduct?.behaviour || []
  if (skills.length || behaviour.length) {
    if (y > 205) { doc.addPage(); y = 20 }
    doc.setFont(undefined, 'bold')
    doc.setFontSize(9.5)
    doc.setTextColor(...PRIMARY)
    const monthLabel = data.conduct.month ? ` — ${MONTH_NAMES[data.conduct.month - 1]}` : ''
    doc.text(`Skills & Behaviour${monthLabel}`, MARGIN.left, y)
    doc.setTextColor(0)
    doc.setFont(undefined, 'normal')
    y += 6

    const colWidth = tableWidth / 2
    const rowHeight = 5.6
    const drawColumn = (items, x) => {
      let cy = y
      items.forEach(item => {
        doc.setFontSize(8)
        doc.setTextColor(80)
        doc.text(item.label, x, cy + 2.1)
        drawStarRow(doc, x + colWidth * 0.5, cy, item.rating, { size: 2.6, gap: 0.6 })
        cy += rowHeight
      })
      doc.setTextColor(0)
      return cy
    }
    const leftEnd = drawColumn(skills, MARGIN.left)
    const rightEnd = drawColumn(behaviour, MARGIN.left + colWidth + 4)
    y = Math.max(leftEnd, rightEnd) + 6
  }

  // --- Signatures ---
  // If the content overflowed onto a new page, sign right below it instead of
  // jumping to the bottom margin - otherwise the block lands alone at the foot
  // of an almost-empty page and reads as missing.
  let signaturesOnFreshPage = false
  if (y > pageHeight - 40) {
    doc.addPage()
    y = 24
    signaturesOnFreshPage = true
  }
  const signY = signaturesOnFreshPage ? y + 10 : Math.max(y, pageHeight - 34)
  const signWidth = tableWidth / 3
  ;['Class Teacher', 'Principal', 'Parent'].forEach((label, i) => {
    const x = MARGIN.left + i * signWidth
    doc.setDrawColor(180)
    doc.setLineWidth(0.3)
    doc.line(x + 6, signY, x + signWidth - 6, signY)
    doc.setFontSize(7.5)
    doc.setTextColor(140)
    doc.text(label.toUpperCase(), x + signWidth / 2, signY + 5, { align: 'center' })
    doc.setTextColor(0)
  })
}
