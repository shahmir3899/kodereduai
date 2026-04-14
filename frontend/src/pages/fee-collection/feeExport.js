import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

const COLORS = {
  title: [29, 78, 216],
  section: [59, 130, 246],
  darkHead: [31, 41, 55],
  subtotalBg: [232, 240, 254],
}

const MARGIN = { left: 36, right: 36, top: 28, bottom: 28 }

function asMoney(value) {
  return (Number(value) || 0).toLocaleString()
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
    // Sanity-check: a blank/failed canvas produces a tiny stub string
    if (!dataUrl || dataUrl.length < 200) return null
    return dataUrl
  } catch {
    return null
  }
}

// Natural sort: "Class 2" before "Class 10", then alphabetical for equal numbers
function naturalClassSort(a, b) {
  const numA = parseInt((String(a).match(/\d+/) || ['0'])[0], 10)
  const numB = parseInt((String(b).match(/\d+/) || ['0'])[0], 10)
  if (numA !== numB) return numA - numB
  return String(a).localeCompare(String(b))
}

function ensureSpace(doc, currentY, neededHeight) {
  const pageHeight = doc.internal.pageSize.getHeight()
  if (currentY + neededHeight > pageHeight - MARGIN.bottom) {
    doc.addPage()
    return MARGIN.top
  }
  return currentY
}

function cleanToken(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-_]/g, '')
}

function normalizeClassLabel(label) {
  if (!label || label === 'All Classes') return 'All'

  const raw = String(label)

  // Try to build compact codes like C2AB from common labels:
  // "Class 2 (Sections: A, B)", "Class 2 - A", "Class 10"
  const classMatch = raw.match(/Class\s*(\d+)/i)
  if (classMatch) {
    const classNum = classMatch[1]
    const sectionParts = []

    const parenSectionMatch = raw.match(/Sections?\s*:\s*([^)]+)/i)
    if (parenSectionMatch) {
      parenSectionMatch[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((s) => sectionParts.push(s.toUpperCase()))
    } else {
      const dashSectionMatch = raw.match(/-\s*([A-Za-z]+)$/)
      if (dashSectionMatch) {
        sectionParts.push(dashSectionMatch[1].toUpperCase())
      }
    }

    const sectionCode = sectionParts.join('')
    return `C${classNum}${sectionCode}`
  }

  return cleanToken(label)
}

function isAllClassesLabel(label) {
  const text = String(label || '').trim().toLowerCase()
  return !text || text === 'all classes' || text === 'all'
}

function getDisplayClassName(row, selectedClassLabel) {
  if (row?.session_class_label) return row.session_class_label
  if (row?.session_class_name) return row.session_class_name
  if (!isAllClassesLabel(selectedClassLabel)) return selectedClassLabel
  return row?.class_name || 'Unknown'
}

function buildSmartFilename({ year, month, selectedClassLabel, feeTypeFilter, statusFilter }) {
  const period = `${year}-${String(month).padStart(2, '0')}`
  const scope = normalizeClassLabel(selectedClassLabel)

  const tags = []
  // Include fee type only when it is not the default collection view.
  if (feeTypeFilter && feeTypeFilter !== 'MONTHLY') {
    tags.push(cleanToken(feeTypeFilter))
  }
  // Include status only when narrowed down.
  if (statusFilter && statusFilter !== 'ALL' && statusFilter !== 'ALL-STATUS') {
    tags.push(cleanToken(statusFilter))
  }

  const segments = ['Fees', period, scope, ...tags]
  return `${segments.filter(Boolean).join('_')}.pdf`
}

function classSummaryRows(paymentList, selectedClassLabel) {
  const byClass = new Map()

  paymentList.forEach((row) => {
    const className = getDisplayClassName(row, selectedClassLabel)
    if (!byClass.has(className)) {
      byClass.set(className, { students: new Set(), due: 0, paid: 0, balance: 0 })
    }
    const bucket = byClass.get(className)
    const due = Math.max(0, Number(row.amount_due) || 0)
    const paid = Number(row.amount_paid) || 0
    const balance = Math.max(0, due - paid)

    const studentKey = row.student_id || row.student || `${className}::${row.student_name || '-'}::${row.student_roll || '-'}`
    bucket.students.add(studentKey)
    bucket.due += due
    bucket.paid += paid
    bucket.balance += balance
  })

  return [...byClass.entries()]
    .sort(([a], [b]) => naturalClassSort(a, b))
    .map(([className, stat]) => {
      const rate = stat.due > 0 ? ((stat.paid / stat.due) * 100) : 0
      return [
        className,
        stat.students.size,
        asMoney(stat.due),
        asMoney(stat.paid),
        asMoney(stat.balance),
        `${rate.toFixed(1)}%`,
      ]
    })
}

