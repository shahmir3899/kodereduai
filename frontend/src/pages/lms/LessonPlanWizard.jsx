import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { lmsApi, academicsApi, hrApi } from '../../services/api'
import { useClasses } from '../../hooks/useClasses'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import RTLWrapper, { isRTLLanguage } from '../../components/RTLWrapper'

const STEPS = [
  { num: 1, label: 'Class & Date' },
  { num: 2, label: 'Topics' },
  { num: 3, label: 'AI Generate' },
  { num: 4, label: 'Review & Save' },
]

export default function LessonPlanWizard({ onClose, onSuccess, editingPlan }) {
  const { activeSchool } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccess, showError } = useToast()

  const [step, setStep] = useState(1)
  const [mode, setMode] = useState('TOPICS')
  const [selectedClass, setSelectedClass] = useState('')
  const [selectedSubject, setSelectedSubject] = useState('')
  const [selectedTeacher, setSelectedTeacher] = useState('')
  const [lessonDate, setLessonDate] = useState('')
  const [duration, setDuration] = useState(45)
  const [selectedTopicIds, setSelectedTopicIds] = useState([])
  const [expandedBooks, setExpandedBooks] = useState({})
  const [expandedChapters, setExpandedChapters] = useState({})
  const [wasAiGenerated, setWasAiGenerated] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

  const [title, setTitle] = useState('')
  const [objectives, setObjectives] = useState('')
  const [description, setDescription] = useState('')
  const [teachingMethods, setTeachingMethods] = useState('')
  const [materialsNeeded, setMaterialsNeeded] = useState('')

  // Pre-populate when editing
  useEffect(() => {
    if (editingPlan) {
      setSelectedClass(editingPlan.class_obj ? String(editingPlan.class_obj) : '')
      setSelectedSubject(editingPlan.subject ? String(editingPlan.subject) : '')
      setSelectedTeacher(editingPlan.teacher ? String(editingPlan.teacher) : '')
      setLessonDate(editingPlan.lesson_date || '')
      setDuration(editingPlan.duration_minutes || 45)
      setMode(editingPlan.content_mode === 'FREEFORM' ? 'FREEFORM' : 'TOPICS')
      setTitle(editingPlan.title || '')
      setObjectives(editingPlan.objectives || '')
      setDescription(editingPlan.description || '')
      setTeachingMethods(editingPlan.teaching_methods || '')
      setMaterialsNeeded(editingPlan.materials_needed || '')
      setWasAiGenerated(editingPlan.ai_generated || false)
      if (editingPlan.planned_topic_ids?.length) {
        setSelectedTopicIds(editingPlan.planned_topic_ids)
      }
      if (editingPlan.title) {
        setStep(4)
      }
    }
  }, [editingPlan])

  // Data fetching
  const { classes } = useClasses()

  const { data: classSubjectsData } = useQuery({
    queryKey: ['classSubjects', selectedClass],
    queryFn: () => academicsApi.getClassSubjects({ class_id: selectedClass, page_size: 9999 }),
    enabled: !!selectedClass,
  })

  const { data: staffData } = useQuery({
    queryKey: ['hrStaffActive'],
    queryFn: () => hrApi.getStaff({ status: 'ACTIVE', page_size: 9999 }),
  })

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['booksForClassSubject', selectedClass, selectedSubject],
    queryFn: () => lmsApi.getBooksForClassSubject({ class_id: selectedClass, subject_id: selectedSubject }),
    enabled: !!selectedClass && !!selectedSubject && mode === 'TOPICS',
  })

  const classSubjects = classSubjectsData?.data?.results || classSubjectsData?.data || []
  const staff = staffData?.data?.results || staffData?.data || []
  const books = booksData?.data || booksData?.data?.results || []

  // Auto-populate teacher when subject is selected
  useEffect(() => {
    if (selectedSubject && classSubjects.length > 0) {
      const match = classSubjects.find((cs) => String(cs.subject) === String(selectedSubject))
      if (match?.teacher) {
        setSelectedTeacher(String(match.teacher))
      }
    }
  }, [selectedSubject, classSubjects])

  // Build a flat map of all topics for lookup
  const topicMap = {}
  if (Array.isArray(books)) {
    books.forEach((book) => {
      (book.chapters || []).forEach((chapter) => {
        (chapter.topics || []).forEach((topic) => {
          topicMap[topic.id] = { ...topic, chapterName: chapter.title, bookTitle: book.title }
        })
      })
    })
  }

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => lmsApi.createLessonPlan(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      showSuccess('Lesson plan created successfully!')
      onSuccess?.()
      onClose()
    },
    onError: (error) => {
      showError(error.response?.data?.detail || error.response?.data?.title?.[0] || 'Failed to create lesson plan')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.updateLessonPlan(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      showSuccess('Lesson plan updated successfully!')
      onSuccess?.()
      onClose()
    },
    onError: (error) => {
      showError(error.response?.data?.detail || error.response?.data?.title?.[0] || 'Failed to update lesson plan')
    },
  })

  // Validation
  const validateStep1 = () => {
    if (!selectedClass) { showError('Please select a class'); return false }
    if (!selectedSubject) { showError('Please select a subject'); return false }
    if (!lessonDate) { showError('Please select a lesson date'); return false }
    return true
  }

  const validateStep2 = () => {
    if (mode === 'TOPICS' && selectedTopicIds.length === 0) {
      showError('Please select at least one topic')
      return false
    }
    return true
  }

  const goNext = () => {
    if (step === 1 && !validateStep1()) return
    if (step === 1 && mode === 'FREEFORM') {
      setStep(3)
      return
    }
    if (step === 2 && !validateStep2()) return
    setStep((s) => Math.min(s + 1, 4))
  }

  const goBack = () => {
    if (step === 3 && mode === 'FREEFORM') {
      setStep(1)
      return
    }
    setStep((s) => Math.max(s - 1, 1))
  }

  const toggleTopic = (topicId) => {
    setSelectedTopicIds((prev) =>
      prev.includes(topicId) ? prev.filter((id) => id !== topicId) : [...prev, topicId]
    )
  }

  const toggleBook = (bookId) => {
    setExpandedBooks((prev) => ({ ...prev, [bookId]: !prev[bookId] }))
  }

  const toggleChapter = (chapterId) => {
    setExpandedChapters((prev) => ({ ...prev, [chapterId]: !prev[chapterId] }))
  }

  const handleAIGenerate = async () => {
    setAiLoading(true)
    try {
      const res = await lmsApi.generateLessonPlan({
        topic_ids: selectedTopicIds,
        lesson_date: lessonDate,
        duration_minutes: duration,
      })
      const data = res.data
      if (data.success !== false) {
        setTitle(data.title || '')
        setObjectives(data.objectives || '')
        setDescription(data.description || '')
        setTeachingMethods(data.teaching_methods || '')
        setMaterialsNeeded(data.materials_needed || '')
        setWasAiGenerated(true)
        showSuccess('AI lesson plan generated!')
        setStep(4)
      } else {
        showError('AI generation failed. You can write the plan manually.')
      }
    } catch (err) {
      showError(err.response?.data?.detail || 'AI generation failed. You can write the plan manually.')
    } finally {
      setAiLoading(false)
    }
  }

  const handleSave = (status) => {
    if (!title.trim()) {
      showError('Title is required')
      return
    }

    const payload = {
      school: activeSchool?.id,
      class_obj: parseInt(selectedClass),
      subject: parseInt(selectedSubject),
      teacher: selectedTeacher ? parseInt(selectedTeacher) : null,
      lesson_date: lessonDate,
      duration_minutes: parseInt(duration) || 45,
      title: title.trim(),
      description: description.trim(),
      objectives: objectives.trim(),
      teaching_methods: teachingMethods.trim(),
      materials_needed: materialsNeeded.trim(),
      content_mode: mode === 'TOPICS' ? 'TOPICS' : 'FREEFORM',
      ai_generated: wasAiGenerated,
      planned_topic_ids: selectedTopicIds,
      status,
    }

    if (editingPlan) {
      updateMutation.mutate({ id: editingPlan.id, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {editingPlan ? 'Edit Lesson Plan' : 'Create Lesson Plan'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
            &times;
          </button>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center mb-6">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  step >= s.num ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {step > s.num ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  s.num
                )}
              </div>
              <span className={`ml-2 text-sm ${step >= s.num ? 'text-primary-600 font-medium' : 'text-gray-500'}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && (
                <div className={`w-12 h-0.5 mx-3 ${step > s.num ? 'bg-primary-600' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Class & Date */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Class *</label>
                <select
                  className="input w-full"
                  value={selectedClass}
                  onChange={(e) => {
                    setSelectedClass(e.target.value)
                    setSelectedSubject('')
                    setSelectedTeacher('')
                    setSelectedTopicIds([])
                  }}
                >
                  <option value="">Select Class</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}{cls.section ? ` - ${cls.section}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Subject *</label>
                <select
                  className="input w-full"
                  value={selectedSubject}
                  onChange={(e) => {
                    setSelectedSubject(e.target.value)
                    setSelectedTopicIds([])
                  }}
                  disabled={!selectedClass}
                >
                  <option value="">Select Subject</option>
                  {classSubjects.map((cs) => (
                    <option key={cs.id} value={cs.subject}>
                      {cs.subject_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Teacher</label>
                <select
                  className="input w-full"
                  value={selectedTeacher}
                  onChange={(e) => setSelectedTeacher(e.target.value)}
                >
                  <option value="">Select Teacher</option>
                  {staff.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.full_name || t.user_name || `Staff #${t.id}`}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Lesson Date *</label>
                <input
                  type="date"
                  className="input w-full"
                  value={lessonDate}
                  onChange={(e) => setLessonDate(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="label">Duration (minutes)</label>
              <input
                type="number"
                className="input w-32"
                min="1"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </div>

            <div>
              <label className="label mb-2">Content Mode</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode('TOPICS')}
                  className={`px-4 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    mode === 'TOPICS'
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Structured Topics
                </button>
                <button
                  type="button"
                  onClick={() => setMode('FREEFORM')}
                  className={`px-4 py-2 text-sm rounded-lg border font-medium transition-colors ${
                    mode === 'FREEFORM'
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Free-form Text
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {mode === 'TOPICS'
                  ? 'Select topics from curriculum books to link with this lesson plan.'
                  : 'Skip topic selection and write content directly.'}
              </p>
            </div>
          </div>
        )}

        {/* Step 2: Topic Selection */}
        {step === 2 && mode === 'TOPICS' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-700">
              Select topics for this lesson plan
            </p>

            {booksLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
                <p className="text-gray-500 mt-2 text-sm">Loading curriculum books...</p>
              </div>
            ) : !Array.isArray(books) || books.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                <p className="text-gray-600 font-medium">No curriculum books found.</p>
                <p className="text-gray-500 text-sm mt-1">Add books in the Curriculum page first.</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg max-h-80 overflow-y-auto divide-y divide-gray-100">
                {books.map((book) => (
                  <div key={book.id}>
                    <button
                      type="button"
                      onClick={() => toggleBook(book.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${expandedBooks[book.id] ? 'rotate-90' : ''}`}
                          fill="none" stroke="currentColor" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <span className="text-sm font-medium text-gray-800">{book.title}</span>
                        {book.language && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            isRTLLanguage(book.language) ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                          }`}>
                            {book.language.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {(book.chapters || []).reduce((sum, ch) => sum + (ch.topics?.length || 0), 0)} topics
                      </span>
                    </button>

                    {expandedBooks[book.id] && (book.chapters || []).map((chapter) => (
                      <div key={chapter.id} className="ml-4 border-l border-gray-200">
                        <button
                          type="button"
                          onClick={() => toggleChapter(chapter.id)}
                          className="w-full flex items-center gap-2 px-4 py-2 hover:bg-gray-50 text-left"
                        >
                          <svg
                            className={`w-3 h-3 text-gray-400 transition-transform ${expandedChapters[chapter.id] ? 'rotate-90' : ''}`}
                            fill="none" stroke="currentColor" viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <span className="text-sm text-gray-700">{chapter.title}</span>
                          <span className="text-xs text-gray-400">({(chapter.topics || []).length})</span>
                        </button>

                        {expandedChapters[chapter.id] && (chapter.topics || []).map((topic) => (
                          <RTLWrapper key={topic.id} language={book.language}>
                            <label className="flex items-center gap-3 px-6 py-1.5 hover:bg-gray-50 cursor-pointer ml-4">
                              <input
                                type="checkbox"
                                checked={selectedTopicIds.includes(topic.id)}
                                onChange={() => toggleTopic(topic.id)}
                                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                              />
                              <span className="text-sm text-gray-600">{topic.title}</span>
                            </label>
                          </RTLWrapper>
                        ))}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {selectedTopicIds.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Selected topics ({selectedTopicIds.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedTopicIds.map((id) => {
                    const topic = topicMap[id]
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 text-xs px-2.5 py-1 rounded-full"
                      >
                        {topic?.title || `Topic #${id}`}
                        <button
                          type="button"
                          onClick={() => toggleTopic(id)}
                          className="text-primary-400 hover:text-primary-600 ml-0.5"
                        >
                          &times;
                        </button>
                      </span>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: AI Generate */}
        {step === 3 && (
          <div className="space-y-6">
            {mode === 'TOPICS' && selectedTopicIds.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Selected Topics</p>
                <div className="bg-gray-50 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                  {selectedTopicIds.map((id) => {
                    const topic = topicMap[id]
                    return (
                      <div key={id} className="text-sm text-gray-600 flex items-center gap-2">
                        <svg className="w-3 h-3 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>{topic?.title || `Topic #${id}`}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="text-center py-6">
              <button
                type="button"
                onClick={handleAIGenerate}
                disabled={aiLoading}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-8 py-3 rounded-lg font-medium text-base hover:from-purple-700 hover:to-indigo-700 transition-all disabled:opacity-50 shadow-lg"
              >
                {aiLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    Generate with AI
                  </>
                )}
              </button>
              <p className="text-xs text-gray-500 mt-3">
                AI will generate a lesson plan based on your selected {mode === 'TOPICS' ? 'topics' : 'inputs'} and date.
              </p>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Skip AI -- Write Manually
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Review & Save */}
        {step === 4 && (
          <div className="space-y-4">
            <div>
              <label className="label">Title *</label>
              <input
                type="text"
                className="input w-full"
                placeholder="e.g., Introduction to Photosynthesis"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Description</label>
              <textarea
                className="input w-full"
                rows={3}
                placeholder="Brief description of the lesson..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Objectives</label>
              <textarea
                className="input w-full"
                rows={3}
                placeholder="Learning objectives for this lesson..."
                value={objectives}
                onChange={(e) => setObjectives(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Teaching Methods</label>
              <textarea
                className="input w-full"
                rows={2}
                placeholder="Lecture, group discussion, hands-on activity..."
                value={teachingMethods}
                onChange={(e) => setTeachingMethods(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Materials Needed</label>
              <textarea
                className="input w-full"
                rows={2}
                placeholder="Textbook, whiteboard, projector..."
                value={materialsNeeded}
                onChange={(e) => setMaterialsNeeded(e.target.value)}
              />
            </div>

            {selectedTopicIds.length > 0 && (
              <div>
                <label className="label mb-2">Linked Topics ({selectedTopicIds.length})</label>
                <div className="flex flex-wrap gap-2">
                  {selectedTopicIds.map((id) => {
                    const topic = topicMap[id]
                    return (
                      <span
                        key={id}
                        className="inline-flex items-center bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full"
                      >
                        {topic?.title || `Topic #${id}`}
                      </span>
                    )
                  })}
                </div>
              </div>
            )}

            {wasAiGenerated && (
              <p className="text-xs text-purple-600 flex items-center gap-1">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
                Content generated by AI -- review and edit as needed.
              </p>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <button
            type="button"
            onClick={step === 1 ? onClose : goBack}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            {step === 1 ? 'Cancel' : 'Back'}
          </button>

          <div className="flex gap-2">
            {step < 4 ? (
              <button type="button" onClick={goNext} className="btn btn-primary px-6 py-2 text-sm">
                Next
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleSave('DRAFT')}
                  disabled={isSaving}
                  className="btn btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSave('PUBLISHED')}
                  disabled={isSaving}
                  className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Save & Publish'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
