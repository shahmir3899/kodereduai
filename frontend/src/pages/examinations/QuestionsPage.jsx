import { useState, useMemo, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { questionPaperApi, lmsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import Toast from '../../components/Toast'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'

// ─── Constants ───────────────────────────────────────────────────────────────

const QUESTION_TYPES = [
  { value: 'MCQ', label: 'Multiple Choice', color: 'bg-blue-100 text-blue-700' },
  { value: 'TRUE_FALSE', label: 'True / False', color: 'bg-green-100 text-green-700' },
  { value: 'FILL_BLANK', label: 'Fill in Blank', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'SHORT', label: 'Short Answer', color: 'bg-orange-100 text-orange-700' },
  { value: 'LONG', label: 'Long Answer', color: 'bg-red-100 text-red-700' },
  { value: 'ESSAY', label: 'Essay', color: 'bg-purple-100 text-purple-700' },
  { value: 'MATCHING', label: 'Matching', color: 'bg-indigo-100 text-indigo-700' },
]

const DIFFICULTY_LEVELS = [
  { value: 'EASY', label: 'Easy', color: 'text-green-600' },
  { value: 'MEDIUM', label: 'Medium', color: 'text-yellow-600' },
  { value: 'HARD', label: 'Hard', color: 'text-red-600' },
]

const BLOOM_LEVELS = [
  { value: 'remember', label: 'Remember', color: 'bg-gray-100 text-gray-700' },
  { value: 'understand', label: 'Understand', color: 'bg-blue-100 text-blue-700' },
  { value: 'apply', label: 'Apply', color: 'bg-green-100 text-green-700' },
  { value: 'analyze', label: 'Analyze', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'evaluate', label: 'Evaluate', color: 'bg-orange-100 text-orange-700' },
  { value: 'create', label: 'Create', color: 'bg-red-100 text-red-700' },
]

const TAG_TYPE_COLORS = {
  concept: 'bg-blue-100 text-blue-700',
  skill: 'bg-green-100 text-green-700',
  keyword: 'bg-amber-100 text-amber-700',
  standard: 'bg-purple-100 text-purple-700',
}

const TYPE_COLOR = Object.fromEntries(QUESTION_TYPES.map((t) => [t.value, t.color]))
const TYPE_LABEL = Object.fromEntries(QUESTION_TYPES.map((t) => [t.value, t.label]))

const EMPTY_FORM = {
  subject: '',
  question_text: '',
  question_type: 'MCQ',
  difficulty_level: 'MEDIUM',
  bloom_level: '',
  marks: 1,
  option_a: '',
  option_b: '',
  option_c: '',
  option_d: '',
  correct_answer: '',
  answer_text: '',
  type_data: {},
  tested_topics: [],
  source_content_block: '',
  // matching helpers (not sent directly)
  matching_left: ['', ''],
  matching_right: ['', ''],
  matching_pairs: [
    { left: 0, right: 0 },
    { left: 1, right: 1 },
  ],
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPayload(form) {
  const sourceBlockId = parseInt(form.source_content_block, 10)
  const base = {
    subject: form.subject,
    question_text: form.question_text,
    question_type: form.question_type,
    difficulty_level: form.difficulty_level,
    bloom_level: form.bloom_level || null,
    marks: parseFloat(form.marks) || 1,
    answer_text: form.answer_text,
    tested_topics: form.tested_topics,
    source_content_block: Number.isFinite(sourceBlockId) ? sourceBlockId : null,
  }

  if (form.question_type === 'MCQ') {
    return {
      ...base,
      option_a: form.option_a,
      option_b: form.option_b,
      option_c: form.option_c,
      option_d: form.option_d,
      correct_answer: form.correct_answer,
    }
  }

  if (form.question_type === 'TRUE_FALSE') {
    return { ...base, correct_answer: form.correct_answer }
  }

  if (form.question_type === 'MATCHING') {
    const left_items = form.matching_left.filter((v) => v.trim())
    const right_items = form.matching_right.filter((v) => v.trim())
    const pairs = form.matching_pairs
      .filter((p) => left_items[p.left] !== undefined && right_items[p.right] !== undefined)
      .map((p) => ({ left: p.left, right: p.right }))
    return { ...base, type_data: { left_items, right_items, pairs } }
  }

  if (form.question_type === 'FILL_BLANK') {
    const accepted = form.answer_text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return { ...base, type_data: { accepted_answers: accepted } }
  }

  return base
}

function formFromQuestion(q) {
  const td = q.type_data || {}
  const sourceContentBlockId = typeof q.source_content_block === 'object'
    ? q.source_content_block?.id
    : q.source_content_block
  return {
    subject: q.subject,
    question_text: q.question_text || '',
    question_type: q.question_type || 'MCQ',
    difficulty_level: q.difficulty_level || 'MEDIUM',
    bloom_level: q.bloom_level || '',
    marks: q.marks || 1,
    option_a: q.option_a || '',
    option_b: q.option_b || '',
    option_c: q.option_c || '',
    option_d: q.option_d || '',
    correct_answer: q.correct_answer || '',
    answer_text:
      q.answer_text ||
      (q.question_type === 'FILL_BLANK' && td.accepted_answers
        ? td.accepted_answers.join(', ')
        : ''),
    type_data: td,
    tested_topics: (q.tested_topics || []).map((t) => (typeof t === 'object' ? t.id : t)),
    source_content_block: sourceContentBlockId || '',
    matching_left: td.left_items?.length ? td.left_items : ['', ''],
    matching_right: td.right_items?.length ? td.right_items : ['', ''],
    matching_pairs: td.pairs?.length ? td.pairs : [{ left: 0, right: 0 }, { left: 1, right: 1 }],
  }
}

function extractQuestionTags(question) {
  const rawTags = question?.tags || question?.question_tags || question?.tag_details || []
  if (!Array.isArray(rawTags)) return []
  return rawTags
    .map((tag) => {
      if (typeof tag === 'object' && tag !== null) {
        return {
          id: tag.id,
          name: tag.name || `Tag #${tag.id}`,
          tag_type: tag.tag_type || 'keyword',
        }
      }
      const numericId = parseInt(tag, 10)
      return Number.isFinite(numericId)
        ? { id: numericId, name: `Tag #${numericId}`, tag_type: 'keyword' }
        : null
    })
    .filter(Boolean)
}

function extractQuestionTagIds(question) {
  return extractQuestionTags(question).map((tag) => tag.id)
}

// ─── Type-aware form sections ─────────────────────────────────────────────────

function MCQFields({ form, setForm, errors }) {
  return (
    <div className="space-y-3 p-4 bg-blue-50 rounded-lg border border-blue-200">
      <p className="text-sm font-semibold text-blue-800">Answer Options</p>
      {['A', 'B', 'C', 'D'].map((opt) => (
        <div key={opt} className="flex items-center gap-3">
          <input
            type="radio"
            name="correct_answer"
            value={opt}
            checked={form.correct_answer === opt}
            onChange={(e) => setForm({ ...form, correct_answer: e.target.value })}
            className="accent-blue-600"
          />
          <span className="font-bold text-gray-700 w-5">{opt}.</span>
          <input
            type="text"
            value={form[`option_${opt.toLowerCase()}`]}
            onChange={(e) =>
              setForm({ ...form, [`option_${opt.toLowerCase()}`]: e.target.value })
            }
            placeholder={`Option ${opt}`}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
          />
        </div>
      ))}
      {errors.options && <p className="text-red-500 text-xs">{errors.options}</p>}
      {errors.correct_answer && (
        <p className="text-red-500 text-xs">{errors.correct_answer}</p>
      )}
      <p className="text-xs text-blue-600">Select the radio button next to the correct option.</p>
    </div>
  )
}

function TrueFalseFields({ form, setForm, errors }) {
  return (
    <div className="p-4 bg-green-50 rounded-lg border border-green-200">
      <p className="text-sm font-semibold text-green-800 mb-3">Correct Answer</p>
      <div className="flex gap-6">
        {['TRUE', 'FALSE'].map((val) => (
          <label key={val} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="tf_correct"
              value={val}
              checked={form.correct_answer === val}
              onChange={(e) => setForm({ ...form, correct_answer: e.target.value })}
              className="accent-green-600"
            />
            <span
              className={`font-medium ${val === 'TRUE' ? 'text-green-700' : 'text-red-700'}`}
            >
              {val}
            </span>
          </label>
        ))}
      </div>
      {errors.correct_answer && (
        <p className="text-red-500 text-xs mt-2">{errors.correct_answer}</p>
      )}
    </div>
  )
}

function FillBlankFields({ form, setForm, errors }) {
  return (
    <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
      <label className="block text-sm font-semibold text-yellow-800 mb-1">
        Accepted Answers{' '}
        <span className="font-normal text-gray-600">(comma-separated)</span>
      </label>
      <input
        type="text"
        value={form.answer_text}
        onChange={(e) => setForm({ ...form, answer_text: e.target.value })}
        placeholder="e.g.  photosynthesis, Photosynthesis"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500 text-sm"
      />
      {errors.answer_text && <p className="text-red-500 text-xs mt-1">{errors.answer_text}</p>}
    </div>
  )
}

function ModelAnswerField({ form, setForm, errors, label = 'Model Answer / Expected Response' }) {
  return (
    <div className="p-4 bg-orange-50 rounded-lg border border-orange-200">
      <label className="block text-sm font-semibold text-orange-800 mb-1">{label}</label>
      <textarea
        value={form.answer_text}
        onChange={(e) => setForm({ ...form, answer_text: e.target.value })}
        placeholder="Enter the expected answer or marking guide..."
        rows={3}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 text-sm resize-y"
      />
      {errors.answer_text && <p className="text-red-500 text-xs mt-1">{errors.answer_text}</p>}
    </div>
  )
}

function MatchingFields({ form, setForm, errors }) {
  const addRow = () => {
    const idx = form.matching_left.length
    setForm({
      ...form,
      matching_left: [...form.matching_left, ''],
      matching_right: [...form.matching_right, ''],
      matching_pairs: [...form.matching_pairs, { left: idx, right: idx }],
    })
  }

  const removeRow = (i) => {
    setForm({
      ...form,
      matching_left: form.matching_left.filter((_, idx) => idx !== i),
      matching_right: form.matching_right.filter((_, idx) => idx !== i),
      matching_pairs: form.matching_pairs
        .filter((p) => p.left !== i && p.right !== i)
        .map((p) => ({
          left: p.left > i ? p.left - 1 : p.left,
          right: p.right > i ? p.right - 1 : p.right,
        })),
    })
  }

  return (
    <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-200 space-y-3">
      <p className="text-sm font-semibold text-indigo-800">
        Matching Pairs{' '}
        <span className="font-normal text-gray-600">(left column ↔ right column)</span>
      </p>
      {form.matching_left.map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-5">{i + 1}.</span>
          <input
            type="text"
            value={form.matching_left[i]}
            onChange={(e) => {
              const next = [...form.matching_left]
              next[i] = e.target.value
              setForm({ ...form, matching_left: next })
            }}
            placeholder="Left item"
            className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
          />
          <span className="text-gray-400">↔</span>
          <input
            type="text"
            value={form.matching_right[i]}
            onChange={(e) => {
              const next = [...form.matching_right]
              next[i] = e.target.value
              setForm({ ...form, matching_right: next })
            }}
            placeholder="Right item"
            className="flex-1 px-2 py-1.5 border border-gray-300 rounded text-sm"
          />
          {form.matching_left.length > 2 && (
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="text-red-400 hover:text-red-600 text-xs px-1"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {errors.type_data && <p className="text-red-500 text-xs">{errors.type_data}</p>}
      <button
        type="button"
        onClick={addRow}
        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
      >
        + Add row
      </button>
    </div>
  )
}

// ─── Topic Picker ─────────────────────────────────────────────────────────────

function TopicPicker({ classId, subjectId, selectedTopics, onChange, initialBookId, initialChapterId }) {
  const [selectedBook, setSelectedBook] = useState('')
  const [selectedChapter, setSelectedChapter] = useState('')

  const { data: booksData } = useQuery({
    queryKey: ['lms-books-for-class-subject', classId, subjectId],
    queryFn: () => lmsApi.getBooksForClassSubject({ class_id: classId, subject_id: subjectId }),
    enabled: !!classId && !!subjectId,
  })
  const books = booksData?.data?.results || booksData?.data || []

  useEffect(() => {
    if (initialBookId && books.some((book) => String(book.id) === String(initialBookId))) {
      setSelectedBook(String(initialBookId))
      return
    }
    if (!selectedBook && books.length === 1) {
      setSelectedBook(String(books[0].id))
    }
  }, [books, initialBookId, selectedBook])

  const { data: treeData } = useQuery({
    queryKey: ['lms-book-tree', selectedBook],
    queryFn: () => lmsApi.getBookTree(selectedBook),
    enabled: !!selectedBook,
  })
  const chapters = treeData?.data?.chapters || []

  useEffect(() => {
    if (initialChapterId && chapters.some((chapter) => String(chapter.id) === String(initialChapterId))) {
      setSelectedChapter(String(initialChapterId))
    }
  }, [initialChapterId, chapters])

  const allTopics = useMemo(() => {
    const list = []
    chapters.forEach((ch) => {
      if (selectedChapter && String(ch.id) !== String(selectedChapter)) {
        return
      }
      ;(ch.topics || []).forEach((t) => list.push({ ...t, chapterName: ch.name }))
    })
    return list
  }, [chapters, selectedChapter])

  const toggle = (topicId) => {
    if (selectedTopics.includes(topicId)) {
      onChange(selectedTopics.filter((id) => id !== topicId))
    } else {
      onChange([...selectedTopics, topicId])
    }
  }

  if (!classId || !subjectId) return null

  return (
    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
      <p className="text-sm font-semibold text-gray-700">
        Linked Topics{' '}
        <span className="font-normal text-gray-500">(optional — for curriculum coverage)</span>
      </p>

      {books.length > 0 ? (
        <>
          <select
            value={selectedBook}
            onChange={(e) => {
              setSelectedBook(e.target.value)
              setSelectedChapter('')
              onChange([])
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          >
            <option value="">-- Select a book to browse topics --</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>

          {chapters.length > 0 && (
            <select
              value={selectedChapter}
              onChange={(e) => {
                setSelectedChapter(e.target.value)
                onChange([])
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">-- All Chapters --</option>
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.chapter_number}. {ch.title}
                </option>
              ))}
            </select>
          )}

          {allTopics.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1.5">
              {allTopics.map((t) => (
                <label key={t.id} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedTopics.includes(t.id)}
                    onChange={() => toggle(t.id)}
                    className="accent-blue-600"
                  />
                  <span className="text-sm text-gray-700 group-hover:text-blue-700">
                    {t.name}
                  </span>
                  <span className="text-xs text-gray-400 ml-auto">{t.chapterName}</span>
                </label>
              ))}
            </div>
          )}

          {selectedTopics.length > 0 && (
            <p className="text-xs text-blue-600">
              {selectedTopics.length} topic{selectedTopics.length > 1 ? 's' : ''} linked
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-400">
          No curriculum books found for this subject. Create books in the Curriculum page first.
        </p>
      )}
    </div>
  )
}

// ─── Question Modal ───────────────────────────────────────────────────────────

function QuestionModal({ editQuestion, initialClassFilterId, initialSubject, initialTopicId, initialBookId, initialChapterId, onClose, onSaved }) {
  const isEdit = !!editQuestion
  const { isTeacher } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)

  const [modalClassFilterId, setModalClassFilterId] = useState(initialClassFilterId || '')
  const resolvedModalClassId = getResolvedMasterClassId(modalClassFilterId, activeAcademicYear?.id, sessionClasses)
  const { subjects: modalSubjectOptions } = useClassSubjects(resolvedModalClassId)
  const [modalSubject, setModalSubject] = useState(initialSubject || '')
  const [modalBookId, setModalBookId] = useState(initialBookId || '')
  const [modalChapterId, setModalChapterId] = useState(initialChapterId || '')

  useEffect(() => {
    if (!modalSubjectOptions.some((subject) => String(subject.id) === String(modalSubject))) {
      setModalSubject('')
      setModalBookId('')
      setModalChapterId('')
    }
  }, [modalSubjectOptions, modalSubject])

  const {
    showAllOption: modalShowAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass: modalClassFilterId,
    setSelectedClass: setModalClassFilterId,
    autoSelectFirst: true,
    queryKey: 'teacherQuestionModalClasses',
  })

  useEffect(() => {
    if (!isEdit) {
      setForm((prev) => ({ ...prev, subject: modalSubject, tested_topics: [] }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalSubject])

  const { data: modalBooksData } = useQuery({
    queryKey: ['question-modal-books', resolvedModalClassId, modalSubject],
    queryFn: () => lmsApi.getBooksForClassSubject({ class_id: resolvedModalClassId, subject_id: modalSubject }),
    enabled: !!resolvedModalClassId && !!modalSubject,
  })
  const modalBooks = modalBooksData?.data?.results || modalBooksData?.data || []

  const { data: modalBookTreeData, isLoading: modalChaptersLoading } = useQuery({
    queryKey: ['question-modal-book-tree', modalBookId],
    queryFn: () => lmsApi.getBookTree(modalBookId),
    enabled: !!modalBookId,
  })
  const modalChapters = modalBookTreeData?.data?.chapters || []

  const [form, setForm] = useState(
    isEdit
      ? formFromQuestion(editQuestion)
      : {
          ...EMPTY_FORM,
          subject: modalSubject || '',
          tested_topics: initialTopicId ? [Number(initialTopicId)] : [],
        },
  )
  const [errors, setErrors] = useState({})
  const [sourceSearch, setSourceSearch] = useState('')
  const [tagSearch, setTagSearch] = useState('')
  const [selectedTagIds, setSelectedTagIds] = useState(() => (isEdit ? extractQuestionTagIds(editQuestion) : []))
  const queryClient = useQueryClient()

  const { data: modalTagsData, isLoading: modalTagsLoading } = useQuery({
    queryKey: ['question-modal-tags', form.subject],
    queryFn: () => lmsApi.getTags({ subject_id: form.subject }),
    enabled: !!form.subject,
  })
  const modalTags = modalTagsData?.data?.results || modalTagsData?.data || []
  const filteredModalTags = useMemo(() => {
    const needle = tagSearch.trim().toLowerCase()
    if (!needle) return modalTags
    return modalTags.filter((tag) => String(tag.name || '').toLowerCase().includes(needle))
  }, [modalTags, tagSearch])

  const createTagMutation = useMutation({
    mutationFn: (data) => lmsApi.createTag(data),
    onSuccess: (response) => {
      const createdTag = response?.data
      queryClient.invalidateQueries({ queryKey: ['question-modal-tags'] })
      queryClient.invalidateQueries({ queryKey: ['question-filter-tags'] })
      if (createdTag?.id) {
        setSelectedTagIds((prev) => (prev.includes(createdTag.id) ? prev : [...prev, createdTag.id]))
      }
    },
  })

  const sourceTopicId = useMemo(() => {
    if (form.tested_topics?.length > 0) {
      const firstTopic = parseInt(form.tested_topics[0], 10)
      if (Number.isFinite(firstTopic)) return firstTopic
    }
    const initialTopic = parseInt(initialTopicId, 10)
    return Number.isFinite(initialTopic) ? initialTopic : null
  }, [form.tested_topics, initialTopicId])

  const {
    data: sourceBlocksData,
    isLoading: sourceBlocksLoading,
    isError: sourceBlocksError,
    error: sourceBlocksErrorObj,
  } = useQuery({
    queryKey: ['question-modal-source-content-blocks', sourceTopicId],
    queryFn: () => lmsApi.getContentBlocks({ topic_id: sourceTopicId, is_active: true }),
    enabled: !!sourceTopicId,
  })

  const sourceBlocks = sourceBlocksData?.data?.results || sourceBlocksData?.data || []
  const filteredSourceBlocks = useMemo(() => {
    const needle = sourceSearch.trim().toLowerCase()
    if (!needle) return sourceBlocks
    return sourceBlocks.filter((block) => {
      const label = `${block.block_type || ''} ${block.content_text || ''}`.toLowerCase()
      return label.includes(needle)
    })
  }, [sourceBlocks, sourceSearch])

  const formatSourceBlockOption = (block) => {
    const type = (block.block_type || 'text').replace(/_/g, ' ')
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1)
    const text = (block.content_text || '').trim()
    return `${typeLabel} — ${text.length > 60 ? `${text.slice(0, 60)}...` : text}`
  }

  const saveMutation = useMutation({
    mutationFn: (payload) =>
      isEdit
        ? questionPaperApi.updateQuestion(editQuestion.id, payload)
        : questionPaperApi.createQuestion(payload),
    onSuccess: async (response) => {
      const savedQuestionId = response?.data?.id || editQuestion?.id
      if (!isEdit && savedQuestionId && selectedTagIds.length > 0) {
        await Promise.all(
          selectedTagIds.map((tagId) => questionPaperApi.addQuestionTag(savedQuestionId, tagId)),
        )
      }
      queryClient.invalidateQueries({ queryKey: ['questions'] })
      onSaved()
    },
    onError: (err) => {
      const data = err.response?.data
      if (data && typeof data === 'object') {
        setErrors(data)
      } else {
        setErrors({ non_field_errors: [err.response?.data?.detail || 'Save failed'] })
      }
    },
  })

  const validate = () => {
    const e = {}
    if (!isEdit && !resolvedModalClassId) e.class_obj = 'Class is required'
    if (!form.subject) e.subject = 'Subject is required'
    if (!form.question_text.trim()) e.question_text = 'Question text is required'
    if (form.question_type === 'MCQ') {
      if (!form.option_a || !form.option_b) e.options = 'Options A and B are required'
      if (!['A', 'B', 'C', 'D'].includes(form.correct_answer))
        e.correct_answer = 'Select the correct option'
    }
    if (form.question_type === 'TRUE_FALSE') {
      if (!['TRUE', 'FALSE'].includes(form.correct_answer))
        e.correct_answer = 'Select True or False'
    }
    if (form.question_type === 'MATCHING') {
      const left = form.matching_left.filter((v) => v.trim())
      const right = form.matching_right.filter((v) => v.trim())
      if (left.length < 2 || right.length < 2)
        e.type_data = 'At least 2 pairs required for matching'
    }
    if (['FILL_BLANK', 'SHORT', 'LONG', 'ESSAY'].includes(form.question_type)) {
      if (!form.answer_text.trim()) e.answer_text = 'Model answer is required'
    }
    return e
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    saveMutation.mutate(buildPayload(form))
  }

  const handleSelectTag = async (tagId) => {
    if (!tagId) return
    if (selectedTagIds.includes(tagId)) return
    setSelectedTagIds((prev) => [...prev, tagId])

    if (isEdit && editQuestion?.id) {
      try {
        await questionPaperApi.addQuestionTag(editQuestion.id, tagId)
      } catch {
        setSelectedTagIds((prev) => prev.filter((id) => id !== tagId))
      }
    }
  }

  const handleRemoveTag = async (tagId) => {
    setSelectedTagIds((prev) => prev.filter((id) => id !== tagId))
    if (isEdit && editQuestion?.id) {
      try {
        await questionPaperApi.addQuestionTag(editQuestion.id, tagId, true)
      } catch {
        setSelectedTagIds((prev) => (prev.includes(tagId) ? prev : [...prev, tagId]))
      }
    }
  }

  const handleCreateTagFromSearch = () => {
    const name = tagSearch.trim()
    if (!name || !form.subject || createTagMutation.isPending) return
    createTagMutation.mutate({ name, tag_type: 'keyword', subject: form.subject })
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] overflow-y-auto">
      <div className="min-h-full flex items-start justify-center py-8 px-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">
              {isEdit ? 'Edit Question' : 'Add Question'}
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
            >
              ×
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Server non-field errors */}
            {errors.non_field_errors && (
              <p className="text-red-600 text-sm bg-red-50 p-3 rounded">
                {errors.non_field_errors.join(' ')}
              </p>
            )}

            {/* Context */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Class <span className="text-red-500">*</span>
                </label>
                <ClassSelector
                  value={modalClassFilterId}
                  onChange={(e) => {
                    const nextClass = e.target.value
                    setModalClassFilterId(nextClass)
                    setModalSubject('')
                    setModalBookId('')
                    setModalChapterId('')
                    if (!isEdit) {
                      setForm((prev) => ({ ...prev, subject: '', tested_topics: [] }))
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  scope={classSelectorScope}
                  academicYearId={activeAcademicYear?.id}
                  showAllOption={modalShowAllOption}
                  classes={teacherClassOptions || undefined}
                  required
                />
                {errors.class_obj && <p className="text-red-500 text-xs mt-1">{errors.class_obj}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject <span className="text-red-500">*</span>
                </label>
                <select
                  value={isEdit ? form.subject : modalSubject}
                  onChange={(e) => {
                    const nextSubject = e.target.value
                    setModalSubject(nextSubject)
                    setModalBookId('')
                    setModalChapterId('')
                    setForm({ ...form, subject: nextSubject, tested_topics: [] })
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  disabled={!resolvedModalClassId || modalSubjectOptions.length === 0}
                  required
                >
                  <option value="">
                    {!resolvedModalClassId
                      ? 'Select class first'
                      : modalSubjectOptions.length > 0
                        ? 'Select subject'
                        : 'No subjects assigned to this class'}
                  </option>
                  {modalSubjectOptions.map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.code ? `${subject.code} - ` : ''}{subject.name}
                    </option>
                  ))}
                </select>
                {errors.subject && <p className="text-red-500 text-xs mt-1">{errors.subject}</p>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Book</label>
                <select
                  value={modalBookId}
                  onChange={(e) => {
                    setModalBookId(e.target.value)
                    setModalChapterId('')
                    setForm({ ...form, tested_topics: [] })
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  disabled={!resolvedModalClassId || !form.subject || modalBooks.length === 0}
                >
                  <option value="">{modalBooks.length > 0 ? 'All Books' : 'No books found'}</option>
                  {modalBooks.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chapter</label>
                <select
                  value={modalChapterId}
                  onChange={(e) => {
                    setModalChapterId(e.target.value)
                    setForm({ ...form, tested_topics: [] })
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  disabled={!modalBookId || modalChaptersLoading}
                >
                  <option value="">
                    {!modalBookId
                      ? 'Select book first'
                      : modalChaptersLoading
                        ? 'Loading chapters...'
                        : modalChapters.length > 0
                          ? 'All Chapters'
                          : 'No chapters in selected book'}
                  </option>
                  {modalChapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.id}>
                      {chapter.chapter_number}. {chapter.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Search page filters are independent; modal has its own context selectors above. */}

            {/* Type + Difficulty + Bloom + Marks */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <select
                  value={form.question_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      question_type: e.target.value,
                      correct_answer: '',
                      answer_text: '',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty</label>
                <select
                  value={form.difficulty_level}
                  onChange={(e) => setForm({ ...form, difficulty_level: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  {DIFFICULTY_LEVELS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bloom&apos;s Level</label>
                <select
                  value={form.bloom_level}
                  onChange={(e) => setForm({ ...form, bloom_level: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                >
                  <option value="">Not set</option>
                  {BLOOM_LEVELS.map((level) => (
                    <option key={level.value} value={level.value}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Marks</label>
                <input
                  type="number"
                  value={form.marks}
                  onChange={(e) => setForm({ ...form, marks: e.target.value })}
                  min={0.5}
                  step={0.5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                />
              </div>
            </div>

            {/* Question Text */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Question Text <span className="text-red-500">*</span>
              </label>
              <textarea
                value={form.question_text}
                onChange={(e) => setForm({ ...form, question_text: e.target.value })}
                placeholder="Type the question here..."
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm resize-y"
              />
              {errors.question_text && (
                <p className="text-red-500 text-xs mt-1">{errors.question_text}</p>
              )}
            </div>

            {/* Type-specific fields */}
            {form.question_type === 'MCQ' && (
              <MCQFields form={form} setForm={setForm} errors={errors} />
            )}
            {form.question_type === 'TRUE_FALSE' && (
              <TrueFalseFields form={form} setForm={setForm} errors={errors} />
            )}
            {form.question_type === 'FILL_BLANK' && (
              <FillBlankFields form={form} setForm={setForm} errors={errors} />
            )}
            {['SHORT', 'LONG', 'ESSAY'].includes(form.question_type) && (
              <ModelAnswerField
                form={form}
                setForm={setForm}
                errors={errors}
                label={
                  form.question_type === 'ESSAY'
                    ? 'Marking Guide / Expected Points'
                    : 'Model Answer'
                }
              />
            )}
            {form.question_type === 'MATCHING' && (
              <MatchingFields form={form} setForm={setForm} errors={errors} />
            )}

            {/* Linked Topics */}
            <TopicPicker
              classId={resolvedModalClassId}
              subjectId={form.subject}
              selectedTopics={form.tested_topics}
              onChange={(ids) => setForm({ ...form, tested_topics: ids })}
              initialBookId={modalBookId || initialBookId}
              initialChapterId={modalChapterId || initialChapterId}
            />

            {/* Optional Source Content Block */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Source Content Block (optional)</label>
              {!sourceTopicId ? (
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  Select at least one topic above to link a source content block.
                </p>
              ) : sourceBlocksLoading ? (
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  Loading content blocks for selected topic...
                </p>
              ) : sourceBlocksError ? (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                  {sourceBlocksErrorObj?.response?.data?.detail || 'Failed to load content blocks for selected topic.'}
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    value={sourceSearch}
                    onChange={(e) => setSourceSearch(e.target.value)}
                    placeholder="Search source block by type or text..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />
                  {sourceBlocks.length === 0 ? (
                    <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                      No content blocks found for the selected topic.
                    </p>
                  ) : (
                    <select
                      value={form.source_content_block || ''}
                      onChange={(e) => setForm({ ...form, source_content_block: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      <option value="">No source linked</option>
                      {filteredSourceBlocks.map((block) => (
                        <option key={block.id} value={block.id}>
                          {formatSourceBlockOption(block)}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">Tags</label>
              {!form.subject ? (
                <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded px-3 py-2">
                  Select a subject to load tags.
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="Search tags..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                  />

                  {modalTagsLoading ? (
                    <p className="text-xs text-gray-500">Loading tags...</p>
                  ) : (
                    <>
                      <div className="max-h-28 overflow-y-auto border border-gray-200 rounded-lg p-2 bg-gray-50">
                        {filteredModalTags.length === 0 ? (
                          <p className="text-xs text-gray-500">No matching tags.</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {filteredModalTags.map((tag) => {
                              const selected = selectedTagIds.includes(tag.id)
                              return (
                                <button
                                  type="button"
                                  key={tag.id}
                                  onClick={() => handleSelectTag(tag.id)}
                                  className={`text-xs px-2 py-0.5 rounded-full border ${selected ? 'bg-blue-100 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'}`}
                                >
                                  {tag.name}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {tagSearch.trim() && filteredModalTags.length === 0 && (
                        <button
                          type="button"
                          onClick={handleCreateTagFromSearch}
                          disabled={createTagMutation.isPending}
                          className="text-xs font-medium text-blue-700 hover:text-blue-900"
                        >
                          {createTagMutation.isPending ? 'Creating tag...' : `Create "${tagSearch.trim()}"`}
                        </button>
                      )}

                      {selectedTagIds.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {selectedTagIds.map((tagId) => {
                            const tagObj = modalTags.find((tag) => tag.id === tagId)
                            return (
                              <button
                                type="button"
                                key={tagId}
                                onClick={() => handleRemoveTag(tagId)}
                                className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200"
                                title="Remove tag"
                              >
                                {tagObj?.name || `Tag #${tagId}`} ×
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 text-sm font-medium"
              >
                {saveMutation.isPending ? 'Saving...' : isEdit ? 'Update Question' : 'Add Question'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ─── Question Card ────────────────────────────────────────────────────────────

function QuestionCard({ question, onEdit, onDelete, onOpenSource, onVerify, isVerifying }) {
  const typeColor = TYPE_COLOR[question.question_type] || 'bg-gray-100 text-gray-600'
  const typeLabel = TYPE_LABEL[question.question_type] || question.question_type
  const diff = DIFFICULTY_LEVELS.find((d) => d.value === question.difficulty_level)
  const bloom = BLOOM_LEVELS.find((level) => level.value === question.bloom_level)
  const rawRealDifficulty = Number(question.real_difficulty)
  const hasRealDifficulty = Number.isFinite(rawRealDifficulty)
  const mappedRealDifficulty = hasRealDifficulty
    ? (rawRealDifficulty <= 0.34
        ? 'EASY'
        : rawRealDifficulty <= 0.67
        ? 'MEDIUM'
        : 'HARD')
    : null
  const realDifficultyLabel = mappedRealDifficulty
    ? (DIFFICULTY_LEVELS.find((d) => d.value === mappedRealDifficulty)?.label || mappedRealDifficulty)
    : null
  const realDifficultyColor = mappedRealDifficulty
    ? (DIFFICULTY_LEVELS.find((d) => d.value === mappedRealDifficulty)?.color || 'text-gray-600')
    : 'text-gray-600'
  const attemptCountRaw = Number(question?.stats?.attempt_count ?? question?.attempt_count)
  const attemptCount = Number.isFinite(attemptCountRaw) ? attemptCountRaw : null
  const hasDifficultyMismatch = hasRealDifficulty
    && !!question.difficulty_level
    && mappedRealDifficulty
    && question.difficulty_level !== mappedRealDifficulty
  const sourceContentBlockId = typeof question.source_content_block === 'object'
    ? question.source_content_block?.id
    : question.source_content_block

  const { data: sourceBlockData } = useQuery({
    queryKey: ['question-source-content-block', sourceContentBlockId],
    queryFn: () => lmsApi.getContentBlock(sourceContentBlockId),
    enabled: !!sourceContentBlockId,
    staleTime: 300000,
  })

  const sourceBlock = sourceBlockData?.data
  const sourceTopicTitle = sourceBlock?.topic_title || sourceBlock?.topic?.title || (sourceBlock?.topic ? `Topic #${sourceBlock.topic}` : '')
  const sourceChapterTitle = sourceBlock?.chapter_title || sourceBlock?.chapter?.title || (sourceBlock?.chapter ? `Chapter #${sourceBlock.chapter}` : '')
  const sourcePathLabel = sourceChapterTitle && sourceTopicTitle
    ? `${sourceChapterTitle} › ${sourceTopicTitle}`
    : sourceTopicTitle || sourceChapterTitle || 'Content Block'
  const sourcePreview = (sourceBlock?.content_text || '').trim()
  const sourceTooltip = sourcePreview ? sourcePreview.slice(0, 100) : 'Source content block linked'
  const isAiGenerated = !!question.is_ai_generated
  const isAiVerified = !!question.verified_by
  const questionTags = extractQuestionTags(question)
  const visibleTags = questionTags.slice(0, 3)
  const hiddenTagCount = Math.max(0, questionTags.length - visibleTags.length)
  const rawSimilarity = Number(question.similarity_score)
  const hasSimilarityScore = Number.isFinite(rawSimilarity)
  const similarityPercent = hasSimilarityScore
    ? Math.max(0, Math.min(100, rawSimilarity <= 1 ? rawSimilarity * 100 : rawSimilarity))
    : null

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColor}`}>
              {typeLabel}
            </span>
            {diff && (
              <span className={`text-xs font-medium ${diff.color}`}>{diff.label}</span>
            )}
            {hasRealDifficulty && (
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 ${realDifficultyColor}`}
                title={`Based on ${attemptCount ?? 'N'} student attempts`}
              >
                Real: {realDifficultyLabel}
              </span>
            )}
            {hasDifficultyMismatch && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"
                title="Difficulty mismatch between stated and real difficulty"
              >
                Mismatch
              </span>
            )}
            {bloom && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${bloom.color}`}>
                {bloom.label}
              </span>
            )}
            {isAiGenerated && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isAiVerified ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                {isAiVerified ? 'AI · Verified' : 'AI · Unverified'}
              </span>
            )}
            <span className="text-xs text-gray-500">
              {question.marks} {question.marks === 1 ? 'mark' : 'marks'}
            </span>
            {question.tested_topics?.length > 0 && (
              <span className="text-xs text-blue-500">
                {question.tested_topics.length} topic
                {question.tested_topics.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* Question text */}
          <p
            className="text-sm text-gray-800 line-clamp-3"
            dangerouslySetInnerHTML={{ __html: question.question_text }}
          />

          {/* MCQ preview */}
          {question.question_type === 'MCQ' && (
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
              {['A', 'B', 'C', 'D'].map((opt) => {
                const text = question[`option_${opt.toLowerCase()}`]
                if (!text) return null
                const isCorrect = question.correct_answer === opt
                return (
                  <p
                    key={opt}
                    className={`text-xs px-1 py-0.5 rounded ${
                      isCorrect
                        ? 'bg-green-100 text-green-700 font-medium'
                        : 'text-gray-500'
                    }`}
                  >
                    {opt}. {text}
                  </p>
                )
              })}
            </div>
          )}

          {/* TRUE_FALSE answer */}
          {question.question_type === 'TRUE_FALSE' && question.correct_answer && (
            <p className="mt-1 text-xs text-green-700 font-medium">
              Answer: {question.correct_answer}
            </p>
          )}

          {/* model answer preview */}
          {question.answer_text && !['MCQ', 'TRUE_FALSE'].includes(question.question_type) && (
            <p className="mt-1 text-xs text-gray-500 line-clamp-2 italic">
              {question.answer_text}
            </p>
          )}

          {sourceContentBlockId && (
            <button
              type="button"
              onClick={() => onOpenSource(sourceContentBlockId)}
              title={sourceTooltip}
              className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-full px-2 py-0.5"
            >
              <span className="font-medium">Source</span>
              <span>From: {sourcePathLabel}</span>
            </button>
          )}

          {questionTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {visibleTags.map((tag) => (
                <span
                  key={tag.id}
                  className={`text-[11px] px-2 py-0.5 rounded-full ${TAG_TYPE_COLORS[tag.tag_type] || 'bg-gray-100 text-gray-700'}`}
                >
                  {tag.name}
                </span>
              ))}
              {hiddenTagCount > 0 && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">+{hiddenTagCount} more</span>
              )}
            </div>
          )}

          {hasSimilarityScore && (
            <div className="mt-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-gray-500">Similarity</span>
                <span className="text-[11px] font-medium text-gray-700">{similarityPercent.toFixed(0)}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-1.5 bg-emerald-500 rounded-full transition-all" style={{ width: `${similarityPercent}%` }} />
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-1 shrink-0">
          {isAiGenerated && !isAiVerified && (
            <button
              onClick={() => onVerify(question)}
              disabled={isVerifying}
              className="text-xs px-2 py-1 rounded border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-60"
              title="Mark this AI-generated question as verified"
            >
              {isVerifying ? 'Verifying...' : 'Verify'}
            </button>
          )}
          <button
            onClick={() => onEdit(question)}
            className="text-gray-400 hover:text-blue-600 p-1.5 rounded hover:bg-blue-50 transition"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </button>
          <button
            onClick={() => onDelete(question)}
            className="text-gray-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50 transition"
            title="Delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function SourceContentBlockModal({ contentBlockId, onClose }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['source-content-block-modal', contentBlockId],
    queryFn: () => lmsApi.getContentBlock(contentBlockId),
    enabled: !!contentBlockId,
  })

  const block = data?.data

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] overflow-y-auto">
      <div className="min-h-full flex items-start justify-center py-10 px-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-bold text-gray-900">Source Content Block</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
          </div>

          <div className="p-6">
            {isLoading && (
              <p className="text-sm text-gray-500">Loading source content block...</p>
            )}
            {isError && (
              <p className="text-sm text-red-600">
                {error?.response?.data?.detail || 'Failed to load source content block.'}
              </p>
            )}
            {!isLoading && !isError && !block && (
              <p className="text-sm text-gray-500">Source content block not found.</p>
            )}
            {!isLoading && !isError && block && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                    {(block.block_type || 'text').replace(/_/g, ' ')}
                  </span>
                  {block.chapter_title && (
                    <span className="text-xs text-gray-500">{block.chapter_title}</span>
                  )}
                  {block.topic_title && (
                    <span className="text-xs text-gray-500">› {block.topic_title}</span>
                  )}
                </div>
                <p className="text-sm text-gray-800 whitespace-pre-wrap">{block.content_text || 'No content text available.'}</p>
              </div>
            )}
          </div>

          <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm">Close</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({ question, onCancel, onConfirm, isLoading }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-bold text-gray-900 mb-2">Delete Question?</h3>
        <p className="text-sm text-gray-600 mb-5 line-clamp-3">
          {question.question_text.replace(/<[^>]+>/g, '') || 'This question'}
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60 text-sm font-medium"
          >
            {isLoading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function QuestionsPage() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const { isTeacher, user } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const locationState = location.state || {}
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)

  // Filters
  const [filterClassId, setFilterClassId] = useState(locationState.classId || '')
  const [filterSubject, setFilterSubject] = useState(locationState.subject || '')
  const [filterBookId, setFilterBookId] = useState(locationState.bookId || '')
  const [filterChapterId, setFilterChapterId] = useState(locationState.chapterId || '')
  const [filterTopicId, setFilterTopicId] = useState(locationState.topicId || '')
  const [filterType, setFilterType] = useState('')
  const [filterDifficulty, setFilterDifficulty] = useState('')
  const [filterBloom, setFilterBloom] = useState('')
  const [filterSource, setFilterSource] = useState('ALL')
  const [filterTagId, setFilterTagId] = useState('')
  const [filterTagSearch, setFilterTagSearch] = useState('')
  const [filterSearch, setFilterSearch] = useState('')
  const [searchMode, setSearchMode] = useState('KEYWORD')
  const [semanticSearchTerm, setSemanticSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const resolvedClassId = getResolvedMasterClassId(filterClassId, activeAcademicYear?.id, sessionClasses)
  const { subjects: classSubjects, isLoading: classSubjectsLoading } = useClassSubjects(resolvedClassId)

  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass: filterClassId,
    setSelectedClass: setFilterClassId,
    autoSelectFirst: true,
    queryKey: 'teacherQuestionBankClasses',
  })

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['question-bank-books', resolvedClassId, filterSubject],
    queryFn: () => lmsApi.getBooksForClassSubject({ class_id: resolvedClassId, subject_id: filterSubject }),
    enabled: !!resolvedClassId && !!filterSubject,
  })
  const books = booksData?.data?.results || booksData?.data || []

  const { data: bookTreeData, isLoading: chaptersLoading } = useQuery({
    queryKey: ['question-bank-book-tree', filterBookId],
    queryFn: () => lmsApi.getBookTree(filterBookId),
    enabled: !!filterBookId,
  })
  const chapters = bookTreeData?.data?.chapters || []

  const { data: filterTagsData, isLoading: filterTagsLoading } = useQuery({
    queryKey: ['question-filter-tags', filterSubject],
    queryFn: () => lmsApi.getTags({ subject_id: filterSubject || undefined }),
    enabled: !!resolvedClassId,
  })
  const filterTags = filterTagsData?.data?.results || filterTagsData?.data || []
  const filteredFilterTags = useMemo(() => {
    const needle = filterTagSearch.trim().toLowerCase()
    if (!needle) return filterTags
    return filterTags.filter((tag) => String(tag.name || '').toLowerCase().includes(needle))
  }, [filterTags, filterTagSearch])

  // If navigated here from Curriculum "+Q" button, open create modal pre-seeded with subject
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editQuestion, setEditQuestion] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [sourcePreviewBlockId, setSourcePreviewBlockId] = useState(null)
  const [toast, setToast] = useState(null)
  const [actionHint, setActionHint] = useState('')
  const [verifyingQuestionId, setVerifyingQuestionId] = useState(null)

  // Pre-open the create modal if a topicId was passed (coming from CurriculumPage "+Q")
  useEffect(() => {
    if (locationState.topicId && locationState.subject && locationState.classId) {
      setShowCreateModal(true)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (searchMode !== 'SEMANTIC') {
      setSemanticSearchTerm('')
      return
    }
    const timer = window.setTimeout(() => {
      setSemanticSearchTerm(filterSearch.trim())
    }, 600)
    return () => window.clearTimeout(timer)
  }, [searchMode, filterSearch])

  const queryParams = {
    ...(resolvedClassId && { class_id: resolvedClassId }),
    ...(filterSubject && { subject: filterSubject }),
    ...(filterBookId && { book_id: filterBookId }),
    ...(filterChapterId && { chapter_id: filterChapterId }),
    ...(filterTopicId && { topic_id: filterTopicId }),
    ...(filterType && { question_type: filterType }),
    ...(filterDifficulty && { difficulty_level: filterDifficulty }),
    ...(filterBloom && { bloom_level: filterBloom }),
    ...(filterSource === 'HUMAN' && { is_ai_generated: 'false' }),
    ...(filterSource === 'AI_UNVERIFIED' && { is_ai_generated: 'true', 'verified_by__isnull': 'true' }),
    ...(filterSource === 'AI_VERIFIED' && { is_ai_generated: 'true', 'verified_by__isnull': 'false' }),
    ...(filterTagId && { tag_id: filterTagId }),
    ...(filterSearch && { search: filterSearch }),
    page,
    page_size: 20,
  }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['questions', queryParams],
    queryFn: () => questionPaperApi.getQuestions(queryParams),
    enabled: !!resolvedClassId,
  })

  const semanticQueryParams = {
    q: semanticSearchTerm,
    limit: 50,
    ...(resolvedClassId && { class_id: resolvedClassId }),
    ...(filterSubject && { subject: filterSubject }),
  }

  const {
    data: semanticData,
    isFetching: semanticIsFetching,
    isSuccess: semanticIsSuccess,
  } = useQuery({
    queryKey: ['questions-semantic-search', semanticQueryParams],
    queryFn: () => questionPaperApi.semanticSearchQuestions(semanticQueryParams),
    enabled: !!resolvedClassId && searchMode === 'SEMANTIC' && !!semanticSearchTerm,
  })

  const semanticResultPayload = semanticData?.data
  const semanticQuestions = Array.isArray(semanticResultPayload)
    ? semanticResultPayload
    : semanticResultPayload?.results || semanticResultPayload?.questions || []
  const useSemanticResults = searchMode === 'SEMANTIC' && !!semanticSearchTerm && semanticQuestions.length > 0
  const shouldFallbackToKeyword = searchMode === 'SEMANTIC' && !!semanticSearchTerm && semanticIsSuccess && semanticQuestions.length === 0

  const keywordQuestions = data?.data?.results || []
  const questions = useSemanticResults ? semanticQuestions : keywordQuestions
  const totalCount = useSemanticResults ? semanticQuestions.length : (data?.data?.count || 0)
  const totalPages = useSemanticResults ? 1 : Math.ceil(totalCount / 20)

  const deleteMutation = useMutation({
    mutationFn: (id) => questionPaperApi.deleteQuestion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['questions'] })
      setDeleteTarget(null)
      setToast({ type: 'success', message: 'Question deleted.' })
    },
    onError: () => {
      setToast({ type: 'error', message: 'Failed to delete question.' })
    },
  })

  const verifyQuestionMutation = useMutation({
    mutationFn: ({ questionId, payload }) => questionPaperApi.updateQuestion(questionId, payload),
    onMutate: async ({ questionId, payload }) => {
      setVerifyingQuestionId(questionId)
      await queryClient.cancelQueries({ queryKey: ['questions'] })
      const previousQueries = queryClient.getQueriesData({ queryKey: ['questions'] })

      previousQueries.forEach(([key, queryData]) => {
        if (!queryData?.data?.results) return
        queryClient.setQueryData(key, {
          ...queryData,
          data: {
            ...queryData.data,
            results: queryData.data.results.map((q) => (
              q.id === questionId
                ? { ...q, verified_by: payload.verified_by, verified_at: payload.verified_at }
                : q
            )),
          },
        })
      })

      return { previousQueries }
    },
    onError: (error, _variables, context) => {
      context?.previousQueries?.forEach(([key, queryData]) => {
        queryClient.setQueryData(key, queryData)
      })
      setToast({ type: 'error', message: error?.response?.data?.detail || 'Failed to verify question.' })
    },
    onSuccess: () => {
      setToast({ type: 'success', message: 'Question marked as verified.' })
    },
    onSettled: () => {
      setVerifyingQuestionId(null)
      queryClient.invalidateQueries({ queryKey: ['questions'] })
    },
  })

  const handleVerifyQuestion = (question) => {
    if (!user?.id) {
      setToast({ type: 'error', message: 'Unable to verify question: user session missing.' })
      return
    }
    verifyQuestionMutation.mutate({
      questionId: question.id,
      payload: {
        verified_by: user.id,
        verified_at: new Date().toISOString(),
      },
    })
  }

  const handleFilterChange = (setter) => (e) => {
    setter(e.target.value)
    setPage(1)
  }

  const handleOpenCreateModal = () => {
    setActionHint('')
    setShowCreateModal(true)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Question Bank</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Manage reusable questions for paper builder and curriculum coverage
            </p>
          </div>
          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium text-sm shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
            title="Add Question"
          >
            + Add Question
          </button>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* Filters */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Class</label>
              <ClassSelector
                value={filterClassId}
                onChange={(e) => {
                  setActionHint('')
                  setFilterClassId(e.target.value)
                  setFilterSubject('')
                  setFilterBookId('')
                  setFilterChapterId('')
                  setFilterTopicId('')
                  setPage(1)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                scope={classSelectorScope}
                academicYearId={activeAcademicYear?.id}
                showAllOption={showAllOption}
                classes={teacherClassOptions || undefined}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
              <select
                value={filterSubject}
                onChange={(e) => {
                  setActionHint('')
                  setFilterSubject(e.target.value)
                  setFilterBookId('')
                  setFilterChapterId('')
                  setFilterTopicId('')
                  setPage(1)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                disabled={!resolvedClassId || classSubjectsLoading}
              >
                <option value="">
                  {!resolvedClassId
                    ? 'Select class first'
                    : classSubjectsLoading
                      ? 'Loading subjects...'
                      : classSubjects.length > 0
                        ? 'All Assigned Subjects'
                        : 'No subjects assigned'}
                </option>
                {classSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code ? `${subject.code} - ` : ''}{subject.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Book</label>
              <select
                value={filterBookId}
                onChange={(e) => {
                  setFilterBookId(e.target.value)
                  setFilterChapterId('')
                  setFilterTopicId('')
                  setPage(1)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                disabled={!resolvedClassId || !filterSubject || booksLoading}
              >
                <option value="">
                  {!resolvedClassId || !filterSubject
                    ? 'Select class and subject first'
                    : booksLoading
                      ? 'Loading books...'
                      : books.length > 0
                        ? 'All Books'
                        : 'No books found'}
                </option>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>
                    {book.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Chapter</label>
              <select
                value={filterChapterId}
                onChange={(e) => {
                  setFilterChapterId(e.target.value)
                  setFilterTopicId('')
                  setPage(1)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                disabled={!filterBookId || chaptersLoading}
              >
                <option value="">
                  {!filterBookId
                    ? 'Select book first'
                    : chaptersLoading
                      ? 'Loading chapters...'
                      : chapters.length > 0
                        ? 'All Chapters'
                        : 'No chapters found'}
                </option>
                {chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.chapter_number}. {chapter.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
              <input
                type="text"
                value={filterSearch}
                onChange={handleFilterChange(setFilterSearch)}
                placeholder="Search questions..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              />
              <div className="mt-2 inline-flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setSearchMode('KEYWORD'); setPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium ${searchMode === 'KEYWORD' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Keyword
                </button>
                <button
                  type="button"
                  onClick={() => { setSearchMode('SEMANTIC'); setPage(1) }}
                  className={`px-2.5 py-1 text-xs font-medium border-l border-gray-300 ${searchMode === 'SEMANTIC' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                >
                  Semantic
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 mt-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Question Type</label>
              <select
                value={filterType}
                onChange={handleFilterChange(setFilterType)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All Types</option>
                {QUESTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Difficulty</label>
              <select
                value={filterDifficulty}
                onChange={handleFilterChange(setFilterDifficulty)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All Levels</option>
                {DIFFICULTY_LEVELS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bloom Level</label>
              <select
                value={filterBloom}
                onChange={handleFilterChange(setFilterBloom)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">All Bloom Levels</option>
                {BLOOM_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Source</label>
              <select
                value={filterSource}
                onChange={handleFilterChange(setFilterSource)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="ALL">All</option>
                <option value="HUMAN">Human</option>
                <option value="AI_UNVERIFIED">AI (Unverified)</option>
                <option value="AI_VERIFIED">AI (Verified)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tag</label>
              <input
                type="text"
                value={filterTagSearch}
                onChange={handleFilterChange(setFilterTagSearch)}
                placeholder="Search tags..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm mb-1"
              />
              <select
                value={filterTagId}
                onChange={handleFilterChange(setFilterTagId)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 text-sm"
                disabled={filterTagsLoading}
              >
                <option value="">All Tags</option>
                {filteredFilterTags.map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            </div>
          </div>

          {actionHint && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-800">{actionHint}</p>
            </div>
          )}

          {shouldFallbackToKeyword && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-xs text-blue-800">Semantic search is still indexing. Using keyword search instead.</p>
            </div>
          )}

          {filterTopicId && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
              <p className="text-xs text-blue-700">
                Filtering questions for curriculum topic #{filterTopicId}
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilterTopicId('')
                  setPage(1)
                }}
                className="text-xs font-medium text-blue-700 hover:text-blue-900"
              >
                Clear topic filter
              </button>
            </div>
          )}
        </div>

        {/* Results summary */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {!resolvedClassId
              ? 'Select a class to load the question bank.'
              : isLoading
                ? 'Loading...'
                : `${totalCount} question${totalCount !== 1 ? 's' : ''}`}
            {isFetching && !isLoading && (
              <span className="ml-2 text-blue-500 text-xs">Refreshing…</span>
            )}
            {semanticIsFetching && searchMode === 'SEMANTIC' && semanticSearchTerm && (
              <span className="ml-2 text-blue-500 text-xs">Semantic search…</span>
            )}
            {useSemanticResults && (
              <span className="ml-2 text-emerald-600 text-xs font-medium">Semantic Search</span>
            )}
          </p>

          {/* Type chips summary */}
          {!filterType && !isLoading && totalCount > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {QUESTION_TYPES.map((t) => {
                const cnt = questions.filter((q) => q.question_type === t.value).length
                if (!cnt) return null
                return (
                  <button
                    key={t.value}
                    onClick={() => { setFilterType(t.value); setPage(1) }}
                    className={`text-xs px-2 py-0.5 rounded-full font-medium cursor-pointer ${t.color}`}
                  >
                    {t.label} {cnt}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Question list */}
        {!resolvedClassId ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <div className="text-4xl mb-3">🏫</div>
            <p className="text-gray-600 font-medium">Select a class to begin</p>
            <p className="text-gray-400 text-sm mt-1">
              Subject, book, and chapter options will load from that class's assigned curriculum.
            </p>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse h-20" />
            ))}
          </div>
        ) : questions.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
            <div className="text-4xl mb-3">📝</div>
            <p className="text-gray-600 font-medium">No questions found</p>
            <p className="text-gray-400 text-sm mt-1">
              {filterSubject || filterType || filterDifficulty || filterBloom || filterTagId || filterSearch || filterSource !== 'ALL'
                ? 'Try clearing some filters'
                : !classSubjectsLoading && classSubjects.length === 0
                  ? 'Assign subjects to this class first in Subjects -> Class Assignments'
                  : 'Add your first question to get started'}
            </p>
            {!(filterSubject || filterType || filterDifficulty || filterBloom || filterTagId || filterSearch || filterSource !== 'ALL') && (
              <button
                onClick={handleOpenCreateModal}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
              >
                Add Question
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {questions.map((q) => (
              <QuestionCard
                key={q.id}
                question={q}
                onEdit={setEditQuestion}
                onDelete={setDeleteTarget}
                onOpenSource={setSourcePreviewBlockId}
                onVerify={handleVerifyQuestion}
                isVerifying={verifyingQuestionId === q.id}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              ‹ Prev
            </button>
            <span className="text-sm text-gray-600">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Next ›
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      {(showCreateModal || editQuestion) && (
        <QuestionModal
          editQuestion={editQuestion || null}
          initialClassFilterId={filterClassId}
          initialSubject={showCreateModal && !editQuestion ? filterSubject : undefined}
          initialTopicId={showCreateModal && !editQuestion ? filterTopicId : undefined}
          initialBookId={showCreateModal && !editQuestion ? filterBookId : filterBookId}
          initialChapterId={showCreateModal && !editQuestion ? filterChapterId : filterChapterId}
          onClose={() => { setShowCreateModal(false); setEditQuestion(null) }}
          onSaved={() => {
            setShowCreateModal(false)
            setEditQuestion(null)
            setToast({
              type: 'success',
              message: editQuestion ? 'Question updated.' : 'Question added.',
            })
          }}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          question={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          isLoading={deleteMutation.isPending}
        />
      )}

      {sourcePreviewBlockId && (
        <SourceContentBlockModal
          contentBlockId={sourcePreviewBlockId}
          onClose={() => setSourcePreviewBlockId(null)}
        />
      )}
    </div>
  )
}
