import { parsePhone } from './studentFormUtils'

// Excel template + bulk-upload parsing, extracted from StudentsPage. The sheet
// shape (instruction rows, then a class_name/roll_number/student_name/parent_phone/
// parent_name header) is what the upload parser expects, so the two live together.

const HEADER = ['class_name', 'roll_number', 'student_name', 'parent_phone', 'parent_name']

export function buildStudentsSheetData({ schoolName, classes, students }) {
  const sheetData = [
    [`School: ${schoolName || 'Unknown'}`],
    [`Classes: ${classes.map((c) => c.name).join(' | ')}`],
    ['Phone (optional): Use +92 format like +923001234567 for WhatsApp - can be added later'],
    [],
    HEADER,
  ]

  if (students.length > 0) {
    // Real data sorted by class then roll number
    const sorted = [...students].sort((a, b) => {
      if (a.class_name !== b.class_name) return (a.class_name || '').localeCompare(b.class_name || '')
      return (parseInt(a.roll_number) || 0) - (parseInt(b.roll_number) || 0)
    })
    sorted.forEach((s) => {
      sheetData.push([s.class_name || '', s.roll_number || '', s.name || '', s.parent_phone || '', s.parent_name || ''])
    })
  } else {
    // No students yet: blank template with sample rows
    classes.slice(0, 2).forEach((cls) => {
      sheetData.push([cls.name, '1', 'Student Name', '+923001234567', 'Parent Name'])
    })
    for (let i = 0; i < 10; i++) sheetData.push(['', '', '', '', ''])
  }

  return sheetData
}

export async function downloadStudentsExcel({ schoolName, classes, students }) {
  const XLSX = (await import('xlsx')).default || await import('xlsx')
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(buildStudentsSheetData({ schoolName, classes, students }))

  // Force phone column cells to text so Excel keeps the + prefix
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
  const phoneCol = 3
  for (let r = range.s.r; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: phoneCol })
    if (ws[addr] && ws[addr].v) {
      ws[addr].t = 's'
      ws[addr].z = '@'
    }
  }

  ws['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 25 }, { wch: 22 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws, 'Students')
  XLSX.writeFile(wb, `students_${schoolName?.replace(/\s+/g, '_') || 'school'}.xlsx`)
}

// Reads the uploaded rows into { studentsByClass } keyed by class id. Returns
// { error } for an unusable file, otherwise { studentsByClass, issues }
// where issues are skipped rows (unknown class) for the caller to report.
export function parseStudentRows(jsonData, classes) {
  if (jsonData.length < 2) return { error: 'File is empty or invalid' }

  const headerRowIndex = jsonData.findIndex((row) =>
    row.some((cell) => String(cell).toLowerCase() === 'class_name'))
  if (headerRowIndex === -1) return { error: 'Could not find header row with "class_name" column' }

  const headers = jsonData[headerRowIndex].map((h) => String(h).toLowerCase().trim())
  const classNameIdx = headers.indexOf('class_name')
  const rollIdx = headers.indexOf('roll_number')
  const nameIdx = headers.indexOf('student_name')
  const phoneIdx = headers.indexOf('parent_phone')
  const parentNameIdx = headers.indexOf('parent_name')

  if (classNameIdx === -1 || rollIdx === -1 || nameIdx === -1) {
    return { error: 'Missing required columns: class_name, roll_number, student_name' }
  }

  const classMap = {}
  const classMapNoSpace = {} // fallback for matching without spaces
  classes.forEach((cls) => {
    const normalized = cls.name.toLowerCase().trim().replace(/\s+/g, ' ')
    classMap[normalized] = cls.id
    classMapNoSpace[normalized.replace(/\s/g, '')] = cls.id
  })

  const studentsByClass = {}
  const issues = []

  for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
    const row = jsonData[i]
    if (!row || row.length === 0) continue

    const className = String(row[classNameIdx] || '').trim().replace(/\s+/g, ' ')
    const classNameLower = className.toLowerCase()
    const classId = classMap[classNameLower] || classMapNoSpace[classNameLower.replace(/\s/g, '')]

    if (!classId) {
      if (className && !classNameLower.includes('enter') && !classNameLower.includes('student')) {
        issues.push(`Row ${i + 1}: Unknown class "${className}"`)
      }
      continue
    }

    const rollNumber = String(row[rollIdx] || '').trim()
    const studentName = String(row[nameIdx] || '').trim()
    const rawPhone = row[phoneIdx]

    // Skip sample/placeholder rows
    if (studentName.toLowerCase().includes('enter')
      || studentName.toLowerCase().includes('here')
      || !rollNumber || !studentName) {
      continue
    }

    if (!studentsByClass[classId]) studentsByClass[classId] = []
    studentsByClass[classId].push({
      roll_number: rollNumber,
      name: studentName,
      // Phone is optional
      parent_phone: rawPhone ? parsePhone(rawPhone) : '',
      parent_name: String(row[parentNameIdx] || '').trim(),
    })
  }

  return { studentsByClass, issues }
}

// Browser File -> parsed rows. Prefers a sheet named like "Students", else the first.
export async function readStudentsFile(file, classes) {
  const XLSX = (await import('xlsx')).default || await import('xlsx')
  const data = new Uint8Array(await file.arrayBuffer())
  const workbook = XLSX.read(data, { type: 'array' })
  const sheetName = workbook.SheetNames.find((name) => name.toLowerCase().includes('student'))
    || workbook.SheetNames[0]
  const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 })
  return parseStudentRows(jsonData, classes)
}
