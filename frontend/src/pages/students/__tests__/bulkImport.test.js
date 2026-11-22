import { describe, it, expect, vi, beforeEach } from 'vitest'

const bulkCreateStudents = vi.fn()
vi.mock('../../../services/api', () => ({
  studentsApi: { bulkCreateStudents: (...a) => bulkCreateStudents(...a) },
}))

import { importStudentsInBatches, batchCount, BULK_BATCH_SIZE } from '../bulkImport'

const rows = (n, start = 1) => Array.from({ length: n }, (_, i) => ({ roll_number: String(start + i), name: `S${start + i}` }))
const ok = (created, updated = 0, errors = []) => ({ data: { created_count: created, updated_count: updated, errors } })

describe('importStudentsInBatches', () => {
  beforeEach(() => bulkCreateStudents.mockReset())

  it('splits 112 rows of one section into 100 + 12 and sums the counts', async () => {
    bulkCreateStudents.mockResolvedValueOnce(ok(88, 12)).mockResolvedValueOnce(ok(12))
    const onProgress = vi.fn()
    const r = await importStudentsInBatches({ schoolId: 1, studentsByClass: { '3:9': rows(112) }, onProgress })
    expect(bulkCreateStudents).toHaveBeenCalledTimes(2)
    expect(bulkCreateStudents.mock.calls[0][0]).toMatchObject({ school_id: 1, class_id: 3, session_class_id: 9 })
    expect(bulkCreateStudents.mock.calls[0][0].students).toHaveLength(BULK_BATCH_SIZE)
    expect(bulkCreateStudents.mock.calls[1][0].students).toHaveLength(12)
    expect(r).toMatchObject({ added: 100, updated: 12, failedCount: 0, failures: [] })
    expect(onProgress).toHaveBeenLastCalledWith({ done: 112, total: 112 })
  })

  it('keeps going after a failed batch and returns that batch for retry', async () => {
    bulkCreateStudents
      .mockRejectedValueOnce({ response: { data: { detail: 'Timeout' } } })
      .mockResolvedValueOnce(ok(5))
    const r = await importStudentsInBatches({
      schoolId: 1, studentsByClass: { '3': rows(100), '4': rows(5) }, labelFor: (k) => `Class ${k}`,
    })
    expect(r.added).toBe(5)
    expect(r.failedCount).toBe(100)
    expect(Object.keys(r.failedRows)).toEqual(['3'])
    expect(r.failures[0]).toMatch(/Class 3.*Timeout/)
  })

  it('returns only the rows the server rejected', async () => {
    bulkCreateStudents.mockResolvedValueOnce(ok(2, 0, [{ roll_number: '2', error: 'boom' }]))
    const r = await importStudentsInBatches({ schoolId: 1, studentsByClass: { '3': rows(3) } })
    expect(r.failedRows['3']).toEqual([{ roll_number: '2', name: 'S2' }])
    expect(r.failures).toEqual(['3, roll 2: boom'])
  })
})

describe('batchCount', () => {
  it('counts batches per class', () => {
    expect(batchCount({ a: rows(112), b: rows(1) })).toBe(3)
  })
})
