import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { libraryApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useDebounce } from '../../hooks/useDebounce'

const emptyBookForm = {
  title: '',
  author: '',
  isbn: '',
  publisher: '',
  category: '',
  total_copies: 1,
  shelf_location: '',
}

const emptyCategoryForm = {
  name: '',
  description: '',
}

export default function BookCatalogPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Filters
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [categoryFilter, setCategoryFilter] = useState('')

  // Book modal
  const [showBookModal, setShowBookModal] = useState(false)
  const [editingBook, setEditingBook] = useState(null)
  const [bookForm, setBookForm] = useState(emptyBookForm)

  // Category modal
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm)

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  // Issue modal (quick issue from catalog)
  const [showIssueModal, setShowIssueModal] = useState(false)
  const [issueBook, setIssueBook] = useState(null)
  const [issueForm, setIssueForm] = useState({
    borrower_type: 'STUDENT',
    borrower_id: '',
    due_date: '',
    notes: '',
  })

  // ---- Queries ----

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['libraryBooks', debouncedSearch, categoryFilter],
    queryFn: () => libraryApi.getBooks({
      search: debouncedSearch || undefined,
      category: categoryFilter || undefined,
      page_size: 9999,
    }),
  })

  const { data: categoriesData } = useQuery({
    queryKey: ['libraryCategories'],
    queryFn: () => libraryApi.getCategories({ page_size: 9999 }),
  })

  const books = booksData?.data?.results || booksData?.data || []
  const categories = categoriesData?.data?.results || categoriesData?.data || []

  // ---- Book Mutations ----

  const createBookMutation = useMutation({
    mutationFn: (data) => libraryApi.createBook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryBooks'] })
      queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      closeBookModal()
    },
  })

  const updateBookMutation = useMutation({
    mutationFn: ({ id, data }) => libraryApi.updateBook(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryBooks'] })
      queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      closeBookModal()
    },
  })

  const deleteBookMutation = useMutation({
    mutationFn: (id) => libraryApi.deleteBook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryBooks'] })
      queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      setDeleteConfirm(null)
    },
  })

  // ---- Category Mutations ----

  const createCategoryMutation = useMutation({
    mutationFn: (data) => libraryApi.createCategory(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryCategories'] })
      queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      closeCategoryModal()
    },
  })

  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, data }) => libraryApi.updateCategory(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryCategories'] })
      closeCategoryModal()
    },
  })

  // ---- Issue Mutation (quick issue) ----

  const createIssueMutation = useMutation({
    mutationFn: (data) => libraryApi.createIssue(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['libraryBooks'] })
      queryClient.invalidateQueries({ queryKey: ['libraryIssues'] })
      queryClient.invalidateQueries({ queryKey: ['libraryStats'] })
      closeIssueModal()
    },
  })

  // ---- Modal Handlers ----

  const openAddBook = () => {
    setEditingBook(null)
    setBookForm(emptyBookForm)
    setShowBookModal(true)
  }

  const openEditBook = (book) => {
    setEditingBook(book)
    setBookForm({
      title: book.title || '',
      author: book.author || '',
      isbn: book.isbn || '',
      publisher: book.publisher || '',
      category: book.category?.toString() || book.category_id?.toString() || '',
      total_copies: book.total_copies || 1,
      shelf_location: book.shelf_location || '',
    })
    setShowBookModal(true)
  }

  const closeBookModal = () => {
    setShowBookModal(false)
    setEditingBook(null)
    setBookForm(emptyBookForm)
  }

  const openAddCategory = () => {
    setEditingCategory(null)
    setCategoryForm(emptyCategoryForm)
    setShowCategoryModal(true)
  }

  const openEditCategory = (cat) => {
    setEditingCategory(cat)
    setCategoryForm({ name: cat.name || '', description: cat.description || '' })
    setShowCategoryModal(true)
  }

  const closeCategoryModal = () => {
    setShowCategoryModal(false)
    setEditingCategory(null)
    setCategoryForm(emptyCategoryForm)
  }

  const openIssueModal = (book) => {
    setIssueBook(book)
    const defaultDue = new Date()
    defaultDue.setDate(defaultDue.getDate() + 14)
    setIssueForm({
      borrower_type: 'STUDENT',
      borrower_id: '',
      due_date: defaultDue.toISOString().split('T')[0],
      notes: '',
    })
    setShowIssueModal(true)
  }

  const closeIssueModal = () => {
    setShowIssueModal(false)
    setIssueBook(null)
    setIssueForm({ borrower_type: 'STUDENT', borrower_id: '', due_date: '', notes: '' })
  }

  // ---- Submit Handlers ----

  const handleBookSubmit = (e) => {
    e.preventDefault()
    const payload = {
      ...bookForm,
      category: bookForm.category ? parseInt(bookForm.category) : null,
      total_copies: parseInt(bookForm.total_copies) || 1,
    }
    if (editingBook) {
      updateBookMutation.mutate({ id: editingBook.id, data: payload })
    } else {
      createBookMutation.mutate(payload)
    }
  }

  const handleCategorySubmit = (e) => {
    e.preventDefault()
    if (editingCategory) {
      updateCategoryMutation.mutate({ id: editingCategory.id, data: categoryForm })
    } else {
      createCategoryMutation.mutate(categoryForm)
    }
  }

  const handleIssueSubmit = (e) => {
    e.preventDefault()
    createIssueMutation.mutate({
      book: issueBook.id,
      borrower_type: issueForm.borrower_type,
      borrower_id: parseInt(issueForm.borrower_id),
      due_date: issueForm.due_date,
      notes: issueForm.notes,
    })
  }

  const mutationError = createBookMutation.error || updateBookMutation.error
  const bookMutationPending = createBookMutation.isPending || updateBookMutation.isPending
  const catMutationError = createCategoryMutation.error || updateCategoryMutation.error
  const catMutationPending = createCategoryMutation.isPending || updateCategoryMutation.isPending

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Book Catalog</h1>
          <p className="text-sm sm:text-base text-gray-600">Browse and manage your library collection</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={openAddCategory} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">
            Manage Categories
          </button>
          <button onClick={openAddBook} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors">
            Add Book
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Search</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Search by title, author, or ISBN..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Category</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Books Table */}
      <div className="bg-white rounded-lg shadow-sm">
        {booksLoading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-gray-500 mt-3">Loading books...</p>
          </div>
        ) : books.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-gray-500 font-medium">No books found</p>
            <p className="text-gray-400 text-sm mt-1">
              {search || categoryFilter ? 'Try adjusting your filters.' : 'Add your first book to get started.'}
            </p>
          </div>
        ) : (
          <>
            {/* Mobile card view */}
            <div className="sm:hidden divide-y divide-gray-200">
              {books.map((book) => {
                const available = (book.available_copies ?? (book.total_copies - (book.issued_copies || 0)))
                return (
                  <div key={book.id} className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm text-gray-900 truncate">{book.title}</p>
                        <p className="text-xs text-gray-500">{book.author}</p>
                      </div>
                      <span className={`flex-shrink-0 ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                        available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {available} avail.
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 space-y-0.5">
                      {book.isbn && <p>ISBN: {book.isbn}</p>}
                      {book.category_name && <p>Category: {book.category_name}</p>}
                      {book.shelf_location && <p>Shelf: {book.shelf_location}</p>}
                    </div>
                    <div className="flex gap-3 mt-3 pt-2 border-t border-gray-100">
                      {available > 0 && (
                        <button onClick={() => openIssueModal(book)} className="text-xs text-amber-600 font-medium">Issue</button>
                      )}
                      <button onClick={() => openEditBook(book)} className="text-xs text-blue-600 font-medium">Edit</button>
                      <button onClick={() => setDeleteConfirm(book)} className="text-xs text-red-600 font-medium">Delete</button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Author</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ISBN</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Publisher</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Category</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Available</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Shelf</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {books.map((book) => {
                    const available = (book.available_copies ?? (book.total_copies - (book.issued_copies || 0)))
                    return (
                      <tr key={book.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{book.title}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{book.author || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 font-mono">{book.isbn || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{book.publisher || '-'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500">{book.category_name || '-'}</td>
                        <td className="px-4 py-3 text-sm text-center text-gray-700">{book.total_copies}</td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${
                            available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {available}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500">{book.shelf_location || '-'}</td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {available > 0 && (
                            <button
                              onClick={() => openIssueModal(book)}
                              className="text-sm text-amber-600 hover:text-amber-800 font-medium mr-3"
                            >
                              Issue
                            </button>
                          )}
                          <button
                            onClick={() => openEditBook(book)}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(book)}
                            className="text-sm text-red-600 hover:text-red-800 font-medium"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ============ Add/Edit Book Modal ============ */}
      {showBookModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingBook ? 'Edit Book' : 'Add Book'}
            </h2>

            {mutationError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {mutationError.response?.data?.detail || mutationError.message || 'An error occurred.'}
              </div>
            )}

            <form onSubmit={handleBookSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Title *</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={bookForm.title}
                  onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Author</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={bookForm.author}
                    onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">ISBN</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={bookForm.isbn}
                    onChange={(e) => setBookForm({ ...bookForm, isbn: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Publisher</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={bookForm.publisher}
                    onChange={(e) => setBookForm({ ...bookForm, publisher: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Category</label>
                  <select
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={bookForm.category}
                    onChange={(e) => setBookForm({ ...bookForm, category: e.target.value })}
                  >
                    <option value="">-- No Category --</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Total Copies *</label>
                  <input
                    type="number"
                    min="1"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    value={bookForm.total_copies}
                    onChange={(e) => setBookForm({ ...bookForm, total_copies: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Shelf Location</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g. A-12"
                    value={bookForm.shelf_location}
                    onChange={(e) => setBookForm({ ...bookForm, shelf_location: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeBookModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bookMutationPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bookMutationPending ? 'Saving...' : (editingBook ? 'Save Changes' : 'Add Book')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Add/Edit Category Modal ============ */}
      {showCategoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingCategory ? 'Edit Category' : 'Add Category'}
            </h2>

            {catMutationError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {catMutationError.response?.data?.detail || catMutationError.message || 'An error occurred.'}
              </div>
            )}

            <form onSubmit={handleCategorySubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Category Name *</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Description</label>
                <textarea
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                />
              </div>

              {/* Existing categories list */}
              {categories.length > 0 && !editingCategory && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Existing Categories</label>
                  <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {categories.map((cat) => (
                      <div key={cat.id} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{cat.name}</p>
                          {cat.description && <p className="text-xs text-gray-500">{cat.description}</p>}
                        </div>
                        <button
                          type="button"
                          onClick={() => openEditCategory(cat)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeCategoryModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={catMutationPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {catMutationPending ? 'Saving...' : (editingCategory ? 'Save Changes' : 'Add Category')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============ Delete Confirmation Modal ============ */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Book</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.title}</strong>?
              This action cannot be undone.
            </p>

            {deleteBookMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {deleteBookMutation.error.response?.data?.detail || deleteBookMutation.error.message || 'Failed to delete.'}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteBookMutation.mutate(deleteConfirm.id)}
                disabled={deleteBookMutation.isPending}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleteBookMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ Quick Issue Book Modal ============ */}
      {showIssueModal && issueBook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Issue Book</h2>
            <p className="text-sm text-gray-500 mb-4">
              Issuing: <span className="font-medium text-gray-700">{issueBook.title}</span>
            </p>

            {createIssueMutation.error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                {createIssueMutation.error.response?.data?.detail || createIssueMutation.error.message || 'Failed to issue book.'}
              </div>
            )}

            <form onSubmit={handleIssueSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-2">Borrower Type</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="borrower_type"
                      value="STUDENT"
                      checked={issueForm.borrower_type === 'STUDENT'}
                      onChange={(e) => setIssueForm({ ...issueForm, borrower_type: e.target.value, borrower_id: '' })}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Student</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="borrower_type"
                      value="STAFF"
                      checked={issueForm.borrower_type === 'STAFF'}
                      onChange={(e) => setIssueForm({ ...issueForm, borrower_type: e.target.value, borrower_id: '' })}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">Staff</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">
                  {issueForm.borrower_type === 'STUDENT' ? 'Student' : 'Staff'} ID *
                </label>
                <input
                  type="number"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={`Enter ${issueForm.borrower_type === 'STUDENT' ? 'student' : 'staff'} ID`}
                  value={issueForm.borrower_id}
                  onChange={(e) => setIssueForm({ ...issueForm, borrower_id: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Due Date *</label>
                <input
                  type="date"
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={issueForm.due_date}
                  onChange={(e) => setIssueForm({ ...issueForm, due_date: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Notes</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  value={issueForm.notes}
                  onChange={(e) => setIssueForm({ ...issueForm, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={closeIssueModal}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createIssueMutation.isPending}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {createIssueMutation.isPending ? 'Issuing...' : 'Issue Book'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
