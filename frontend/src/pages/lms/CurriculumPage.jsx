import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactCrop from 'react-image-crop'
import 'react-image-crop/dist/ReactCrop.css'
import { lmsApi, academicsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import RTLWrapper, { isRTLLanguage } from '../../components/RTLWrapper'
import ClassSelector from '../../components/ClassSelector'
import SubjectSelector from '../../components/SubjectSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'

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

const parseOcrLinesFromText = (text) => {
  return (text || '')
    .split('\n')
    .map((line, index) => ({
      id: `line-${index + 1}`,
      line_number: index + 1,
      text: (line || '').trim(),
      confidence: 0,
      mappedAs: null,
      mappedNumber: null,
    }))
    .filter((line) => !!line.text)
}

const createDefaultPerspectiveCorners = () => ({
  tl: { x: 0.08, y: 0.08 },
  tr: { x: 0.92, y: 0.08 },
  br: { x: 0.92, y: 0.92 },
  bl: { x: 0.08, y: 0.92 },
})

export default function CurriculumPage() {
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const navigate = useNavigate()

  // Filters
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedSelectedClass = getResolvedMasterClassId(selectedClass, activeAcademicYear?.id, sessionClasses)

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
  const [tocMode, setTocMode] = useState('paste')
  const [tocStep, setTocStep] = useState('input')
  const [tocChapters, setTocChapters] = useState([])
  const [tocSuggestionItems, setTocSuggestionItems] = useState([])
  const [tocWarnings, setTocWarnings] = useState([])
  const [tocSuggestionMeta, setTocSuggestionMeta] = useState(null)
  const [tocImageFile, setTocImageFile] = useState(null)
  const [tocImagePreview, setTocImagePreview] = useState(null)
  const [tocImageRotation, setTocImageRotation] = useState(0)
  const [tocImageSkewX, setTocImageSkewX] = useState(0)
  const [tocImageSkewY, setTocImageSkewY] = useState(0)
  const [tocImageWizardStep, setTocImageWizardStep] = useState(1)
  const [tocCropAspect, setTocCropAspect] = useState('free')
  const [tocPerspectiveCorners, setTocPerspectiveCorners] = useState(createDefaultPerspectiveCorners)
  const [tocDraggingCornerKey, setTocDraggingCornerKey] = useState(null)
  const [tocCropModalOpen, setTocCropModalOpen] = useState(false)
  // react-image-crop state
  const [tocCrop, setTocCrop] = useState(undefined)
  const [tocCompletedCrop, setTocCompletedCrop] = useState(null)
  const tocCropImageRef = useRef(null)
  const [tocImageProcessing, setTocImageProcessing] = useState(false)
  const [tocFinalPreviewUrl, setTocFinalPreviewUrl] = useState(null)
  const [tocFinalPreviewLoading, setTocFinalPreviewLoading] = useState(false)
  const tocPreviewImageRef = useRef(null)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [tocOcrLines, setTocOcrLines] = useState([])
  const [selectedOcrLineId, setSelectedOcrLineId] = useState(null)
  const [targetChapterIndex, setTargetChapterIndex] = useState(0)
  const [showAdvancedOcrMapping, setShowAdvancedOcrMapping] = useState(false)
  const [editingLineId, setEditingLineId] = useState(null)
  const [editingLineText, setEditingLineText] = useState('')

  // Undo/Redo stacks for OCR lines and chapters (Phase 3)
  const [undoStackLines, setUndoStackLines] = useState([])
  const [redoStackLines, setRedoStackLines] = useState([])
  const [undoStackChapters, setUndoStackChapters] = useState([])
  const [redoStackChapters, setRedoStackChapters] = useState([])

  // ---- Utilities: Text Normalization & Undo/Redo (Phase 3) ----

  const normalizeText = (text) => {
    return (text || '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\u0600-\u06FF\u0905-\u092F]/g, (char) => {
        // Keep alphanumeric, spaces, and unicode for Urdu/Arabic/Hindi
        if (/[\w\s\u0600-\u06FF\u0905-\u092F]/i.test(char)) return char
        // Remove punctuation except . , : ; - /
        if (/[.,;:\-/]/i.test(char)) return char
        return ''
      })
  }

  const pushToUndoStack = (lines, chapters) => {
    setUndoStackLines((prev) => [...prev, lines])
    setUndoStackChapters((prev) => [...prev, chapters])
    setRedoStackLines([])
    setRedoStackChapters([])
  }

  const handleUndo = () => {
    if (undoStackLines.length === 0) {
      showError('Nothing to undo.')
      return
    }
    const prevLines = undoStackLines[undoStackLines.length - 1]
    const prevChapters = undoStackChapters[undoStackChapters.length - 1]
    
    setRedoStackLines((prev) => [...prev, tocOcrLines])
    setRedoStackChapters((prev) => [...prev, tocChapters])
    setTocOcrLines(prevLines)
    setTocChapters(prevChapters)
    setUndoStackLines((prev) => prev.slice(0, -1))
    setUndoStackChapters((prev) => prev.slice(0, -1))
    showSuccess('Undone.')
  }

  const handleRedo = () => {
    if (redoStackLines.length === 0) {
      showError('Nothing to redo.')
      return
    }
    const nextLines = redoStackLines[redoStackLines.length - 1]
    const nextChapters = redoStackChapters[redoStackChapters.length - 1]
    
    setUndoStackLines((prev) => [...prev, tocOcrLines])
    setUndoStackChapters((prev) => [...prev, tocChapters])
    setTocOcrLines(nextLines)
    setTocChapters(nextChapters)
    setRedoStackLines((prev) => prev.slice(0, -1))
    setRedoStackChapters((prev) => prev.slice(0, -1))
    showSuccess('Redone.')
  }

  const startEditingLine = (lineId, text) => {
    setEditingLineId(lineId)
    setEditingLineText(text)
  }

  const linesToRawText = (lines) => lines
    .map((line) => (line.text || '').trim())
    .filter(Boolean)
    .join('\n')

  const clearTocSuggestionState = () => {
    if (tocSuggestionItems.length > 0 || tocSuggestionMeta) {
      setTocSuggestionItems([])
      setTocSuggestionMeta(null)
    }
  }

  const saveLine = (lineId) => {
    const normalized = normalizeText(editingLineText)
    if (!normalized) {
      showError('Line text cannot be empty.')
      return
    }

    pushToUndoStack(tocOcrLines, tocChapters)
    const nextLines = tocOcrLines.map((line) => (
      line.id === lineId ? { ...line, text: normalized } : line
    ))
    setTocOcrLines(nextLines)
    setTocText(linesToRawText(nextLines))
    clearTocSuggestionState()
    setEditingLineId(null)
    setEditingLineText('')
    showSuccess('Line saved.')
  }

  const mergeWithNext = (lineId) => {
    const index = tocOcrLines.findIndex((line) => line.id === lineId)
    if (index < 0 || index >= tocOcrLines.length - 1) {
      showError('Cannot merge last line.')
      return
    }

    pushToUndoStack(tocOcrLines, tocChapters)
    const merged = `${tocOcrLines[index].text} ${tocOcrLines[index + 1].text}`
    const nextLines = [
      ...tocOcrLines.slice(0, index),
      { ...tocOcrLines[index], text: normalizeText(merged) },
      ...tocOcrLines.slice(index + 2),
    ]
    setTocOcrLines(nextLines)
    setTocText(linesToRawText(nextLines))
    clearTocSuggestionState()
    showSuccess('Lines merged.')
  }

  const selectedOcrLine = tocOcrLines.find((line) => line.id === selectedOcrLineId)

  // ---- Keyboard Shortcuts for OCR Lines (Phase 2/3) ----
  useEffect(() => {
    if (!showTocModal || tocOcrLines.length === 0) return

    const handleKeyDown = (e) => {
      // If focus is inside the raw textarea, do NOT handle shortcuts
      const active = document.activeElement
      if (active && active.getAttribute && active.getAttribute('data-rawarea') === 'true') return

      // Only handle shortcuts when modal is open and OCR lines are visible
      const key = e.key.toLowerCase()
      const selectedIndex = tocOcrLines.findIndex((line) => line.id === selectedOcrLineId)

      // Ctrl+Z: Undo
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault()
        handleUndo()
      }
      // Ctrl+Y or Ctrl+Shift+Z: Redo
      else if ((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))) {
        e.preventDefault()
        handleRedo()
      }
      // C: Map selected line as chapter
      else if (key === 'c' && !editingLineId) {
        e.preventDefault()
        handleMapSelectedLineAsChapter()
      }
      // T: Map selected line as topic
      else if (key === 't' && !editingLineId) {
        e.preventDefault()
        handleMapSelectedLineAsTopic()
      }
      // E: Edit selected line
      else if (key === 'e' && !editingLineId && selectedOcrLine) {
        e.preventDefault()
        startEditingLine(selectedOcrLine.id, selectedOcrLine.text)
      }
      // Delete: Remove selected OCR line (undo supported)
      else if ((e.key === 'Delete' || e.key === 'Backspace') && !editingLineId && selectedOcrLine) {
        e.preventDefault()
        handleDeleteOcrLine(selectedOcrLine.id)
      }
      // Arrow Up: Select previous line
      else if (e.key === 'ArrowUp' && !editingLineId) {
        e.preventDefault()
        if (selectedIndex > 0) {
          setSelectedOcrLineId(tocOcrLines[selectedIndex - 1].id)
        }
      }
      // Arrow Down: Select next line
      else if (e.key === 'ArrowDown' && !editingLineId) {
        e.preventDefault()
        if (selectedIndex >= 0 && selectedIndex < tocOcrLines.length - 1) {
          setSelectedOcrLineId(tocOcrLines[selectedIndex + 1].id)
        }
      }
      // Escape: Clear selection or exit edit mode
      else if (e.key === 'Escape') {
        e.preventDefault()
        if (editingLineId) {
          setEditingLineId(null)
          setEditingLineText('')
        } else {
          setSelectedOcrLineId(null)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [showTocModal, tocOcrLines, selectedOcrLineId, editingLineId, selectedOcrLine])

  // ---- Queries ----

  // Fetch subjects assigned to selected class
  const { data: classSubjectsData } = useQuery({
    queryKey: ['classSubjects', resolvedSelectedClass],
    queryFn: () => academicsApi.getClassSubjectsByClass(resolvedSelectedClass),
    enabled: !!resolvedSelectedClass,
  })

  const classSubjects = (classSubjectsData?.data?.results || classSubjectsData?.data || [])
    .map((cs) => ({ id: cs.subject, name: cs.subject_name }))

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['lmsBooks', resolvedSelectedClass, selectedSubject],
    queryFn: () => lmsApi.getBooks({ class_id: resolvedSelectedClass, subject_id: selectedSubject }),
    enabled: !!resolvedSelectedClass && !!selectedSubject,
  })

  const books = booksData?.data?.results || booksData?.data || []

  const { data: bookTreeData, isLoading: treeLoading } = useQuery({
    queryKey: ['lmsBookTree', selectedBookId],
    queryFn: () => lmsApi.getBookTree(selectedBookId),
    enabled: !!selectedBookId,
  })

  const bookTree = bookTreeData?.data || null

  const { data: progressData } = useQuery({
    queryKey: ['syllabusProgress', resolvedSelectedClass, selectedSubject],
    queryFn: () => lmsApi.getSyllabusProgress({ class_id: resolvedSelectedClass, subject_id: selectedSubject }),
    enabled: !!resolvedSelectedClass && !!selectedSubject,
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

  const parseTocMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.parseTOC(id, data),
    onSuccess: (response) => {
      const parsed = response?.data?.chapters || []
      const normalized = parsed.map((chapter) => ({
        title: chapter.title || '',
        topics: (chapter.topics || []).map((topic) => ({ title: topic.title || '' })),
      }))
      setTocChapters(normalized)
      setTocSuggestionItems([])
      setTocWarnings(response?.data?.warnings || [])
      setTocSuggestionMeta({ source: 'rule_based', confidence: null })
      setTocStep('review')
      showSuccess('Table of Contents parsed. Review and adjust chapters/topics before applying.')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || error.response?.data?.error || 'Failed to parse table of contents')
    },
  })

  const applyTocMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.applyTOC(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lmsBookTree'] })
      closeTocModal()
      showSuccess('Table of contents imported')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || error.response?.data?.error || 'Failed to import table of contents')
    },
  })

  const suggestTocMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.suggestTOC(id, data),
    onSuccess: (response) => {
      const chapters = response?.data?.chapters || []
      const confidence = typeof response?.data?.confidence === 'number' ? response.data.confidence : 0.7
      const suggestionPayload = response?.data?.suggestions || []
      const normalizedSuggestions = suggestionPayload.length > 0
        ? suggestionPayload
          .map((item, index) => ({
            id: item.id || `s-${index}`,
            kind: item.kind === 'topic' ? 'topic' : 'chapter',
            title: item.title || '',
            chapterTitle: item.chapter_title || '',
            confidence: typeof item.confidence === 'number' ? item.confidence : confidence,
            status: 'pending',
          }))
          .filter((item) => !!item.title.trim())
        : chapters.flatMap((chapter, chapterIndex) => {
          const chapterTitle = chapter.title || ''
          const chapterItem = chapterTitle
            ? [{
              id: `ch-${chapterIndex}`,
              kind: 'chapter',
              title: chapterTitle,
              chapterTitle: chapterTitle,
              confidence,
              status: 'pending',
            }]
            : []

          const topicItems = (chapter.topics || [])
            .map((topic, topicIndex) => ({
              id: `tp-${chapterIndex}-${topicIndex}`,
              kind: 'topic',
              title: topic.title || '',
              chapterTitle,
              confidence,
              status: 'pending',
            }))
            .filter((item) => !!item.title.trim())

          return [...chapterItem, ...topicItems]
        })

      setTocSuggestionItems(normalizedSuggestions)
      setTocWarnings(response?.data?.warnings || [])
      setTocSuggestionMeta({
        source: response?.data?.source || 'ai',
        confidence,
      })
      showSuccess('AI suggestions are ready. Use each suggestion explicitly before review.')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || error.response?.data?.error || 'Failed to generate AI suggestion')
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
    setTocMode('paste')
    setTocStep('input')
    setTocChapters([{ title: '', topics: [{ title: '' }] }])
    setTocSuggestionItems([])
    setTocWarnings([])
    setTocSuggestionMeta(null)
    setTocImageFile(null)
    setTocImagePreview(null)
    setTocImageRotation(0)
    setTocImageSkewX(0)
    setTocImageSkewY(0)
    setTocImageWizardStep(1)
    setTocCropAspect('free')
    setTocPerspectiveCorners(createDefaultPerspectiveCorners())
    setTocDraggingCornerKey(null)
    setTocCropModalOpen(false)
    setTocCrop(undefined)
    setTocCompletedCrop(null)
    setTocImageProcessing(false)
    if (tocFinalPreviewUrl) URL.revokeObjectURL(tocFinalPreviewUrl)
    setTocFinalPreviewUrl(null)
    setTocFinalPreviewLoading(false)
    setOcrLoading(false)
    setShowTocModal(true)
  }

  const closeTocModal = () => {
    setShowTocModal(false)
    setTocText('')
    setTocMode('paste')
    setTocStep('input')
    setTocChapters([{ title: '', topics: [{ title: '' }] }])
    setTocSuggestionItems([])
    setTocWarnings([])
    setTocSuggestionMeta(null)
    setTocImageFile(null)
    if (tocImagePreview) URL.revokeObjectURL(tocImagePreview)
    setTocImagePreview(null)
    setTocImageRotation(0)
    setTocImageSkewX(0)
    setTocImageSkewY(0)
    setTocImageWizardStep(1)
    setTocCropAspect('free')
    setTocPerspectiveCorners(createDefaultPerspectiveCorners())
    setTocDraggingCornerKey(null)
    setTocCropModalOpen(false)
    setTocCrop(undefined)
    setTocCompletedCrop(null)
    setTocImageProcessing(false)
    if (tocFinalPreviewUrl) URL.revokeObjectURL(tocFinalPreviewUrl)
    setTocFinalPreviewUrl(null)
    setTocFinalPreviewLoading(false)
    setOcrLoading(false)
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
      class_obj: parseInt(resolvedSelectedClass),
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
      showError('Please provide Table of Contents text first')
      return
    }
    parseTocMutation.mutate({ id: selectedBookId, data: { toc_text: tocText } })
  }

  const handleApplyToc = () => {
    const chapters = tocChapters
      .map((chapter) => ({
        title: (chapter.title || '').trim(),
        topics: (chapter.topics || [])
          .map((topic) => ({ title: (topic.title || '').trim() }))
          .filter((topic) => !!topic.title),
      }))
      .filter((chapter) => !!chapter.title)

    if (chapters.length === 0) {
      showError('Add at least one chapter before applying.')
      return
    }

    applyTocMutation.mutate({ id: selectedBookId, data: { chapters } })
  }

  const handleManualTocReview = () => {
    const hasChapterTitle = tocChapters.some((chapter) => (chapter.title || '').trim())
    if (!hasChapterTitle) {
      showError('Please type at least one chapter title.')
      return
    }
    setTocWarnings([])
    setTocSuggestionMeta({ source: 'manual', confidence: 1 })
    setTocStep('review')
  }

  const handleSuggestToc = () => {
    const cleanedRawText = tocMode === 'upload' && tocOcrLines.length > 0
      ? linesToRawText(tocOcrLines)
      : tocText

    if (!cleanedRawText.trim()) {
      showError('Please provide Table of Contents text before requesting AI suggestion.')
      return
    }
    suggestTocMutation.mutate({
      id: selectedBookId,
      data: { raw_text: cleanedRawText },
    })
  }

  const markSuggestionStatus = (id, status) => {
    setTocSuggestionItems((prev) => prev.map((item) => (
      item.id === id ? { ...item, status } : item
    )))
  }

  const addChapterFromSuggestion = (title, sourceMeta = null) => {
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return

    setTocChapters((prev) => [...prev, { title: cleanTitle, topics: [], ...(sourceMeta || {}) }])
  }

  const addTopicFromSuggestion = (title, chapterTitle, sourceMeta = null) => {
    const cleanTitle = (title || '').trim()
    if (!cleanTitle) return

    setTocChapters((prev) => {
      const next = prev.map((chapter) => ({
        ...chapter,
        topics: [...(chapter.topics || [])],
      }))

      const normalizedChapterTitle = (chapterTitle || '').trim().toLowerCase()
      let targetIndex = normalizedChapterTitle
        ? next.findIndex((chapter) => (chapter.title || '').trim().toLowerCase() === normalizedChapterTitle)
        : -1

      if (targetIndex === -1 && normalizedChapterTitle) {
        next.push({ title: chapterTitle.trim(), topics: [] })
        targetIndex = next.length - 1
      }

      if (targetIndex === -1) {
        if (next.length === 0) {
          next.push({ title: 'New Chapter', topics: [] })
        }
        targetIndex = next.length - 1
      }

      next[targetIndex].topics.push({ title: cleanTitle, ...(sourceMeta || {}) })
      return next
    })
  }

  const syncTocStructureWithRawLines = (nextLines) => {
    const normalizedTextSet = new Set(nextLines.map((line) => (line.text || '').trim().toLowerCase()))

    setTocChapters((prev) => prev
      .map((chapter) => {
        const chapterIsOcr = chapter?.source === 'ocr'
        const chapterSourceText = (chapter?.sourceText || chapter?.title || '').trim().toLowerCase()

        if (chapterIsOcr && chapterSourceText && !normalizedTextSet.has(chapterSourceText)) {
          return null
        }

        const nextTopics = (chapter.topics || []).filter((topic) => {
          const topicIsOcr = topic?.source === 'ocr'
          if (!topicIsOcr) return true
          const topicSourceText = (topic?.sourceText || topic?.title || '').trim().toLowerCase()
          return topicSourceText ? normalizedTextSet.has(topicSourceText) : true
        })

        return { ...chapter, topics: nextTopics }
      })
      .filter(Boolean)
    )
  }

  const handleUseSuggestion = (item) => {
    if (item.kind === 'chapter') {
      addChapterFromSuggestion(item.title)
    } else {
      addTopicFromSuggestion(item.title, item.chapterTitle)
    }
    markSuggestionStatus(item.id, 'used')
  }

  const handleIgnoreSuggestion = (item) => {
    markSuggestionStatus(item.id, 'ignored')
  }

  const handleUseHighConfidenceSuggestions = () => {
    const toApply = tocSuggestionItems.filter((item) => item.status === 'pending' && item.confidence >= 0.8)
    if (toApply.length === 0) {
      showError('No pending high-confidence suggestions found.')
      return
    }

    toApply.forEach((item) => {
      if (item.kind === 'chapter') {
        addChapterFromSuggestion(item.title)
      } else {
        addTopicFromSuggestion(item.title, item.chapterTitle)
      }
    })

    setTocSuggestionItems((prev) => prev.map((item) => (
      toApply.some((picked) => picked.id === item.id)
        ? { ...item, status: 'used' }
        : item
    )))
    showSuccess(`Applied ${toApply.length} high-confidence suggestions.`)
  }

  const markOcrLineMapped = (lineId, mappedAs) => {
    setTocOcrLines((prev) => prev.map((line) => (
      line.id === lineId ? { ...line, mappedAs } : line
    )))
  }

  const mapOcrLineAsChapter = (line) => {
    if (!line || !line.text) return
    const chapterNumber = tocChapters.length + 1

    pushToUndoStack(tocOcrLines, tocChapters)
    addChapterFromSuggestion(line.text, {
      source: 'ocr',
      sourceLineId: line.id,
      sourceText: line.text,
    })
    setTocOcrLines((prev) => prev.map((item) => (
      item.id === line.id
        ? { ...item, mappedAs: 'chapter', mappedNumber: chapterNumber }
        : item
    )))
    // When a new chapter is created from OCR, make it the default target for next topic mappings.
    setTargetChapterIndex(chapterNumber - 1)
  }

  const mapOcrLineAsTopic = (line, requestedChapterIndex = targetChapterIndex) => {
    if (!line || !line.text) return
    if (tocChapters.length === 0) {
      showError('Add a chapter first, then map this line as a topic.')
      return
    }

    const safeTargetIndex = Math.min(Math.max(requestedChapterIndex, 0), tocChapters.length - 1)
    const chapterTitle = tocChapters[safeTargetIndex]?.title || ''
    const nextTopicNumber = (tocChapters[safeTargetIndex]?.topics?.length || 0) + 1
    const topicNumberLabel = `${safeTargetIndex + 1}.${nextTopicNumber}`

    pushToUndoStack(tocOcrLines, tocChapters)
    addTopicFromSuggestion(line.text, chapterTitle, {
      source: 'ocr',
      sourceLineId: line.id,
      sourceText: line.text,
    })
    setTocOcrLines((prev) => prev.map((item) => (
      item.id === line.id
        ? { ...item, mappedAs: `topic:${safeTargetIndex}`, mappedNumber: topicNumberLabel }
        : item
    )))
  }

  const handleDeleteOcrLine = (lineId) => {
    const lineToDelete = tocOcrLines.find((line) => line.id === lineId)
    if (!lineToDelete) return

    pushToUndoStack(tocOcrLines, tocChapters)

    const nextLines = tocOcrLines.filter((line) => line.id !== lineId)
    setTocOcrLines(nextLines)
    setTocText(linesToRawText(nextLines))
    clearTocSuggestionState()
    if (selectedOcrLineId === lineId) {
      setSelectedOcrLineId(nextLines[0]?.id || null)
    }

    // If a mapped OCR line is deleted, rollback corresponding chapter/topic placeholder content.
    if (lineToDelete.mappedAs === 'chapter') {
      setTocChapters((prev) => {
        const removeIndex = prev.findIndex((chapter) => (chapter.title || '').trim() === (lineToDelete.text || '').trim())
        if (removeIndex === -1) return prev
        return prev.filter((_, index) => index !== removeIndex)
      })
    } else if ((lineToDelete.mappedAs || '').startsWith('topic:')) {
      const targetIndex = parseInt((lineToDelete.mappedAs || '').split(':')[1], 10)
      setTocChapters((prev) => prev.map((chapter, chapterIndex) => {
        if (chapterIndex !== targetIndex) return chapter
        let removed = false
        const nextTopics = (chapter.topics || []).filter((topic) => {
          if (!removed && (topic.title || '').trim() === (lineToDelete.text || '').trim()) {
            removed = true
            return false
          }
          return true
        })
        return { ...chapter, topics: nextTopics }
      }))
    }

    showSuccess('OCR line deleted. You can undo this action.')
  }

  const handleMapSelectedLineAsChapter = () => {
    if (!selectedOcrLine || !selectedOcrLine.text) {
      showError('Select an OCR line first.')
      return
    }

    mapOcrLineAsChapter(selectedOcrLine)
    showSuccess('OCR line mapped as chapter.')
  }

  const handleMapSelectedLineAsTopic = () => {
    if (!selectedOcrLine || !selectedOcrLine.text) {
      showError('Select an OCR line first.')
      return
    }

    if (tocChapters.length === 0) {
      showError('Add a chapter first, then map this line as a topic.')
      return
    }

    mapOcrLineAsTopic(selectedOcrLine, targetChapterIndex)
    showSuccess('OCR line mapped as topic.')
  }

  const addTocChapter = () => {
    setTocChapters((prev) => ([...prev, { title: '', topics: [{ title: '' }] }]))
  }

  const removeTocChapter = (chapterIndex) => {
    setTocChapters((prev) => prev.filter((_, idx) => idx !== chapterIndex))
  }

  const updateTocChapterTitle = (chapterIndex, title) => {
    setTocChapters((prev) => prev.map((chapter, idx) => (
      idx === chapterIndex ? { ...chapter, title } : chapter
    )))
  }

  const addTocTopic = (chapterIndex) => {
    setTocChapters((prev) => prev.map((chapter, idx) => {
      if (idx !== chapterIndex) return chapter
      return {
        ...chapter,
        topics: [...(chapter.topics || []), { title: '' }],
      }
    }))
  }

  const removeTocTopic = (chapterIndex, topicIndex) => {
    setTocChapters((prev) => prev.map((chapter, idx) => {
      if (idx !== chapterIndex) return chapter
      return {
        ...chapter,
        topics: chapter.topics.filter((_, tIdx) => tIdx !== topicIndex),
      }
    }))
  }

  const updateTocTopicTitle = (chapterIndex, topicIndex, title) => {
    setTocChapters((prev) => prev.map((chapter, idx) => {
      if (idx !== chapterIndex) return chapter
      return {
        ...chapter,
        topics: chapter.topics.map((topic, tIdx) => (
          tIdx === topicIndex ? { ...topic, title } : topic
        )),
      }
    }))
  }

  const readFileAsDataUrl = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  const createImageElement = (url) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = url
    })
  }

  const replaceTocImageFile = (file) => {
    if (tocImagePreview) URL.revokeObjectURL(tocImagePreview)
    setTocImageFile(file)
    setTocImagePreview(URL.createObjectURL(file))
    setTocPerspectiveCorners(createDefaultPerspectiveCorners())
    setTocDraggingCornerKey(null)
  }

  const resetTocPerspectiveCorners = () => {
    setTocPerspectiveCorners(createDefaultPerspectiveCorners())
    setTocDraggingCornerKey(null)
  }

  const updatePerspectiveCornerFromClient = (cornerKey, clientX, clientY) => {
    const rect = tocPreviewImageRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return

    let x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    let y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height))

    // Snap-to-edge helper: when a handle is close to image bounds, lock it to the edge.
    const snapPx = 16
    const snapX = snapPx / rect.width
    const snapY = snapPx / rect.height

    if (x <= snapX) x = 0
    else if (x >= 1 - snapX) x = 1

    if (y <= snapY) y = 0
    else if (y >= 1 - snapY) y = 1

    setTocPerspectiveCorners((prev) => ({
      ...prev,
      [cornerKey]: { x, y },
    }))
  }

  const isPerspectiveQuadValid = (corners, width, height) => {
    const points = [corners.tl, corners.tr, corners.br, corners.bl]
    const inBounds = points.every((p) => p.x >= 0 && p.x <= width && p.y >= 0 && p.y <= height)
    if (!inBounds) return false

    const edgeLengths = [
      Math.hypot(corners.tr.x - corners.tl.x, corners.tr.y - corners.tl.y),
      Math.hypot(corners.br.x - corners.tr.x, corners.br.y - corners.tr.y),
      Math.hypot(corners.bl.x - corners.br.x, corners.bl.y - corners.br.y),
      Math.hypot(corners.tl.x - corners.bl.x, corners.tl.y - corners.bl.y),
    ]
    if (edgeLengths.some((edge) => edge < 20)) return false

    const area = Math.abs(
      points.reduce((acc, p, i) => {
        const n = points[(i + 1) % points.length]
        return acc + (p.x * n.y - n.x * p.y)
      }, 0) / 2,
    )
    return area > 800
  }

  const solveAffineTransform = (src, dst) => {
    const [s0, s1, s2] = src
    const [d0, d1, d2] = dst

    const det = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
    if (Math.abs(det) < 1e-6) return null

    const a = (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / det
    const c = (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / det
    const e = (d0.x * (s1.x * s2.y - s2.x * s1.y) + d1.x * (s2.x * s0.y - s0.x * s2.y) + d2.x * (s0.x * s1.y - s1.x * s0.y)) / det

    const b = (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / det
    const d = (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / det
    const f = (d0.y * (s1.x * s2.y - s2.x * s1.y) + d1.y * (s2.x * s0.y - s0.x * s2.y) + d2.y * (s0.x * s1.y - s1.x * s0.y)) / det

    return { a, b, c, d, e, f }
  }

  const drawImageTriangle = (ctx, img, srcTri, dstTri) => {
    const matrix = solveAffineTransform(srcTri, dstTri)
    if (!matrix) return

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(dstTri[0].x, dstTri[0].y)
    ctx.lineTo(dstTri[1].x, dstTri[1].y)
    ctx.lineTo(dstTri[2].x, dstTri[2].y)
    ctx.closePath()
    ctx.clip()
    ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
    ctx.drawImage(img, 0, 0)
    ctx.restore()
  }

  const getPerspectiveCorrectedImageFile = async (file, normalizedCorners) => {
    const imageUrl = await readFileAsDataUrl(file)
    const img = await createImageElement(imageUrl)

    const sourceCorners = {
      tl: { x: normalizedCorners.tl.x * img.width, y: normalizedCorners.tl.y * img.height },
      tr: { x: normalizedCorners.tr.x * img.width, y: normalizedCorners.tr.y * img.height },
      br: { x: normalizedCorners.br.x * img.width, y: normalizedCorners.br.y * img.height },
      bl: { x: normalizedCorners.bl.x * img.width, y: normalizedCorners.bl.y * img.height },
    }

    if (!isPerspectiveQuadValid(sourceCorners, img.width, img.height)) {
      throw new Error('Invalid corners')
    }

    const topWidth = Math.hypot(sourceCorners.tr.x - sourceCorners.tl.x, sourceCorners.tr.y - sourceCorners.tl.y)
    const bottomWidth = Math.hypot(sourceCorners.br.x - sourceCorners.bl.x, sourceCorners.br.y - sourceCorners.bl.y)
    const leftHeight = Math.hypot(sourceCorners.bl.x - sourceCorners.tl.x, sourceCorners.bl.y - sourceCorners.tl.y)
    const rightHeight = Math.hypot(sourceCorners.br.x - sourceCorners.tr.x, sourceCorners.br.y - sourceCorners.tr.y)

    const outWidth = Math.max(1, Math.round(Math.max(topWidth, bottomWidth)))
    const outHeight = Math.max(1, Math.round(Math.max(leftHeight, rightHeight)))

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = outWidth
    canvas.height = outHeight
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    drawImageTriangle(
      ctx,
      img,
      [sourceCorners.tl, sourceCorners.tr, sourceCorners.bl],
      [{ x: 0, y: 0 }, { x: outWidth, y: 0 }, { x: 0, y: outHeight }],
    )
    drawImageTriangle(
      ctx,
      img,
      [sourceCorners.tr, sourceCorners.br, sourceCorners.bl],
      [{ x: outWidth, y: 0 }, { x: outWidth, y: outHeight }, { x: 0, y: outHeight }],
    )

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    })

    return new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' })
  }

  const getRotatedImageFile = async (file, rotation) => {
    if (!rotation) return file

    const imageUrl = await readFileAsDataUrl(file)
    const img = await createImageElement(imageUrl)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const normalizedRotation = ((rotation % 360) + 360) % 360

    if (normalizedRotation === 90 || normalizedRotation === 270) {
      canvas.width = img.height
      canvas.height = img.width
    } else {
      canvas.width = img.width
      canvas.height = img.height
    }

    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((normalizedRotation * Math.PI) / 180)
    ctx.drawImage(img, -img.width / 2, -img.height / 2)

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    })

    return new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' })
  }

  const getSkewedImageFile = async (file, skewXDeg, skewYDeg) => {
    if (!skewXDeg && !skewYDeg) return file

    const imageUrl = await readFileAsDataUrl(file)
    const img = await createImageElement(imageUrl)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    const skewXRad = (skewXDeg * Math.PI) / 180
    const skewYRad = (skewYDeg * Math.PI) / 180
    const skewXFactor = Math.tan(skewXRad)
    const skewYFactor = Math.tan(skewYRad)

    const outWidth = Math.ceil(img.width + Math.abs(skewXFactor * img.height))
    const outHeight = Math.ceil(img.height + Math.abs(skewYFactor * img.width))

    canvas.width = outWidth
    canvas.height = outHeight

    const offsetX = skewXFactor < 0 ? Math.abs(skewXFactor * img.height) : 0
    const offsetY = skewYFactor < 0 ? Math.abs(skewYFactor * img.width) : 0

    ctx.setTransform(1, skewYFactor, skewXFactor, 1, offsetX, offsetY)
    ctx.drawImage(img, 0, 0)

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    })

    return new File([blob], file.name.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' })
  }

  const getCroppedImageFile = async (imageSrc, pixelCrop, rotation = 0, originalName = 'toc-image.jpg') => {
    const image = await createImageElement(imageSrc)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    const rotRad = (rotation * Math.PI) / 180
    const sin = Math.abs(Math.sin(rotRad))
    const cos = Math.abs(Math.cos(rotRad))
    const bBoxWidth = image.width * cos + image.height * sin
    const bBoxHeight = image.width * sin + image.height * cos

    canvas.width = bBoxWidth
    canvas.height = bBoxHeight
    ctx.translate(bBoxWidth / 2, bBoxHeight / 2)
    ctx.rotate(rotRad)
    ctx.translate(-image.width / 2, -image.height / 2)
    ctx.drawImage(image, 0, 0)

    const croppedData = ctx.getImageData(pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height)
    canvas.width = pixelCrop.width
    canvas.height = pixelCrop.height
    ctx.putImageData(croppedData, 0, 0)

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    })

    return new File([blob], originalName.replace(/\.[^/.]+$/, '.jpg'), { type: 'image/jpeg' })
  }

  const handleSaveTocCrop = async () => {
    if (!tocCompletedCrop || !tocCropImageRef.current || !tocImageFile) {
      showError('Select a crop area first.')
      return
    }

    setTocImageProcessing(true)
    try {
      const img = tocCropImageRef.current
      const scaleX = img.naturalWidth / img.width
      const scaleY = img.naturalHeight / img.height
      const canvas = document.createElement('canvas')
      const pixelCrop = {
        x: tocCompletedCrop.x * scaleX,
        y: tocCompletedCrop.y * scaleY,
        width: tocCompletedCrop.width * scaleX,
        height: tocCompletedCrop.height * scaleY,
      }
      canvas.width = pixelCrop.width
      canvas.height = pixelCrop.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(
        img,
        pixelCrop.x, pixelCrop.y,
        pixelCrop.width, pixelCrop.height,
        0, 0,
        pixelCrop.width, pixelCrop.height,
      )
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95))
      const croppedFile = new File(
        [blob],
        tocImageFile.name.replace(/\.[^/.]+$/, '.jpg'),
        { type: 'image/jpeg' },
      )
      replaceTocImageFile(croppedFile)
      setTocCropModalOpen(false)
      setTocCrop(undefined)
      setTocCompletedCrop(null)
      showSuccess('Crop applied.')
    } catch (error) {
      showError('Failed to apply crop.')
    } finally {
      setTocImageProcessing(false)
    }
  }

  const handleTocImageSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowed.includes(file.type)) {
      showError('Please select a JPEG, PNG, or WebP image')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      showError('Image too large. Maximum size is 10MB.')
      return
    }
    replaceTocImageFile(file)
    setTocImageRotation(0)
    setTocImageSkewX(0)
    setTocImageSkewY(0)
    setTocImageWizardStep(1)
    setTocCropAspect('free')
    if (tocFinalPreviewUrl) URL.revokeObjectURL(tocFinalPreviewUrl)
    setTocFinalPreviewUrl(null)
    setTocFinalPreviewLoading(false)
    resetTocPerspectiveCorners()
    setTocCrop(undefined)
    setTocCompletedCrop(null)
    setTocCropModalOpen(false)
  }

  const handleRotateTocImage = (direction) => {
    setTocImageRotation((prev) => {
      if (direction === 'left') return (prev - 90 + 360) % 360
      return (prev + 90) % 360
    })
  }

  const bakeRotationAndAdvance = async (nextStep) => {
    if (!tocImageRotation || !tocImageFile) {
      setTocImageWizardStep(nextStep)
      return
    }
    setTocImageProcessing(true)
    try {
      const baked = await getRotatedImageFile(tocImageFile, tocImageRotation)
      replaceTocImageFile(baked)
      setTocImageRotation(0)
    } catch {
      // proceed even if bake fails
    } finally {
      setTocImageProcessing(false)
    }
    setTocImageWizardStep(nextStep)
  }

  const handleApplyTocSkew = async () => {
    if (!tocImageFile) return
    if (!tocImageSkewX && !tocImageSkewY) {
      showError('Adjust skew sliders first.')
      return
    }

    setTocImageProcessing(true)
    try {
      const processedFile = await getSkewedImageFile(tocImageFile, tocImageSkewX, tocImageSkewY)
      replaceTocImageFile(processedFile)
      setTocImageSkewX(0)
      setTocImageSkewY(0)
      showSuccess('Skew correction applied.')
    } catch (error) {
      showError('Failed to apply skew correction.')
    } finally {
      setTocImageProcessing(false)
    }
  }

  const handleApplyTocPerspective = async () => {
    if (!tocImageFile) return
    if (tocImageRotation || tocImageSkewX || tocImageSkewY) {
      showError('Apply or reset rotate/skew first, then apply perspective correction.')
      return
    }

    setTocImageProcessing(true)
    try {
      const perspectiveFile = await getPerspectiveCorrectedImageFile(tocImageFile, tocPerspectiveCorners)
      replaceTocImageFile(perspectiveFile)
      showSuccess('Perspective correction applied.')
    } catch (error) {
      showError('Unable to apply perspective correction. Keep corners inside the page area.')
    } finally {
      setTocImageProcessing(false)
    }
  }

  const buildProcessedTocImageFile = async (baseFile) => {
    let processedFile = baseFile
    if (tocImageRotation) {
      processedFile = await getRotatedImageFile(processedFile, tocImageRotation)
    }
    if (tocImageSkewX || tocImageSkewY) {
      processedFile = await getSkewedImageFile(processedFile, tocImageSkewX, tocImageSkewY)
    }
    if (tocPerspectiveCorners) {
      try {
        processedFile = await getPerspectiveCorrectedImageFile(processedFile, tocPerspectiveCorners)
      } catch (error) {
        // Keep non-perspective processed output if perspective corners are invalid.
      }
    }
    return processedFile
  }

  useEffect(() => {
    if (tocImageWizardStep !== 4 || !tocImageFile) return

    let active = true
    const renderFinalPreview = async () => {
      setTocFinalPreviewLoading(true)
      try {
        const processed = await buildProcessedTocImageFile(tocImageFile)
        if (!active) return
        if (tocFinalPreviewUrl) URL.revokeObjectURL(tocFinalPreviewUrl)
        setTocFinalPreviewUrl(URL.createObjectURL(processed))
      } finally {
        if (active) setTocFinalPreviewLoading(false)
      }
    }

    renderFinalPreview()
    return () => {
      active = false
    }
  }, [tocImageWizardStep, tocImageFile, tocImageRotation, tocImageSkewX, tocImageSkewY, tocPerspectiveCorners])

  useEffect(() => {
    if (!tocDraggingCornerKey) return

    const handlePointerMove = (e) => {
      const point = e.touches?.[0] || e
      if (!point) return
      if (e.cancelable) e.preventDefault()
      updatePerspectiveCornerFromClient(tocDraggingCornerKey, point.clientX, point.clientY)
    }

    const handlePointerUp = () => {
      setTocDraggingCornerKey(null)
    }

    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', handlePointerUp)
    window.addEventListener('touchmove', handlePointerMove, { passive: false })
    window.addEventListener('touchend', handlePointerUp)

    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', handlePointerUp)
      window.removeEventListener('touchmove', handlePointerMove)
      window.removeEventListener('touchend', handlePointerUp)
    }
  }, [tocDraggingCornerKey])

  const handleOcrExtract = async () => {
    if (!tocImageFile) {
      showError('Please select an image first')
      return
    }
    setOcrLoading(true)
    try {
      const processedFile = await buildProcessedTocImageFile(tocImageFile)
      if (processedFile !== tocImageFile) {
        replaceTocImageFile(processedFile)
        setTocImageRotation(0)
        setTocImageSkewX(0)
        setTocImageSkewY(0)
      }

      const response = await lmsApi.ocrTOC(selectedBookId, processedFile)
      setTocText(response.data.text)
      const responseLines = Array.isArray(response?.data?.lines)
        ? response.data.lines
          .map((line, index) => ({
            id: line.id || `line-${index + 1}`,
            line_number: line.line_number || index + 1,
            text: (line.text || '').trim(),
            confidence: typeof line.confidence === 'number' ? line.confidence : 0,
            mappedAs: null,
            mappedNumber: null,
          }))
          .filter((line) => !!line.text)
        : parseOcrLinesFromText(response.data.text)
      setTocOcrLines(responseLines)
      setSelectedOcrLineId(responseLines[0]?.id || null)
      setTocMode('upload')
      setTocStep('input')
      setTocImageWizardStep(4)
      setTocSuggestionItems([])
      setTocSuggestionMeta(null)
      showSuccess('Text extracted! Review and edit before importing Table of Contents.')
    } catch (error) {
      showError(error.response?.data?.error || 'Failed to extract text from image')
    } finally {
      setOcrLoading(false)
    }
  }

  const handleDeleteBook = async (book) => {
    const ok = await confirm({ title: 'Delete Book', message: `Delete "${book.title}"? This action cannot be undone.` })
    if (ok) deleteBookMutation.mutate(book.id)
  }

  const handleDeleteChapter = async (chapter) => {
    const ok = await confirm({ title: 'Delete Chapter', message: `Delete "Ch ${chapter.chapter_number}: ${chapter.title}"? This will also delete all topics in this chapter.` })
    if (ok) deleteChapterMutation.mutate(chapter.id)
  }

  const handleDeleteTopic = async (topic) => {
    const ok = await confirm({ title: 'Delete Topic', message: `Delete topic "${topic.title}"? This action cannot be undone.` })
    if (ok) deleteTopicMutation.mutate(topic.id)
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

  const pendingSuggestionCount = tocSuggestionItems.filter((item) => item.status === 'pending').length
  const hasPendingLinearTransforms = tocImageRotation !== 0 || tocImageSkewX !== 0 || tocImageSkewY !== 0
  const tocDisplayPreviewUrl = tocImageWizardStep === 4 && tocFinalPreviewUrl ? tocFinalPreviewUrl : tocImagePreview
  const tocDisplayPreviewAlt = tocImageWizardStep === 4 && tocFinalPreviewUrl
    ? 'Final processed TOC preview'
    : 'TOC page preview'
  const tocDisplayPreviewStyle = tocImageWizardStep === 4 && tocFinalPreviewUrl
    ? undefined
    : { transform: `rotate(${tocImageRotation}deg) skew(${tocImageSkewX}deg, ${tocImageSkewY}deg)` }

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
            <ClassSelector
              value={selectedClass}
              onChange={(e) => {
                setSelectedClass(e.target.value)
                setSelectedBookId(null)
              }}
              placeholder="Select Class"
              scope={classSelectorScope}
              academicYearId={activeAcademicYear?.id}
            />
          </div>
          <div>
            <label className="label">Subject</label>
            <SubjectSelector
              value={selectedSubject}
              onChange={(e) => {
                setSelectedSubject(e.target.value)
                setSelectedBookId(null)
              }}
              placeholder={!selectedClass ? 'Select a class first' : 'Select Subject'}
              disabled={!selectedClass}
              subjects={resolvedSelectedClass ? classSubjects : []}
            />
          </div>
        </div>
      </div>

      {/* Guide Steps */}
      {!filtersSelected && (
        <div className="card p-4 sm:p-6 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Step 1 */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
              selectedClass
                ? 'bg-green-100 text-green-700'
                : 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                selectedClass ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'
              }`}>
                {selectedClass ? '\u2713' : '1'}
              </span>
              Select a Class
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            {/* Step 2 */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm ${
              selectedSubject
                ? 'bg-green-100 text-green-700'
                : selectedClass
                  ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                  : 'bg-gray-100 text-gray-400'
            }`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                selectedSubject ? 'bg-green-500 text-white' : selectedClass ? 'bg-blue-500 text-white' : 'bg-gray-300 text-white'
              }`}>
                {selectedSubject ? '\u2713' : '2'}
              </span>
              Pick a Subject
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            {/* Step 3 */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
              Manage Books
            </div>
          </div>

          {/* Contextual hint */}
          <p className="text-sm text-gray-500 mt-3">
            {!selectedClass
              ? 'Start by selecting a class above to see its assigned subjects.'
              : 'Now pick a subject to view and manage curriculum books.'}
          </p>

          {/* TOC tip */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
            <p className="text-xs text-blue-700">
              <span className="font-semibold">Tip:</span> After adding a book, use "Import Table of Contents" to photograph the book's table of contents — the AI extracts chapters and topics automatically.
            </p>
          </div>
        </div>
      )}

      {/* Main content */}
      {!filtersSelected ? null : booksLoading ? (
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
                    Import Table of Contents
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
                                        {topic.is_tested && (
                                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 flex-shrink-0">
                                            Tested
                                          </span>
                                        )}
                                        {!topic.is_tested && topic.is_covered && (
                                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 flex-shrink-0">
                                            Not tested
                                          </span>
                                        )}
                                        {typeof topic.test_question_count === 'number' && topic.test_question_count > 0 && (
                                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 flex-shrink-0">
                                            {topic.test_question_count}Q
                                          </span>
                                        )}
                                        {topic.estimated_periods && (
                                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 flex-shrink-0">
                                            {topic.estimated_periods} {topic.estimated_periods === 1 ? 'period' : 'periods'}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex gap-2 flex-shrink-0 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button
                                          onClick={() => navigate('/academics/questions', {
                                            state: {
                                              classId: resolvedSelectedClass,
                                              subject: selectedSubject,
                                              bookId: selectedBookId,
                                              chapterId: chapter.id,
                                              topicId: topic.id,
                                            },
                                          })}
                                          className="text-xs text-emerald-600 hover:text-emerald-800 font-medium"
                                          title="View / add questions for this topic"
                                        >
                                          +Q
                                        </button>
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

      {/* ============ Table of Contents Import Modal ============ */}
      {showTocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Import Table of Contents</h2>
            <p className="text-sm text-gray-500 mb-4">
              Upload a photo of the book's Table of Contents page, or enter chapters and topics manually.
            </p>

            {tocStep === 'input' && (
              <>
                {/* Mode Toggle Tabs */}
                <div className="flex border-b border-gray-200 mb-4">
                  <button
                    onClick={() => setTocMode('paste')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      tocMode === 'paste'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Manual Entry
                  </button>
                  <button
                    onClick={() => setTocMode('upload')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      tocMode === 'upload'
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Upload Photo
                  </button>
                </div>

                {/* Upload Photo Mode */}
                {tocMode === 'upload' && (
                  <div>
                    {!tocImagePreview ? (
                      <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
                        <svg className="w-10 h-10 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-sm text-gray-500">Click to select or take a photo of the Table of Contents page</span>
                        <span className="text-xs text-gray-400 mt-1">JPEG, PNG, or WebP (max 10MB)</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          capture="environment"
                          onChange={handleTocImageSelect}
                          className="hidden"
                        />
                      </label>
                    ) : (
                      <div className="space-y-3">
                        <div className="relative rounded-lg overflow-hidden border border-gray-200">
                          <div className="w-full flex justify-center bg-gray-50 py-2">
                            <div className="relative inline-block">
                              {tocImageWizardStep === 2 ? (
                                <ReactCrop
                                  crop={tocCrop}
                                  onChange={(c) => setTocCrop(c)}
                                  onComplete={(c) => setTocCompletedCrop(c)}
                                  aspect={tocCropAspect === 'free' ? undefined : Number(tocCropAspect)}
                                  minWidth={20}
                                  minHeight={20}
                                  ruleOfThirds
                                >
                                  <img
                                    ref={tocCropImageRef}
                                    src={tocImagePreview}
                                    alt="Crop TOC"
                                    className="max-h-80 w-auto object-contain block"
                                  />
                                </ReactCrop>
                              ) : (
                                <img
                                  ref={tocPreviewImageRef}
                                  src={tocDisplayPreviewUrl}
                                  alt={tocDisplayPreviewAlt}
                                  className="max-h-64 w-auto object-contain transition-transform duration-150"
                                  style={tocDisplayPreviewStyle}
                                />
                              )}

                              {tocImageWizardStep === 1 && (
                                <>
                                  {/* Rotate Left — left edge */}
                                  <button
                                    type="button"
                                    onClick={() => handleRotateTocImage('left')}
                                    disabled={ocrLoading || tocImageProcessing}
                                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center shadow-lg transition-colors"
                                    title="Rotate Left 90°"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                    </svg>
                                  </button>
                                  {/* Rotate Right — right edge */}
                                  <button
                                    type="button"
                                    onClick={() => handleRotateTocImage('right')}
                                    disabled={ocrLoading || tocImageProcessing}
                                    className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center shadow-lg transition-colors"
                                    title="Rotate Right 90°"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                                    </svg>
                                  </button>
                                </>
                              )}

                              {tocImageWizardStep === 3 && !hasPendingLinearTransforms && (
                                <>
                                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                    <polyline
                                      points={`${tocPerspectiveCorners.tl.x * 100},${tocPerspectiveCorners.tl.y * 100} ${tocPerspectiveCorners.tr.x * 100},${tocPerspectiveCorners.tr.y * 100} ${tocPerspectiveCorners.br.x * 100},${tocPerspectiveCorners.br.y * 100} ${tocPerspectiveCorners.bl.x * 100},${tocPerspectiveCorners.bl.y * 100} ${tocPerspectiveCorners.tl.x * 100},${tocPerspectiveCorners.tl.y * 100}`}
                                      fill="rgba(14, 165, 233, 0.12)"
                                      stroke="rgba(2, 132, 199, 0.9)"
                                      strokeWidth="1.5"
                                    />
                                  </svg>

                                  {Object.entries(tocPerspectiveCorners).map(([key, corner]) => (
                                    <div
                                      key={key}
                                      className="absolute"
                                      style={{
                                        left: `${corner.x * 100}%`,
                                        top: `${corner.y * 100}%`,
                                        transform: 'translate(-50%, -50%)',
                                      }}
                                    >
                                      <button
                                        type="button"
                                        onMouseDown={(e) => {
                                          e.preventDefault()
                                          setTocDraggingCornerKey(key)
                                        }}
                                        onTouchStart={(e) => {
                                          e.preventDefault()
                                          setTocDraggingCornerKey(key)
                                        }}
                                        className="w-4 h-4 rounded-full border-2 border-white bg-blue-600 shadow cursor-move touch-none"
                                        title={`Drag ${key.toUpperCase()} corner`}
                                      />
                                      <span
                                        className={`absolute text-[10px] font-semibold text-blue-900 bg-white/90 border border-blue-200 rounded px-1 py-0.5 pointer-events-none whitespace-nowrap ${
                                          key === 'tl'
                                            ? '-top-6 -left-1'
                                            : key === 'tr'
                                              ? '-top-6 -right-1'
                                              : key === 'br'
                                                ? 'top-3 -right-1'
                                                : 'top-3 -left-1'
                                        }`}
                                      >
                                        {key.toUpperCase()}
                                      </span>
                                    </div>
                                  ))}
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={() => {
                              setTocImageFile(null)
                              if (tocImagePreview) URL.revokeObjectURL(tocImagePreview)
                              setTocImagePreview(null)
                              setTocImageRotation(0)
                              setTocImageSkewX(0)
                              setTocImageSkewY(0)
                              setTocImageWizardStep(1)
                              if (tocFinalPreviewUrl) URL.revokeObjectURL(tocFinalPreviewUrl)
                              setTocFinalPreviewUrl(null)
                              setTocFinalPreviewLoading(false)
                              resetTocPerspectiveCorners()
                              setTocCropModalOpen(false)
                            }}
                            className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 hover:bg-red-600"
                            title="Remove image"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            {[1, 2, 3, 4].map((step) => (
                              <button
                                key={`wiz-step-${step}`}
                                type="button"
                                onClick={() => setTocImageWizardStep(step)}
                                className={`text-xs px-2 py-1 rounded border ${
                                  tocImageWizardStep === step
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'
                                }`}
                              >
                                {step === 1 ? '1. Rotate' : step === 2 ? '2. Crop' : step === 3 ? '3. Skew' : '4. OCR'}
                              </button>
                            ))}
                          </div>

                          {tocImageWizardStep === 1 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-700">Step 1: Rotate / Align</p>
                              <p className="text-xs text-gray-500">Use the arrow buttons on the image to rotate.</p>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => bakeRotationAndAdvance(2)}
                                  disabled={ocrLoading || tocImageProcessing}
                                  className="btn btn-primary text-sm"
                                >
                                  {tocImageProcessing ? 'Processing...' : 'Next: Crop'}
                                </button>
                              </div>
                            </div>
                          )}

                          {tocImageWizardStep === 2 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-700">Step 2: Crop</p>
                              <p className="text-xs text-gray-500">Draw a rectangle on the image above. Drag handles to resize, drag inside to move.</p>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => { setTocCrop(undefined); setTocCompletedCrop(null) }}
                                  disabled={ocrLoading || tocImageProcessing}
                                  className="btn btn-secondary text-xs"
                                >
                                  Clear Selection
                                </button>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => setTocImageWizardStep(1)} className="btn btn-secondary text-sm">Back</button>
                                <button
                                  type="button"
                                  onClick={handleSaveTocCrop}
                                  disabled={ocrLoading || tocImageProcessing || !tocCompletedCrop}
                                  className="btn btn-secondary text-sm"
                                >
                                  {tocImageProcessing ? 'Applying...' : 'Apply Crop'}
                                </button>
                                <button type="button" onClick={() => setTocImageWizardStep(3)} className="btn btn-primary text-sm">Next: Skew</button>
                              </div>
                            </div>
                          )}

                          {tocImageWizardStep === 3 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-700">Step 3: Perspective / Skew</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="text-xs text-gray-600 space-y-1 block">
                                  <span>Corner Skew X ({tocImageSkewX}deg)</span>
                                  <input
                                    type="range"
                                    min={-20}
                                    max={20}
                                    step={1}
                                    value={tocImageSkewX}
                                    onChange={(e) => setTocImageSkewX(parseInt(e.target.value, 10) || 0)}
                                    className="w-full"
                                    disabled={ocrLoading || tocImageProcessing}
                                  />
                                </label>
                                <label className="text-xs text-gray-600 space-y-1 block">
                                  <span>Corner Skew Y ({tocImageSkewY}deg)</span>
                                  <input
                                    type="range"
                                    min={-20}
                                    max={20}
                                    step={1}
                                    value={tocImageSkewY}
                                    onChange={(e) => setTocImageSkewY(parseInt(e.target.value, 10) || 0)}
                                    className="w-full"
                                    disabled={ocrLoading || tocImageProcessing}
                                  />
                                </label>
                              </div>

                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={handleApplyTocSkew} disabled={ocrLoading || tocImageProcessing} className="btn btn-secondary text-sm">
                                  Apply Skew Correction
                                </button>
                                <button
                                  type="button"
                                  onClick={handleApplyTocPerspective}
                                  disabled={ocrLoading || tocImageProcessing || hasPendingLinearTransforms}
                                  className="btn btn-secondary text-sm"
                                  title={hasPendingLinearTransforms ? 'Apply/reset rotate-skew first, then perspective.' : 'Apply 4-corner perspective correction'}
                                >
                                  Apply Perspective
                                </button>
                                <button type="button" onClick={resetTocPerspectiveCorners} disabled={ocrLoading || tocImageProcessing} className="btn btn-secondary text-sm">
                                  Reset Corners
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTocImageRotation(0)
                                    setTocImageSkewX(0)
                                    setTocImageSkewY(0)
                                  }}
                                  disabled={ocrLoading || tocImageProcessing}
                                  className="btn btn-secondary text-sm"
                                >
                                  Reset Transforms
                                </button>
                              </div>

                              <p className="text-xs text-gray-500">
                                Perspective: drag the 4 blue handles to page corners, then apply perspective correction.
                              </p>
                              <p className="text-xs text-gray-500">
                                Handles snap to edges when close to image bounds for easier alignment.
                              </p>
                              {hasPendingLinearTransforms && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                                  Apply or reset rotate/skew before applying perspective correction.
                                </p>
                              )}
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => setTocImageWizardStep(2)} className="btn btn-secondary text-sm">Back</button>
                                <button type="button" onClick={() => setTocImageWizardStep(4)} className="btn btn-primary text-sm">Next: OCR</button>
                              </div>
                            </div>
                          )}

                          {tocImageWizardStep === 4 && (
                            <div className="space-y-2">
                              <p className="text-xs font-medium text-gray-700">Step 4: Run OCR</p>
                              <p className="text-xs text-gray-500">
                                The preview above is the final processed area that will be sent to OCR, not the full original photo.
                              </p>
                              <button
                                onClick={handleOcrExtract}
                                disabled={ocrLoading || tocImageProcessing}
                                className="btn btn-primary w-full"
                              >
                                {ocrLoading ? (
                                  <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    Extracting text...
                                  </span>
                                ) : tocImageProcessing ? (
                                  'Processing image...'
                                ) : 'Extract Text from Image'}
                              </button>
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => setTocImageWizardStep(3)} className="btn btn-secondary text-sm">Back</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Type/Paste Mode */}
                {tocMode === 'paste' && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">Type chapter and topic titles directly in separate fields.</p>
                    {tocChapters.map((chapter, chapterIndex) => (
                      <div key={chapterIndex} className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-gray-500 w-14">Ch {chapterIndex + 1}</span>
                          <input
                            type="text"
                            className="input flex-1"
                            placeholder="Type chapter title..."
                            value={chapter.title}
                            onChange={(e) => updateTocChapterTitle(chapterIndex, e.target.value)}
                          />
                          <button
                            onClick={() => removeTocChapter(chapterIndex)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Delete
                          </button>
                        </div>

                        <div className="space-y-2 ml-2">
                          {(chapter.topics || []).map((topic, topicIndex) => (
                            <div key={topicIndex} className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-20">
                                {chapterIndex + 1}.{topicIndex + 1}
                              </span>
                              <input
                                type="text"
                                className="input flex-1"
                                placeholder="Type topic title..."
                                value={topic.title}
                                onChange={(e) => updateTocTopicTitle(chapterIndex, topicIndex, e.target.value)}
                              />
                              <button
                                onClick={() => removeTocTopic(chapterIndex, topicIndex)}
                                className="text-xs text-red-600 hover:text-red-800 font-medium"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={() => addTocTopic(chapterIndex)}
                          className="mt-2 text-sm text-primary-600 hover:text-primary-800 font-medium"
                        >
                          + Add Topic
                        </button>
                      </div>
                    ))}

                    <button onClick={addTocChapter} className="btn btn-secondary text-sm">
                      Add Chapter
                    </button>
                  </div>
                )}

                {tocMode === 'upload' && tocText.trim() && (
                  <div className="mt-4">
                    <label className="label">Extracted Text (clean up here)</label>
                    <textarea
                      className="input font-mono text-sm"
                      data-rawarea="true"
                      rows={10}
                      dir={isRTLLanguage(bookTree?.language) ? 'rtl' : 'ltr'}
                      placeholder="OCR output will appear here..."
                      value={tocText}
                      onChange={(e) => {
                        const nextText = e.target.value
                        setTocText(nextText)
                        setTocOcrLines(parseOcrLinesFromText(nextText))
                        clearTocSuggestionState()
                        if (selectedOcrLineId && !parseOcrLinesFromText(nextText).some((line) => line.id === selectedOcrLineId)) {
                          setSelectedOcrLineId(null)
                        }
                      }}
                      onKeyDown={(e) => {
                        // Only handle merge logic, let all other keys act as normal
                        if (e.key === 'Backspace') {
                          const textarea = e.target
                          const value = textarea.value
                          const selectionStart = textarea.selectionStart
                          const selectionEnd = textarea.selectionEnd
                          // Only at start of a line, no selection
                          if (selectionStart === selectionEnd && selectionStart > 0) {
                            // Find previous newline
                            const before = value.slice(0, selectionStart)
                            const lastNewline = before.lastIndexOf('\n')
                            if (lastNewline >= 0 && selectionStart === lastNewline + 1) {
                              // Prevent default backspace
                              e.preventDefault()
                              // Merge this line with previous
                              const after = value.slice(selectionEnd)
                              const merged = value.slice(0, lastNewline) + after
                              setTocText(merged)
                              setTocOcrLines(parseOcrLinesFromText(merged))
                              clearTocSuggestionState()
                              // Move caret to end of previous line
                              setTimeout(() => {
                                textarea.selectionStart = textarea.selectionEnd = lastNewline
                              }, 0)
                            }
                          }
                        }
                      }}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Clean up the text above, then click <b>Build Structure from Text</b> to extract chapters/topics.
                    </p>
                    <button
                      onClick={handleSuggestToc}
                      disabled={suggestTocMutation.isPending || !tocText.trim()}
                      className="btn btn-secondary mt-2"
                    >
                      {suggestTocMutation.isPending ? 'Building Structure...' : 'Build Structure from Text'}
                    </button>
                  </div>
                )}

                {tocMode === 'upload' && tocOcrLines.length > 0 && (
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedOcrMapping((prev) => !prev)}
                      className="btn btn-sm btn-secondary"
                    >
                      {showAdvancedOcrMapping ? 'Hide' : 'Show'} Advanced OCR Lines Panel
                    </button>
                    {showAdvancedOcrMapping && (
                      <div className="mt-2 rounded-lg border border-gray-200 p-3 bg-gray-50 space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">OCR Lines (Advanced)</p>
                            <p className="text-xs text-gray-500">
                              C=Chapter | T=Topic | E=Edit | Delete=Remove line | Ctrl+Z/Y=Undo/Redo | ↑↓=Navigate
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                              Use per-line mapping only if you want fine control. Most users can ignore this panel.
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={handleUndo}
                              disabled={undoStackLines.length === 0}
                              className="btn btn-sm text-xs"
                              title="Undo (Ctrl+Z)"
                            >
                              ↶ Undo
                            </button>
                            <button
                              type="button"
                              onClick={handleRedo}
                              disabled={redoStackLines.length === 0}
                              className="btn btn-sm text-xs"
                              title="Redo (Ctrl+Y)"
                            >
                              ↷ Redo
                            </button>
                          </div>
                        </div>
                        {/* ...existing OCR lines panel code here, unchanged... */}
                        <div className="max-h-72 overflow-y-auto space-y-2 border border-gray-200 rounded-md bg-white p-2">
                          {tocOcrLines.map((line) => {
                            const isEditing = editingLineId === line.id
                            return (
                              <div
                                key={line.id}
                                className={`px-2 py-2 rounded border transition-colors ${
                                  selectedOcrLineId === line.id
                                    ? 'bg-blue-50 border-blue-300'
                                    : 'bg-white border-gray-200 hover:bg-gray-50'
                                }`}
                              >
                                {isEditing ? (
                                  <div className="space-y-2">
                                    <input
                                      type="text"
                                      autoFocus
                                      value={editingLineText}
                                      onChange={(e) => setEditingLineText(e.target.value)}
                                      className="input input-sm w-full"
                                      placeholder="Edit line text..."
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          saveLine(line.id)
                                        } else if (e.key === 'Escape') {
                                          setEditingLineId(null)
                                          setEditingLineText('')
                                        }
                                      }}
                                    />
                                    <div className="flex gap-1">
                                      <button
                                        type="button"
                                        onClick={() => saveLine(line.id)}
                                        className="btn btn-primary btn-sm text-xs flex-1"
                                      >
                                        Save
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingLineId(null)
                                          setEditingLineText('')
                                        }}
                                        className="btn btn-secondary btn-sm text-xs flex-1"
                                      >
                                        Cancel
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    className="cursor-pointer hover:opacity-75 transition-opacity"
                                    onClick={() => setSelectedOcrLineId(line.id)}
                                  >
                                    <div className="flex items-start gap-2">
                                      <span className="text-xs text-gray-500 mt-0.5 min-w-fit">
                                        {line.line_number}.
                                      </span>
                                      <span className="text-sm flex-1">{line.text}</span>
                                      {line.mappedAs && (
                                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 whitespace-nowrap">
                                          {line.mappedAs === 'chapter'
                                            ? 'Mapped: Chapter'
                                            : 'Mapped: Topic'}
                                        </span>
                                      )}
                                    </div>
                                    {selectedOcrLineId === line.id && (
                                      <div className="space-y-2 mt-2">
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                          <div className={`rounded border px-2 py-1 text-xs ${
                                            line.mappedAs === 'chapter'
                                              ? 'border-blue-300 bg-blue-50 text-blue-800'
                                              : 'border-gray-200 bg-white text-gray-400'
                                          }`}>
                                            <span className="font-semibold">Chapter Placeholder:</span>{' '}
                                            {line.mappedAs === 'chapter'
                                              ? `${line.mappedNumber ? `Ch ${line.mappedNumber}` : 'Chapter'} - ${line.text}`
                                              : 'Empty'}
                                          </div>
                                          <div className={`rounded border px-2 py-1 text-xs ml-4 sm:ml-6 ${
                                            (line.mappedAs || '').startsWith('topic:')
                                              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                                              : 'border-gray-200 bg-white text-gray-400'
                                          }`}>
                                            <span className="font-semibold">Topic Placeholder:</span>{' '}
                                            {(line.mappedAs || '').startsWith('topic:')
                                              ? `${line.mappedNumber ? `T ${line.mappedNumber}` : 'Topic'} - ${line.text}`
                                              : 'Empty'}
                                          </div>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              mapOcrLineAsChapter(line)
                                            }}
                                            className="text-xs text-blue-700 hover:text-blue-900 font-medium"
                                            title="Place in Chapter placeholder"
                                          >
                                            ⇢ Place as Chapter
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              mapOcrLineAsTopic(line, targetChapterIndex)
                                            }}
                                            className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
                                            title="Place in Topic placeholder"
                                          >
                                            ⇢ Place as Topic
                                          </button>
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              startEditingLine(line.id, line.text)
                                            }}
                                            className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                                            title="Edit (E)"
                                          >
                                            ✎ Edit
                                          </button>
                                          {tocOcrLines.findIndex((l) => l.id === line.id) <
                                            tocOcrLines.length - 1 && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation()
                                                mergeWithNext(line.id)
                                              }}
                                              className="text-xs text-orange-600 hover:text-orange-800 font-medium"
                                              title="Merge with next line"
                                            >
                                              ⤵ Merge
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              handleDeleteOcrLine(line.id)
                                            }}
                                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                                            title="Delete line (undo supported)"
                                          >
                                            🗑 Delete
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {tocSuggestionItems.length > 0 && (
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-blue-900">AI Suggestions</p>
                        <p className="text-xs text-blue-700">
                          Suggestions are staged separately. Use or ignore each one before review.
                        </p>
                      </div>
                      <button
                        onClick={handleUseHighConfidenceSuggestions}
                        className="btn btn-secondary text-sm"
                        disabled={pendingSuggestionCount === 0}
                      >
                        Use High Confidence
                      </button>
                    </div>

                    <div className="max-h-60 overflow-y-auto space-y-2">
                      {tocSuggestionItems.map((item) => (
                        <div key={item.id} className="rounded-md border border-blue-100 bg-white p-2">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                            <div>
                              <p className="text-sm text-gray-900">
                                {item.kind === 'chapter' ? 'Chapter:' : 'Topic:'} {item.title}
                              </p>
                              {item.kind === 'topic' && !!item.chapterTitle && (
                                <p className="text-xs text-gray-500">Suggested chapter: {item.chapterTitle}</p>
                              )}
                              <p className="text-xs text-gray-500">
                                Confidence: {Math.round((item.confidence || 0) * 100)}%
                              </p>
                            </div>

                            {item.status === 'pending' ? (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleUseSuggestion(item)}
                                  className="btn btn-primary text-xs px-3 py-1"
                                >
                                  {item.kind === 'chapter' ? 'Use as Chapter' : 'Use as Topic'}
                                </button>
                                <button
                                  onClick={() => handleIgnoreSuggestion(item)}
                                  className="btn btn-secondary text-xs px-3 py-1"
                                >
                                  Ignore
                                </button>
                              </div>
                            ) : (
                              <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                                item.status === 'used'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-gray-100 text-gray-600'
                              }`}>
                                {item.status === 'used' ? 'Used' : 'Ignored'}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {tocStep === 'review' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    Review and correct structure before saving.
                  </p>
                  <div className="flex items-center gap-2">
                    {tocSuggestionMeta && (
                      <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                        {tocSuggestionMeta.source === 'ai' ? 'AI suggested' : tocSuggestionMeta.source === 'manual' ? 'Manual' : 'Rule-based'}
                        {typeof tocSuggestionMeta.confidence === 'number' && ` • ${Math.round(tocSuggestionMeta.confidence * 100)}%`}
                      </span>
                    )}
                    <button onClick={addTocChapter} className="btn btn-secondary text-sm">
                      Add Chapter
                    </button>
                  </div>
                </div>

                {tocWarnings.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-800 mb-1">Parser notes</p>
                    <div className="max-h-28 overflow-y-auto space-y-1">
                      {tocWarnings.map((warning, idx) => (
                        <p key={idx} className="text-xs text-amber-700">• {warning}</p>
                      ))}
                    </div>
                  </div>
                )}

                {tocSuggestionItems.length > 0 && (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-blue-800">
                        Pending AI suggestions: {pendingSuggestionCount}
                      </p>
                      <button
                        onClick={handleUseHighConfidenceSuggestions}
                        className="text-xs text-blue-700 hover:text-blue-900 font-medium"
                        disabled={pendingSuggestionCount === 0}
                      >
                        Use High Confidence
                      </button>
                    </div>
                  </div>
                )}

                {tocChapters.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 text-center">
                    No chapters parsed yet. Add chapters manually.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {tocChapters.map((chapter, chapterIndex) => (
                      <div key={chapterIndex} className="rounded-lg border border-gray-200 p-3 bg-gray-50">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-gray-500 w-14">Ch {chapterIndex + 1}</span>
                          <input
                            type="text"
                            className="input flex-1"
                            placeholder="Chapter title"
                            value={chapter.title}
                            onChange={(e) => updateTocChapterTitle(chapterIndex, e.target.value)}
                          />
                          <button
                            onClick={() => removeTocChapter(chapterIndex)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Delete
                          </button>
                        </div>

                        <div className="space-y-2 ml-2">
                          {(chapter.topics || []).map((topic, topicIndex) => (
                            <div key={topicIndex} className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 w-20">
                                {chapterIndex + 1}.{topicIndex + 1}
                              </span>
                              <input
                                type="text"
                                className="input flex-1"
                                placeholder="Topic title"
                                value={topic.title}
                                onChange={(e) => updateTocTopicTitle(chapterIndex, topicIndex, e.target.value)}
                              />
                              <button
                                onClick={() => removeTocTopic(chapterIndex, topicIndex)}
                                className="text-xs text-red-600 hover:text-red-800 font-medium"
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                        </div>

                        <button
                          onClick={() => addTocTopic(chapterIndex)}
                          className="mt-2 text-sm text-primary-600 hover:text-primary-800 font-medium"
                        >
                          + Add Topic
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeTocModal} className="btn btn-secondary">
                Cancel
              </button>

              {tocStep === 'review' && (
                <button
                  onClick={() => setTocStep('input')}
                  className="btn btn-secondary"
                >
                  Back
                </button>
              )}

              {tocStep === 'input' && tocMode === 'upload' && !!tocText.trim() && (
                <>
                  <button
                    onClick={handleTocSubmit}
                    disabled={parseTocMutation.isPending || !tocText.trim()}
                    className="btn btn-primary"
                  >
                    {parseTocMutation.isPending ? 'Parsing...' : 'Next: Review'}
                  </button>
                </>
              )}

              {tocStep === 'input' && tocMode === 'paste' && (
                <button
                  onClick={handleManualTocReview}
                  className="btn btn-primary"
                >
                  Next: Review
                </button>
              )}

              {tocStep === 'review' && (
                <button
                  onClick={handleApplyToc}
                  disabled={applyTocMutation.isPending}
                  className="btn btn-primary"
                >
                  {applyTocMutation.isPending ? 'Applying...' : 'Apply to Book'}
                </button>
              )}
            </div>
          </div>


        </div>
      )}

      <ConfirmModalRoot />
    </div>
  )
}
