import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders } from '../../../test/utils'
import CurriculumPage from '../CurriculumPage'

// Mock hooks/contexts
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School', role: 'SCHOOL_ADMIN', is_default: true },
    loading: false,
    isModuleEnabled: () => true,
    isSchoolAdmin: true,
    isTeacher: false,
  }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: '2025-2026' },
    academicYears: [{ id: 1, name: '2025-2026' }],
  }),
}))

const WAIT_OPTS = { timeout: 3000 }

describe('CurriculumPage', () => {
  describe('Initial Render', () => {
    it('renders header and filters', async () => {
      renderWithProviders(<CurriculumPage />)
      expect(screen.getByText('Curriculum Management')).toBeInTheDocument()
      // Filter labels
      expect(screen.getByText('Class')).toBeInTheDocument()
      expect(screen.getByText('Subject')).toBeInTheDocument()
    })

    it('shows placeholder before filters selected', () => {
      renderWithProviders(<CurriculumPage />)
      expect(screen.getByText(/Start by selecting a class/)).toBeInTheDocument()
    })

    it('does not show Add Book button before filters', () => {
      renderWithProviders(<CurriculumPage />)
      expect(screen.queryByText('Add Book')).not.toBeInTheDocument()
    })
  })

  describe('Book List', () => {
    async function renderWithFilters() {
      const user = userEvent.setup()
      renderWithProviders(<CurriculumPage />)
      await waitFor(() => {
        expect(screen.getByText(/Class 1A/)).toBeInTheDocument()
      }, WAIT_OPTS)
      const selects = screen.getAllByRole('combobox')
      await user.selectOptions(selects[0], '1')
      await waitFor(() => {
        const both = screen.getAllByRole('combobox')
        expect(within(both[1]).getByRole('option', { name: 'Mathematics' })).toBeInTheDocument()
      }, WAIT_OPTS)
      await user.selectOptions(screen.getAllByRole('combobox')[1], '1')
      return user
    }

    it('shows books after selecting filters', async () => {
      await renderWithFilters()
      await waitFor(() => {
        expect(screen.getByText('Mathematics Textbook')).toBeInTheDocument()
      }, WAIT_OPTS)
    })

    it('shows Add Book button after filters selected', async () => {
      await renderWithFilters()
      await waitFor(() => {
        expect(screen.getByText('Add Book')).toBeInTheDocument()
      }, WAIT_OPTS)
    })

    it('shows chapter count', async () => {
      await renderWithFilters()
      await waitFor(() => {
        expect(screen.getByText(/2 chapters/)).toBeInTheDocument()
      }, WAIT_OPTS)
    })
  })

  describe('Modals', () => {
    it('opens Add Book modal when button clicked', async () => {
      const user = userEvent.setup()
      renderWithProviders(<CurriculumPage />)
      // Wait for data to load
      await waitFor(() => {
        expect(screen.getByText(/Class 1A/)).toBeInTheDocument()
      }, WAIT_OPTS)
      // Select filters to enable Add Book button
      const selects = screen.getAllByRole('combobox')
      await user.selectOptions(selects[0], '1')
      await waitFor(() => {
        const both = screen.getAllByRole('combobox')
        expect(within(both[1]).getByRole('option', { name: 'Mathematics' })).toBeInTheDocument()
      }, WAIT_OPTS)
      await user.selectOptions(screen.getAllByRole('combobox')[1], '1')
      await waitFor(() => {
        expect(screen.getByText('Add Book')).toBeInTheDocument()
      }, WAIT_OPTS)
      await user.click(screen.getByText('Add Book'))
      await waitFor(() => {
        // Modal should appear with title input placeholder
        expect(screen.getByPlaceholderText('e.g., Mathematics Grade 5')).toBeInTheDocument()
      })
    })
  })
})
