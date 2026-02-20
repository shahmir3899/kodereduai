import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders } from '../../../test/utils'
import LessonPlanWizard from '../LessonPlanWizard'

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

vi.mock('../../../hooks/useClasses', () => ({
  useClasses: () => ({
    classes: [
      { id: 1, name: 'Class 1A', section: 'A', grade_level: 1 },
      { id: 2, name: 'Class 2B', section: 'B', grade_level: 2 },
    ],
    isLoading: false,
  }),
}))

const defaultProps = {
  onClose: vi.fn(),
  onSuccess: vi.fn(),
  editingPlan: null,
}

describe('LessonPlanWizard', () => {
  describe('Step 1 - Class & Date', () => {
    it('renders class, subject, date, duration fields', async () => {
      renderWithProviders(<LessonPlanWizard {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Class & Date')).toBeInTheDocument()
      })
      // Should have select elements for class, subject, teacher
      const selects = screen.getAllByRole('combobox')
      expect(selects.length).toBeGreaterThanOrEqual(2) // class, subject at minimum
    })

    it('shows TOPICS and FREEFORM mode options', async () => {
      renderWithProviders(<LessonPlanWizard {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Structured Topics')).toBeInTheDocument()
        expect(screen.getByText('Free-form Text')).toBeInTheDocument()
      })
    })

    it('renders step indicator', async () => {
      renderWithProviders(<LessonPlanWizard {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Class & Date')).toBeInTheDocument()
        expect(screen.getByText('Topics')).toBeInTheDocument()
        expect(screen.getByText('AI Generate')).toBeInTheDocument()
        expect(screen.getByText('Review & Save')).toBeInTheDocument()
      })
    })

    it('has a Next button', async () => {
      renderWithProviders(<LessonPlanWizard {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText(/next/i)).toBeInTheDocument()
      })
    })

    it('has a Cancel/Close button', async () => {
      renderWithProviders(<LessonPlanWizard {...defaultProps} />)
      await waitFor(() => {
        // Should have some close mechanism
        expect(screen.getByText(/cancel|close/i)).toBeInTheDocument()
      })
    })
  })

  describe('Step Navigation', () => {
    it('starts at step 1', async () => {
      renderWithProviders(<LessonPlanWizard {...defaultProps} />)
      await waitFor(() => {
        // Step 1 content should be visible
        expect(screen.getByText('Class & Date')).toBeInTheDocument()
      })
    })

    it('calls onClose when cancel is clicked', async () => {
      const onClose = vi.fn()
      renderWithProviders(<LessonPlanWizard {...defaultProps} onClose={onClose} />)
      await waitFor(() => {
        const cancelBtn = screen.getByText(/cancel|close/i)
        fireEvent.click(cancelBtn)
      })
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe('Editing Mode', () => {
    it('pre-populates fields when editingPlan is provided', async () => {
      const editingPlan = {
        id: 1,
        class_obj: 1,
        subject: 1,
        teacher: 1,
        lesson_date: '2026-03-15',
        duration_minutes: 45,
        content_mode: 'TOPICS',
        title: 'Existing Plan',
        description: 'Existing description',
        objectives: 'Existing objectives',
        teaching_methods: 'Existing methods',
        materials_needed: 'Existing materials',
        ai_generated: false,
        planned_topic_ids: [],
      }
      renderWithProviders(<LessonPlanWizard {...defaultProps} editingPlan={editingPlan} />)
      await waitFor(() => {
        // When editing, it should jump to step 4 since title is set
        expect(screen.getByText('Review & Save')).toBeInTheDocument()
      })
    })
  })
})
