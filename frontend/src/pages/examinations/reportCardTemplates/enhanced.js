import autoTable from 'jspdf-autotable'
import { drawStarRow, MONTH_NAMES } from './stars'
import { drawPhotoBox } from './photoBox'
import { drawPodiumBanner, podiumTier } from './podium'
import { formatIssueDate, shortExamName } from '../reportCardData'
import { drawGradeKey, positionText, rowsWithComments } from './common'

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

  const photoWidth = 17
  const photo = drawPhotoBox(doc, pageWidth - MARGIN.right - photoWidth - 1.2, y - 2, photoWidth, data.photo, { frameColor: PRIMARY })
  doc.setTextColor(0)
  y += Math.max(22, photo.height + 4)

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
  // Issue date lives with the title, where a parent looks first, not at the page foot.
  const issued = formatIssueDate(data.issueDate)
  doc.setFont(undefined, 'bold')
  doc.setFontSize(9.5)
  const issuedW = doc.getTextWidth(issued)
  doc.setTextColor(...PRIMARY)
  doc.text(issued, pageWidth - MARGIN.right, y + 5.5, { align: 'right' })
  doc.setFont(undefined, 'normal')
  doc.setTextColor(110)
  doc.text('Date of Issue: ', pageWidth - MARGIN.right - issuedW, y + 5.5, { align: 'right' })
  doc.setTextColor(0)
  y += 7

  if (data.guardianName) {
    doc.setFontSize(9)
    doc.setTextColor(110)
    doc.text(`Guardian: ${data.guardianName}`, MARGIN.left, y)
    doc.setTextColor(0)
    y += 6
  }
  if (data.earlierExamNames?.length) {
    const mainName = data.exams.find(e => e.is_main)?.exam_name
    const note = data.weighted
      ? `Weighted result across: ${[...data.earlierExamNames, mainName].filter(Boolean).join(', ')}`
      : `Result is from ${mainName}. Earlier exams shown for reference: ${data.earlierExamNames.join(', ')}`
    doc.setFontSize(8.5)
    doc.setTextColor(110)
    const noteLines = doc.splitTextToSize(note, tableWidth)
    doc.text(noteLines, MARGIN.left, y)
    doc.setTextColor(0)
    y += noteLines.length * 4 + 2
  }
  y += 2

  // --- Stat strip: attendance, rank, overall grade ---
  // Top-3 positions get a full banner below instead of a plain tile.
  const stats = []
  if (data.summary?.rank && !podiumTier(data.summary.rank)) {
    stats.push({ label: 'Position', value: positionText(data.summary.rank, data.classSize), color: PRIMARY })
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

  if (data.summary?.rank && podiumTier(data.summary.rank)) {
    y = drawPodiumBanner(doc, {
      x: MARGIN.left, y, width: tableWidth, rank: data.summary.rank,
      className: data.className, percentage: data.summary.percentage,
    })
  }

  // --- Attendance: present of working days (OFF days already excluded by the API) ---
  const att = data.attendance
  if (att && att.working_days > 0) {
    const panelHeight = 24
    doc.setFillColor(...PRIMARY_SOFT)
    doc.roundedRect(MARGIN.left, y, tableWidth, panelHeight, 2, 2, 'F')
    doc.setFont(undefined, 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(140)
    doc.text('ATTENDANCE', MARGIN.left + 5, y + 6)
    doc.setFontSize(12)
    doc.setTextColor(...GOOD)
    // The percentage only exists when every working day was recorded (see the API).
    const pctText = att.percentage != null ? `  (${att.percentage}%)` : ''
    doc.text(`${att.present} / ${att.working_days} days${pctText}`, MARGIN.left + 5, y + 13)
    doc.setFont(undefined, 'normal')
    if (att.from && att.to) {
      doc.setFontSize(7.5)
      doc.setTextColor(140)
      doc.text(`${formatIssueDate(att.from)} – ${formatIssueDate(att.to)}`, pageWidth - MARGIN.right - 5, y + 6, { align: 'right' })
    }
    // Proportional bar over working days; not-marked is the empty remainder.
    const barX = MARGIN.left + 5
    const barW = tableWidth - 10
    const segments = [
      { n: att.present, color: GOOD },
      { n: att.absent, color: [214, 69, 65] },
      { n: att.leave, color: [230, 160, 30] },
    ]
    doc.setFillColor(222, 224, 232)
    doc.roundedRect(barX, y + 15, barW, 2.4, 1.2, 1.2, 'F')
    let bx = barX
    segments.forEach(seg => {
      const w = (seg.n / att.working_days) * barW
      if (w > 0) {
        doc.setFillColor(...seg.color)
        doc.rect(bx, y + 15, w, 2.4, 'F')
        bx += w
      }
    })
    const legend = [
      ['Present', att.present, GOOD], ['Absent', att.absent, segments[1].color],
      ['Leave', att.leave, segments[2].color],
      ...(att.not_marked > 0 ? [['Not marked', att.not_marked, [150, 154, 170]]] : []),
    ]
    const legendW = barW / legend.length
    legend.forEach(([label, n, color], i) => {
      const lx = barX + i * legendW
      doc.setFillColor(...color)
      doc.circle(lx + 1.2, y + 21, 1, 'F')
      doc.setFontSize(7.8)
      doc.setTextColor(80)
      doc.text(`${label}: ${n}`, lx + 4, y + 21.8)
    })
    if (att.suspect) {
      doc.setFontSize(7.5)
      doc.setTextColor(180, 110, 20)
      doc.text(`Attendance was not recorded on ${att.not_marked} of ${att.working_days} working days.`, MARGIN.left + 5, y + panelHeight + 3.5)
      y += 5
    }
    doc.setTextColor(0)
    y += panelHeight + 6
  }

  // --- Marks table ---
  // One exam: Total / Obtained / % / Grade / Class Avg / Status. Several: one compact
  // column per exam (earlier ones muted, the main exam bold), then the result columns,
  // which come from the main exam - or the weighted blend when the school weights exams.
  if (data.subjects.length) {
    const pctText = (v) => (v != null ? `${Number(v).toFixed(1)}%` : '-')
    const avgText = (v) => (v == null ? '-' : (data.classAvgUnit === 'percent' ? `${v}%` : v))
    const multi = data.exams.length > 1
    const tableCommon = {
      startY: y,
      margin: MARGIN,
      tableWidth,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: { top: 3, right: 4, bottom: 3, left: 4 } },
      // Header and Total row are centred across every column; body rows keep the
      // subject left / numbers centred layout below.
      headStyles: { fillColor: PRIMARY, fontSize: 9, fontStyle: 'bold', halign: 'center' },
      footStyles: { fillColor: PRIMARY_SOFT, textColor: 20, fontStyle: 'bold', halign: 'center' },
    }

    // Comment rows sit under their subject, so both rows share one stripe colour.
    const stripe = (meta) => (hook) => {
      const m = hook.section === 'body' ? meta[hook.row.index] : null
      if (m) hook.cell.styles.fillColor = m.subjectIdx % 2 ? [245, 245, 250] : [255, 255, 255]
    }

    if (!multi) {
      const single = rowsWithComments(data.subjects, s => [
        s.subject_name,
        s.total_marks,
        s.is_absent ? 'Absent' : (s.marks_obtained ?? '-'),
        pctText(s.percentage),
        s.grade || '-',
        avgText(s.class_avg),
        s.is_pass === true ? 'Pass' : s.is_pass === false ? 'Fail' : '-',
      ], 7)
      autoTable(doc, {
        ...tableCommon,
        head: [['Subject', 'Total', 'Obtained', '%', 'Grade', 'Class Avg', 'Status']],
        body: single.body,
        didParseCell: stripe(single.meta),
        foot: data.summary ? [[
          { content: 'Total', styles: { fontStyle: 'bold', halign: 'center' } },
          data.summary.total_marks || '-',
          data.summary.obtained_marks || '-',
          pctText(data.summary.percentage),
          data.summary.grade || '-',
          '',
          data.summary.overall_pass === true ? 'Pass' : data.summary.overall_pass === false ? 'Fail' : '-',
        ]] : [],
        columnStyles: {
          0: { cellWidth: tableWidth * 0.24 },
          1: { cellWidth: tableWidth * 0.12, halign: 'center' },
          2: { cellWidth: tableWidth * 0.14, halign: 'center' },
          3: { cellWidth: tableWidth * 0.12, halign: 'center' },
          4: { cellWidth: tableWidth * 0.12, halign: 'center' },
          5: { cellWidth: tableWidth * 0.14, halign: 'center' },
          6: { cellWidth: tableWidth * 0.12, halign: 'center' },
        },
      })
    } else {
      const exams = data.exams
      const examCell = (exam, subject) => {
        const m = exam.marks?.[subject.subject_id]
        if (!m) return '-'
        if (m.is_absent) return 'Abs'
        return `${m.marks_obtained ?? '-'}/${m.total_marks}`
      }
      const examTotal = (exam) => {
        let got = 0
        let of = 0
        data.subjects.forEach(subject => {
          const m = exam.marks?.[subject.subject_id]
          if (!m) return
          of += Number(m.total_marks) || 0
          if (!m.is_absent && m.marks_obtained != null) got += Number(m.marks_obtained)
        })
        return of ? `${got}/${of}` : '-'
      }
      // Fixed widths keep header, body and Total row lined up: subject 24%, result columns
      // 10 / 9 / 12%, and the rest split evenly between the exams (max 4 on a card).
      const examWidth = (tableWidth * (1 - 0.24 - 0.31)) / exams.length
      const columnStyles = { 0: { cellWidth: tableWidth * 0.24 } }
      exams.forEach((exam, i) => {
        columnStyles[i + 1] = {
          cellWidth: examWidth,
          halign: 'center',
          ...(exam.is_main ? { fontStyle: 'bold' } : { textColor: 130 }),
        }
      })
      const k = exams.length
      columnStyles[k + 1] = { cellWidth: tableWidth * 0.10, halign: 'center' }
      columnStyles[k + 2] = { cellWidth: tableWidth * 0.09, halign: 'center' }
      columnStyles[k + 3] = { cellWidth: tableWidth * 0.12, halign: 'center' }

      const multiRows = rowsWithComments(data.subjects, s => [
        s.subject_name,
        ...exams.map(e => examCell(e, s)),
        pctText(s.percentage),
        s.grade || '-',
        avgText(s.class_avg),
      ], k + 4)
      const stripeMulti = stripe(multiRows.meta)
      autoTable(doc, {
        ...tableCommon,
        styles: { ...tableCommon.styles, fontSize: 8.5, cellPadding: { top: 3, right: 2, bottom: 3, left: 3 } },
        head: [[
          'Subject',
          ...exams.map(e => (data.weighted ? `${shortExamName(e.exam_name)}\n${e.weight}%` : shortExamName(e.exam_name))),
          data.weighted ? 'Result %' : '%',
          'Grade',
          'Class Avg',
        ]],
        body: multiRows.body,
        foot: data.summary ? [[
          { content: 'Total', styles: { fontStyle: 'bold', halign: 'center' } },
          ...exams.map(examTotal),
          pctText(data.summary.percentage),
          data.summary.grade || '-',
          '',
        ]] : [],
        columnStyles,
        didParseCell: (hook) => {
          stripeMulti(hook)
          // A failing subject reads red in the % column (the Status column is dropped here).
          const m = hook.section === 'body' ? multiRows.meta[hook.row.index] : null
          if (m && !m.isComment && hook.column.index === k + 1) {
            if (data.subjects[m.subjectIdx]?.is_pass === false) hook.cell.styles.textColor = [190, 60, 55]
          }
        },
      })
    }
    y = drawGradeKey(doc, data, MARGIN.left, doc.lastAutoTable.finalY + 5, tableWidth) + 4
  }

  // --- Promotion (final exam only; NOT_APPLICABLE prints nothing) ---
  if (data.promotion?.applicable && data.promotion.status !== 'NOT_APPLICABLE') {
    const promoted = data.promotion.status === 'PROMOTED'
    const color = promoted ? GOOD : [190, 60, 55]
    doc.setFillColor(...(promoted ? [236, 247, 241] : [252, 238, 237]))
    doc.setDrawColor(...color)
    doc.setLineWidth(0.5)
    doc.roundedRect(MARGIN.left, y, tableWidth, 11, 2, 2, 'FD')
    doc.setFontSize(7.5)
    doc.setFont(undefined, 'bold')
    doc.setTextColor(120)
    doc.text('PROMOTION STATUS', MARGIN.left + 5, y + 6.9)
    doc.setFontSize(11)
    doc.setTextColor(...color)
    doc.text(promoted ? 'PROMOTED' : 'NOT PROMOTED', pageWidth - MARGIN.right - 5, y + 7.2, { align: 'right' })
    doc.setFont(undefined, 'normal')
    doc.setTextColor(0)
    y += 17
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

  // --- Overall performance comment (AI/template/edited, from the Results page) ---
  if (data.overallComment) {
    // Measure at the font it is drawn in; measuring at the previous size let lines overflow the box.
    doc.setFontSize(9.5)
    doc.setFont(undefined, 'italic')
    const commentLines = doc.splitTextToSize(data.overallComment, tableWidth - 14)
    doc.setFont(undefined, 'normal')
    const commentHeight = 12 + commentLines.length * 4.6
    if (y + commentHeight > pageHeight - 32) { doc.addPage(); y = 20 }
    doc.setFillColor(...PRIMARY_SOFT)
    doc.rect(MARGIN.left, y, tableWidth, commentHeight, 'F')
    doc.setDrawColor(...PRIMARY)
    doc.setLineWidth(1.2)
    doc.line(MARGIN.left, y, MARGIN.left, y + commentHeight)
    doc.setFontSize(7.5)
    doc.setTextColor(110, 100, 220)
    doc.text('OVERALL PERFORMANCE', MARGIN.left + 6, y + 7)
    doc.setFontSize(9.5)
    doc.setFont(undefined, 'italic')
    doc.setTextColor(50)
    doc.text(commentLines, MARGIN.left + 6, y + 13)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(0)
    y += commentHeight + 6
  }

  // --- Remarks ---
  const remarkText = data.conduct?.teacher_remark || data.conduct?.principal_remark
  if (remarkText) {
    doc.setFontSize(9.5)
    doc.setFont(undefined, 'italic')
    const boxLines = doc.splitTextToSize(remarkText, tableWidth - 14)
    doc.setFont(undefined, 'normal')
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

  // --- Signatures ---
  // If the content overflowed onto a new page, sign right below it instead of
  // jumping to the bottom margin - otherwise the block lands alone at the foot
  // of an almost-empty page and reads as missing.
  let signaturesOnFreshPage = false
  if (y > pageHeight - 44) {
    doc.addPage()
    y = 24
    signaturesOnFreshPage = true
  }
  const signY = signaturesOnFreshPage ? y + 10 : Math.max(y + 8, pageHeight - 34)
  const signWidth = tableWidth / 3
  ;[data.signatureLabels.class_teacher, data.signatureLabels.principal, data.signatureLabels.parent].forEach((label, i) => {
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
