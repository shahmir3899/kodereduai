import { screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderWithProviders } from '../../../test/utils'
import { server } from '../../../test/mocks/server'
import LessonPlanWizard from '../LessonPlanWizard'

// The shared mock handler for class-subjects filters on `class_id`, but this
// wizard queries with `class_obj` (matches the real backend param). Override
// it here so the Subject dropdown actually populates in these tests.
function mockClassSubjectsByClassObj() {
  server.use(
    http.get('/api/academics/class-subjects/', ({ request }) => {
      const url = new URL(request.url)
      const classObj = url.searchParams.get('class_obj')
      const subjects = classObj ? [
        { id: 1, class_obj: parseInt(classObj), subject: 1, subject_name: 'Mathematics', teacher: 1, teacher_name: 'Ali Khan' },
      ] : []
      return HttpResponse.json({ count: subjects.length, results: subjects })
    }),
  )
}

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

const { mockShowSuccess, mockShowError } = vi.hoisted(() => ({
  mockShowSuccess: vi.fn(),
  mockShowError: vi.fn(),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: mockShowSuccess, showError: mockShowError }),
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

vi.mock('../../../contexts/AcademicYearContext', () => ({
  useAcademicYear: () => ({
    activeAcademicYear: { id: 1, name: '2025-2026' },
    academicYears: [{ id: 1, name: '2025-2026' }],
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

  describe('Custom topics without a book topic (regression)', () => {
    beforeEach(() => {
      mockShowError.mockClear()
      mockShowSuccess.mockClear()
      mockClassSubjectsByClassObj()
    })

    async function advanceToStep2() {
      const { container } = renderWithProviders(<LessonPlanWizard {...defaultProps} />)
      await waitFor(() => {
        expect(screen.getByText('Class & Date')).toBeInTheDocument()
      })

      // Class / Subject / Teacher selects aren't <label htmlFor>-linked, so
      // query them positionally rather than by label text.
      const [classSelect, subjectSelect] = container.querySelectorAll('select')

      // ClassSelector loads its options async (session-classes query) — wait
      // for the real option before firing change, or the value won't "take".
      await waitFor(() => {
        expect(classSelect.querySelectorAll('option').length).toBeGreaterThan(1)
      })
      fireEvent.change(classSelect, { target: { value: '1' } })

      await waitFor(() => {
        expect(subjectSelect).not.toBeDisabled()
        expect(subjectSelect.querySelectorAll('option').length).toBeGreaterThan(1)
      })
      fireEvent.change(subjectSelect, { target: { value: '1' } })

      const dateInput = container.querySelector('input[type="date"]')
      fireEvent.change(dateInput, { target: { value: '2026-04-01' } })

      fireEvent.click(screen.getByText('Next'))
      await waitFor(() => {
        expect(screen.getByText(/Select chapter, topics, and optional sub-topics/i)).toBeInTheDocument()
      })
    }

    it('does not block Step 2 -> Step 3 when no book topic is selected', async () => {
      await advanceToStep2()

      fireEvent.click(screen.getByText('Next'))

      await waitFor(() => {
        expect(screen.getByText(/Skip AI — write manually in review/i)).toBeInTheDocument()
      })
      expect(mockShowError).not.toHaveBeenCalledWith('Please select at least one topic or sub-topic')
    })

    it('saves successfully with only a custom topic and no book topic selected', async () => {
      let capturedBody = null
      server.use(
        http.post('/api/lms/lesson-plans/', async ({ request }) => {
          capturedBody = await request.json()
          return HttpResponse.json({ id: 99, ...capturedBody }, { status: 201 })
        }),
      )

      await advanceToStep2()
      fireEvent.click(screen.getByText('Next')) // -> step 3 (AI)
      await waitFor(() => {
        expect(screen.getByText(/Skip AI — write manually in review/i)).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText(/Skip AI — write manually in review/i)) // -> step 4

      await waitFor(() => {
        expect(screen.getByText('Review & Save')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText(/Introduction to Photosynthesis/i), {
        target: { value: 'Guest Speaker Day' },
      })

      const customTopicInput = screen.getByPlaceholderText(/Guest speaker session/i)
      fireEvent.change(customTopicInput, { target: { value: 'Guest speaker session' } })
      fireEvent.click(screen.getByText('Add'))
      expect(screen.getByText('Guest speaker session')).toBeInTheDocument()

      fireEvent.click(screen.getByText('Save as Draft'))

      await waitFor(() => {
        expect(capturedBody).not.toBeNull()
      })
      expect(capturedBody.content_mode).toBe('TOPICS')
      expect(capturedBody.custom_topics).toEqual(['Guest speaker session'])
      expect(capturedBody.planned_topic_ids).toEqual([])
      expect(mockShowError).not.toHaveBeenCalledWith(
        'Please select at least one topic/sub-topic or add a custom topic',
      )
      expect(mockShowSuccess).toHaveBeenCalled()
    })

    it('still blocks save in TOPICS mode when neither a book topic nor a custom topic is set', async () => {
      await advanceToStep2()
      fireEvent.click(screen.getByText('Next')) // -> step 3
      await waitFor(() => {
        expect(screen.getByText(/Skip AI — write manually in review/i)).toBeInTheDocument()
      })
      fireEvent.click(screen.getByText(/Skip AI — write manually in review/i)) // -> step 4

      await waitFor(() => {
        expect(screen.getByText('Review & Save')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText(/Introduction to Photosynthesis/i), {
        target: { value: 'Untitled Lesson' },
      })

      fireEvent.click(screen.getByText('Save as Draft'))

      await waitFor(() => {
        expect(mockShowError).toHaveBeenCalledWith(
          'Please select at least one topic/sub-topic or add a custom topic',
        )
      })
      expect(mockShowSuccess).not.toHaveBeenCalled()
    })
  })
})
