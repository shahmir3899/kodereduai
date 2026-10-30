import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import StudentResults from '../StudentResults'

vi.mock('../../../services/api', () => ({
  studentPortalApi: {
    getExamResults: () => Promise.resolve({ data: [{
      exam_name: 'Quiz', grade: 'C',
      subjects: [
        // 30 % passes because this exam's passing marks are 25; 45 % fails because they are 50.
        { subject: 'English', marks_obtained: 30, total_marks: 100, passing_marks: 25 },
        { subject: 'Urdu', marks_obtained: 45, total_marks: 100, passing_marks: 50 },
      ],
    }] }),
  },
}))

describe('StudentResults Pass/Fail', () => {
  it('follows the exam passing marks, not a fixed 40 %', async () => {
    renderWithProviders(<StudentResults />)
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0))
    const rowOf = (name) => screen.getAllByText(name)[0].closest('.px-4')
    expect(rowOf('English').textContent).toContain('Pass')
    expect(rowOf('Urdu').textContent).toContain('Fail')
  })
})
