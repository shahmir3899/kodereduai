import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
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
import BankFillSource from './BankFillSource'
import PaperStructureBuilder, { calculateAllocatedMarks } from './PaperStructureBuilder'

const RENDER_OPTIONS_DEFAULT = { answer_lines: false }

const WIZARD_STEPS = [
  { id: 1, label: 'Paper Setup' },
  { id: 2, label: 'Paper Structure' },
  { id: 3, label: 'Add Questions' },
]

function hydrateStructure(structure) {
  if (!Array.isArray(structure)) return []
  return structure.map((section, index) => {
    const localId = `sec_${section?.key || index}_${index}`
    const key = section?.key || `sec_${Date.now()}_${index}`

    if (section?.type === 'divider') {
      return { local_id: localId, key, type: 'divider', title: section?.title || 'Section' }
    }

    const slotsShown = Number(section?.slots_shown ?? 0) || 0
    const slotsCounted = Number(section?.slots_counted ?? slotsShown) || 0
    const isChoice = slotsCounted !== slotsShown
    return {
      local_id: localId,
      key,
      type: 'question_group',
      title: section?.title || `Q${index + 1}`,
      instruction: section?.instruction || '',
      instructionIsAuto: false,
      question_type: section?.question_type || 'SHORT',
      slots_shown: slotsShown,
      slots_counted: slotsCounted,
      marks_per_question: Number(section?.marks_per_question ?? 0) || 0,
      is_choice: isChoice,
    }
  })
}

function serializeStructure(sections) {
  return (sections || []).map((section) => {
    if (section.type === 'divider') {
      return { key: section.key, type: 'divider', title: section.title }
    }
    return {
      key: section.key,
      type: 'question_group',
      title: section.title,
      instruction: section.instruction,
      question_type: section.question_type,
      slots_shown: section.slots_shown,
      slots_counted: section.slots_counted,
      marks_per_question: section.marks_per_question,
    }
  })
}

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

/** Exam records from the API expose name/exam_type_name/start_date (not exam_date or
 * a nested exam_subject) — build a safe label without ever rendering "Invalid Date". */
