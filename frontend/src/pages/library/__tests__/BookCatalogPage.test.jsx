import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/mocks/server'
import { renderWithProviders } from '../../../test/utils'
import BookCatalogPage from '../BookCatalogPage'
import BookIssuePage from '../BookIssuePage'
import OverdueBooksPage from '../OverdueBooksPage'
import LibraryDashboard from '../LibraryDashboard'

const auth = vi.hoisted(() => ({ role: 'SCHOOL_ADMIN' }))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, username: 'admin', role: auth.role },
    effectiveRole: auth.role,
    activeSchool: { id: 1, name: 'Test School' },
  }),
}))

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}))

const page = (results) => HttpResponse.json({ count: results.length, results })

const book = {
  id: 9, title: 'Algebra Made Easy', author: 'A. Khan', isbn: '', category: 1, category_name: 'Science',
  total_copies: 3, available_copies: 2, shelf_location: 'B-2', is_active: true,
}

const overdueIssue = {
  id: 4, book: 9, book_title: 'World Atlas', borrower_type: 'STUDENT', borrower_name: 'Fatima Noor',
  issue_date: '2026-10-01', due_date: '2026-10-10', status: 'ISSUED', days_overdue: 6, estimated_fine: '30.00',
}

beforeEach(() => {
  auth.role = 'SCHOOL_ADMIN'
  server.use(
    http.get('/api/library/books/', () => page([book])),
    http.get('/api/library/config/', () => HttpResponse.json({
      loan_period_days: 14, max_books_student: 3, max_books_staff: 5, fine_per_day: '5.00',
    })),
  )
})

