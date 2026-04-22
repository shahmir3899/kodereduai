import { screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders } from '../../../test/utils'
import StudentAssignments from '../StudentAssignments'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'student1', role: 'STUDENT' },
    activeSchool: { id: 1, name: 'Test School' },
    loading: false,
  }),
}))

const WAIT = { timeout: 3000 }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('StudentAssignments', () => {
  describe('Rendering', () => {
    it('shows the page title', async () => {
      renderWithProviders(<StudentAssignments />)
      await waitFor(() => {
        expect(screen.getByText('My Assignments')).toBeInTheDocument()
      }, WAIT)
    })

    it('renders HOMEWORK assignment with submit button', async () => {
      renderWithProviders(<StudentAssignments />)
      await waitFor(() => {
        expect(screen.getByText('Chapter 5 Homework')).toBeInTheDocument()
      }, WAIT)
      // Submit button must be visible for a homework with no submission
      expect(screen.getByText('Submit')).toBeInTheDocument()
    })

    it('renders DIARY assignment without a submit button', async () => {
      renderWithProviders(<StudentAssignments />)
      await waitFor(() => {
        expect(screen.getByText('Monday Class Diary')).toBeInTheDocument()
      }, WAIT)

      // Only one "Submit" button should exist (for HOMEWORK), none for DIARY
      const submitButtons = screen.queryAllByText('Submit')
      expect(submitButtons.length).toBe(1)
    })

    it('shows "Diary Entry" badge for DIARY assignments', async () => {
      renderWithProviders(<StudentAssignments />)
      await waitFor(() => {
        expect(screen.getByText('Monday Class Diary')).toBeInTheDocument()
      }, WAIT)
      expect(screen.getByText('Diary Entry')).toBeInTheDocument()
    })

    it('does not show overdue styling or marks for DIARY', async () => {
      renderWithProviders(<StudentAssignments />)
      await waitFor(() => {
        expect(screen.getByText('Monday Class Diary')).toBeInTheDocument()
      }, WAIT)
      // DIARY has no due_date in mock data so no "Due:" text for that card
      // (HOMEWORK does have due_date so at least one "Due:" should exist)
      const dueLabels = screen.queryAllByText(/^Due:/)
      // HOMEWORK card has a due date; DIARY card should not
      expect(dueLabels.length).toBe(1)
    })
  })
})
