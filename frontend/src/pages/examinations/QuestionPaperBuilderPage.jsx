import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { questionPaperApi, examinationsApi, lmsApi } from '../../services/api'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import Toast from '../../components/Toast'
import ClassSelector from '../../components/ClassSelector'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import { useDebounce } from '../../hooks/useDebounce'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import ImageCapturePaperTab from './ImageCapturePaperTab'
import ManualEntryPaperTab from './ManualEntryPaperTab'
import LessonPlanPaperTab from './LessonPlanPaperTab'

const MANUAL_DRAFT_DEFAULT = {
  paper_title: '',
  instructions: '',
  total_marks: '100',
  duration_minutes: '60',
  questions: [],
}

const MANUAL_QUESTION_DEFAULT_OPTIONS = {
  A: '',
  B: '',
  C: '',
  D: '',
}

const BLOOM_LEVELS = [
  { key: 'remember', label: 'Remember', color: '#6B7280' },
  { key: 'understand', label: 'Understand', color: '#2563EB' },
  { key: 'apply', label: 'Apply', color: '#16A34A' },
  { key: 'analyze', label: 'Analyze', color: '#CA8A04' },
  { key: 'evaluate', label: 'Evaluate', color: '#EA580C' },
  { key: 'create', label: 'Create', color: '#DC2626' },
  { key: 'unclassified', label: 'Unclassified', color: '#94A3B8' },
]

function toQuestionDraft(paperQuestion) {
  return {
    local_id: `q_${paperQuestion.question}_${paperQuestion.question_order}`,
    question_id: paperQuestion.question,
    question_text: paperQuestion.question_text || '',
    question_type: paperQuestion.question_type || 'SHORT',
    difficulty_level: paperQuestion.difficulty_level || 'MEDIUM',
    bloom_level: paperQuestion.bloom_level || paperQuestion.question_snapshot?.bloom_level || '',
    marks: Number(paperQuestion.marks_override ?? paperQuestion.marks ?? 1) || 1,
    marks_override: Number(paperQuestion.marks_override ?? paperQuestion.marks ?? 1) || 1,
    correct_answer: paperQuestion.correct_answer || '',
    answer_text: paperQuestion.answer_text || '',
    type_data: paperQuestion.type_data || {},
    tested_topics: Array.isArray(paperQuestion.question_snapshot?.tested_topics)
      ? paperQuestion.question_snapshot.tested_topics
      : [],
    options: {
      A: paperQuestion.option_a || '',
      B: paperQuestion.option_b || '',
      C: paperQuestion.option_c || '',
      D: paperQuestion.option_d || '',
    },
  }
}

function buildManualAutosaveQuestions(questions) {
  return (questions || []).map((question, index) => ({
    question_id: question.question_id || undefined,
    question_order: index + 1,
    marks_override: Number(question.marks_override ?? question.marks ?? 1) || 1,
    question_text: question.question_text || '',
    question_type: question.question_type || 'SHORT',
    difficulty_level: question.difficulty_level || 'MEDIUM',
    bloom_level: question.bloom_level || undefined,
    marks: Number(question.marks ?? 1) || 1,
    option_a: question.options?.A || '',
    option_b: question.options?.B || '',
    option_c: question.options?.C || '',
    option_d: question.options?.D || '',
    correct_answer: question.correct_answer || '',
    answer_text: question.answer_text || '',
    type_data: question.type_data || {},
    tested_topics: Array.isArray(question.tested_topics) ? question.tested_topics : [],
    local_id: question.local_id,
  }))
}

/**
 * QuestionPaperBuilderPage - Main Question Paper Builder
 * Supports two modes:
 * 1. Image capture - Upload handwritten paper → OCR → Review
 * 2. Manual entry - Type questions with rich editor
 */