function formatExamOptionLabel(exam) {
  const parts = [exam.name || exam.exam_type_name || `Exam #${exam.id}`]
  if (exam.exam_type_name && exam.exam_type_name !== exam.name) {
    parts.push(`(${exam.exam_type_name})`)
  }
  if (exam.start_date) {
    const parsedDate = new Date(exam.start_date)
    if (!Number.isNaN(parsedDate.getTime())) {
      parts.push(`- ${parsedDate.toLocaleDateString()}`)
    }
  }
  return parts.join(' ')
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
    section_key: paperQuestion.section_key || '',
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

/**
 * Flattens draft questions into autosave order: sections in structure order first
 * (preserving each question's relative position within its section), then any
 * questions not linked to a section key.
 */
function orderQuestionsForAutosave(questions, structure) {
  const orderedKeys = (structure || [])
    .filter((section) => section.type !== 'divider')
    .map((section) => section.key)
    .filter(Boolean)
  const bySection = new Map()
  const unassigned = []

  ;(questions || []).forEach((question) => {
    const sectionKey = question.section_key || ''
    if (sectionKey && orderedKeys.includes(sectionKey)) {
      if (!bySection.has(sectionKey)) bySection.set(sectionKey, [])
      bySection.get(sectionKey).push(question)
    } else {
      unassigned.push(question)
    }
  })

  const ordered = []
  orderedKeys.forEach((key) => {
    ordered.push(...(bySection.get(key) || []))
  })
  ordered.push(...unassigned)
  return ordered
}

function buildManualAutosaveQuestions(questions, structure = []) {
  return orderQuestionsForAutosave(questions, structure).map((question, index) => ({
    question_id: question.question_id || undefined,
    question_order: index + 1,
    section_key: question.section_key || '',
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
  const queryClient = useQueryClient()
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
  const [wizardStep, setWizardStep] = useState(location.state?.lessonPlanId ? 3 : 1)
  const [structure, setStructure] = useState([])
  const [renderOptions, setRenderOptions] = useState(RENDER_OPTIONS_DEFAULT)
  const [sourceChosen, setSourceChosen] = useState(Boolean(location.state?.lessonPlanId))
  const hasJumpedToStep3Ref = useRef(false)
  // Whether the Paper Title field is still following the auto-generated
  // "Exam - Class - Subject" suggestion. Flips to false the moment the user types
  // into the field directly, or once we resume a draft that already has its own title.
  const titleIsAutoRef = useRef(!resumePaperId)
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

  // Fetch exams — scoped to the current academic year (session) and the selected
  // class, since an Exam always belongs to exactly one class/year.
  const { data: examsData, isLoading: examsLoading } = useQuery({
    queryKey: ['exams', activeAcademicYear?.id, resolvedClassObj],
    queryFn: () => examinationsApi.getExams({
      page_size: 999,
      academic_year: activeAcademicYear.id,
      class_obj: resolvedClassObj,
    }),
    enabled: !!activeAcademicYear?.id && !!resolvedClassObj,
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

  const { data: resumeDraftRes } = useQuery({
    queryKey: ['paperBuilderResumeDraft', resumePaperId],
    queryFn: () => questionPaperApi.getExamPaper(resumePaperId),
    enabled: !!resumePaperId,
  })

  useEffect(() => {
    const paper = resumeDraftRes?.data
    if (!paper?.id) return

    if ((paper.paper_title || '').trim()) {
      titleIsAutoRef.current = false
    }

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
    setStructure(hydrateStructure(paper.structure))
    setRenderOptions({ ...RENDER_OPTIONS_DEFAULT, ...(paper.render_options || {}) })
    setManualDirty(false)
    setSaveState('saved')
    setLastSavedAt(paper.updated_at || new Date().toISOString())
    hydrateOverusedQuestionCounts(paper)

    if (!hasJumpedToStep3Ref.current) {
      hasJumpedToStep3Ref.current = true
      setWizardStep(3)
      setSourceChosen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeDraftRes])

  const isReadOnlyPaper = Boolean(resumePaperId && paperStatus && paperStatus !== 'DRAFT')

  useEffect(() => {
    if (isReadOnlyPaper && activeTab !== 'manual') {
      setActiveTab('manual')
    }
    if (isReadOnlyPaper) {
      setWizardStep(3)
      setSourceChosen(true)
    }
  }, [activeTab, isReadOnlyPaper])

  const exams = examsData?.data?.results || []

  // Human-readable labels for the auto paper-title suggestion ("Exam - Class - Subject").
  const selectedClassLabel = useMemo(() => {
    if (!paperMetadata.class_obj) return ''
    const sessionMatch = sessionClasses.find((sc) => String(sc.id) === String(paperMetadata.class_obj))
    if (sessionMatch) {
      return sessionMatch.display_name || sessionMatch.label || sessionMatch.class_obj_name || ''
    }
    const teacherMatch = (teacherClassOptions || []).find((opt) => String(opt.id) === String(paperMetadata.class_obj))
    return teacherMatch?.label || teacherMatch?.name || ''
  }, [paperMetadata.class_obj, sessionClasses, teacherClassOptions])

  const selectedSubjectLabel = useMemo(() => {
    if (!paperMetadata.subject) return ''
    return classSubjects.find((subject) => String(subject.id) === String(paperMetadata.subject))?.name || ''
  }, [paperMetadata.subject, classSubjects])

  const selectedExamLabel = useMemo(() => {
    if (!paperMetadata.exam) return ''
    return exams.find((exam) => String(exam.id) === String(paperMetadata.exam))?.exam_type_name || ''
  }, [paperMetadata.exam, exams])

  const autoPaperTitle = useMemo(() => {
    return [selectedExamLabel, selectedClassLabel, selectedSubjectLabel].filter(Boolean).join(' - ')
  }, [selectedExamLabel, selectedClassLabel, selectedSubjectLabel])

  // Keeps the Paper Title field following "Exam - Class - Subject" until the user
  // types their own title (or clears it back to empty, which re-enables the suggestion).
  useEffect(() => {
    if (!titleIsAutoRef.current) return
    if (!autoPaperTitle || autoPaperTitle === manualDraft.paper_title) return
    setManualDraft((prev) => ({ ...prev, paper_title: autoPaperTitle }))
    setManualDirty(true)
    setSaveState((prev) => (prev === 'saving' ? prev : 'pending'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPaperTitle])

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

      // This response reflects whatever was sent at dispatch time. If the user kept
      // editing (structure/questions/metadata) while the request was in flight, the
      // live state has already moved on — overwriting it here would silently revert
      // those newer edits (this exact class of bug has bitten this page before).
      // Only apply the server echo when nothing has changed since we sent it.
      const latestPayloadHash = JSON.stringify(buildAutosavePayload())
      const hasNewerLocalEdits = Boolean(variables?.payloadHash) && variables.payloadHash !== latestPayloadHash

      if (!hasNewerLocalEdits) {
        // Deliberately NOT syncing class_obj/subject/exam from this response: the
        // dropdowns are the source of truth once the user starts picking values, and
        // buildEnsurePayload() omits empty subject/exam (they're required FKs, so an
        // in-progress "cleared, about to repick" state can't be sent) rather than
        // clearing them server-side — echoing the server's still-old value back here
        // used to silently revert a subject/exam the user had just cleared mid-selection.
        setManualDraft((prev) => ({
          ...prev,
          paper_title: paper.paper_title || prev.paper_title,
          instructions: paper.instructions || '',
          total_marks: String(paper.total_marks ?? prev.total_marks),
          duration_minutes: String(paper.duration_minutes ?? prev.duration_minutes),
          questions: (paper.paper_questions || []).map(toQuestionDraft),
        }))
        setStructure(hydrateStructure(paper.structure))
        setRenderOptions({ ...RENDER_OPTIONS_DEFAULT, ...(paper.render_options || {}) })
        setManualDirty(false)
      }
      // else: leave local state (and manualDirty=true) alone — the next autosave
      // cycle will pick up and send the newer edits.

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
      if (Array.isArray(parsed.structure)) {
        setStructure(parsed.structure)
      }
      if (parsed.renderOptions) {
        setRenderOptions((prev) => ({ ...prev, ...parsed.renderOptions }))
      }
      if (parsed.wizardStep) {
        setWizardStep(parsed.wizardStep)
        setSourceChosen(parsed.wizardStep >= 3)
      }
      setSaveState('pending')
      setToast({ type: 'success', message: 'Recovered unsaved manual draft from this browser.' })
    } catch {
      // Ignore corrupt recovery payloads.
    }
  }, [recoveryKey, resumePaperId])

  const recoveryPayload = useDebounce({ paperMetadata, manualDraft, structure, renderOptions, wizardStep }, 400)
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
          structure: recoveryPayload.structure,
          renderOptions: recoveryPayload.renderOptions,
          wizardStep: recoveryPayload.wizardStep,
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
      structure: serializeStructure(structure),
      render_options: renderOptions,
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
  }, [manualDraft.duration_minutes, manualDraft.instructions, manualDraft.paper_title, manualDraft.total_marks, paperMetadata.exam, paperMetadata.subject, renderOptions, resolvedClassObj, structure])

  const buildAutosavePayload = useCallback(() => {
    const payload = buildEnsurePayload()
    payload.manual_questions = buildManualAutosaveQuestions(manualDraft.questions, structure)
    return payload
  }, [buildEnsurePayload, manualDraft.questions, structure])

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

  // `useDebounce` only gates *when* autosave fires (settle trigger); the payload it returns
  // can still lag the live state by up to `delay` right after mount (its internal state starts
  // frozen at the first render's value until its own timer first fires). Reading that stale
  // snapshot as the outgoing payload once caused an early autosave-after-resume to post an
  // empty manual_questions list, which the backend interprets as "delete every question."
  // So the debounce is used only as a trigger; the payload sent is always rebuilt fresh here.
  const debouncedAutosaveTrigger = useDebounce(JSON.stringify(buildAutosavePayload()), 900)
  useEffect(() => {
    if (activeTab !== 'manual') return
    if (!draftId) return
    if (!manualDirty) return
    if (autosaveMutation.isPending) return
    if (debouncedAutosaveTrigger === lastAutosavePayloadRef.current) return

    const payload = buildAutosavePayload()
    const payloadHash = JSON.stringify(payload)
    if (payloadHash === lastAutosavePayloadRef.current) return

    setSaveState('saving')
    autosaveMutation.mutate({
      id: draftId,
      data: payload,
      payloadHash,
    })
  }, [activeTab, autosaveMutation, buildAutosavePayload, debouncedAutosaveTrigger, draftId, manualDirty])

  const handleManualDraftChange = useCallback((nextDraft) => {
    setManualDraft(nextDraft)
    setManualDirty(true)
    if (saveState !== 'saving') {
      setSaveState('pending')
    }
  }, [saveState])

  const handleStructureChange = useCallback((nextStructure) => {
    setStructure(nextStructure)
    setManualDirty(true)
    if (saveState !== 'saving') {
      setSaveState('pending')
    }
  }, [saveState])

  const handleRenderOptionsChange = useCallback((nextRenderOptions) => {
    setRenderOptions(nextRenderOptions)
    setManualDirty(true)
    if (saveState !== 'saving') {
      setSaveState('pending')
    }
  }, [saveState])

  // Marks mismatch is advisory only — never a hard block — but it should at least
  // interrupt the "Next" click with a confirmation instead of silently sailing past it.
  const handleGoToAddQuestions = useCallback(() => {
    const allocated = calculateAllocatedMarks(structure)
    const total = Number(manualDraft.total_marks) || 0
    const isMismatched = total > 0 && allocated !== total

    if (isMismatched) {
      const proceed = window.confirm(
        `Allocated marks (${allocated}) don't match the paper's total marks (${total}). Continue to Add Questions anyway?`,
      )
      if (!proceed) return
    }
    setWizardStep(3)
  }, [structure, manualDraft.total_marks])

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

  // Feedback-only confirm call for image-capture uploads: records the PaperFeedback
  // learning-loop row and links/marks the upload CONFIRMED, but never creates
  // ExamPaper/Question rows itself — those already exist via ensure-draft + autosave.
  const confirmPaperUploadMutation = useMutation({
    mutationFn: ({ uploadId, payload }) => questionPaperApi.confirmPaperUpload(uploadId, payload),
    onError: () => {
      setToast({
        type: 'error',
        message: 'Could not record OCR feedback for the uploaded paper (your draft is unaffected).',
      })
    },
  })

  const [pendingImageConfirm, setPendingImageConfirm] = useState(null)
  useEffect(() => {
    if (!draftId || !pendingImageConfirm) return
    const { uploadId, questions } = pendingImageConfirm
    setPendingImageConfirm(null)
    confirmPaperUploadMutation.mutate({
      uploadId,
      payload: { exam_paper_id: draftId, confirmed_data: { questions } },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, pendingImageConfirm])

  // Commits the reviewed image-extraction prefill (paper fields, structure, slotted
  // questions) into the same wizard state manual entry uses — it then autosaves
  // through the normal draft path exactly like typed/bank questions.
  const handleApplyImagePrefill = useCallback((prefill) => {
    if ((prefill.paperFields.paper_title || '').trim()) {
      // The detected title is a real suggestion from the paper itself — stop the
      // Exam/Class/Subject auto-title from overwriting it later.
      titleIsAutoRef.current = false
    }
    setManualDraft((prev) => ({
      ...prev,
      paper_title: prefill.paperFields.paper_title || prev.paper_title,
      total_marks: prefill.paperFields.total_marks || prev.total_marks,
      duration_minutes: prefill.paperFields.duration_minutes || prev.duration_minutes,
      questions: [...prev.questions, ...prefill.questions],
    }))
    setManualDirty(true)
    setSaveState((prev) => (prev === 'saving' ? prev : 'pending'))
    setStructure((prev) => [...prev, ...prefill.structure])
    setActiveTab('manual')
    setSourceChosen(true)
    setWizardStep(3)
    setPendingImageConfirm({ uploadId: prefill.uploadId, questions: prefill.questions })
    setToast({ type: 'success', message: 'Prefilled from your uploaded paper — review and edit; it autosaves as you go.' })
  }, [])

  const linkLessonPlansMutation = useMutation({
    mutationFn: ({ id, lessonPlanIds }) => questionPaperApi.linkLessonPlans(id, { lesson_plan_ids: lessonPlanIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paperCoverageStats', draftId] })
    },
  })

  const [selectedLessonPlanIds, setSelectedLessonPlanIds] = useState([])
  const handleLessonPlanIdsChange = useCallback((lessonPlanIds) => {
    setSelectedLessonPlanIds(lessonPlanIds)
  }, [])

  // Seeded from the server's current linkage (via coverage stats) before any sync is
  // allowed to fire — otherwise BankFillSource's default empty selection, reported on
  // mount before the user touches anything, would wipe out lesson plans already linked
  // to a resumed draft.
  const lastLinkedLessonPlanIdsRef = useRef(null)
  useEffect(() => {
    if (lastLinkedLessonPlanIdsRef.current === null && coverageStatsRes) {
      lastLinkedLessonPlanIdsRef.current = JSON.stringify(linkedLessonPlanIds)
    }
  }, [coverageStatsRes, linkedLessonPlanIds])

  useEffect(() => {
    if (!draftId) return
    if (lastLinkedLessonPlanIdsRef.current === null) return
    const payloadHash = JSON.stringify(selectedLessonPlanIds)
    if (payloadHash === lastLinkedLessonPlanIdsRef.current) return
    lastLinkedLessonPlanIdsRef.current = payloadHash
    linkLessonPlansMutation.mutate({ id: draftId, lessonPlanIds: selectedLessonPlanIds })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, selectedLessonPlanIds])

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
        {/* Wizard step nav */}
        <div className="flex items-center gap-2 mb-6">
          {WIZARD_STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center gap-2 flex-1">
              <button
                type="button"
                onClick={() => setWizardStep(step.id)}
                className={`flex-1 flex items-center gap-2 px-4 py-3 rounded-lg border text-left transition ${
                  wizardStep === step.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold ${
                    wizardStep === step.id ? 'bg-white text-blue-600' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {step.id}.
                </span>
                <span className="font-medium text-sm">{step.label}</span>
              </button>
              {index < WIZARD_STEPS.length - 1 && (
                <span className="text-gray-300 hidden sm:inline">→</span>
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Paper Setup */}
        {wizardStep === 1 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6 border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Paper Setup</h2>

            {!isReadOnlyPaper && (
              <div className="flex items-center justify-between gap-3 mb-6 rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-3">
                <p className="text-sm text-blue-800">
                  📄 Have a printed/handwritten paper? Upload it and we'll pre-fill this form.
                </p>
                <button
                  type="button"
                  onClick={() => { setActiveTab('image'); setSourceChosen(true); setWizardStep(3) }}
                  className="shrink-0 px-3 py-1.5 border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-100"
                >
                  Upload paper image
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Class *
                </label>
                <ClassSelector
                  value={paperMetadata.class_obj}
                  onChange={(e) =>
                    setPaperMetadata({ ...paperMetadata, class_obj: e.target.value, subject: '', exam: '' })
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
                  disabled={isReadOnlyPaper || !resolvedClassObj || examsLoading}
                >
                  <option value="">
                    {!resolvedClassObj
                      ? 'Select class first'
                      : examsLoading
                        ? 'Loading exams...'
                        : exams.length > 0
                          ? 'Select Exam (Optional)'
                          : 'No exams found for this class this session'}
                  </option>
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>
                      {formatExamOptionLabel(exam)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Paper Title *
                </label>
                <input
                  type="text"
                  value={manualDraft.paper_title || ''}
                  onChange={(e) => {
                    titleIsAutoRef.current = e.target.value.trim() === ''
                    handleManualDraftChange({ ...manualDraft, paper_title: e.target.value })
                  }}
                  placeholder="e.g., Physics Mid-Term 2026"
                  disabled={isReadOnlyPaper}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {titleIsAutoRef.current && autoPaperTitle && (
                  <p className="text-xs text-gray-500 mt-1">Auto-generated from exam, class and subject — edit anytime.</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total Marks
                </label>
                <input
                  type="number"
                  value={manualDraft.total_marks || '100'}
                  onChange={(e) => handleManualDraftChange({ ...manualDraft, total_marks: e.target.value })}
                  disabled={isReadOnlyPaper}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Duration (minutes)
                </label>
                <input
                  type="number"
                  value={manualDraft.duration_minutes || '60'}
                  onChange={(e) => handleManualDraftChange({ ...manualDraft, duration_minutes: e.target.value })}
                  disabled={isReadOnlyPaper}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Instructions
              </label>
              <textarea
                value={manualDraft.instructions || ''}
                onChange={(e) => handleManualDraftChange({ ...manualDraft, instructions: e.target.value })}
                placeholder="Enter general instructions for students..."
                rows="4"
                disabled={isReadOnlyPaper}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            <div className="flex items-center gap-2 mb-6">
              <input
                type="checkbox"
                id="answer-lines"
                checked={Boolean(renderOptions.answer_lines)}
                disabled={isReadOnlyPaper}
                onChange={(e) => handleRenderOptionsChange({ ...renderOptions, answer_lines: e.target.checked })}
              />
              <label htmlFor="answer-lines" className="text-sm text-gray-700">
                Add answer lines in exported paper
              </label>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setWizardStep(2)}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                Next: Paper Structure
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Paper Structure */}
        {wizardStep === 2 && (
          <div className="bg-white rounded-lg shadow-sm p-6 mb-6 border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Paper Structure</h2>
            <PaperStructureBuilder
              sections={structure}
              onChange={handleStructureChange}
              totalMarks={manualDraft.total_marks}
              readOnly={isReadOnlyPaper}
            />

            <div className="flex justify-between mt-6">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="px-6 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50"
              >
                Back: Paper Setup
              </button>
              <button
                type="button"
                onClick={handleGoToAddQuestions}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
              >
                Next: Add Questions
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Add Questions + Coverage */}
        {wizardStep === 3 && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
          {/* Source chooser + content */}
          <div className="xl:col-span-3 bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-8">
              {structure.length === 0 && (
                <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  Define sections in Step 2, or add questions freely.
                </div>
              )}

              {!sourceChosen && !isReadOnlyPaper ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <button
                    type="button"
                    onClick={() => { setActiveTab('manual'); setSourceChosen(true) }}
                    className="p-6 border-2 border-gray-200 rounded-lg text-center hover:border-blue-400 hover:bg-blue-50 transition"
                  >
                    <span className="text-3xl block mb-2">⌨️</span>
                    <span className="font-semibold text-gray-800">Type manually</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('lesson'); setSourceChosen(true) }}
                    className="p-6 border-2 border-gray-200 rounded-lg text-center hover:border-blue-400 hover:bg-blue-50 transition"
                  >
                    <span className="text-3xl block mb-2">📚</span>
                    <span className="font-semibold text-gray-800">From question bank / lesson plans</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setActiveTab('image'); setSourceChosen(true) }}
                    className="p-6 border-2 border-gray-200 rounded-lg text-center hover:border-blue-400 hover:bg-blue-50 transition"
                  >
                    <span className="text-3xl block mb-2">📸</span>
                    <span className="font-semibold text-gray-800">Capture from image</span>
                  </button>
                </div>
              ) : (
                <>
                  {!isReadOnlyPaper && (
                    <div className="flex items-center justify-between mb-4">
                      <div className="text-sm text-gray-600">
                        Source: <span className="font-medium text-gray-800">
                          {activeTab === 'manual' && 'Type manually'}
                          {activeTab === 'lesson' && 'From question bank / lesson plans'}
                          {activeTab === 'image' && 'Capture from image'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSourceChosen(false)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Change source
                      </button>
                    </div>
                  )}

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
                      structure={structure}
                      overusedQuestionCounts={overusedQuestionCounts}
                      readOnly={isReadOnlyPaper}
                    />
                  )}

                  {activeTab === 'image' && (
                    <ImageCapturePaperTab
                      classId={resolvedClassObj}
                      subjectId={paperMetadata.subject}
                      readOnly={isReadOnlyPaper}
                      onApplyPrefill={handleApplyImagePrefill}
                    />
                  )}

                  {activeTab === 'lesson' && (
                    <BankFillSource
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
                      structure={structure}
                      overusedQuestionCounts={overusedQuestionCounts}
                      readOnly={isReadOnlyPaper}
                      initialLessonPlanId={location.state?.lessonPlanId}
                      initialLessonPlanIds={linkedLessonPlanIds}
                      onLessonPlanIdsChange={handleLessonPlanIdsChange}
                    />
                  )}
                </>
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
        )}

        {/* Help text */}
        {wizardStep === 3 && (
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
        )}
      </div>
    </div>
  )
}