describe('Book catalog', () => {
  it('lists books and categories', async () => {
    renderWithProviders(<BookCatalogPage />)
    expect((await screen.findAllByText('Algebra Made Easy')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('option', { name: 'Science' })).toBeInTheDocument()
  })

  it('creates a category without sending the school field', async () => {
    let body = null
    server.use(
      http.post('/api/library/categories/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 3, school: 1, ...body }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<BookCatalogPage />)
    await user.click(await screen.findByRole('button', { name: 'Manage Categories' }))
    await user.type(await screen.findByLabelText(/category name/i), 'History')
    await user.click(screen.getByRole('button', { name: 'Add Category' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toHaveProperty('name', 'History')
    expect(body).not.toHaveProperty('school')
  })

  it('hides every write action from roles the API refuses', async () => {
    auth.role = 'TEACHER'
    renderWithProviders(<BookCatalogPage />)
    expect((await screen.findAllByText('Algebra Made Easy')).length).toBeGreaterThan(0)
    for (const name of ['Add Book', 'Manage Categories', 'Edit', 'Delete', 'Issue']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('marks Author required and shows the server field error', async () => {
    server.use(
      http.post('/api/library/books/', () => HttpResponse.json({ author: ['This field may not be blank.'] }, { status: 400 })),
    )
    const user = userEvent.setup()
    renderWithProviders(<BookCatalogPage />)
    await user.click(await screen.findByRole('button', { name: 'Add Book' }))
    const author = await screen.findByLabelText(/author/i)
    expect(author).toBeRequired()
    await user.type(await screen.findByLabelText(/^title/i), 'New Book')
    await user.type(author, ' ')
    await user.click(screen.getAllByRole('button', { name: 'Add Book' }).at(-1))
    expect(await screen.findByText(/author/i, { selector: 'div.bg-red-50' })).toBeInTheDocument()
  })

  it('sends the search term to the API', async () => {
    let term = null
    server.use(http.get('/api/library/books/', ({ request }) => {
      term = new URL(request.url).searchParams.get('search')
      return page([book])
    }))
    const user = userEvent.setup()
    renderWithProviders(<BookCatalogPage />)
    await user.type(await screen.findByPlaceholderText(/search by title/i), 'alg')
    await waitFor(() => expect(term).toBe('alg'))
  })

  it('quick issue picks a student by name instead of a typed id', async () => {
    let body = null
    server.use(
      http.get('/api/students/', () => page([{ id: 11, name: 'Usman Raza', roll_number: '2', class_name: 'Class 1 - A' }])),
      http.post('/api/library/issues/', async ({ request }) => {
        body = await request.json()
        return HttpResponse.json({ id: 1, book_title: 'Algebra Made Easy', borrower_name: 'Usman Raza' }, { status: 201 })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<BookCatalogPage />)
    await user.click((await screen.findAllByRole('button', { name: 'Issue' }))[0])
    expect(screen.queryByLabelText(/student id/i)).not.toBeInTheDocument()
    await user.type(await screen.findByPlaceholderText(/student name/i), 'Usm')
    await user.click(await screen.findByText('Usman Raza'))
    await user.click(screen.getByRole('button', { name: 'Issue Book' }))
    await waitFor(() => expect(body).not.toBeNull())
    expect(body).toMatchObject({ book: 9, borrower_type: 'STUDENT', student: 11 })
  })
})

describe('Issue / return', () => {
  it('asks for issued AND overdue books and returns through return_book', async () => {
    let status = null
    let returned = false
    server.use(
      http.get('/api/library/issues/', ({ request }) => {
        status = new URL(request.url).searchParams.get('status')
        return page([overdueIssue])
      }),
      http.post('/api/library/issues/:id/return_book/', () => {
        returned = true
        return HttpResponse.json({ ...overdueIssue, status: 'RETURNED', fine_amount: '30.00' })
      }),
    )
    const user = userEvent.setup()
    renderWithProviders(<BookIssuePage />)
    await user.click(await screen.findByRole('button', { name: 'Return Book' }))
    await user.click((await screen.findAllByRole('button', { name: 'Process Return' }))[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Rs. 30')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Return' }))
    await waitFor(() => expect(returned).toBe(true))
    expect(status).toBe('ISSUED,OVERDUE')
  })

  it('is read-only for a teacher', async () => {
    auth.role = 'TEACHER'
    server.use(http.get('/api/library/issues/', () => page([overdueIssue])))
    renderWithProviders(<BookIssuePage />)
    expect((await screen.findAllByText('World Atlas')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Issue Book' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /return/i })).not.toBeInTheDocument()
  })
})

describe('Overdue books', () => {
  it('shows the server fine and no placeholder reminder button', async () => {
    server.use(http.get('/api/library/issues/overdue/', () => HttpResponse.json([overdueIssue])))
    renderWithProviders(<OverdueBooksPage />)
    expect((await screen.findAllByText('World Atlas')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rs. 30').length).toBeGreaterThan(0)
    expect(screen.queryByText(/send reminder/i)).not.toBeInTheDocument()
  })

  it('does not fetch the admin-only config for a teacher', async () => {
    auth.role = 'TEACHER'
    let configAsked = false
    server.use(
      http.get('/api/library/issues/overdue/', () => HttpResponse.json([overdueIssue])),
      http.get('/api/library/config/', () => { configAsked = true; return HttpResponse.json({}, { status: 403 }) }),
    )
    renderWithProviders(<OverdueBooksPage />)
    expect((await screen.findAllByText('World Atlas')).length).toBeGreaterThan(0)
    expect(configAsked).toBe(false)
    expect(screen.queryByText('Fine Per Day')).not.toBeInTheDocument()
  })
})

describe('Library dashboard', () => {
  it('reads the stats keys the API actually sends', async () => {
    server.use(http.get('/api/library/stats/', () => HttpResponse.json({
      total_books: 12, total_titles: 8, total_copies: 12, total_issued: 4, total_overdue: 2,
      total_categories: 3, total_fine_collected: '0',
      most_issued_books: [{ id: 9, title: 'Algebra Made Easy', author: 'A. Khan', issue_count: 5 }],
    })))
    renderWithProviders(<LibraryDashboard />)
    expect(await screen.findByText('Currently Issued')).toBeInTheDocument()
    const tile = (label) => screen.getAllByText(label, { selector: 'p' })[0].parentElement
    expect(within(tile('Currently Issued')).getByText('4')).toBeInTheDocument()
    expect(within(tile('Overdue Books')).getByText('2')).toBeInTheDocument()
    expect(within(tile('Total Copies')).getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Algebra Made Easy')).toBeInTheDocument()
  })
})
