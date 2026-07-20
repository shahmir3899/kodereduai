import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { lmsApi, academicsApi, hrApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import RTLWrapper, { isRTLLanguage } from '../../components/RTLWrapper'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import LessonPlanAIModal from './LessonPlanAIModal'
import { normalizeLessonPlanText } from './lessonPlanTextUtils'

const STEPS = [
  { num: 1, label: 'Class & Date' },
  { num: 2, label: 'Topics' },
  { num: 3, label: 'AI assistant' },
  { num: 4, label: 'Review & Save' },
]

const OBJECTIVE_BLOOM_OPTIONS = [
  { value: 'remember', label: 'Remember' },
  { value: 'understand', label: 'Understand' },
  { value: 'apply', label: 'Apply' },
  { value: 'analyze', label: 'Analyze' },
  { value: 'evaluate', label: 'Evaluate' },
  { value: 'create', label: 'Create' },
]

const BLOOM_BADGE_CLASSES = {
  remember: 'bg-gray-100 text-gray-700',
  understand: 'bg-blue-100 text-blue-700',
  apply: 'bg-green-100 text-green-700',
  analyze: 'bg-yellow-100 text-yellow-800',
  evaluate: 'bg-orange-100 text-orange-700',
  create: 'bg-red-100 text-red-700',
}

function makeObjectiveRow(seed = {}) {
  return {
    rowId: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    objectiveId: seed.objectiveId ?? seed.id ?? null,
    statement: seed.statement || '',
    bloom_level: seed.bloom_level || '',
  }
}

function parseObjectiveTextToRows(rawText) {
  const text = normalizeLessonPlanText(rawText)
  if (!text) return []
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)
  return lines.map((statement) => makeObjectiveRow({ statement }))
}

