import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { lmsApi, academicsApi } from '../../services/api'
import api from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import RTLWrapper, { isRTLLanguage } from '../../components/RTLWrapper'

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'Urdu' },
  { value: 'ar', label: 'Arabic' },
  { value: 'sd', label: 'Sindhi' },
  { value: 'ps', label: 'Pashto' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'other', label: 'Other' },
]

const EMPTY_BOOK_FORM = {
  title: '',
  author: '',
  publisher: '',
  edition: '',
  language: 'en',
  description: '',
}

const EMPTY_CHAPTER_FORM = {
  title: '',
  chapter_number: 1,
  description: '',
}

const EMPTY_TOPIC_FORM = {
  title: '',
  topic_number: 1,
  estimated_periods: 1,
  description: '',
}

export default function CurriculumPage() {
  const { activeSchool } = useAuth()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  // Filters
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')

  // Selected book
  const [selectedBookId, setSelectedBookId] = useState(null)

  // Expanded chapters in tree view
  const [expandedChapters, setExpandedChapters] = useState(new Set())

  // Modals
  const [showBookModal, setShowBookModal] = useState(false)
  const [editingBook, setEditingBook] = useState(null)
  const [bookForm, setBookForm] = useState({ ...EMPTY_BOOK_FORM })

  const [showChapterModal, setShowChapterModal] = useState(false)
  const [editingChapter, setEditingChapter] = useState(null)
  const [chapterForm, setChapterForm] = useState({ ...EMPTY_CHAPTER_FORM })

  const [showTopicModal, setShowTopicModal] = useState(false)
  const [editingTopic, setEditingTopic] = useState(null)
  const [topicParentChapterId, setTopicParentChapterId] = useState(null)
  const [topicForm, setTopicForm] = useState({ ...EMPTY_TOPIC_FORM })

  const [showTocModal, setShowTocModal] = useState(false)
  const [tocText, setTocText] = useState('')

  // ---- Queries ----

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => api.get('/api/classes/', { params: { page_size: 9999 } }),
  })

  const { data: subjectsData } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => academicsApi.getSubjects({ page_size: 9999 }),
  })

  const classes = classesData?.data?.results || classesData?.data || []
  const subjects = subjectsData?.data?.results || subjectsData?.data || []

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['lmsBooks', selectedClass, selectedSubject],
    queryFn: () => lmsApi.getBooks({ class_id: selectedClass, subject_id: selectedSubject }),
    enabled: !!selectedClass && !!selectedSubject,
  })

  const books = booksData?.data?.results || booksData?.data || []

  const { data: bookTreeData, isLoading: treeLoading } = useQuery({
    queryKey: ['lmsBookTree', selectedBookId],
    queryFn: () => lmsApi.getBookTree(selectedBookId),
    enabled: !!selectedBookId,
  })

  const bookTree = bookTreeData?.data || null

  const { data: progressData } = useQuery({
    queryKey: ['syllabusProgress', selectedClass, selectedSubject],
    queryFn: () => lmsApi.getSyllabusProgress({ class_id: selectedClass, subject_id: selectedSubject }),
    enabled: !!selectedClass && !!selectedSubject,
  })

  const progress = progressData?.data || null

  // ---- Book Mutations ----

  const createBookMutation = useMutation({
    mutationFn: (data) => lmsApi.createBook(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBooks'] })
      closeBookModal()
      showSuccess('Book created')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || error.response?.data?.title?.[0] || 'Failed to create book')
    },
  })

  const updateBookMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.updateBook(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBooks'] })
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      closeBookModal()
      showSuccess('Book updated')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to update book')
    },
  })

  const deleteBookMutation = useMutation({
    mutationFn: (id) => lmsApi.deleteBook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBooks'] })
      if (selectedBookId === deleteBookMutation.variables) {
        setSelectedBookId(null)
      }
      showSuccess('Book deleted')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete book')
    },
  })

  // ---- Chapter Mutations ----

  const createChapterMutation = useMutation({
    mutationFn: (data) => lmsApi.createChapter(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      closeChapterModal()
      showSuccess('Chapter created')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to create chapter')
    },
  })

  const updateChapterMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.updateChapter(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      closeChapterModal()
      showSuccess('Chapter updated')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to update chapter')
    },
  })

  const deleteChapterMutation = useMutation({
    mutationFn: (id) => lmsApi.deleteChapter(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      showSuccess('Chapter deleted')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete chapter')
    },
  })

  // ---- Topic Mutations ----

  const createTopicMutation = useMutation({
    mutationFn: (data) => lmsApi.createTopic(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      closeTopicModal()
      showSuccess('Topic created')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to create topic')
    },
  })

  const updateTopicMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.updateTopic(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      closeTopicModal()
      showSuccess('Topic updated')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to update topic')
    },
  })

  const deleteTopicMutation = useMutation({
    mutationFn: (id) => lmsApi.deleteTopic(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      showSuccess('Topic deleted')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete topic')
    },
  })

  // ---- TOC Mutation ----

  const bulkTocMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.bulkTOC(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      closeTocModal()
      showSuccess('Table of contents imported')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to import table of contents')
    },
  })

  // ---- Modal Handlers ----

  const openAddBook = () => {
    setEditingBook(null)
    setBookForm({ ...EMPTY_BOOK_FORM })
    setShowBookModal(true)
  }

  const openEditBook = (book) => {
    setEditingBook(book)
    setBookForm({
      title: book.title || '',
      author: book.author || '',
      publisher: book.publisher || '',
      edition: book.edition || '',
      language: book.language || 'en',
      description: book.description || '',
    })
    setShowBookModal(true)
  }

  const closeBookModal = () => {
    setShowBookModal(false)
    setEditingBook(null)
    setBookForm({ ...EMPTY_BOOK_FORM })
  }

  const openAddChapter = () => {
    setEditingChapter(null)
    const chapters = bookTree?.chapters || []
    setChapterForm({
      ...EMPTY_CHAPTER_FORM,
      chapter_number: chapters.length + 1,
    })
    setShowChapterModal(true)
  }

  const openEditChapter = (chapter) => {
    setEditingChapter(chapter)
    setChapterForm({
      title: chapter.title || '',
      chapter_number: chapter.chapter_number || 1,
      description: chapter.description || '',
    })
    setShowChapterModal(true)
  }

  const closeChapterModal = () => {
    setShowChapterModal(false)
    setEditingChapter(null)
    setChapterForm({ ...EMPTY_CHAPTER_FORM })
  }

  const openAddTopic = (chapterId, existingTopics) => {
    setEditingTopic(null)
    setTopicParentChapterId(chapterId)
    setTopicForm({
      ...EMPTY_TOPIC_FORM,
      topic_number: (existingTopics?.length || 0) + 1,
    })
    setShowTopicModal(true)
  }

  const openEditTopic = (topic, chapterId) => {
    setEditingTopic(topic)
    setTopicParentChapterId(chapterId)
    setTopicForm({
      title: topic.title || '',
      topic_number: topic.topic_number || 1,
      estimated_periods: topic.estimated_periods || 1,
      description: topic.description || '',
    })
    setShowTopicModal(true)
  }

  const closeTopicModal = () => {
    setShowTopicModal(false)
    setEditingTopic(null)
    setTopicParentChapterId(null)
    setTopicForm({ ...EMPTY_TOPIC_FORM })
  }

  const openTocModal = () => {
    setTocText('')
    setShowTocModal(true)
  }

  const closeTocModal = () => {
    setShowTocModal(false)
    setTocText('')
  }

  // ---- Submit Handlers ----

  const handleBookSubmit = () => {
    if (!bookForm.title) {
      showError('Title is required')
      return
    }
    const payload = {
      ...bookForm,
      school: activeSchool?.id,
      class_obj: parseInt(selectedClass),
      subject: parseInt(selectedSubject),
    }
    if (editingBook) {
      updateBookMutation.mutate({ id: editingBook.id, data: payload })
    } else {
      createBookMutation.mutate(payload)
    }
  }

  const handleChapterSubmit = () => {
    if (!chapterForm.title) {
      showError('Title is required')
      return
    }
    const payload = {
      ...chapterForm,
      book: selectedBookId,
      chapter_number: parseInt(chapterForm.chapter_number) || 1,
    }
    if (editingChapter) {
      updateChapterMutation.mutate({ id: editingChapter.id, data: payload })
    } else {
      createChapterMutation.mutate(payload)
    }
  }

  const handleTopicSubmit = () => {
    if (!topicForm.title) {
      showError('Title is required')
      return
    }
    const payload = {
      ...topicForm,
      chapter: topicParentChapterId,
      topic_number: parseInt(topicForm.topic_number) || 1,
      estimated_periods: parseInt(topicForm.estimated_periods) || 1,
    }
    if (editingTopic) {
      updateTopicMutation.mutate({ id: editingTopic.id, data: payload })
    } else {
      createTopicMutation.mutate(payload)
    }
  }

  const handleTocSubmit = () => {
    if (!tocText.trim()) {
      showError('Please paste a table of contents')
      return
    }
    bulkTocMutation.mutate({ id: selectedBookId, data: { toc_text: tocText } })
  }

  const handleDeleteBook = (book) => {
    if (window.confirm(`Delete "${book.title}"? This action cannot be undone.`)) {
      deleteBookMutation.mutate(book.id)
    }
  }

  const handleDeleteChapter = (chapter) => {
    if (window.confirm(`Delete "Ch ${chapter.chapter_number}: ${chapter.title}"? This will also delete all topics in this chapter.`)) {
      deleteChapterMutation.mutate(chapter.id)
    }
  }

  const handleDeleteTopic = (topic) => {
    if (window.confirm(`Delete topic "${topic.title}"? This action cannot be undone.`)) {
      deleteTopicMutation.mutate(topic.id)
    }
  }

  // ---- Accordion ----

  const toggleChapter = (chapterId) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(chapterId)) {
        next.delete(chapterId)
      } else {
        next.add(chapterId)
      }
      return next
    })
  }

  // ---- Helpers ----

  const getLanguageLabel = (code) => {
    const lang = LANGUAGES.find((l) => l.value === code)
    return lang ? lang.label : code
  }

  const isRTL = (code) => isRTLLanguage(code)

  const bookMutationPending = createBookMutation.isPending || updateBookMutation.isPending
  const chapterMutationPending = createChapterMutation.isPending || updateChapterMutation.isPending
  const topicMutationPending = createTopicMutation.isPending || updateTopicMutation.isPending

  const filtersSelected = selectedClass && selectedSubject

  // Compute progress percentage
  const progressPercent = progress?.total_topics > 0
    ? Math.round((progress.covered_topics / progress.total_topics) * 100)
    : 0

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Curriculum Management</h1>
          <p className="text-sm text-gray-600">Manage books, chapters, and topics for your classes</p>
        </div>
        {filtersSelected && (
          <button onClick={openAddBook} className="btn btn-primary">
            Add Book
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <div>
            <label className="label">Class</label>
            <select
              className="input"
              value={selectedClass}
              onChange={(e) => {
                setSelectedClass(e.target.value)
                setSelectedBookId(null)
              }}
            >
              <option value="">Select Class</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Subject</label>
            <select
              className="input"
              value={selectedSubject}
              onChange={(e) => {
                setSelectedSubject(e.target.value)
                setSelectedBookId(null)
              }}
            >
              <option value="">Select Subject</option>
              {subjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {sub.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main content */}
      {!filtersSelected ? (
        <div className="card">
          <div className="text-center py-12 text-gray-500">
            Select a class and subject to view curriculum books
          </div>
        </div>
      ) : booksLoading ? (
        <div className="card">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading books...</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Book List */}
          <div className="lg:col-span-1">
            <div className="space-y-3">
              {books.length === 0 ? (
                <div className="card">
                  <div className="text-center py-8 text-gray-500">
                    No books found. Add a book to get started.
                  </div>
                </div>
              ) : (
                books.map((book) => (
                  <div
                    key={book.id}
                    onClick={() => setSelectedBookId(book.id)}
                    className={`card cursor-pointer transition-all hover:shadow-md ${
                      selectedBookId === book.id
                        ? 'ring-2 ring-primary-500 border-primary-500'
                        : 'hover:border-gray-300'
                    }`}
                  >
                    <RTLWrapper language={book.language}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-gray-900 truncate">{book.title}</p>
                          {book.author && (
                            <p className="text-sm text-gray-500 mt-0.5">{book.author}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {isRTL(book.language) && (
                            <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                              RTL
                            </span>
                          )}
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            {getLanguageLabel(book.language)}
                          </span>
                        </div>
                      </div>
                    </RTLWrapper>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
                      <span className="text-xs text-gray-500">
                        {book.chapter_count ?? book.chapters?.length ?? 0} chapters
                      </span>
                      <div className="flex gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            openEditBook(book)
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteBook(book)
                          }}
                          className="text-xs text-red-600 hover:text-red-800 font-medium"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right: Book Detail (Tree View) */}
          <div className="lg:col-span-2">
            {!selectedBookId ? (
              <div className="card">
                <div className="text-center py-12 text-gray-500">
                  Select a book to view its chapters and topics
                </div>
              </div>
            ) : treeLoading ? (
              <div className="card">
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                  <p className="text-gray-500 mt-2">Loading book details...</p>
                </div>
              </div>
            ) : bookTree ? (
              <div className="card">
                {/* Book metadata */}
                <RTLWrapper language={bookTree.language}>
                  <div className="mb-4">
                    <h2 className="text-lg font-bold text-gray-900">{bookTree.title}</h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-gray-500">
                      {bookTree.author && <span>Author: {bookTree.author}</span>}
                      {bookTree.publisher && <span>Publisher: {bookTree.publisher}</span>}
                      {bookTree.edition && <span>Edition: {bookTree.edition}</span>}
                      <span>Language: {getLanguageLabel(bookTree.language)}</span>
                    </div>
                    {bookTree.description && (
                      <p className="text-sm text-gray-600 mt-2">{bookTree.description}</p>
                    )}
                  </div>
                </RTLWrapper>

                {/* Syllabus progress */}
                {progress && progress.total_topics > 0 && (
                  <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-gray-700">Syllabus Progress</span>
                      <span className="text-gray-600">
                        {progress.covered_topics} / {progress.total_topics} topics ({progressPercent}%)
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-green-500 h-2 rounded-full transition-all"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 mb-4">
                  <button onClick={openTocModal} className="btn btn-secondary text-sm">
                    Import TOC
                  </button>
                  <button onClick={openAddChapter} className="btn btn-primary text-sm">
                    Add Chapter
                  </button>
                </div>

                {/* Chapters accordion */}
                <div className="space-y-2">
                  {(!bookTree.chapters || bookTree.chapters.length === 0) ? (
                    <div className="text-center py-6 text-gray-500 text-sm">
                      No chapters yet. Add a chapter or import a table of contents.
                    </div>
                  ) : (
                    bookTree.chapters.map((chapter) => {
                      const isExpanded = expandedChapters.has(chapter.id)
                      const topics = chapter.topics || []
                      return (
                        <div key={chapter.id} className="border border-gray-200 rounded-lg overflow-hidden">
                          {/* Chapter header */}
                          <div
                            className="flex items-center justify-between px-4 py-3 bg-gray-50 cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => toggleChapter(chapter.id)}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <svg
                                className={`w-4 h-4 text-gray-500 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className="font-medium text-gray-900 truncate">
                                Ch {chapter.chapter_number}: {chapter.title}
                              </span>
                              <span className="text-xs text-gray-500 flex-shrink-0">
                                ({topics.length} {topics.length === 1 ? 'topic' : 'topics'})
                              </span>
                            </div>
                            <div className="flex gap-2 flex-shrink-0 ml-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  openEditChapter(chapter)
                                }}
                                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDeleteChapter(chapter)
                                }}
                                className="text-xs text-red-600 hover:text-red-800 font-medium"
                              >
                                Delete
                              </button>
                            </div>
                          </div>

                          {/* Chapter content (topics) */}
                          {isExpanded && (
                            <div className="px-4 py-2 bg-white">
                              {chapter.description && (
                                <p className="text-sm text-gray-500 mb-2 italic">{chapter.description}</p>
                              )}
                              {topics.length === 0 ? (
                                <p className="text-sm text-gray-400 py-2">No topics in this chapter.</p>
                              ) : (
                                <div className="space-y-1">
                                  {topics.map((topic) => (
                                    <div
                                      key={topic.id}
                                      className="flex items-center justify-between py-2 px-3 rounded hover:bg-gray-50 group"
                                    >
                                      <div className="flex items-center gap-2 min-w-0 flex-1">
                                        {topic.is_covered ? (
                                          <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                          </svg>
                                        ) : (
                                          <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
                                        )}
                                        <span className={`text-sm truncate ${topic.is_covered ? 'text-gray-500' : 'text-gray-900'}`}>
                                          {topic.topic_number}. {topic.title}
                                        </span>
                                        {topic.estimated_periods && (
                                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 flex-shrink-0">
                                            {topic.estimated_periods} {topic.estimated_periods === 1 ? 'period' : 'periods'}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex gap-2 flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => openEditTopic(topic, chapter.id)}
                                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          onClick={() => handleDeleteTopic(topic)}
                                          className="text-xs text-red-600 hover:text-red-800 font-medium"
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <button
                                onClick={() => openAddTopic(chapter.id, topics)}
                                className="mt-2 mb-1 text-sm text-primary-600 hover:text-primary-800 font-medium flex items-center gap-1"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Add Topic
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* ============ Book Form Modal ============ */}
      {showBookModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingBook ? 'Edit Book' : 'Add Book'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">Title *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Mathematics Grade 5"
                  dir={isRTL(bookForm.language) ? 'rtl' : 'ltr'}
                  value={bookForm.title}
                  onChange={(e) => setBookForm({ ...bookForm, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Author</label>
                  <input
                    type="text"
                    className="input"
                    value={bookForm.author}
                    onChange={(e) => setBookForm({ ...bookForm, author: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Publisher</label>
                  <input
                    type="text"
                    className="input"
                    value={bookForm.publisher}
                    onChange={(e) => setBookForm({ ...bookForm, publisher: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Edition</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., 3rd Edition"
                    value={bookForm.edition}
                    onChange={(e) => setBookForm({ ...bookForm, edition: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Language</label>
                  <select
                    className="input"
                    value={bookForm.language}
                    onChange={(e) => setBookForm({ ...bookForm, language: e.target.value })}
                  >
                    {LANGUAGES.map((lang) => (
                      <option key={lang.value} value={lang.value}>
                        {lang.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  dir={isRTL(bookForm.language) ? 'rtl' : 'ltr'}
                  placeholder="Brief description of the book..."
                  value={bookForm.description}
                  onChange={(e) => setBookForm({ ...bookForm, description: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeBookModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleBookSubmit}
                disabled={bookMutationPending}
                className="btn btn-primary"
              >
                {bookMutationPending ? 'Saving...' : editingBook ? 'Save Changes' : 'Add Book'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ Chapter Form Modal ============ */}
      {showChapterModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingChapter ? 'Edit Chapter' : 'Add Chapter'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">Title *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Introduction to Algebra"
                  value={chapterForm.title}
                  onChange={(e) => setChapterForm({ ...chapterForm, title: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Chapter Number</label>
                <input
                  type="number"
                  className="input"
                  min="1"
                  value={chapterForm.chapter_number}
                  onChange={(e) => setChapterForm({ ...chapterForm, chapter_number: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Brief description of this chapter..."
                  value={chapterForm.description}
                  onChange={(e) => setChapterForm({ ...chapterForm, description: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeChapterModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleChapterSubmit}
                disabled={chapterMutationPending}
                className="btn btn-primary"
              >
                {chapterMutationPending ? 'Saving...' : editingChapter ? 'Save Changes' : 'Add Chapter'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ Topic Form Modal ============ */}
      {showTopicModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingTopic ? 'Edit Topic' : 'Add Topic'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">Title *</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Linear Equations"
                  value={topicForm.title}
                  onChange={(e) => setTopicForm({ ...topicForm, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Topic Number</label>
                  <input
                    type="number"
                    className="input"
                    min="1"
                    value={topicForm.topic_number}
                    onChange={(e) => setTopicForm({ ...topicForm, topic_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Estimated Periods</label>
                  <input
                    type="number"
                    className="input"
                    min="1"
                    value={topicForm.estimated_periods}
                    onChange={(e) => setTopicForm({ ...topicForm, estimated_periods: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Brief description of this topic..."
                  value={topicForm.description}
                  onChange={(e) => setTopicForm({ ...topicForm, description: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeTopicModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleTopicSubmit}
                disabled={topicMutationPending}
                className="btn btn-primary"
              >
                {topicMutationPending ? 'Saving...' : editingTopic ? 'Save Changes' : 'Add Topic'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============ TOC Import Modal ============ */}
      {showTocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Import Table of Contents</h2>
            <p className="text-sm text-gray-500 mb-4">
              Paste the table of contents below. Each line should represent a chapter or topic.
              The system will parse the structure automatically.
            </p>

            <div>
              <textarea
                className="input font-mono text-sm"
                rows={12}
                placeholder={"Chapter 1: Introduction\n  1.1 Overview\n  1.2 Background\nChapter 2: Fundamentals\n  2.1 Key Concepts\n  2.2 Applications"}
                value={tocText}
                onChange={(e) => setTocText(e.target.value)}
              />
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeTocModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleTocSubmit}
                disabled={bulkTocMutation.isPending}
                className="btn btn-primary"
              >
                {bulkTocMutation.isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