function groupedStudentRows(paymentList, selectedClassLabel) {
  const byStudent = new Map()

  paymentList.forEach((row) => {
    const className = getDisplayClassName(row, selectedClassLabel)
    const studentId = row.student_id || row.student || ''
    const roll = row.student_roll || '-'
    const studentName = row.student_name || '-'
    const key = studentId || `${className}::${roll}::${studentName}`

    if (!byStudent.has(key)) {
      byStudent.set(key, {
        className,
        roll,
        studentName,
        due: 0,
        paid: 0,
        feeBreakdown: new Map(),
      })
    }

    const bucket = byStudent.get(key)
    const due = Math.max(0, Number(row.amount_due) || 0)
    const paid = Number(row.amount_paid) || 0
    const type = row.fee_type || 'OTHER'
    const category = row.monthly_category_name || row.annual_category_name || 'General'
    const breakdownKey = `${type}||${category}`

    bucket.due += due
    bucket.paid += paid

    if (!bucket.feeBreakdown.has(breakdownKey)) {
      bucket.feeBreakdown.set(breakdownKey, 0)
    }
    bucket.feeBreakdown.set(breakdownKey, bucket.feeBreakdown.get(breakdownKey) + due)
  })

  return [...byStudent.values()]
    .sort((a, b) => {
      const classCmp = naturalClassSort(a.className || '', b.className || '')
      if (classCmp !== 0) return classCmp
      const rollA = parseInt(a.roll) || 9999
      const rollB = parseInt(b.roll) || 9999
      if (rollA !== rollB) return rollA - rollB
      return (a.studentName || '').localeCompare(b.studentName || '')
    })
    .map((row) => {
      const balance = Math.max(0, row.due - row.paid)
      const typeOrder = ['MONTHLY', 'ANNUAL', 'ADMISSION', 'BOOKS', 'FINE', 'OTHER']
      const sortedBreakdown = [...row.feeBreakdown.entries()]
        .sort((a, b) => {
          const [typeA, categoryA] = a[0].split('||')
          const [typeB, categoryB] = b[0].split('||')
          const ai = typeOrder.indexOf(typeA)
          const bi = typeOrder.indexOf(typeB)
          const typeRank = (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
          if (typeRank !== 0) return typeRank
          return categoryA.localeCompare(categoryB)
        })

      const monthlyParts = []
      const yearlyParts = []
      sortedBreakdown.forEach(([keyValue, amount]) => {
        const [typeValue, categoryValue] = keyValue.split('||')
        const token = `${categoryValue}: ${asMoney(amount)}`
        if (typeValue === 'MONTHLY') {
          monthlyParts.push(token)
        } else {
          yearlyParts.push(token)
        }
      })

      const lines = []
      if (monthlyParts.length > 0 || yearlyParts.length > 0) {
        if (monthlyParts.length > 0) lines.push(`Monthly: ${monthlyParts.join(', ')}`)
        if (yearlyParts.length > 0) lines.push(`Yearly: ${yearlyParts.join(', ')}`)
      } else {
        lines.push('Monthly: -')
      }
      const breakdown = lines.join('\n')

      return {
        className: row.className,
        roll: row.roll,
        studentName: row.studentName,
        breakdown: breakdown || '-',
        due: row.due,
        paid: row.paid,
        balance,
      }
    })
}

function classSectionData(paymentList, selectedClassLabel) {
  const rows = groupedStudentRows(paymentList, selectedClassLabel)
  const byClass = new Map()

  rows.forEach((row) => {
    if (!byClass.has(row.className)) {
      byClass.set(row.className, {
        className: row.className,
        items: [],
        totalDue: 0,
        totalPaid: 0,
        totalBalance: 0,
      })
    }
    const bucket = byClass.get(row.className)
    bucket.items.push(row)
    bucket.totalDue += Number(row.due || 0)
    bucket.totalPaid += Number(row.paid || 0)
    bucket.totalBalance += Number(row.balance || 0)
  })

  return [...byClass.values()].sort((a, b) => naturalClassSort(a.className, b.className))
}

function classTeacherNameMap(paymentList, selectedClassLabel) {
  const teacherByClass = new Map()
  const teacherFields = [
    'class_teacher_name',
    'class_teacher',
    'class_teacher_full_name',
    'teacher_name',
    'class_incharge_name',
    'incharge_name',
    'homeroom_teacher_name',
    'advisor_name',
  ]

  paymentList.forEach((row) => {
    const className = getDisplayClassName(row, selectedClassLabel)
    if (!className || teacherByClass.has(className)) return

    for (const field of teacherFields) {
      const value = row?.[field]
      if (typeof value === 'string' && value.trim()) {
        teacherByClass.set(className, value.trim())
        return
      }
      if (value && typeof value === 'object' && typeof value.name === 'string' && value.name.trim()) {
        teacherByClass.set(className, value.name.trim())
        return
      }
    }
  })

  return teacherByClass
}

export async function exportFeePDF({
  paymentList,
  month,
  year,
  schoolName,
  schoolLogo,
  schoolAddress,
  schoolContact,
  selectedClassLabel = 'All Classes',
  feeTypeFilter = '',
  statusFilter = '',
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const centerX = pageWidth / 2
  const usableWidth = pageWidth - MARGIN.left - MARGIN.right

  const totalDue = paymentList.reduce((sum, p) => sum + Math.max(0, Number(p.amount_due)), 0)
  const totalCollected = paymentList.reduce((sum, p) => sum + Number(p.amount_paid), 0)
  const totalPending = Math.max(0, totalDue - totalCollected)
  const uniqueClasses = new Set(paymentList.map((p) => getDisplayClassName(p, selectedClassLabel))).size
  const uniqueStudents = new Set(
    paymentList.map((p) => p.student_id || p.student || `${getDisplayClassName(p, selectedClassLabel)}::${p.student_name || '-'}::${p.student_roll || '-'}`)
  ).size

  const periodLabel = `${MONTH_NAMES[month - 1]} ${year}`
  const exportedAt = new Date().toLocaleString()
  const filename = buildSmartFilename({
    year,
    month,
    selectedClassLabel,
    feeTypeFilter,
    statusFilter,
  })

  let y = MARGIN.top
  const teacherByClass = classTeacherNameMap(paymentList, selectedClassLabel)
  let logoSize = 0

  if (schoolLogo) {
    try {
      const img = await loadImage(schoolLogo)
      logoSize = 45
      const compressedLogo = compressImageForPdf(img)
      if (compressedLogo) {
        doc.addImage(compressedLogo, 'JPEG', MARGIN.left, y, logoSize, logoSize)
      } else {
        doc.addImage(img, 'PNG', MARGIN.left, y, logoSize, logoSize)
      }
    } catch {
      // Skip logo if loading fails
    }
  }

  doc.setFontSize(16)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(...COLORS.title)
  doc.text(schoolName || 'School Fee Report', centerX, y + 14, { align: 'center' })

  doc.setFontSize(12)
  doc.text('Fee Collection Report', centerX, y + 32, { align: 'center' })

  const headerBlockHeight = Math.max(logoSize, 36)
  y += headerBlockHeight + 8

  doc.setDrawColor(...COLORS.title)
  doc.setLineWidth(0.8)
  doc.line(MARGIN.left, y, pageWidth - MARGIN.right, y)
  y += 12

  doc.setFont(undefined, 'normal')
  doc.setTextColor(70)
  doc.setFontSize(9)
  doc.setFont(undefined, 'bold')
  doc.text('Period:', MARGIN.left, y)
  doc.setFont(undefined, 'normal')
  doc.text(`${periodLabel}`, MARGIN.left + 34, y)

  doc.setFont(undefined, 'bold')
  doc.text('Class:', MARGIN.left + 170, y)
  doc.setFont(undefined, 'normal')
  doc.text(`${selectedClassLabel || 'All Classes'}`, MARGIN.left + 200, y)
  y += 12
  if (schoolAddress) {
    doc.setFont(undefined, 'bold')
    doc.text('Address:', MARGIN.left, y)
    doc.setFont(undefined, 'normal')
    doc.text(`${schoolAddress}`, MARGIN.left + 40, y)
    y += 12
  }
  if (schoolContact) {
    doc.setFont(undefined, 'normal')
    doc.text(`Contact: ${schoolContact}`, MARGIN.left, y)
    y += 12
  }
  y += 2
  doc.setTextColor(0)

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN.left, right: MARGIN.right },
    head: [['Students', 'Classes', 'Total Due', 'Collected', 'Pending', 'Collection Rate']],
    body: [[
      uniqueStudents,
      uniqueClasses,
      asMoney(totalDue),
      asMoney(totalCollected),
      asMoney(totalPending),
      totalDue > 0 ? `${((totalCollected / totalDue) * 100).toFixed(1)}%` : '0.0%',
    ]],
    theme: 'grid',
    styles: { fontSize: 9, cellPadding: 6, halign: 'center' },
    headStyles: { fillColor: COLORS.darkHead },
  })

  y = doc.lastAutoTable.finalY + 12

  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN.left, right: MARGIN.right },
    head: [['Class', 'Students', 'Total Due', 'Collected', 'Pending', 'Collection %']],
    body: classSummaryRows(paymentList, selectedClassLabel),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4, halign: 'center' },
    headStyles: { fillColor: COLORS.title },
  })

  y = doc.lastAutoTable.finalY + 16

  const sections = classSectionData(paymentList, selectedClassLabel)

  sections.forEach((section) => {
    doc.addPage()
    y = MARGIN.top

    doc.setFillColor(239, 246, 255)
    doc.roundedRect(MARGIN.left, y, usableWidth, 18, 2, 2, 'F')
    doc.setTextColor(...COLORS.section)
    doc.setFont(undefined, 'bold')
    doc.setFontSize(10)
    doc.text(section.className, centerX, y + 12, { align: 'center' })
    doc.setTextColor(0)
    doc.setFont(undefined, 'normal')
    y += 22

    const detailRows = section.items.map((row) => [
      row.roll,
      row.studentName,
      row.breakdown,
      asMoney(row.due),
      asMoney(row.paid),
      asMoney(row.balance),
      '',
    ])

    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN.left, right: MARGIN.right },
      head: [['Roll', 'Student', 'Fee Breakdown', 'Total Payable', 'Received', 'Balance', 'Remarks']],
      body: detailRows,
      foot: [[
        { content: `Sub Total (${section.className})`, colSpan: 3, styles: { halign: 'center', fontStyle: 'bold' } },
        { content: asMoney(section.totalDue), styles: { halign: 'center', fontStyle: 'bold' } },
        { content: asMoney(section.totalPaid), styles: { halign: 'center', fontStyle: 'bold' } },
        { content: asMoney(section.totalBalance), styles: { halign: 'center', fontStyle: 'bold' } },
        { content: '', styles: { halign: 'center' } },
      ]],
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: COLORS.title, fontSize: 7 },
      footStyles: { fillColor: COLORS.subtotalBg, textColor: [30, 64, 175], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 30, halign: 'center' },
        1: { cellWidth: 84 },
        2: { cellWidth: 155, overflow: 'linebreak' },
        3: { cellWidth: 62, halign: 'center' },
        4: { cellWidth: 58, halign: 'center' },
        5: { cellWidth: 58, halign: 'center' },
        6: { cellWidth: 76 },
      },
    })

    y = doc.lastAutoTable.finalY + 28
    y = ensureSpace(doc, y, 54)
    const classTeacherName = teacherByClass.get(section.className)
    doc.setFontSize(9)
    doc.setTextColor(60)
    doc.text(`Class Teacher${classTeacherName ? ` (${classTeacherName})` : ''} Signature:`, MARGIN.left, y)
    doc.line(MARGIN.left + 170, y + 1, MARGIN.left + 340, y + 1)
    doc.setTextColor(0)
    y += 34
  })

  y = ensureSpace(doc, y + 22, 70)
  const principalX = pageWidth - MARGIN.right - 200
  doc.setFontSize(10)
  doc.setFont(undefined, 'bold')
  doc.setTextColor(0)
  doc.text('Principal Signature:', principalX, y)
  doc.setFont(undefined, 'normal')
  doc.line(principalX + 95, y + 1, pageWidth - MARGIN.right, y + 1)

  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(8)
    doc.setTextColor(140)
    doc.text(`Prepared for School Records on ${exportedAt}`, MARGIN.left, doc.internal.pageSize.getHeight() - 12)
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN.right - 50, doc.internal.pageSize.getHeight() - 12)
  }

  doc.save(filename)
}
