import { describe, it, expect } from 'vitest'
import {
  buildStudentChargesPayload, buildStudentRows, changeCounts, changedCells, classDefaultAmount, isOverride, overrideAmounts, rowTotal,
  validateStudentCharges,
} from '../studentCharges'

const fs = (over) => ({
  id: 1, class_obj: 5, student: null, fee_type: 'MONTHLY', monthly_amount: '3000.00', monthly_category: 1, is_active: true, effective_from: '2026-04-01', ...over,
})

const tuition = { id: 1, name: 'Tuition' }
const kids = { id: 2, name: 'Koder Kids' }
const robotics = { id: 3, name: 'Robotics', billing_mode: 'ENROLLED', default_amount: '1500.00' }
const students = [
  { id: 11, name: 'Zara', roll_number: '2' }, { id: 12, name: 'Ali', roll_number: '1' }, { id: 13, name: 'Omar', roll_number: null },
]

describe('amounts in force', () => {
  it('reads the class charge and student overrides per category, newest first', () => {
    const rows = [
      fs({}), fs({ id: 2, monthly_category: 2, monthly_amount: '800' }),
      fs({ id: 3, class_obj: null, student: 11, monthly_amount: '2400', effective_from: '2026-01-01' }),
      fs({ id: 4, class_obj: null, student: 11, monthly_amount: '2500', effective_from: '2026-08-01' }),
    ]
    expect(classDefaultAmount(rows, 5, 'MONTHLY', tuition)).toBe('3000')
    expect(classDefaultAmount(rows, 5, 'MONTHLY', kids)).toBe('800')
    expect(overrideAmounts(rows, 'MONTHLY', tuition)).toEqual({ 11: { amount: '2500', legacy: false } })
    expect(overrideAmounts(rows, 'MONTHLY', kids)).toEqual({})
  })

  it('shows an old uncategorised override on every fee except enrolled-only ones', () => {
    const rows = [fs({}), fs({ id: 2, class_obj: null, student: 12, monthly_category: null, monthly_amount: '2000' })]
    expect(overrideAmounts(rows, 'MONTHLY', kids)).toEqual({ 12: { amount: '2000', legacy: true } })
    expect(overrideAmounts(rows, 'MONTHLY', robotics)).toEqual({})
    expect(classDefaultAmount([], 5, 'MONTHLY', robotics)).toBe('1500')
  })

  it('keeps annual categories apart', () => {
    const rows = [fs({ fee_type: 'ANNUAL', monthly_category: null, annual_category: 2, monthly_amount: '500' })]
    expect(classDefaultAmount(rows, 5, 'ANNUAL', kids)).toBe('500')
    expect(classDefaultAmount(rows, 5, 'ANNUAL', tuition)).toBe('')
  })
})

describe('grid', () => {
  const structures = [fs({}), fs({ id: 2, monthly_category: 2, monthly_amount: '800' }), fs({ id: 3, class_obj: null, student: 11, monthly_amount: '2500' })]

  it('has one cell per chosen fee and a total', () => {
    const rows = buildStudentRows(students, structures, 5, 'MONTHLY', [tuition, kids], {})
    expect(rows.map((r) => r.name)).toEqual(['Ali', 'Zara', 'Omar'])
    const zara = rows.find((r) => r.studentId === 11)
    expect(isOverride(zara.cells[1])).toBe(true)
    expect(isOverride(zara.cells[2])).toBe(false)
    expect(rowTotal(zara)).toBe(3300)
  })

  it('sends only changed boxes, each with its own category', () => {
    const rows = buildStudentRows(students, structures, 5, 'MONTHLY', [tuition, kids], { 1: { 12: '2000', 11: '2500' }, 2: { 11: '700', 13: '' } })
    expect(validateStudentCharges(rows, '2026-11-01', [1, 2])).toBeNull()
    expect(buildStudentChargesPayload('5', 'MONTHLY', '2026-11-01', rows)).toEqual({
      class_id: 5, fee_type: 'MONTHLY', effective_from: '2026-11-01',
      students: [{ student_id: 12, monthly_amount: '2000', monthly_category: 1 }, { student_id: 11, monthly_amount: '700', monthly_category: 2 }],
    })
    expect(changeCounts(changedCells(rows), [tuition, kids]).map((x) => [x.category.name, x.count])).toEqual([['Tuition', 1], ['Koder Kids', 1]])
  })

  it('saves a retyped old uncategorised amount onto the fee', () => {
    const rows = buildStudentRows(students, [fs({ class_obj: null, student: 12, monthly_category: null, monthly_amount: '2000' })], 5, 'MONTHLY', [tuition], { 1: { 12: '2000' } })
    expect(changedCells(rows)).toEqual([expect.objectContaining({ studentId: 12, categoryId: 1, amount: '2000' })])
  })

  it('validates fee choice, date and amounts', () => {
    const rows = (edits) => buildStudentRows(students, structures, 5, 'MONTHLY', [tuition], edits)
    expect(validateStudentCharges(rows({}), '2026-11-01', [])).toMatch(/at least one fee/)
    expect(validateStudentCharges(rows({}), '2026-11-01', [1])).toMatch(/at least one student/)
    expect(validateStudentCharges(rows({ 1: { 12: '1' } }), '', [1])).toMatch(/date/)
    expect(validateStudentCharges(rows({ 1: { 12: '-5' } }), '2026-11-01', [1])).toMatch(/Ali/)
  })
})