function objectiveRowsToPlainText(rows) {
  return rows
    .map((row) => normalizeLessonPlanText(row.statement))
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

function collectChapterIds(chapter) {
  const topicIds = []
  const subtopicIds = []
  for (const topic of chapter.topics || []) {
    topicIds.push(topic.id)
    for (const st of topic.subtopics || []) {
      subtopicIds.push(st.id)
    }
  }
  return { topicIds, subtopicIds }
}

function collectTopicIds(topic) {
  const subtopicIds = (topic.subtopics || []).map((st) => st.id)
  return { topicIds: [topic.id], subtopicIds }
}

export default function LessonPlanWizard({ onClose, onSuccess, editingPlan }) {
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
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
  const [selectedSubtopicIds, setSelectedSubtopicIds] = useState([])
  const [expandedBooks, setExpandedBooks] = useState({})
  const [expandedChapters, setExpandedChapters] = useState({})
  const [expandedTopics, setExpandedTopics] = useState({})
  const [wasAiGenerated, setWasAiGenerated] = useState(false)
  const [showAIModal, setShowAIModal] = useState(false)

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedSelectedClass = getResolvedMasterClassId(selectedClass, activeAcademicYear?.id, sessionClasses)
  const sessionClassIdByMaster = useMemo(() => {
    const map = {}
    sessionClasses.forEach((sc) => {
      if (sc.class_obj) map[String(sc.class_obj)] = String(sc.id)
    })
    return map
  }, [sessionClasses])

  const { classOptions: teacherClassOptions } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass,
    setSelectedClass,
    autoSelectFirst: !editingPlan,
    queryKey: 'myLessonPlanWizardClasses',
  })

  const [title, setTitle] = useState('')
  const [objectives, setObjectives] = useState('')
  const [objectiveRows, setObjectiveRows] = useState([makeObjectiveRow()])
  const [description, setDescription] = useState('')
  const [teachingMethods, setTeachingMethods] = useState('')
  const [materialsNeeded, setMaterialsNeeded] = useState('')

  // Pre-populate when editing
  useEffect(() => {
    if (editingPlan) {
      const mappedClassId = activeAcademicYear?.id
        ? (sessionClassIdByMaster[String(editingPlan.class_obj)] || '')
        : (editingPlan.class_obj ? String(editingPlan.class_obj) : '')
      setSelectedClass(mappedClassId)
      setSelectedSubject(editingPlan.subject ? String(editingPlan.subject) : '')
      setSelectedTeacher(editingPlan.teacher ? String(editingPlan.teacher) : '')
      setLessonDate(editingPlan.lesson_date || '')
      setDuration(editingPlan.duration_minutes || 45)
      setMode(editingPlan.content_mode === 'FREEFORM' ? 'FREEFORM' : 'TOPICS')
      setTitle(editingPlan.title || '')
      const objectivesText = normalizeLessonPlanText(editingPlan.objectives_text ?? editingPlan.objectives)
      setObjectives(objectivesText)
      const linkedRows = (editingPlan.linked_objectives || []).map((objective) =>
        makeObjectiveRow({
          id: objective.id,
          statement: objective.statement,
          bloom_level: objective.bloom_level,
        }),
      )
      if (linkedRows.length > 0) {
        setObjectiveRows(linkedRows)
      } else {
        const parsedRows = parseObjectiveTextToRows(objectivesText)
        setObjectiveRows(parsedRows.length > 0 ? parsedRows : [makeObjectiveRow()])
      }
      setDescription(editingPlan.description || '')
      setTeachingMethods(editingPlan.teaching_methods || '')
      setMaterialsNeeded(editingPlan.materials_needed || '')
      setWasAiGenerated(editingPlan.ai_generated || false)
      if (editingPlan.planned_topics?.length) {
        setSelectedTopicIds(editingPlan.planned_topics.map((t) => t.id))
      } else if (editingPlan.planned_topic_ids?.length) {
        setSelectedTopicIds(editingPlan.planned_topic_ids)
      } else {
        setSelectedTopicIds([])
      }
      if (editingPlan.planned_subtopics?.length) {
        setSelectedSubtopicIds(editingPlan.planned_subtopics.map((s) => s.id))
      } else {
        setSelectedSubtopicIds([])
      }
      if (editingPlan.title) {
        setStep(4)
      }
    }
  }, [editingPlan, activeAcademicYear?.id, sessionClassIdByMaster])

  const topicObjectivesQueries = useQueries({
    queries: selectedTopicIds.map((topicId) => ({
      queryKey: ['topic-objectives', topicId],
      queryFn: () => lmsApi.getTopicObjectives(topicId),
      enabled: mode === 'TOPICS' && !!topicId,
    })),
  })

  const isTopicObjectivesLoading = topicObjectivesQueries.some((query) => query.isLoading)
  const topicObjectivesError = topicObjectivesQueries.find((query) => query.isError)?.error
  const availableObjectives = useMemo(() => {
    const seen = new Set()
    const rows = []
    topicObjectivesQueries.forEach((query) => {
      const payload = query.data?.data
      const items = Array.isArray(payload?.results)
        ? payload.results
        : (Array.isArray(payload) ? payload : [])
      items.forEach((item) => {
        if (seen.has(item.id)) return
        seen.add(item.id)
        rows.push(item)
      })
    })
    return rows
  }, [topicObjectivesQueries])

  // Data fetching
  const { data: classSubjectsData } = useQuery({
    queryKey: ['classSubjects', resolvedSelectedClass],
    queryFn: () => academicsApi.getClassSubjects({ class_obj: resolvedSelectedClass, page_size: 9999 }),
    enabled: !!resolvedSelectedClass,
  })

  const { data: staffData } = useQuery({
    queryKey: ['hrStaffTeachers'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', role: 'TEACHER', page_size: 9999 }),
  })

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['booksForClassSubject', resolvedSelectedClass, selectedSubject],
    queryFn: () => lmsApi.getBooksForClassSubject({ class_id: resolvedSelectedClass, subject_id: selectedSubject }),
    enabled: !!resolvedSelectedClass && !!selectedSubject && mode === 'TOPICS',
  })

  const classSubjects = classSubjectsData?.data?.results || classSubjectsData?.data || []
  const staff = staffData?.data?.results || staffData?.data || []
  const books = booksData?.data || booksData?.data?.results || []

  const syncObjectivesAfterSave = async (response) => {
    const lessonPlanId = response?.data?.id
    if (!lessonPlanId) return
    const objectiveIds = Array.from(
      new Set(
        objectiveRows
          .map((row) => row.objectiveId)
          .filter((id) => Number.isInteger(id)),
      ),
    )
    if (objectiveIds.length === 0) return
    await lmsApi.linkLessonPlanObjectives(lessonPlanId, objectiveIds)
  }

  const { topicMap, subtopicMap } = useMemo(() => {
    const tMap = {}
    const sMap = {}
    if (!Array.isArray(books)) return { topicMap: tMap, subtopicMap: sMap }
    books.forEach((book) => {
      ;(book.chapters || []).forEach((chapter) => {
        ;(chapter.topics || []).forEach((topic) => {
          tMap[topic.id] = { ...topic, chapterName: chapter.title, bookTitle: book.title, language: book.language }
          ;(topic.subtopics || []).forEach((st) => {
            sMap[st.id] = {
              ...st,
              topicTitle: topic.title,
              chapterName: chapter.title,
              bookTitle: book.title,
              language: book.language,
            }
          })
        })
      })
    })
    return { topicMap: tMap, subtopicMap: sMap }
  }, [books])

  // Auto-populate teacher when subject is selected
  useEffect(() => {
    if (selectedSubject && classSubjects.length > 0) {
      const match = classSubjects.find((cs) => String(cs.subject) === String(selectedSubject))
      if (match?.teacher) {
        setSelectedTeacher(String(match.teacher))
      }
    }
  }, [selectedSubject, classSubjects])

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data) => lmsApi.createLessonPlan(data),
    onSuccess: async (response) => {
      try {
        await syncObjectivesAfterSave(response)
      } catch (error) {
        showError(error.response?.data?.error || 'Lesson plan saved, but linking objectives failed.')
      }
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
    onSuccess: async (response) => {
      try {
        await syncObjectivesAfterSave(response)
      } catch (error) {
        showError(error.response?.data?.error || 'Lesson plan saved, but linking objectives failed.')
      }
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
    if (!resolvedSelectedClass) { showError('Please select a class'); return false }
    if (!selectedSubject) { showError('Please select a subject'); return false }
    if (!lessonDate) { showError('Please select a lesson date'); return false }
    return true
  }

  const validateStep2 = () => {
    if (mode === 'TOPICS' && selectedTopicIds.length === 0 && selectedSubtopicIds.length === 0) {
      showError('Please select at least one topic or sub-topic')
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

  const chapterFullySelected = (chapter) => {
    const { topicIds, subtopicIds } = collectChapterIds(chapter)
    if (topicIds.length === 0) return false
    return (
      topicIds.every((id) => selectedTopicIds.includes(id)) &&
      subtopicIds.every((id) => selectedSubtopicIds.includes(id))
    )
  }

  const toggleChapterSelection = (chapter) => {
    const { topicIds, subtopicIds } = collectChapterIds(chapter)
    const allOn = chapterFullySelected(chapter)
    setSelectedTopicIds((prev) => {
      const set = new Set(prev)
      topicIds.forEach((id) => {
        if (allOn) set.delete(id)
        else set.add(id)
      })
      return Array.from(set)
    })
    setSelectedSubtopicIds((prev) => {
      const set = new Set(prev)
      subtopicIds.forEach((id) => {
        if (allOn) set.delete(id)
        else set.add(id)
      })
      return Array.from(set)
    })
  }

  const topicFullySelected = (topic) => {
    const { topicIds, subtopicIds } = collectTopicIds(topic)
    const subsOk = subtopicIds.length === 0 || subtopicIds.every((id) => selectedSubtopicIds.includes(id))
    return selectedTopicIds.includes(topicIds[0]) && subsOk
  }

  const toggleTopicBranch = (topic) => {
    const { topicIds, subtopicIds } = collectTopicIds(topic)
    const allOn = topicFullySelected(topic)
    setSelectedTopicIds((prev) => {
      const set = new Set(prev)
      if (allOn) set.delete(topicIds[0])
      else set.add(topicIds[0])
      return Array.from(set)
    })
    setSelectedSubtopicIds((prev) => {
      const set = new Set(prev)
      subtopicIds.forEach((id) => {
        if (allOn) set.delete(id)
        else set.add(id)
      })
      return Array.from(set)
    })
  }

  const toggleSubtopic = (subtopicId) => {
    setSelectedSubtopicIds((prev) =>
      prev.includes(subtopicId) ? prev.filter((id) => id !== subtopicId) : [...prev, subtopicId],
    )
  }

  const toggleBook = (bookId) => {
    setExpandedBooks((prev) => ({ ...prev, [bookId]: !prev[bookId] }))
  }

  const toggleChapter = (chapterId) => {
    setExpandedChapters((prev) => ({ ...prev, [chapterId]: !prev[chapterId] }))
  }

  const toggleTopicExpand = (topicId) => {
    setExpandedTopics((prev) => ({ ...prev, [topicId]: !prev[topicId] }))
  }

  const addObjectiveRow = () => {
    setObjectiveRows((prev) => [...prev, makeObjectiveRow()])
  }

  const updateObjectiveRow = (rowId, patch) => {
    setObjectiveRows((prev) => prev.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)))
  }

  const removeObjectiveRow = (rowId) => {
    setObjectiveRows((prev) => {
      const next = prev.filter((row) => row.rowId !== rowId)
      return next.length > 0 ? next : [makeObjectiveRow()]
    })
  }

  const applyAIGeneratedFields = (fields) => {
    setTitle(normalizeLessonPlanText(fields.title))
    const aiRows = parseObjectiveTextToRows(fields.objectives)
    if (aiRows.length > 0) {
      setObjectiveRows(aiRows)
    }
    setObjectives(normalizeLessonPlanText(fields.objectives))
    setDescription(normalizeLessonPlanText(fields.description))
    setTeachingMethods(normalizeLessonPlanText(fields.teaching_methods))
    setMaterialsNeeded(normalizeLessonPlanText(fields.materials_needed))
    setWasAiGenerated(true)
    setStep(4)
  }

  const handleSave = (status) => {
    if (!normalizeLessonPlanText(title)) {
      showError('Title is required')
      return
    }

    const payload = {
      school: activeSchool?.id,
      class_obj: parseInt(resolvedSelectedClass),
      subject: parseInt(selectedSubject),
      teacher: selectedTeacher ? parseInt(selectedTeacher) : null,
      lesson_date: lessonDate,
      duration_minutes: parseInt(duration) || 45,
      title: normalizeLessonPlanText(title),
      description: normalizeLessonPlanText(description),
      objectives: objectiveRowsToPlainText(objectiveRows) || normalizeLessonPlanText(objectives),
      teaching_methods: normalizeLessonPlanText(teachingMethods),
      materials_needed: normalizeLessonPlanText(materialsNeeded),
      content_mode: mode === 'TOPICS' ? 'TOPICS' : 'FREEFORM',
      ai_generated: wasAiGenerated,
      planned_topic_ids: selectedTopicIds,
      planned_subtopic_ids: selectedSubtopicIds,
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
                <ClassSelector
                  className="input w-full"
                  value={selectedClass}
                  onChange={(e) => {
                    setSelectedClass(e.target.value)
                    setSelectedSubject('')
                    setSelectedTeacher('')
                    setSelectedTopicIds([])
                  }}
                  scope={classSelectorScope}
                  academicYearId={activeAcademicYear?.id}
                  classes={teacherClassOptions || undefined}
                />
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

        {/* Step 2: Curriculum (chapter → topic → sub-topic) */}
        {step === 2 && mode === 'TOPICS' && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-700">
              Select chapter, topics, and optional sub-topics. Use the chapter checkbox to grab the whole branch.
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
                {books.map((book) => {
                  const topicCount = (book.chapters || []).reduce((sum, ch) => sum + (ch.topics?.length || 0), 0)
                  const subCount = (book.chapters || []).reduce(
                    (sum, ch) =>
                      sum + (ch.topics || []).reduce((s2, t) => s2 + (t.subtopics?.length || 0), 0),
                    0,
                  )
                  return (
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
                        {topicCount} topics{subCount ? ` · ${subCount} sub-topics` : ''}
                      </span>
                    </button>

                    {expandedBooks[book.id] && (book.chapters || []).map((chapter) => (
                      <div key={chapter.id} className="ml-3 border-l border-gray-200 pl-1">
                        <div className="flex items-stretch hover:bg-gray-50">
                          <label className="flex items-center gap-2 px-2 py-2 cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={chapterFullySelected(chapter)}
                              onChange={() => toggleChapterSelection(chapter)}
                              className="rounded border-gray-300 text-primary-600"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => toggleChapter(chapter.id)}
                            className="flex-1 flex items-center gap-2 py-2 pr-2 text-left text-sm text-gray-700"
                          >
                            <span className="text-gray-400">{expandedChapters[chapter.id] ? '▼' : '▶'}</span>
                            <span className="font-medium">{chapter.title}</span>
                            <span className="text-xs text-gray-400">({(chapter.topics || []).length})</span>
                          </button>
                        </div>

                        {expandedChapters[chapter.id] && (chapter.topics || []).map((topic) => {
                          const subs = topic.subtopics || []
                          const hasSubs = subs.length > 0
                          return (
                            <div key={topic.id} className="ml-4 border-l border-gray-100">
                              <div className="flex items-stretch hover:bg-gray-50">
                                <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer shrink-0">
                                  <input
                                    type="checkbox"
                                    checked={topicFullySelected(topic)}
                                    onChange={() => toggleTopicBranch(topic)}
                                    className="rounded border-gray-300 text-primary-600"
                                  />
                                </label>
                                <div className="flex-1 flex items-center min-w-0">
                                  {hasSubs ? (
                                    <button
                                      type="button"
                                      onClick={() => toggleTopicExpand(topic.id)}
                                      className="flex items-center gap-1 py-1.5 text-left text-sm text-gray-700 flex-1"
                                    >
                                      <span className="text-gray-400 text-xs">{expandedTopics[topic.id] ? '▼' : '▶'}</span>
                                      <RTLWrapper language={book.language}>
                                        <span className="truncate">{topic.title}</span>
                                      </RTLWrapper>
                                      <span className="text-xs text-gray-400 shrink-0">{subs.length} sub</span>
                                    </button>
                                  ) : (
                                    <RTLWrapper language={book.language}>
                                      <span className="text-sm text-gray-700 py-1.5 pl-1">{topic.title}</span>
                                    </RTLWrapper>
                                  )}
                                </div>
                              </div>
                              {hasSubs && expandedTopics[topic.id] && (
                                <div className="ml-6 border-l border-gray-100 pb-1">
                                  {subs.map((st) => (
                                    <RTLWrapper key={st.id} language={book.language}>
                                      <label className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 cursor-pointer text-sm">
                                        <input
                                          type="checkbox"
                                          checked={selectedSubtopicIds.includes(st.id)}
                                          onChange={() => toggleSubtopic(st.id)}
                                          className="rounded border-gray-300 text-primary-600"
                                        />
                                        <span className="text-gray-700">{st.title}</span>
                                      </label>
                                    </RTLWrapper>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                  )
                })}
              </div>
            )}

            {(selectedTopicIds.length > 0 || selectedSubtopicIds.length > 0) && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Selected: {selectedTopicIds.length} topic(s), {selectedSubtopicIds.length} sub-topic(s)
                </p>
                <div className="flex flex-wrap gap-2">
                  {selectedTopicIds.map((id) => {
                    const topic = topicMap[id]
                    return (
                      <span
                        key={`t-${id}`}
                        className="inline-flex items-center gap-1 bg-primary-50 text-primary-700 text-xs px-2.5 py-1 rounded-full"
                      >
                        {topic?.title || `Topic #${id}`}
                        <button
                          type="button"
                          onClick={() => {
                            const t = topicMap[id]
                            if (t) toggleTopicBranch(t)
                          }}
                          className="text-primary-400 hover:text-primary-600 ml-0.5"
                        >
                          &times;
                        </button>
                      </span>
                    )
                  })}
                  {selectedSubtopicIds.map((id) => {
                    const st = subtopicMap[id]
                    return (
                      <span
                        key={`s-${id}`}
                        className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-800 text-xs px-2.5 py-1 rounded-full"
                      >
                        {st?.title || `Sub #${id}`}
                        <button
                          type="button"
                          onClick={() => toggleSubtopic(id)}
                          className="text-indigo-400 hover:text-indigo-600 ml-0.5"
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

        {/* Step 3: AI assistant (opens modal — one API call per generation) */}
        {step === 3 && (
          <div className="space-y-6">
            {mode === 'TOPICS' && (selectedTopicIds.length > 0 || selectedSubtopicIds.length > 0) && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Selected curriculum (sent to AI)</p>
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
                  {selectedSubtopicIds.map((id) => {
                    const st = subtopicMap[id]
                    return (
                      <div key={`s-${id}`} className="text-sm text-gray-600 flex items-center gap-2">
                        <svg className="w-3 h-3 text-indigo-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>{st?.title || `Sub-topic #${id}`}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {mode === 'TOPICS' && (selectedTopicIds.length > 0 || selectedSubtopicIds.length > 0) ? (
              <div className="text-center py-4">
                <button
                  type="button"
                  onClick={() => setShowAIModal(true)}
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-8 py-3 rounded-lg font-medium text-base hover:from-purple-700 hover:to-indigo-700 transition-all shadow-lg"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                  Open AI generator
                </button>
                <p className="text-xs text-gray-500 mt-3 max-w-md mx-auto">
                  Opens a short dialog: your topics and lesson date are sent to the model in one request. You can run it
                  again from here if you change topics (each run is a separate call).
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600 text-center py-4">
                Free-form mode does not use topic-based AI. Continue to the next step to write the plan manually.
              </p>
            )}

            <div className="text-center">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                Skip AI — write manually in review
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
              <div className="flex items-center justify-between gap-2 mb-2">
                <label className="label mb-0">Objectives</label>
                <button
                  type="button"
                  onClick={() => setShowAIModal(true)}
                  className="text-xs px-2.5 py-1 rounded-md border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
                >
                  Generate with AI
                </button>
              </div>

              <div className="space-y-2">
                {objectiveRows.map((row) => (
                  <div key={row.rowId} className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <input
                      type="text"
                      className="input sm:col-span-8"
                      placeholder="Students will be able to..."
                      value={row.statement}
                      onChange={(e) => updateObjectiveRow(row.rowId, { statement: e.target.value, objectiveId: null })}
                    />
                    <select
                      className="input sm:col-span-3"
                      value={row.bloom_level}
                      onChange={(e) => updateObjectiveRow(row.rowId, { bloom_level: e.target.value })}
                    >
                      <option value="">Bloom level</option>
                      {OBJECTIVE_BLOOM_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeObjectiveRow(row.rowId)}
                      className="sm:col-span-1 px-2 py-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
                      title="Delete objective"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={addObjectiveRow} className="btn btn-secondary text-xs px-3 py-1.5">
                  Add Objective
                </button>
              </div>

              <div className="mt-3">
                <p className="text-xs font-medium text-gray-600 mb-1">Topic objective suggestions</p>
                {isTopicObjectivesLoading ? (
                  <p className="text-xs text-gray-500">Loading topic objectives...</p>
                ) : topicObjectivesError ? (
                  <p className="text-xs text-red-600">Could not load topic objectives.</p>
                ) : availableObjectives.length === 0 ? (
                  <p className="text-xs text-gray-500">No linked topic objectives found for current topic selection.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {availableObjectives.slice(0, 8).map((objective) => (
                      <button
                        type="button"
                        key={objective.id}
                        onClick={() => {
                          const newRow = makeObjectiveRow({
                            id: objective.id,
                            statement: objective.statement,
                            bloom_level: objective.bloom_level,
                          })
                          setObjectiveRows((prev) => [...prev, newRow])
                        }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100"
                        title={objective.statement}
                      >
                        <span className="truncate max-w-[220px]">{objective.statement}</span>
                        {objective.bloom_level && (
                          <span className={`px-1.5 py-0.5 rounded-full ${BLOOM_BADGE_CLASSES[objective.bloom_level] || 'bg-gray-100 text-gray-700'}`}>
                            {OBJECTIVE_BLOOM_OPTIONS.find((opt) => opt.value === objective.bloom_level)?.label || objective.bloom_level}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
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

            {(selectedTopicIds.length > 0 || selectedSubtopicIds.length > 0) && (
              <div>
                <label className="label mb-2">
                  Linked curriculum ({selectedTopicIds.length} topics, {selectedSubtopicIds.length} sub-topics)
                </label>
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
                  {selectedSubtopicIds.map((id) => {
                    const st = subtopicMap[id]
                    return (
                      <span
                        key={`s-${id}`}
                        className="inline-flex items-center bg-indigo-50 text-indigo-800 text-xs px-2.5 py-1 rounded-full"
                      >
                        {st?.title || `Sub #${id}`}
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

      <LessonPlanAIModal
        open={showAIModal}
        onClose={() => setShowAIModal(false)}
        topicIds={selectedTopicIds}
        subtopicIds={selectedSubtopicIds}
        lessonDate={lessonDate}
        durationMinutes={parseInt(duration, 10) || 45}
        onApply={applyAIGeneratedFields}
      />
    </div>
  )
}
