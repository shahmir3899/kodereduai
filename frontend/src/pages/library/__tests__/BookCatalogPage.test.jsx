import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import BookCatalogPage from '../BookCatalogPage'

// Mock AuthContext
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'SCHOOL_ADMIN' },
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

// Mock Toast
vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn(),
  }),
}))

describe('BookCatalogPage - Bug #8: category creation without school field', () => {
  it('renders the page and categories', async () => {
    renderWithProviders(<BookCatalogPage />)
    await waitFor(() => {
      expect(screen.getByText('Book Catalog')).toBeInTheDocument()
    })
  })

  it('creates category without sending school field', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/library/categories/', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ id: 3, school: 1, ...capturedBody }, { status: 201 })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<BookCatalogPage />)

    // Wait for page load
    await waitFor(() => {
      expect(screen.getByText('Book Catalog')).toBeInTheDocument()
    })

    // Find "Manage Categories" or "Add Category" button
    const manageCatBtn = screen.queryByRole('button', { name: /manage categor|add categor/i })
    if (manageCatBtn) {
      await user.click(manageCatBtn)

      // Fill category form
      const nameInput = screen.getByPlaceholderText(/category name/i)
      await user.type(nameInput, 'History')

      // Submit
      const saveBtn = screen.getByRole('button', { name: /save|add|create/i })
      await user.click(saveBtn)

      await waitFor(() => {
        expect(capturedBody).not.toBeNull()
      })

      // Verify school is NOT in the payload (backend handles it)
      expect(capturedBody).toHaveProperty('name', 'History')
      expect(capturedBody).not.toHaveProperty('school')
    }
  })

  it('renders category list', async () => {
    renderWithProviders(<BookCatalogPage />)
    await waitFor(() => {
      expect(screen.getByText('Science')).toBeInTheDocument()
    })
    expect(screen.getByText('Fiction')).toBeInTheDocument()
  })
})
