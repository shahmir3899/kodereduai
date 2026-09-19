import { describe, it, expect } from 'vitest'
import jsPDF from 'jspdf'
import { buildReportData, formatIssueDate } from '../reportCardData'
import { renderEnhanced } from '../reportCardTemplates/enhanced'

const baseReport = {
  school_name: 'Test School',
  student_name: 'Ayesha Khan',
  roll_number: '7',
  class_name: 'Class 5-A',
  academic_year_name: '2025-26',
  exam_display: 'Final Exam',
  subjects: [
    { subject_name: 'Maths', total_marks: 100, marks_obtained: 91, percentage: 91, grade: 'A+', is_pass: true, class_avg: 62.5, comment: 'Great work' },
    { subject_name: 'English', total_marks: 100, marks_obtained: 80, percentage: 80, grade: 'A', is_pass: true, class_avg: null },
  ],
  summary: { total_marks: 200, obtained_marks: 171, percentage: 85.5, grade: 'A', rank: 1, overall_pass: true },
  class_size: 30,
  attendance: { present: 42, absent: 3, leave: 2, not_marked: 3, working_days: 50, total: 47, percentage: 89.36, from: '2025-04-01', to: '2025-09-30' },
  promotion_applicable: true,
  promotion_status: 'PROMOTED',
  issue_date: '2026-04-01',
  signature_labels: { principal: 'Head Teacher' },
}

async function render(overrides = {}) {
  const data = await buildReportData({ report: { ...baseReport, ...overrides }, schoolData: null })
  const doc = new jsPDF()
  renderEnhanced(doc, data)
  return { data, doc }
}

describe('enhanced report card', () => {
  it.each([1, 2, 3, 4, null])('renders for rank %s without throwing', async (rank) => {
    const { doc } = await render({ summary: { ...baseReport.summary, rank } })
    expect(doc.getNumberOfPages()).toBeGreaterThan(0)
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000)
  })

  it('merges signature captions over defaults and defaults the issue date', async () => {
    const { data } = await render()
    expect(data.signatureLabels).toEqual({ class_teacher: 'Class Teacher', principal: 'Head Teacher', parent: 'Parent' })
    const noDate = await buildReportData({ report: { ...baseReport, issue_date: null }, schoolData: null })
    expect(noDate.issueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(formatIssueDate('2026-04-01')).toContain('2026')
  })

  it('handles missing attendance, non-final and not-applicable promotion', async () => {
    const { data } = await render({ attendance: null, promotion_applicable: false, promotion_status: 'NOT_APPLICABLE' })
    expect(data.promotion).toEqual({ applicable: false, status: 'NOT_APPLICABLE' })
  })
})

import { shortExamName } from '../reportCardData'

const exam = (id, name, weight, isMain, marks) => ({
  exam_id: id, exam_name: name, weight, is_main: isMain,
  marks: { 1: { total_marks: 100, marks_obtained: marks, is_absent: false }, 2: { total_marks: 100, marks_obtained: marks - 5, is_absent: false } },
})

describe('multi-exam card', () => {
  const multi = {
    subjects: [
      { subject_id: 1, subject_name: 'Maths', total_marks: 100, marks_obtained: 90, percentage: 90, grade: 'A+', is_pass: true, class_avg: 60 },
      { subject_id: 2, subject_name: 'Urdu', total_marks: 100, marks_obtained: 85, percentage: 30, grade: 'F', is_pass: false, class_avg: 55 },
    ],
    exams: [
      exam(1, '1st Term Exam 2026-27 - Class 5', 20, false, 70),
      exam(2, '2nd Term Exam 2026-27 - Class 5', 40, false, 80),
      exam(3, 'Final Exam 2026-27 - Class 5', 60, true, 90),
    ],
    earlier_exam_names: ['1st Term Exam 2026-27 - Class 5', '2nd Term Exam 2026-27 - Class 5'],
    exam_display: 'Final Exam 2026-27 - Class 5',
  }

  it('shortens exam names for narrow column headers', () => {
    expect(shortExamName('1st Term Exam 2026-27 - Playgroup')).toBe('1st Term Exam')
    expect(shortExamName('Final')).toBe('Final')
    expect(shortExamName('2nd Term Exam 2026-27 - Class 5-A')).toBe('2nd Term Exam')
  })

  it.each([false, true])('renders 3 exams (weighted=%s) without throwing', async (weighted) => {
    const { doc } = await render({ ...multi, weighted, class_avg_unit: weighted ? 'percent' : 'marks' })
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000)
  })

  it('carries the exam columns through buildReportData', async () => {
    const data = await buildReportData({ report: { ...baseReport, ...multi, weighted: true }, schoolData: null })
    expect(data.exams).toHaveLength(3)
    expect(data.weighted).toBe(true)
    expect(data.earlierExamNames).toHaveLength(2)
  })
})

describe('attendance panel', () => {
  const att = (over) => ({
    present: 40, absent: 3, leave: 2, working_days: 45, not_marked: 0, total: 45,
    percentage: 88.89, suspect: false, from: '2026-09-14', to: '2026-09-19', ...over,
  })

  it.each([
    ['fully recorded, percentage shown', att({})],
    ['some unmarked, percentage withheld', att({ not_marked: 3, total: 42, percentage: null })],
    ['many unmarked, flagged as suspect', att({ not_marked: 30, total: 15, present: 10, absent: 3, leave: 2, percentage: null, suspect: true })],
  ])('renders when %s', async (_label, attendance) => {
    const { doc } = await render({ attendance })
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000)
  })
})
