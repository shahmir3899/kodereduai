import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import StudentResults from '../StudentResults'

vi.mock('../../../services/api', () => ({
  studentPortalApi: {
    getExamResults: () => Promise.resolve({ data: [{
      exam_name: 'Weekly Quiz', grade: 'A',
      subjects: [
        { subject: 'English', marks_obtained: null, total_marks: 20, is_absent: true },
        { subject: 'Mathematics', marks_obtained: 16, total_marks: 20 },
      ],
    }] }),
  },
}))

describe('StudentResults phone cards', () => {
  it('show a dash, not 0%, for an absent paper', async () => {
    renderWithProviders(<StudentResults />)
    await waitFor(() => expect(screen.getAllByText('English').length).toBeGreaterThan(0))
    // 80% overall is in the header and 80% for Mathematics: a 0% must not appear anywhere
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })
})
