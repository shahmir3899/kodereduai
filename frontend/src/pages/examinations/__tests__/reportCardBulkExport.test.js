import { describe, it, expect, vi, beforeEach } from 'vitest'
import JSZip from 'jszip'

const mockGetReportCard = vi.fn()
vi.mock('../../../services/api', () => ({
  examinationsApi: { getReportCard: (...a) => mockGetReportCard(...a) },
}))

import { exportBulkReportCardsZIP } from '../reportCardExport'

const baseReport = {
  school_name: 'Test School',
  roll_number: '7',
  class_name: 'Class 5-A',
  academic_year_name: '2025-26',
  exam_display: 'Final Exam',
  subjects: [
    { subject_name: 'Maths', total_marks: 100, marks_obtained: 91, percentage: 91, grade: 'A+', is_pass: true },
  ],
  summary: { total_marks: 100, obtained_marks: 91, percentage: 91, grade: 'A+', rank: 1, overall_pass: true },
  class_size: 2,
  attendance: null,
  promotion_applicable: false,
  promotion_status: 'NOT_APPLICABLE',
  issue_date: '2026-04-01',
  signature_labels: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom has no real anchor click/objectURL wiring for downloads - stub what the
  // export function touches after the zip blob is built.
  global.URL.createObjectURL = vi.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = vi.fn()
})

const students = [
  { studentId: 1, name: 'Ayesha Khan', roll: '7' },
  { studentId: 2, name: 'Bilal Ahmed', roll: '8' },
  { studentId: 3, name: 'Chand Bibi', roll: '9' },
]

describe('exportBulkReportCardsZIP', () => {
  it('generates one PDF per student, reports progress, and zips them', async () => {
    mockGetReportCard.mockImplementation(({ student_id }) => Promise.resolve({
      data: { ...baseReport, student_name: students.find(s => s.studentId === student_id).name },
    }))
    const progress = []

    const result = await exportBulkReportCardsZIP({
      students, yearId: '1', examIds: ['1'], schoolData: null, className: 'Class 5-A',
      onProgress: (done, total) => progress.push([done, total]),
    })

    expect(result.generated).toBe(3)
    expect(result.skipped).toEqual([])
    expect(progress).toEqual([[1, 3], [2, 3], [3, 3]])
    expect(mockGetReportCard).toHaveBeenCalledTimes(3)
    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1)
  })

  it('skips a student with no report data instead of failing the whole batch', async () => {
    mockGetReportCard.mockImplementation(({ student_id }) => Promise.resolve({
      data: student_id === 2 ? null : { ...baseReport, student_name: 'Someone' },
    }))

    const result = await exportBulkReportCardsZIP({
      students, yearId: '1', examIds: ['1'], schoolData: null, className: 'Class 5-A',
    })

    expect(result.generated).toBe(2)
    expect(result.skipped).toEqual([{ name: 'Bilal Ahmed', reason: 'No report card data' }])
  })

  it('skips a student whose fetch rejects, recording the server-provided reason', async () => {
    mockGetReportCard.mockImplementation(({ student_id }) => (
      student_id === 3
        ? Promise.reject({ response: { data: { detail: 'No marks entered yet.' } } })
        : Promise.resolve({ data: { ...baseReport, student_name: 'Someone' } })
    ))

    const result = await exportBulkReportCardsZIP({
      students, yearId: '1', examIds: ['1'], schoolData: null, className: 'Class 5-A',
    })

    expect(result.generated).toBe(2)
    expect(result.skipped).toEqual([{ name: 'Chand Bibi', reason: 'No marks entered yet.' }])
  })

  it('does not create a ZIP download when every student is skipped', async () => {
    mockGetReportCard.mockResolvedValue({ data: null })

    const result = await exportBulkReportCardsZIP({
      students, yearId: '1', examIds: ['1'], schoolData: null, className: 'Class 5-A',
    })

    expect(result.generated).toBe(0)
    expect(result.skipped).toHaveLength(3)
    expect(global.URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('reuses the school logo across the batch instead of refetching it per student', async () => {
    // jsdom never fires a real Image's onload/onerror, so stub one that rejects on
    // the next tick - buildReportData just needs to settle, not actually load pixels.
    const OriginalImage = global.Image
    let constructedCount = 0
    global.Image = class {
      constructor() { constructedCount += 1; setTimeout(() => this.onerror?.(), 0) }
      set src(_v) {}
    }

    mockGetReportCard.mockResolvedValue({ data: { ...baseReport, student_name: 'Someone' } })
    const schoolData = { logo: 'https://example.com/logo.png' }

    try {
      await exportBulkReportCardsZIP({ students, yearId: '1', examIds: ['1'], schoolData, className: 'Class 5-A' })
    } finally {
      global.Image = OriginalImage
    }

    // No photo_url on any student here, so every Image() construction is a logo load -
    // caching means that happens once for the whole batch, not once per student.
    expect(constructedCount).toBe(1)
  })
})

describe('JSZip sanity', () => {
  it('is importable in this test env (guards the dependency itself, not just our wrapper)', () => {
    expect(new JSZip()).toBeTruthy()
  })
})
