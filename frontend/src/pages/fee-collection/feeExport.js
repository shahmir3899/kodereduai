import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function asMoney(value) {
  return (Number(value) || 0).toLocaleString()
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
    .sort(([a], [b]) => a.localeCompare(b))
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
      const classCmp = (a.className || '').localeCompare(b.className || '')
      if (classCmp !== 0) return classCmp
      const rollA = parseInt(a.roll) || 9999
      const rollB = parseInt(b.roll) || 9999
      if (rollA !== rollB) return rollA - rollB
      return (a.studentName || '').localeCompare(b.studentName || '')
    })
    .map((row, idx) => {
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

      const monthlyLine = monthlyParts.length > 0
        ? `Monthly: ${monthlyParts.join(', ')}`
        : 'Monthly: -'
      const yearlyLine = yearlyParts.length > 0
        ? `Yearly: ${yearlyParts.join(', ')}`
        : 'Yearly: -'
      const breakdown = `${monthlyLine}\n${yearlyLine}`

      return [
        idx + 1,
        row.className,
        row.roll,
        row.studentName,
        breakdown || '-',
        asMoney(row.due),
        asMoney(row.paid),
        asMoney(balance),
      ]
    })
}

export function exportFeePDF({
  paymentList,
  month,
  year,
  schoolName,
  selectedClassLabel = 'All Classes',
  feeTypeFilter = '',
  statusFilter = '',
}) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })

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

  doc.setFontSize(16)
  doc.text('Fee Collection Report', 40, 42)
  doc.setFontSize(10)
  doc.text(`Period: ${periodLabel}`, 40, 62)
  doc.text(`Class: ${selectedClassLabel || 'All Classes'}`, 210, 62)
  doc.text(`Fee Type: ${feeTypeFilter || 'All Types'}`, 40, 78)
  doc.text(`Status: ${statusFilter || 'All Status'}`, 210, 78)
  if (schoolName) {
    doc.text(`School: ${schoolName}`, 40, 94)
  }
  doc.text(`Exported: ${exportedAt}`, 40, 110)

  autoTable(doc, {
    startY: 124,
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
    styles: { fontSize: 9, cellPadding: 6 },
    headStyles: { fillColor: [31, 41, 55] },
  })

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 18,
    head: [['Class', 'Students', 'Total Due', 'Collected', 'Pending', 'Collection %']],
    body: classSummaryRows(paymentList, selectedClassLabel),
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [29, 78, 216] },
    columnStyles: {
      1: { halign: 'right' },
      2: { halign: 'right' },
      3: { halign: 'right' },
      4: { halign: 'right' },
      5: { halign: 'right' },
    },
  })

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 18,
    head: [['#', 'Class', 'Roll', 'Student', 'Fee Breakdown', 'Due', 'Paid', 'Balance']],
    body: groupedStudentRows(paymentList, selectedClassLabel),
    theme: 'grid',
    styles: { fontSize: 7, cellPadding: 3 },
    headStyles: { fillColor: [79, 70, 229], fontSize: 7 },
    columnStyles: {
      0: { cellWidth: 16, halign: 'right' },
      1: { cellWidth: 46 },
      2: { cellWidth: 24, halign: 'right' },
      3: { cellWidth: 76 },
      4: { cellWidth: 180, overflow: 'linebreak' },
      5: { cellWidth: 48, halign: 'right' },
      6: { cellWidth: 48, halign: 'right' },
      7: { cellWidth: 48, halign: 'right' },
    },
    didDrawPage: (data) => {
      const page = doc.getNumberOfPages()
      doc.setFontSize(8)
      doc.text(`Page ${page}`, data.settings.margin.left, doc.internal.pageSize.getHeight() - 14)
    },
  })

  doc.save(filename)
}