export default function QuestionPaperBuilderPage() {
  const { activeSchool, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const { paperId: routePaperId } = useParams()
  const { activeAcademicYear } = useAcademicYear()
  const resumePaperId = routePaperId || location.state?.paperId || location.state?.draftId || null
  const [activeTab, setActiveTab] = useState(location.state?.lessonPlanId ? 'lesson' : 'manual') // 'manual' | 'image' | 'lesson'
  const [toast, setToast] = useState(null)
  const [draftId, setDraftId] = useState(resumePaperId)
  const [manualDraft, setManualDraft] = useState(MANUAL_DRAFT_DEFAULT)
  const [manualDirty, setManualDirty] = useState(false)
  const [saveState, setSaveState] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [coverageCollapsed, setCoverageCollapsed] = useState(false)
  const [paperStatus, setPaperStatus] = useState('DRAFT')
  const [overusedQuestionCounts, setOverusedQuestionCounts] = useState({})
  const [paperMetadata, setPaperMetadata] = useState({
    class_obj: '',
    subject: '',
    exam: '',
  })
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedClassObj = getResolvedMasterClassId(paperMetadata.class_obj, activeAcademicYear?.id, sessionClasses)
  const { subjects: classSubjects, isLoading: classSubjectsLoading } = useClassSubjects(resolvedClassObj)
  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass: paperMetadata.class_obj,
    setSelectedClass: (value) => setPaperMetadata((prev) => ({ ...prev, class_obj: value, subject: '' })),
    autoSelectFirst: true,
    queryKey: 'teacherPaperBuilderClasses',
  })

  // Fetch exams
  const { data: examsData, isLoading: examsLoading } = useQuery({
    queryKey: ['exams'],
    queryFn: () => examinationsApi.getExams({ page_size: 999 }),
  })

  const hydrateOverusedQuestionCounts = useCallback((paper) => {
    const rows = Array.isArray(paper?.overused_questions) ? paper.overused_questions : []
    if (rows.length === 0) {
      setOverusedQuestionCounts({})
      return
    }

    const nextCounts = rows.reduce((acc, row) => {
      const questionId = Number(row?.question_id)
      const useCount = Number(row?.paper_use_count)
      if (Number.isFinite(questionId) && questionId > 0 && Number.isFinite(useCount)) {
        acc[questionId] = useCount
      }
      return acc
    }, {})

    setOverusedQuestionCounts(nextCounts)
  }, [])

  useQuery({
    queryKey: ['paperBuilderResumeDraft', resumePaperId],
    queryFn: () => questionPaperApi.getExamPaper(resumePaperId),
    enabled: !!resumePaperId,
    onSuccess: (response) => {
      const paper = response?.data
      if (!paper?.id) return

      setDraftId(paper.id)
      setPaperStatus(paper.status || 'DRAFT')
      setPaperMetadata({
        class_obj: paper.class_obj ? String(paper.class_obj) : '',
        subject: paper.subject ? String(paper.subject) : '',
        exam: paper.exam ? String(paper.exam) : '',
      })
      setManualDraft({
        paper_title: paper.paper_title || '',
        instructions: paper.instructions || '',
        total_marks: String(paper.total_marks ?? '100'),
        duration_minutes: String(paper.duration_minutes ?? '60'),
        questions: (paper.paper_questions || []).map(toQuestionDraft),
      })
      setManualDirty(false)
      setSaveState('saved')
      setLastSavedAt(paper.updated_at || new Date().toISOString())
      hydrateOverusedQuestionCounts(paper)
    },
  })

  const isReadOnlyPaper = Boolean(resumePaperId && paperStatus && paperStatus !== 'DRAFT')

  useEffect(() => {
    if (isReadOnlyPaper && activeTab !== 'manual') {
      setActiveTab('manual')
    }
  }, [activeTab, isReadOnlyPaper])

  const exams = examsData?.data?.results || []

  const { data: coverageStatsRes, isLoading: coverageLoading, isError: coverageError } = useQuery({
    queryKey: ['paperCoverageStats', draftId, activeTab, manualDraft.questions.length],
    queryFn: () => questionPaperApi.getCoverageStats(draftId),
    enabled: !!draftId,
    refetchInterval: draftId && !isReadOnlyPaper ? 4000 : false,
  })
  const coverageStats = coverageStatsRes?.data || null
  const linkedLessonPlanIds = useMemo(
    () => (coverageStats?.linked_lesson_plans || []).map((plan) => plan.id),
    [coverageStats],
  )

  const linkedLessonPlanQueries = useQueries({
    queries: linkedLessonPlanIds.map((lessonPlanId) => ({
      queryKey: ['paper-coverage-lesson-plan', lessonPlanId],
      queryFn: () => lmsApi.getLessonPlan(lessonPlanId),
      enabled: !!draftId,
    })),
  })

  const lessonPlanTopicIds = useMemo(() => {
    const set = new Set()
    linkedLessonPlanQueries.forEach((query) => {
      const plan = query.data?.data
      ;(plan?.planned_topics || []).forEach((topic) => set.add(topic.id))
    })
    return Array.from(set)
  }, [linkedLessonPlanQueries])

  const topicStandardsQueries = useQueries({
    queries: lessonPlanTopicIds.map((topicId) => ({
      queryKey: ['paper-coverage-topic-standards', topicId],
      queryFn: () => lmsApi.getTopicStandards(topicId),
      enabled: !!draftId,
    })),
  })

  const allSLOs = useMemo(() => {
    const byId = new Map()
    topicStandardsQueries.forEach((query) => {
      const payload = query.data?.data
      const items = Array.isArray(payload?.results)
        ? payload.results
        : (Array.isArray(payload) ? payload : [])
      items.forEach((slo) => {
        if (!byId.has(slo.id)) {
          byId.set(slo.id, slo)
        }
      })
    })
    return Array.from(byId.values())
  }, [topicStandardsQueries])

  const coveredTopicIds = useMemo(
    () => new Set((coverageStats?.covered_topics || []).map((topic) => topic.id)),
    [coverageStats],
  )

  const coveredSLOIds = useMemo(() => {
    const set = new Set()
    lessonPlanTopicIds.forEach((topicId, index) => {
      if (!coveredTopicIds.has(topicId)) return
      const payload = topicStandardsQueries[index]?.data?.data
      const items = Array.isArray(payload?.results)
        ? payload.results
        : (Array.isArray(payload) ? payload : [])
      items.forEach((slo) => set.add(slo.id))
    })
    return set
  }, [coveredTopicIds, lessonPlanTopicIds, topicStandardsQueries])

  const coveredSLOs = useMemo(
    () => allSLOs.filter((slo) => coveredSLOIds.has(slo.id)),
    [allSLOs, coveredSLOIds],
  )
  const uncoveredSLOs = useMemo(
    () => allSLOs.filter((slo) => !coveredSLOIds.has(slo.id)),
    [allSLOs, coveredSLOIds],
  )

  const totalSLOCount = allSLOs.length
  const coveredSLOCount = coveredSLOs.length || Number(coverageStats?.slo_coverage_count || 0)
  const coveragePercent = totalSLOCount > 0
    ? Math.min(100, Math.round((coveredSLOCount / totalSLOCount) * 100))
    : 0

  const bloomDistribution = useMemo(() => {
    const counts = {
      remember: 0,
      understand: 0,
      apply: 0,
      analyze: 0,
      evaluate: 0,
      create: 0,
      unclassified: 0,
    }
    const questionRows = Array.isArray(manualDraft.questions) ? manualDraft.questions : []
    questionRows.forEach((question) => {
      const key = String(question?.bloom_level || '').toLowerCase()
      if (counts[key] !== undefined) {
        counts[key] += 1
      } else {
        counts.unclassified += 1
      }
    })

    const total = questionRows.length
    const percentages = BLOOM_LEVELS.reduce((acc, level) => {
      acc[level.key] = total > 0 ? Number(((counts[level.key] / total) * 100).toFixed(1)) : 0
      return acc
    }, {})

    const surfaceHeavyPercent = percentages.remember + percentages.understand

    return {
      total,
      counts,
      percentages,
      surfaceHeavyPercent,
      isSurfaceHeavy: surfaceHeavyPercent > 70,
      stackData: [{ name: 'Bloom', ...percentages }],
    }
  }, [manualDraft.questions])
  const recoveryKey = useMemo(() => {
    const schoolId = activeSchool?.id || 'school'
    const userId = user?.id || 'user'
    return `paper_builder_manual_recovery_${schoolId}_${userId}`
  }, [activeSchool?.id, user?.id])

  const hasRestoredRecoveryRef = useRef(false)
  const lastEnsurePayloadRef = useRef('')
  const lastAutosavePayloadRef = useRef('')

  // Create exam paper mutation
  const createPaperMutation = useMutation({
    mutationFn: (data) => questionPaperApi.createExamPaper(data),
    onSuccess: (response) => {
      setToast({
        type: 'success',
        message: 'Exam paper created successfully!',
      })
      // Redirect to paper detail/preview
      setTimeout(() => {
        navigate(`/examinations/papers/${response.data.id}`)
      }, 1500)
    },
    onError: (error) => {
      const msg = error.response?.data?.detail || 'Error creating exam paper'
      setToast({
        type: 'error',
        message: msg,
      })
    },
  })

  const ensureDraftMutation = useMutation({
    mutationFn: (data) => questionPaperApi.ensureDraft(data),
    onSuccess: (response) => {
      const paper = response?.data
      if (!paper?.id) return
      setDraftId(paper.id)
      setSaveState('saved')
      setLastSavedAt(new Date().toISOString())
      localStorage.removeItem(recoveryKey)
    },
    onError: (error) => {
      setSaveState('error')
      const msg = error?.response?.data?.detail || 'Failed to create draft'
      setToast({ type: 'error', message: msg })
    },
  })

  const autosaveMutation = useMutation({
    mutationFn: ({ id, data }) => questionPaperApi.autosaveDraft(id, data),
    onSuccess: (response, variables) => {
      const paper = response?.data
      if (!paper?.id) return
      setDraftId(paper.id)
      setPaperMetadata((prev) => ({
        ...prev,
        class_obj: paper.class_obj ? String(paper.class_obj) : prev.class_obj,
        subject: paper.subject ? String(paper.subject) : prev.subject,
        exam: paper.exam ? String(paper.exam) : '',
      }))
      setManualDraft((prev) => ({
        ...prev,
        paper_title: paper.paper_title || prev.paper_title,
        instructions: paper.instructions || '',
        total_marks: String(paper.total_marks ?? prev.total_marks),
        duration_minutes: String(paper.duration_minutes ?? prev.duration_minutes),
        questions: (paper.paper_questions || []).map(toQuestionDraft),
      }))
      setManualDirty(false)
      setSaveState('saved')
      setLastSavedAt(new Date().toISOString())
      lastAutosavePayloadRef.current = variables?.payloadHash || lastAutosavePayloadRef.current
      localStorage.removeItem(recoveryKey)
      hydrateOverusedQuestionCounts(paper)
    },
    onError: (error) => {
      setSaveState('error')
      const msg = error?.response?.data?.detail || 'Autosave failed'
      setToast({ type: 'error', message: msg })
    },
  })

  useEffect(() => {
    if (hasRestoredRecoveryRef.current) return
    hasRestoredRecoveryRef.current = true

    if (resumePaperId) return

    try {
      const raw = localStorage.getItem(recoveryKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return

      if (parsed.paperMetadata) {
        setPaperMetadata((prev) => ({ ...prev, ...parsed.paperMetadata }))
      }
      if (parsed.manualDraft) {
        setManualDraft((prev) => ({ ...prev, ...parsed.manualDraft }))
      }
      setSaveState('pending')
      setToast({ type: 'success', message: 'Recovered unsaved manual draft from this browser.' })
    } catch {
      // Ignore corrupt recovery payloads.
    }
  }, [recoveryKey, resumePaperId])

  const recoveryPayload = useDebounce({ paperMetadata, manualDraft }, 400)
  useEffect(() => {
    if (activeTab !== 'manual') return
    if (draftId) {
      localStorage.removeItem(recoveryKey)
      return
    }

    try {
      localStorage.setItem(
        recoveryKey,
        JSON.stringify({
          paperMetadata: recoveryPayload.paperMetadata,
          manualDraft: recoveryPayload.manualDraft,
          savedAt: new Date().toISOString(),
        }),
      )
    } catch {
      // Recovery storage is best-effort.
    }
  }, [activeTab, draftId, recoveryKey, recoveryPayload])

  const buildEnsurePayload = useCallback(() => {
    const payload = {
      class_obj: resolvedClassObj || undefined,
      subject: paperMetadata.subject || undefined,
      exam: paperMetadata.exam || undefined,
      paper_title: (manualDraft.paper_title || '').trim() || undefined,
      instructions: manualDraft.instructions || '',
    }

    const parsedTotal = Number(manualDraft.total_marks)
    if (!Number.isNaN(parsedTotal) && parsedTotal > 0) {
      payload.total_marks = parsedTotal
    }

    const parsedDuration = parseInt(manualDraft.duration_minutes, 10)
    if (!Number.isNaN(parsedDuration) && parsedDuration > 0) {
      payload.duration_minutes = parsedDuration
    }

    return payload
  }, [manualDraft.duration_minutes, manualDraft.instructions, manualDraft.paper_title, manualDraft.total_marks, paperMetadata.exam, paperMetadata.subject, resolvedClassObj])

  const buildAutosavePayload = useCallback(() => {
    const payload = buildEnsurePayload()
    payload.manual_questions = buildManualAutosaveQuestions(manualDraft.questions)
    return payload
  }, [buildEnsurePayload, manualDraft.questions])

  useEffect(() => {
    if (activeTab !== 'manual') return
    if (draftId) return
    if (ensureDraftMutation.isPending) return
    if (!resolvedClassObj || !paperMetadata.subject || !(manualDraft.paper_title || '').trim()) return

    const ensurePayload = buildEnsurePayload()
    const payloadHash = JSON.stringify(ensurePayload)
    if (!ensurePayload.class_obj || !ensurePayload.subject || !ensurePayload.paper_title) return
    if (payloadHash === lastEnsurePayloadRef.current) return

    lastEnsurePayloadRef.current = payloadHash
    setSaveState('saving')
    ensureDraftMutation.mutate(ensurePayload)
  }, [
    activeTab,
    buildEnsurePayload,
    draftId,
    ensureDraftMutation,
    manualDraft.paper_title,
    paperMetadata.subject,
    resolvedClassObj,
  ])

  const debouncedAutosavePayload = useDebounce(buildAutosavePayload(), 900)
  useEffect(() => {
    if (activeTab !== 'manual') return
    if (!draftId) return
    if (!manualDirty) return
    if (autosaveMutation.isPending) return

    const payloadHash = JSON.stringify(debouncedAutosavePayload)
    if (payloadHash === lastAutosavePayloadRef.current) return

    setSaveState('saving')
    autosaveMutation.mutate({
      id: draftId,
      data: debouncedAutosavePayload,
      payloadHash,
    })
  }, [activeTab, autosaveMutation, debouncedAutosavePayload, draftId, manualDirty])

  const handleManualDraftChange = useCallback((nextDraft) => {
    setManualDraft(nextDraft)
    setManualDirty(true)
    if (saveState !== 'saving') {
      setSaveState('pending')
    }
  }, [saveState])

  const handleManualSubmit = useCallback(async () => {
    if (!(manualDraft.paper_title || '').trim()) {
      setToast({ type: 'error', message: 'Paper title is required before opening draft.' })
      return
    }
    if (!resolvedClassObj || !paperMetadata.subject) {
      setToast({ type: 'error', message: 'Select class and subject before opening draft.' })
      return
    }
    if ((manualDraft.questions || []).length === 0) {
      setToast({ type: 'error', message: 'Add at least one question.' })
      return
    }

    try {
      let finalDraftId = draftId
      if (!finalDraftId) {
        setSaveState('saving')
        const ensured = await ensureDraftMutation.mutateAsync(buildEnsurePayload())
        finalDraftId = ensured?.data?.id
      }

      if (!finalDraftId) {
        setSaveState('error')
        setToast({ type: 'error', message: 'Draft could not be created.' })
        return
      }

      const payload = buildAutosavePayload()
      const payloadHash = JSON.stringify(payload)
      await autosaveMutation.mutateAsync({
        id: finalDraftId,
        data: payload,
        payloadHash,
      })

      navigate(`/examinations/papers/${finalDraftId}`)
    } catch {
      setSaveState('error')
    }
  }, [
    autosaveMutation,
    buildAutosavePayload,
    buildEnsurePayload,
    draftId,
    ensureDraftMutation,
    manualDraft.paper_title,
    manualDraft.questions,
    navigate,
    paperMetadata.subject,
    resolvedClassObj,
  ])

  // Handle paper creation from either tab
  const handlePaperCreate = (paperData) => {
    // Ensure metadata is included
    const finalData = {
      ...paperMetadata,
      class_obj: resolvedClassObj,
      ...paperData,
      status: 'DRAFT',
    }

    createPaperMutation.mutate(finalData)
  }

  const handlePaperCreated = (paper) => {
    if (!paper?.id) {
      setToast({ type: 'error', message: 'Paper created but no ID returned' })
      return
    }
    setToast({ type: 'success', message: 'Exam paper created successfully!' })
    setTimeout(() => {
      navigate(`/examinations/papers/${paper.id}`)
    }, 1200)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-6">
        <div className="max-w-6xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900">Question Paper Builder</h1>
          <p className="text-gray-600 mt-1">
            Create exam papers by uploading handwritten questions or typing manually
          </p>
        </div>
      </div>

      {/* Toast notifications */}
      {toast && (
        <Toast
          type={toast.type}
          message={toast.message}
          onClose={() => setToast(null)}
        />
      )}

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Metadata form */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6 border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Paper Metadata</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Class *
              </label>
              <ClassSelector
                value={paperMetadata.class_obj}
                onChange={(e) =>
                  setPaperMetadata({ ...paperMetadata, class_obj: e.target.value, subject: '' })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                scope={classSelectorScope}
                academicYearId={activeAcademicYear?.id}
                showAllOption={showAllOption}
                classes={teacherClassOptions || undefined}
                disabled={isReadOnlyPaper}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subject *
              </label>
              <select
                value={paperMetadata.subject}
                onChange={(e) =>
                  setPaperMetadata({ ...paperMetadata, subject: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isReadOnlyPaper || !resolvedClassObj || classSubjectsLoading}
                required
              >
                <option value="">
                  {!resolvedClassObj
                    ? 'Select class first'
                    : classSubjectsLoading
                      ? 'Loading subjects...'
                      : classSubjects.length > 0
                        ? 'Select subject'
                        : 'No subjects assigned to this class'}
                </option>
                {classSubjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.code ? `${subject.code} - ` : ''}{subject.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Exam (Optional)
              </label>
              <select
                value={paperMetadata.exam}
                onChange={(e) =>
                  setPaperMetadata({ ...paperMetadata, exam: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isReadOnlyPaper || examsLoading}
              >
                <option value="">{examsLoading ? 'Loading exams...' : 'Select Exam (Optional)'}</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>
                    {exam.exam_type?.name} - {exam.exam_subject?.subject?.name} ({new Date(exam.exam_date).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Builder + Coverage */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Tabs */}
          <div className="xl:col-span-3 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {/* Tab buttons */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setActiveTab('manual')}
                className={`flex-1 px-6 py-4 font-medium text-center transition ${
                  activeTab === 'manual'
                    ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                <span className="text-xl mr-2">⌨️</span>
                Manual Entry
              </button>
              <button
                onClick={() => setActiveTab('image')}
                disabled={isReadOnlyPaper}
                className={`flex-1 px-6 py-4 font-medium text-center transition ${
                  activeTab === 'image'
                    ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                <span className="text-xl mr-2">📸</span>
                Capture from Image
              </button>
              <button
                onClick={() => setActiveTab('lesson')}
                disabled={isReadOnlyPaper}
                className={`flex-1 px-6 py-4 font-medium text-center transition ${
                  activeTab === 'lesson'
                    ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-600 hover:text-gray-800'
                }`}
              >
                <span className="text-xl mr-2">📚</span>
                From Lesson Plans
              </button>
            </div>

            {/* Tab content */}
            <div className="p-8">
              {activeTab === 'manual' && (
                <ManualEntryPaperTab
                  draftData={manualDraft}
                  onDraftDataChange={handleManualDraftChange}
                  onSubmitDraft={handleManualSubmit}
                  isLoading={
                    saveState === 'saving'
                    || ensureDraftMutation.isPending
                    || autosaveMutation.isPending
                  }
                  saveState={saveState}
                  lastSavedAt={lastSavedAt}
                  draftReady={!!draftId}
                  classId={resolvedClassObj}
                  subjectId={paperMetadata.subject}
                  overusedQuestionCounts={overusedQuestionCounts}
                  readOnly={isReadOnlyPaper}
                />
              )}

              {activeTab === 'image' && (
                <ImageCapturePaperTab
                  onPaperCreate={handlePaperCreate}
                  isLoading={createPaperMutation.isPending}
                />
              )}

              {activeTab === 'lesson' && (
                <LessonPlanPaperTab
                  metadata={paperMetadata}
                  onPaperCreated={handlePaperCreated}
                  isLoading={createPaperMutation.isPending}
                  initialLessonPlanId={location.state?.lessonPlanId}
                />
              )}
            </div>
          </div>

          {/* Curriculum Coverage Panel */}
          <aside className="xl:col-span-1 bg-white rounded-lg shadow-sm border border-gray-200 h-fit">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-800">Curriculum Coverage</h3>
              <button
                type="button"
                onClick={() => setCoverageCollapsed((prev) => !prev)}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                {coverageCollapsed ? 'Expand' : 'Collapse'}
              </button>
            </div>

            {!coverageCollapsed && (
              <div className="p-4 space-y-3">
                {!draftId ? (
                  <p className="text-xs text-gray-500">Start building a draft to see coverage stats.</p>
                ) : coverageLoading ? (
                  <p className="text-xs text-gray-500">Loading coverage data...</p>
                ) : coverageError ? (
                  <p className="text-xs text-red-600">Failed to load coverage stats.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md bg-gray-50 p-2">
                        <p className="text-gray-500">Total SLOs</p>
                        <p className="text-gray-900 font-semibold">{totalSLOCount}</p>
                      </div>
                      <div className="rounded-md bg-emerald-50 p-2">
                        <p className="text-emerald-700">Covered</p>
                        <p className="text-emerald-800 font-semibold">{coveredSLOCount}</p>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-gray-600">Coverage</p>
                        <p className="text-xs font-medium text-gray-700">{coveragePercent}%</p>
                      </div>
                      <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-2 bg-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${coveragePercent}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-1">Covered SLOs</p>
                      {coveredSLOs.length === 0 ? (
                        <p className="text-xs text-gray-500">No covered SLOs yet.</p>
                      ) : (
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {coveredSLOs.map((slo) => (
                            <div key={slo.id} className="text-xs text-emerald-700 flex items-start gap-1">
                              <span className="mt-0.5">✓</span>
                              <span className="truncate">{slo.code || `SLO-${slo.id}`} {slo.statement}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="text-xs font-medium text-gray-700 mb-1">Uncovered SLOs</p>
                      {uncoveredSLOs.length === 0 ? (
                        <p className="text-xs text-gray-500">No uncovered SLOs in linked lesson-plan scope.</p>
                      ) : (
                        <div className="space-y-1 max-h-28 overflow-y-auto">
                          {uncoveredSLOs.map((slo) => (
                            <div key={slo.id} className="text-xs text-gray-600 flex items-start gap-1">
                              <span className="mt-0.5">•</span>
                              <span className="truncate">{slo.code || `SLO-${slo.id}`} {slo.statement}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-2 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-700 mb-2">Bloom Distribution</p>
                      {bloomDistribution.total === 0 ? (
                        <p className="text-xs text-gray-500">Add questions to view Bloom distribution.</p>
                      ) : (
                        <>
                          <div className="h-20">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={bloomDistribution.stackData} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                                <XAxis type="number" domain={[0, 100]} hide />
                                <YAxis type="category" dataKey="name" hide />
                                <Tooltip formatter={(value, name) => [`${value}%`, BLOOM_LEVELS.find((level) => level.key === name)?.label || name]} />
                                {BLOOM_LEVELS.map((level) => (
                                  <Bar key={level.key} dataKey={level.key} stackId="bloom" fill={level.color} isAnimationActive />
                                ))}
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {BLOOM_LEVELS.map((level) => (
                              <span key={level.key} className="inline-flex items-center gap-1 text-[10px] text-gray-600">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: level.color }} />
                                {level.label} ({bloomDistribution.counts[level.key]})
                              </span>
                            ))}
                          </div>
                          {bloomDistribution.isSurfaceHeavy && (
                            <p className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                              Warning: {Math.round(bloomDistribution.surfaceHeavyPercent)}% of questions are Remember/Understand.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>

        {/* Help text */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-900 mb-2">💡 Manual Entry Tips</h4>
            <ul className="text-sm text-blue-800 space-y-1 list-disc pl-4">
              <li>Use the rich editor for formatting</li>
              <li>Add questions one by one for better control</li>
              <li>MCQ requires at least options A and B</li>
              <li>Review all questions before creating the paper</li>
            </ul>
          </div>

          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
            <h4 className="font-semibold text-green-900 mb-2">🎯 Image Capture Tips</h4>
            <ul className="text-sm text-green-800 space-y-1 list-disc pl-4">
              <li>Take a clear photo of the handwritten paper</li>
              <li>Ensure good lighting and no shadows</li>
              <li>AI will extract and parse questions automatically</li>
              <li>Review and correct any extraction errors before confirming</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
