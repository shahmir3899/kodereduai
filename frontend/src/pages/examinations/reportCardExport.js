import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const PRIMARY_COLOR = [79, 70, 229]
const MARGIN = { left: 14, right: 14 }

/**
 * Generate and download a Report Card PDF.
 * @param {Object} params
 * @param {Object} params.report - Report card data from API
 * @param {Object} params.schoolData - School details from schoolsApi.getMySchool()
 */
export async function exportReportCardPDF({ report, schoolData }) {
  const doc = new jsPDF()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const tableWidth = pageWidth - MARGIN.left - MARGIN.right
  const centerX = pageWidth / 2

  let startY = 15

  // --- HEADER: Logo (centered) + School Name + Address ---
  if (schoolData?.logo) {
    try {
      const img = await loadImage(schoolData.logo)
      const logoSize = 22
      doc.addImage(img, 'PNG', centerX - logoSize / 2, startY, logoSize, logoSize)
      startY += logoSize + 4
    } catch {
      // Logo failed to load, skip it
    }
  }

  // School name (centered, bold)
  doc.setFontSize(15)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...PRIMARY_COLOR)
  doc.text(report.school_name || 'Report Card', centerX, startY, { align: 'center' })
  startY += 5

  // Address & contact (centered, smaller)
  doc.setFontSize(9)
  doc.setFont(undefined, 'normal')
  doc.setTextColor(100)
  if (schoolData?.address) {
    doc.text(schoolData.address, centerX, startY, { align: 'center' })
    startY += 4
  }
  if (schoolData?.contact_email || schoolData?.contact_phone) {
    const contact = [schoolData.contact_email, schoolData.contact_phone].filter(Boolean).join(' | ')
    doc.text(contact, centerX, startY, { align: 'center' })
    startY += 4
  }
  doc.setTextColor(0)
  startY += 2

  // Decorative line
  doc.setDrawColor(...PRIMARY_COLOR)
  doc.setLineWidth(0.8)
  doc.line(MARGIN.left, startY, pageWidth - MARGIN.right, startY)
  startY += 8

  // --- TITLE ---
  doc.setFontSize(13)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(0)
  doc.text('Student Report Card', centerX, startY, { align: 'center' })
  startY += 7

  if (report.academic_year_name) {
    doc.setFontSize(10)
    doc.setFont(undefined, 'normal')
    doc.setTextColor(100)
    let subtitle = `Academic Year: ${report.academic_year_name}`
    if (report.term_name) subtitle += ` | Term: ${report.term_name}`
    doc.text(subtitle, centerX, startY, { align: 'center' })
    doc.setTextColor(0)
    startY += 8
  }

  // --- STUDENT INFO ---
  autoTable(doc, {
    startY,
    margin: MARGIN,
    tableWidth,
    body: [
      ['Student Name', report.student_name || '-', 'Class', report.class_name || '-'],
      ['Roll Number', report.roll_number || '-', '', ''],
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 3 },
    columnStyles: {
      0: { fontStyle: 'bold', textColor: [100, 100, 100], cellWidth: tableWidth * 0.2 },
      1: { cellWidth: tableWidth * 0.3 },
      2: { fontStyle: 'bold', textColor: [100, 100, 100], cellWidth: tableWidth * 0.15 },
      3: { cellWidth: tableWidth * 0.35 },
    },
  })
  startY = doc.lastAutoTable.finalY + 6

  // --- MARKS TABLE ---
  if (report.subjects && report.subjects.length > 0) {
    autoTable(doc, {
      startY,
      margin: MARGIN,
      tableWidth,
      head: [['Subject', 'Total', 'Obtained', '%', 'Grade', 'Status']],
      body: report.subjects.map(s => [
        s.subject_name,
        s.total_marks,
        s.is_absent ? 'Absent' : (s.marks_obtained ?? '-'),
        s.percentage != null ? `${Number(s.percentage).toFixed(1)}%` : '-',
        s.grade || '-',
        s.is_pass === true ? 'Pass' : s.is_pass === false ? 'Fail' : '-',
      ]),
      foot: report.summary ? [[
        { content: 'Total', styles: { fontStyle: 'bold' } },
        report.summary.total_marks || '-',
        report.summary.obtained_marks || '-',
        report.summary.percentage != null ? `${Number(report.summary.percentage).toFixed(1)}%` : '-',
        report.summary.grade || '-',
        report.summary.overall_pass === true ? 'Pass' : report.summary.overall_pass === false ? 'Fail' : '-',
      ]] : [],
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: { top: 3, right: 4, bottom: 3, left: 4 } },
      headStyles: { fillColor: PRIMARY_COLOR, fontSize: 9, fontStyle: 'bold' },
      footStyles: { fillColor: [240, 240, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: tableWidth * 0.28 },
        1: { cellWidth: tableWidth * 0.12, halign: 'center' },
        2: { cellWidth: tableWidth * 0.15, halign: 'center' },
        3: { cellWidth: tableWidth * 0.15, halign: 'center' },
        4: { cellWidth: tableWidth * 0.15, halign: 'center' },
        5: { cellWidth: tableWidth * 0.15, halign: 'center' },
      },
    })
    startY = doc.lastAutoTable.finalY + 8
  }

  // --- RANK, GPA & CALCULATION MODE ---
  if (report.summary) {
    const summaryItems = []
    if (report.summary.rank) summaryItems.push(['Rank in Class', `${report.summary.rank}`])
    if (report.summary.gpa) summaryItems.push(['GPA', Number(report.summary.gpa).toFixed(2)])
    if (report.summary.calculation_mode === 'weighted') {
      summaryItems.push(['Calculation', 'Weighted Average'])
    }

    if (summaryItems.length > 0) {
      autoTable(doc, {
        startY,
        margin: MARGIN,
        tableWidth: tableWidth * 0.5,
        body: summaryItems,
        theme: 'plain',
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: {
          0: { fontStyle: 'bold', textColor: [100, 100, 100] },
          1: { fontStyle: 'bold', textColor: PRIMARY_COLOR },
        },
      })
      startY = doc.lastAutoTable.finalY + 8
    }
  }

  // --- GRADE SCALE REFERENCE ---
  if (report.grade_scales && report.grade_scales.length > 0) {
    if (startY > 220) { doc.addPage(); startY = 20 }
    doc.setFontSize(10)
    doc.setFont(undefined, 'bold')
    doc.setTextColor(0)
    doc.text('Grade Scale Reference', MARGIN.left, startY)
    startY += 3

    autoTable(doc, {
      startY,
      margin: MARGIN,
      tableWidth: tableWidth * 0.6,
      head: [['Grade', 'Range', 'GPA Points']],
      body: report.grade_scales.map(gs => [
        gs.grade_label,
        `${gs.min_percentage}% - ${gs.max_percentage}%`,
        gs.gpa_points,
      ]),
      theme: 'striped',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: PRIMARY_COLOR, fontSize: 8 },
    })
  }

  // --- FOOTER ---
  const pageCount = doc.internal.getNumberOfPages()
  const now = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(150)
    doc.text(`Generated on ${now}`, MARGIN.left, pageHeight - 10)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - 35, pageHeight - 10)
    doc.setTextColor(0)
  }

  // Save
  const safeName = (report.student_name || 'Student').replace(/[^a-zA-Z0-9]/g, '_')
  doc.save(`Report_Card_${safeName}.pdf`)
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
