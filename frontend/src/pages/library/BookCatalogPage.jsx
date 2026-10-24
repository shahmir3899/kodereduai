import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import Field from '../../components/ui/Field'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import EmptyState from '../../components/ui/EmptyState'
import ErrorState from '../../components/ui/ErrorState'
import { libraryApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import { useDebounce } from '../../hooks/useDebounce'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'
import IssueFields, { issuePayload } from './IssueFields'
import { canManageLibrary, defaultDueDate, listOf } from './libraryUtils'

const emptyBookForm = {
  title: '', author: '', isbn: '', publisher: '', category: '',
  total_copies: 1, shelf_location: '', is_active: true,
}

const emptyIssueForm = (loanDays = 14) => ({
  borrower_type: 'STUDENT', borrower: null, due_date: defaultDueDate(loanDays), notes: '', borrowerQuery: '',
})

function ErrorBanner({ error, fallback }) {
  if (!error) return null
  return (
    <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
      {getErrorMessage(error, fallback)}
    </div>
  )
}

function AvailabilityBadge({ book }) {
  if (!book.is_active) return <Badge tone="neutral">Inactive</Badge>
  return <Badge tone={book.available_copies > 0 ? 'success' : 'danger'}>{book.available_copies} avail.</Badge>
}

export default function BookCatalogPage() {
  const { effectiveRole } = useAuth()
  const canManage = canManageLibrary(effectiveRole)
  const queryClient = useQueryClient()
  const toast = useToast()

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [view, setView] = useViewPreference('book-catalog')

  const [showBookModal, setShowBookModal] = useState(false)
  const [editingBook, setEditingBook] = useState(null)
  const [bookForm, setBookForm] = useState(emptyBookForm)

  const [showCategories, setShowCategories] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '' })
  const [deleteCategory, setDeleteCategory] = useState(null)

  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const [issueBook, setIssueBook] = useState(null)
  const [issueForm, setIssueForm] = useState(emptyIssueForm())

  // ---- Queries ----
  const { data: booksData, isLoading, isError, refetch } = useQuery({
    queryKey: ['libraryBooks', debouncedSearch, categoryFilter],
    queryFn: () => libraryApi.getBooks({
      search: debouncedSearch || undefined,
      category: categoryFilter || undefined,
      page_size: 2000,
    }),
  })

  const { data: categoriesData } = useQuery({
    queryKey: ['libraryCategories'],
    queryFn: () => libraryApi.getCategories({ page_size: 2000 }),
  })

  const { data: configRes } = useQuery({
    queryKey: ['libraryConfig'],
    queryFn: () => libraryApi.getFineConfig(),
    enabled: canManage,
  })
  const loanDays = configRes?.data?.loan_period_days || 14

  const books = listOf(booksData)
  const categories = listOf(categoriesData)

  const invalidate = (...keys) => keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }))

  // ---- Close helpers ----
  const closeBookModal = () => { setShowBookModal(false); setEditingBook(null); setBookForm(emptyBookForm) }
  const closeCategories = () => { setShowCategories(false); setEditingCategory(null); setCategoryForm({ name: '', description: '' }) }
  const closeIssueModal = () => { setIssueBook(null); setIssueForm(emptyIssueForm(loanDays)) }

  useEscapeKey(closeBookModal, showBookModal)
  useEscapeKey(closeCategories, showCategories && !deleteCategory)
  useEscapeKey(() => setDeleteConfirm(null), !!deleteConfirm)
  useEscapeKey(() => setDeleteCategory(null), !!deleteCategory)
  useEscapeKey(closeIssueModal, !!issueBook)

  // ---- Mutations ----
  const saveBook = useMutation({
    mutationFn: ({ id, data }) => (id ? libraryApi.updateBook(id, data) : libraryApi.createBook(data)),
    onSuccess: (_res, { id }) => {
      invalidate('libraryBooks', 'bookSearch', 'libraryStats')
      toast.showSuccess(id ? 'Book updated' : 'Book added to the catalog')
      closeBookModal()
    },
  })

  const deleteBook = useMutation({
    mutationFn: (id) => libraryApi.deleteBook(id),
    onSuccess: () => {
      invalidate('libraryBooks', 'bookSearch', 'libraryStats')
      toast.showSuccess('Book deleted')
      setDeleteConfirm(null)
    },
  })

  const saveCategory = useMutation({
    mutationFn: ({ id, data }) => (id ? libraryApi.updateCategory(id, data) : libraryApi.createCategory(data)),
    onSuccess: (_res, { id }) => {
      invalidate('libraryCategories', 'libraryBooks', 'libraryStats')
      toast.showSuccess(id ? 'Category updated' : 'Category added')
      setEditingCategory(null)
      setCategoryForm({ name: '', description: '' })
    },
  })

  const removeCategory = useMutation({
    mutationFn: (id) => libraryApi.deleteCategory(id),
    onSuccess: () => {
      invalidate('libraryCategories', 'libraryBooks', 'libraryStats')
      toast.showSuccess('Category deleted')
      if (categoryFilter === String(deleteCategory?.id)) setCategoryFilter('')
      setDeleteCategory(null)
    },
  })

  const issue = useMutation({
    mutationFn: (data) => libraryApi.createIssue(data),
    onSuccess: (res) => {
      invalidate('libraryBooks', 'bookSearch', 'libraryIssues', 'libraryStats', 'libraryOverdue')
      toast.showSuccess(`Issued "${res.data.book_title}" to ${res.data.borrower_name}`)
      closeIssueModal()
    },
  })

  // ---- Handlers ----
  const openAddBook = () => { saveBook.reset(); setEditingBook(null); setBookForm(emptyBookForm); setShowBookModal(true) }

  const openEditBook = (book) => {
    saveBook.reset()
    setEditingBook(book)
    setBookForm({
      title: book.title || '',
      author: book.author || '',
      isbn: book.isbn || '',
      publisher: book.publisher || '',
      category: book.category ? String(book.category) : '',
      total_copies: book.total_copies || 1,
      shelf_location: book.shelf_location || '',
      is_active: book.is_active,
    })
    setShowBookModal(true)
  }

  const submitBook = (e) => {
    e.preventDefault()
    saveBook.mutate({
      id: editingBook?.id,
      data: {
        ...bookForm,
        category: bookForm.category ? parseInt(bookForm.category, 10) : null,
        total_copies: parseInt(bookForm.total_copies, 10) || 1,
      },
    })
  }

  const submitCategory = (e) => {
    e.preventDefault()
    saveCategory.mutate({ id: editingCategory?.id, data: categoryForm })
  }

  const openIssue = (book) => { issue.reset(); setIssueBook(book); setIssueForm(emptyIssueForm(loanDays)) }

  const submitIssue = (e) => {
    e.preventDefault()
    if (!issueForm.borrower) return toast.showError(`Choose a ${issueForm.borrower_type === 'STAFF' ? 'staff member' : 'student'}`)
    issue.mutate(issuePayload(issueForm, issueBook))
  }

  const setBook = (changes) => setBookForm((f) => ({ ...f, ...changes }))

  const bookActions = (book) => [
    ...(canManage && book.is_active && book.available_copies > 0 ? [{ label: 'Issue', tone: 'amber', onClick: () => openIssue(book) }] : []),
    ...(canManage ? [
      { label: 'Edit', tone: 'info', onClick: () => openEditBook(book) },
      { label: 'Delete', tone: 'danger', onClick: () => { deleteBook.reset(); setDeleteConfirm(book) } },
    ] : []),
  ]

  return (
    <div>
      <PageHeader
        title="Book Catalog"
        subtitle="Browse and manage your library collection"
        className="mb-6"
        actions={canManage ? (
          <>
            <Button variant="secondary" onClick={() => setShowCategories(true)}>Manage Categories</Button>
            <Button onClick={openAddBook}>Add Book</Button>
          </>
        ) : null}
      />

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Search" className="sm:col-span-2">
            <input
              type="text"
              className="input"
              placeholder="Search by title, author, or ISBN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          <Field label="Category">
            <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All Categories</option>
              {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        {isLoading ? (
          <LoadingState label="Loading books..." compact />
        ) : isError ? (
          <ErrorState message="Could not load the book catalog." onRetry={refetch} />
        ) : books.length === 0 ? (
          search || categoryFilter ? (
            <EmptyState title="No books found" description="Try adjusting your search or category." />
          ) : (
            <EmptyState
              title="No books in the catalog yet"
              description={canManage
                ? 'Set up a few categories first, then add your first book.'
                : 'Books will appear here once the library adds them.'}
              action={canManage ? <Button onClick={openAddBook}>Add Book</Button> : null}
            />
          )
        ) : (
          <>
            <div className="flex justify-end p-2">
              <ViewToggle view={view} onChange={setView} />
            </div>

            {view === 'cards' ? (
              <CardGrid className="p-2">
                {books.map((book) => (
                  <RecordCard
                    key={book.id}
                    title={book.title}
                    meta={book.author}
                    status={<AvailabilityBadge book={book} />}
                    fields={[
                      ...(book.isbn ? [{ label: 'ISBN', value: book.isbn, mono: true }] : []),
                      ...(book.category_name ? [{ label: 'Category', value: book.category_name }] : []),
                      ...(book.shelf_location ? [{ label: 'Shelf', value: book.shelf_location }] : []),
                    ]}
                    actions={bookActions(book)}
                  />
                ))}
              </CardGrid>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Title', 'Author', 'ISBN', 'Category'].map((h) => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Available</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shelf</th>
                      {canManage && <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {books.map((book) => {
                      const actions = bookActions(book)
                      return (
                        <tr key={book.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{book.title}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{book.author || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 font-mono">{book.isbn || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{book.category_name || '-'}</td>
                          <td className="px-4 py-3 text-sm text-center text-gray-700">{book.total_copies}</td>
                          <td className="px-4 py-3 text-center"><AvailabilityBadge book={book} /></td>
                          <td className="px-4 py-3 text-sm text-gray-500">{book.shelf_location || '-'}</td>
                          {canManage && (
                            <td className="px-4 py-3 text-right whitespace-nowrap">
                              {actions.map((a) => (
                                <button
                                  key={a.label}
                                  onClick={a.onClick}
                                  className={`text-sm font-medium ml-3 ${
                                    a.tone === 'danger' ? 'text-red-600 hover:text-red-800'
                                      : a.tone === 'amber' ? 'text-amber-600 hover:text-amber-800'
                                        : 'text-blue-600 hover:text-blue-800'
                                  }`}
                                >
                                  {a.label}
                                </button>
                              ))}
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* ============ Add/Edit Book Modal ============ */}
      {showBookModal && (
        <Modal open size="lg" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-4">{editingBook ? 'Edit Book' : 'Add Book'}</h2>
          <ErrorBanner error={saveBook.error} fallback="Failed to save the book." />
          <form onSubmit={submitBook} className="space-y-4">
            <Field label="Title" required>
              <input type="text" required className="input" value={bookForm.title} onChange={(e) => setBook({ title: e.target.value })} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Author" required>
                <input type="text" required className="input" value={bookForm.author} onChange={(e) => setBook({ author: e.target.value })} />
              </Field>
              <Field label="ISBN">
                <input type="text" className="input" value={bookForm.isbn} onChange={(e) => setBook({ isbn: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Publisher">
                <input type="text" className="input" value={bookForm.publisher} onChange={(e) => setBook({ publisher: e.target.value })} />
              </Field>
              <Field label="Category">
                <select className="input" value={bookForm.category} onChange={(e) => setBook({ category: e.target.value })}>
                  <option value="">-- No Category --</option>
                  {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Total Copies" required hint={editingBook ? 'Cannot be lower than the copies currently issued' : undefined}>
                <input type="number" min="1" required className="input" value={bookForm.total_copies} onChange={(e) => setBook({ total_copies: e.target.value })} />
              </Field>
              <Field label="Shelf Location">
                <input type="text" className="input" placeholder="e.g. A-12" value={bookForm.shelf_location} onChange={(e) => setBook({ shelf_location: e.target.value })} />
              </Field>
            </div>
            {editingBook && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={bookForm.is_active} onChange={(e) => setBook({ is_active: e.target.checked })} className="rounded text-blue-600" />
                <span className="text-sm text-gray-700">Active (untick to take it off the shelf without deleting its history)</span>
              </label>
            )}
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button variant="secondary" type="button" onClick={closeBookModal}>Cancel</Button>
              <Button type="submit" loading={saveBook.isPending}>{editingBook ? 'Save Changes' : 'Add Book'}</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ============ Manage Categories Modal ============ */}
      {showCategories && (
        <Modal open size="lg" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-4">Manage Categories</h2>
          <ErrorBanner error={saveCategory.error} fallback="Failed to save the category." />
          <form onSubmit={submitCategory} className="space-y-4">
            <Field label="Category Name" required>
              <input
                type="text"
                required
                className="input"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
              />
            </Field>
            <Field label="Description">
              <textarea
                rows={2}
                className="input"
                value={categoryForm.description}
                onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
              />
            </Field>
            <div className="flex justify-end gap-3">
              {editingCategory && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => { setEditingCategory(null); setCategoryForm({ name: '', description: '' }) }}
                >
                  Cancel Edit
                </Button>
              )}
              <Button type="submit" loading={saveCategory.isPending}>
                {editingCategory ? 'Save Changes' : 'Add Category'}
              </Button>
            </div>
          </form>

          <div className="mt-5">
            <p className="label">Existing Categories</p>
            {categories.length === 0 ? (
              <EmptyState title="No categories yet" compact />
            ) : (
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {categories.map((cat) => (
                  <div key={cat.id} className="flex items-center justify-between px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{cat.name}</p>
                      {cat.description && <p className="text-xs text-gray-500 truncate">{cat.description}</p>}
                    </div>
                    <div className="flex gap-3 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => { saveCategory.reset(); setEditingCategory(cat); setCategoryForm({ name: cat.name, description: cat.description || '' }) }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => { removeCategory.reset(); setDeleteCategory(cat) }}
                        className="text-xs text-red-600 hover:text-red-800 font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end pt-4 mt-4 border-t border-gray-200">
            <Button variant="secondary" type="button" onClick={closeCategories}>Done</Button>
          </div>
        </Modal>
      )}

      {/* ============ Delete Category Confirmation ============ */}
      {deleteCategory && (
        <Modal open size="sm" layer="top" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Category</h2>
          <p className="text-gray-600 mb-6">
            Delete <strong>{deleteCategory.name}</strong>? Its books stay in the catalog without a category.
          </p>
          <ErrorBanner error={removeCategory.error} fallback="Failed to delete the category." />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteCategory(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => removeCategory.mutate(deleteCategory.id)} loading={removeCategory.isPending}>
              Delete
            </Button>
          </div>
        </Modal>
      )}

      {/* ============ Delete Book Confirmation ============ */}
      {deleteConfirm && (
        <Modal open size="sm" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Book</h2>
          <p className="text-gray-600 mb-6">
            Are you sure you want to delete <strong>{deleteConfirm.title}</strong>? This action cannot be undone.
          </p>
          <ErrorBanner error={deleteBook.error} fallback="Failed to delete the book." />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => deleteBook.mutate(deleteConfirm.id)} loading={deleteBook.isPending}>
              Delete
            </Button>
          </div>
        </Modal>
      )}

      {/* ============ Quick Issue Modal ============ */}
      {issueBook && (
        <Modal open size="lg" closeOnBackdrop={false}>
          <h2 className="text-xl font-bold text-gray-900 mb-1">Issue Book</h2>
          <p className="text-sm text-gray-500 mb-4">
            Issuing: <span className="font-medium text-gray-700">{issueBook.title}</span>
          </p>
          <ErrorBanner error={issue.error} fallback="Failed to issue the book." />
          <form onSubmit={submitIssue} className="space-y-4">
            <IssueFields form={issueForm} setForm={setIssueForm} fixedBook={issueBook} />
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <Button variant="secondary" type="button" onClick={closeIssueModal}>Cancel</Button>
              <Button type="submit" loading={issue.isPending}>Issue Book</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
