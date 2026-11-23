import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Field from '../../components/ui/Field'
import PageHeader from '../../components/ui/PageHeader'
import LoadingState from '../../components/ui/LoadingState'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { questionPaperApi, examinationsApi, lmsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import ClassSelector from '../../components/ClassSelector'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import { useDebounce } from '../../hooks/useDebounce'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import BlockPaperEditor from './blocks/BlockPaperEditor'
import {
  buildPaperEnsurePayload,
  hydrateStructure,
} from './paperPayload'

const RENDER_OPTIONS_DEFAULT = { answer_lines: false }

// DRF validation errors (e.g. QuestionCreateUpdateSerializer.validate()) come back as
// {field: [messages]} with no wrapping "detail" key -- only Django ValidationError
// (core.views.custom_exception_handler) wraps under "detail". Without this, autosave
// failures fell back to a generic "Autosave failed" toast that hid the actual reason
// (e.g. "SHORT requires answer_text or correct_answer"), leaving the paper builder
// stuck retrying the same invalid payload with no clue why.
function extractAutosaveErrorMessage(error, fallback) {
  const data = error?.response?.data
  if (!data) return fallback
  if (typeof data.detail === 'string') return data.detail
  if (Array.isArray(data.detail)) return data.detail.join(' ')
  if (typeof data === 'object') {
    const messages = Object.entries(data).map(([field, value]) => {
      const text = Array.isArray(value) ? value.join(' ') : String(value)
      return field === 'detail' || field === 'non_field_errors' ? text : `${field}: ${text}`
    })
    if (messages.length > 0) return messages.join(' | ')
  }
  return fallback
}

// Steps 2 and 3 are one block editor (blocks/BlockPaperEditor.jsx): Structure plans the paper's questions and
// marks and makes them with empty parts, Fill questions writes them (docs/PAPER_BUILDER_STRUCTURE_PLAN.md).
const STRUCTURE_STEP = 2
const FILL_STEP = 3
const WIZARD_STEPS = [
  { id: 1, label: 'Paper Setup' },
  { id: STRUCTURE_STEP, label: 'Structure' },
  { id: FILL_STEP, label: 'Fill questions' },
]

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
 * QuestionPaperBuilderPage - Main Question Paper Builder
 * Supports two modes:
 * 1. Image capture - Upload handwritten paper → OCR → Review
 * 2. Manual entry - Type questions with rich editor
 */
const PAPER_STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'READY', label: 'Ready' },
  { value: 'PUBLISHED', label: 'Published' },
]

function statusErrorMessage(error) {
  const data = error?.response?.data
  const first = (value) => (Array.isArray(value) ? value[0] : value)
  return first(data?.status) || first(data?.document) || first(data?.non_field_errors) || data?.detail || 'Could not change the status.'
}

export default function QuestionPaperBuilderPage() {
  const { activeSchool, user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { paperId: routePaperId } = useParams()
  const { activeAcademicYear } = useAcademicYear()
  const resumePaperId = routePaperId || location.state?.paperId || location.state?.draftId || null
  const [activeTab, setActiveTab] = useState('manual') // 'manual' (slot board) | 'image' (OCR upload)
  const { showError, showSuccess } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const [draftId, setDraftId] = useState(resumePaperId)
  const [manualDraft, setManualDraft] = useState(MANUAL_DRAFT_DEFAULT)
  const [manualDirty, setManualDirty] = useState(false)
  // Class / subject labels read off an uploaded paper; shown on Setup until both are chosen.
  const [saveState, setSaveState] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [coverageCollapsed, setCoverageCollapsed] = useState(false)
  const [paperStatus, setPaperStatus] = useState('DRAFT')
  // Server-computed allocated-vs-total marks check (ExamPaperSerializer.marks_reconciled),
  // so a mismatch persists past a dismissed/skipped step-2 confirm and is visible on
  // any later read of the paper (resumed draft, after an autosave). Defaults true so
  // a brand-new paper with no structure yet doesn't show a false mismatch warning.
  const [marksReconciled, setMarksReconciled] = useState(true)
  const [overusedQuestionCounts, setOverusedQuestionCounts] = useState({})
  const [wizardStep, setWizardStep] = useState(location.state?.lessonPlanId ? STRUCTURE_STEP : 1)
  // Total marks come from the blocks; the server stores them when the editor saves.
  const [paperTotal, setPaperTotal] = useState(null)
  const [structure, setStructure] = useState([])
  const [renderOptions, setRenderOptions] = useState(RENDER_OPTIONS_DEFAULT)
  const hasJumpedToStep3Ref = useRef(false)
  // Raw Master Class id (ExamPaper.class_obj) from a resumed draft, held here so the
  // late-loading-sessionClasses safety-net effect below can retry the session-class
  // mapping once sessionClasses arrives, without re-running the whole hydration effect.
  const resumedMasterClassIdRef = useRef(null)
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
    // Default fetchClasses (attendanceApi.getMyAttendanceClasses) is
    // class-teacher-only scope — too narrow here. Paper Builder's backend
    // permission (_can_manage_exam_papers) allows class-teacher OR
    // subject-teacher, same combined scope getMyLessonPlanClasses already
    // exposes for Lesson Plans, so a teacher who only teaches a subject in a
    // class (not its homeroom teacher) can now select that class too.
    fetchClasses: () => lmsApi.getMyLessonPlanClasses(),
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
    // ExamPaper.class_obj is a FK straight to the Master Class (students.Class), but
    // this page's paperMetadata.class_obj holds a Session Class id everywhere else
    // (that's what <ClassSelector scope="session"> options and getResolvedMasterClassId
    // expect) -- so resuming a draft needs to map the paper's master class id back to
    // this year's matching session class, or resolvedClassObj comes back empty and the
    // class/subject fields silently look unset even though the paper has them saved.
    resumedMasterClassIdRef.current = paper.class_obj || null
    const resumedSessionClassId = activeAcademicYear?.id
      ? sessionClasses.find((sc) => String(sc.class_obj) === String(paper.class_obj))?.id
      : paper.class_obj
    setPaperMetadata({
      class_obj: resumedSessionClassId ? String(resumedSessionClassId) : '',
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
    setMarksReconciled(paper.marks_reconciled !== false)
    setPaperTotal(paper.total_marks ?? null)
    hydrateOverusedQuestionCounts(paper)

    if (!hasJumpedToStep3Ref.current) {
      hasJumpedToStep3Ref.current = true
      setWizardStep(FILL_STEP)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeDraftRes])

  // Safety net: sessionClasses (useSessionClasses above) can still be loading when the
  // resumed-draft effect above runs, so the master->session class_obj mapping there can
  // miss on first pass. Retry once sessionClasses arrives; bail if the user has since
  // picked a class themselves (paperMetadata.class_obj already set).
  useEffect(() => {
    if (!resumedMasterClassIdRef.current || !activeAcademicYear?.id) return
    if (paperMetadata.class_obj) return
    const match = sessionClasses.find(
      (sc) => String(sc.class_obj) === String(resumedMasterClassIdRef.current),
    )
    if (match) {
      setPaperMetadata((prev) => ({ ...prev, class_obj: String(match.id) }))
    }
  }, [sessionClasses, activeAcademicYear?.id, paperMetadata.class_obj])

  // Keyed purely off paperStatus (defaults to 'DRAFT') rather than also requiring
  // resumePaperId -- a paper created fresh this session (no route/state id) must
  // still lock down if its status moves off DRAFT mid-session (e.g. published
  // from another tab), not just one resumed via a paper id in the URL/route state.
  const isReadOnlyPaper = paperStatus !== 'DRAFT'

  const statusMutation = useMutation({
    mutationFn: (status) => questionPaperApi.updateExamPaper(draftId, { status }),
    onSuccess: (_, status) => {
      setPaperStatus(status)
      queryClient.invalidateQueries({ queryKey: ['examPapersList'] })
      queryClient.invalidateQueries({ queryKey: ['paperBuilderResumeDraft', resumePaperId] })
      showSuccess(status === 'DRAFT' ? 'The paper is a draft again: you can change it.' : `The paper is now ${status === 'READY' ? 'ready' : 'published'}.`)
    },
    // The server refuses Ready/Published while questions are still to fill; show its reason.
    onError: (error) => showError(statusErrorMessage(error)),
  })

  useEffect(() => {
    if (isReadOnlyPaper && activeTab !== 'manual') {
      setActiveTab('manual')
    }
    if (isReadOnlyPaper) {
      setWizardStep(FILL_STEP)
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

  // A class with one subject (usual in Play Group) needs no extra pick (demo findings B4).
  useEffect(() => {
    if (!resolvedClassObj || paperMetadata.subject || classSubjectsLoading || classSubjects.length !== 1) return
    setPaperMetadata((prev) => (prev.subject ? prev : { ...prev, subject: String(classSubjects[0].id) }))
  }, [resolvedClassObj, paperMetadata.subject, classSubjectsLoading, classSubjects])

  // Coverage only actually changes server-side when an autosave lands (new/removed
  // questions or lesson-plan links), so it's refetched explicitly from
  // autosaveMutation.onSuccess and linkLessonPlansMutation.onSuccess rather than
  // polled blindly -- a fixed interval kept refetching (and re-running the
  // planned_topics_coverage query) even when nothing had changed since the last tick.
  const { data: coverageStatsRes, isLoading: coverageLoading, isError: coverageError } = useQuery({
    queryKey: ['paperCoverageStats', draftId],
    queryFn: () => questionPaperApi.getCoverageStats(draftId),
    enabled: !!draftId,
  })
  const coverageStats = coverageStatsRes?.data || null
  const linkedLessonPlanIds = useMemo(
    () => (coverageStats?.linked_lesson_plans || []).map((plan) => plan.id),
    [coverageStats],
  )

  // planned_topics_coverage (topic + its SLOs + covered flag, for every topic
  // planned across the paper's linked lesson plans) is computed server-side in
  // one query by coverage_stats -- this used to require one request per linked
  // lesson plan plus one per distinct topic (useQueries fan-out), which scaled
  // poorly with paper size and re-fired on every 4s coverage poll.
  const plannedTopicsCoverage = coverageStats?.planned_topics_coverage || []

  const allSLOs = useMemo(() => {
    const byId = new Map()
    plannedTopicsCoverage.forEach((topic) => {
      ;(topic.slos || []).forEach((slo) => {
        if (!byId.has(slo.id)) byId.set(slo.id, slo)
      })
    })
    return Array.from(byId.values())
  }, [plannedTopicsCoverage])

  const coveredSLOIds = useMemo(() => {
    const set = new Set()
    plannedTopicsCoverage.forEach((topic) => {
      if (!topic.is_covered) return
      ;(topic.slos || []).forEach((slo) => set.add(slo.id))
    })
    return set
  }, [plannedTopicsCoverage])

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

  // Written questions only: drawing activities (Play Group papers) carry no thinking level.
  const bloomDistribution = useMemo(() => {
    const counts = Object.fromEntries(BLOOM_LEVELS.map((level) => [level.key, 0]))
    const questionRows = (manualDraft.questions || []).filter((question) => question?.question_type !== 'ACTIVITY')
    questionRows.forEach((question) => {
      const key = String(question?.bloom_level || '').toLowerCase()
      counts[counts[key] !== undefined ? key : 'unclassified'] += 1
    })
    const total = questionRows.length
    const percentages = Object.fromEntries(BLOOM_LEVELS.map((level) => [
      level.key, total > 0 ? Number(((counts[level.key] / total) * 100).toFixed(1)) : 0,
    ]))
    const surfaceHeavyPercent = percentages.remember + percentages.understand
    return {
      total,
      counts,
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
  // Payload hash of the most recent autosave that the backend rejected. The autosave
  // effect below skips re-firing while the outgoing payload still hashes to this value,
  // so a validation failure (e.g. a question missing its required answer field) surfaces
  // once instead of retrying the identical doomed payload in a tight save/error loop that
  // reads to the user as "stuck at Saving...".
  const lastFailedAutosavePayloadRef = useRef('')


  const ensureDraftMutation = useMutation({
    mutationFn: (data) => questionPaperApi.ensureDraft(data),
    onSuccess: (response) => {
      const paper = response?.data
      if (!paper?.id) return
      setDraftId(paper.id)
      setSaveState('saved')
      setLastSavedAt(new Date().toISOString())
      setPaperTotal(paper.total_marks ?? null)
      localStorage.removeItem(recoveryKey)
      // A refresh should reopen this paper. replaceState (not navigate) keeps this page mounted;
      // the two routes render the same page.
      if (!routePaperId) window.history.replaceState(window.history.state, '', `/examinations/papers/${paper.id}`)
    },
    onError: (error) => {
      setSaveState('error')
      showError(extractAutosaveErrorMessage(error, 'Failed to create draft'))
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
          // The title box is never refilled from the reply: emptying it to type a new title sent '' and the
          // reply's old title came back mid-typing, mixing the two (demo findings 2026-11-18).
          paper_title: prev.paper_title,
          instructions: paper.instructions || '',
          duration_minutes: String(paper.duration_minutes ?? prev.duration_minutes),
        }))
        setStructure(hydrateStructure(paper.structure))
        setRenderOptions({ ...RENDER_OPTIONS_DEFAULT, ...(paper.render_options || {}) })
        setManualDirty(false)
      }
      // else: leave local state (and manualDirty=true) alone — the next autosave
      // cycle will pick up and send the newer edits.

      setSaveState('saved')
      setLastSavedAt(new Date().toISOString())
      setMarksReconciled(paper.marks_reconciled !== false)
      lastAutosavePayloadRef.current = variables?.payloadHash || lastAutosavePayloadRef.current
      localStorage.removeItem(recoveryKey)
      hydrateOverusedQuestionCounts(paper)
      // Coverage (topics/SLOs/Bloom mix) only changes when questions/structure
      // actually saved server-side -- refetch it here instead of polling blindly.
      queryClient.invalidateQueries({ queryKey: ['paperCoverageStats', paper.id] })
    },
    onError: (error, variables) => {
      setSaveState('error')
      // Record this exact payload as a known-failure so the autosave effect won't
      // immediately re-fire it once autosaveMutation.isPending flips back to false --
      // it'll only retry once the user actually changes something.
      lastFailedAutosavePayloadRef.current = variables?.payloadHash || lastFailedAutosavePayloadRef.current
      showError(extractAutosaveErrorMessage(error, 'Autosave failed'))
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
      }
      setSaveState('pending')
      showSuccess('Recovered unsaved manual draft from this browser.')
    } catch {
      // Ignore corrupt recovery payloads.
    }
  }, [recoveryKey, resumePaperId, showSuccess])

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

  // Dependencies stay field by field (not the whole draft): the draft's questions change on every keystroke
  // and this callback re-arms the ensure/autosave effects.
  const buildEnsurePayload = useCallback(() => buildPaperEnsurePayload({
    classObj: resolvedClassObj,
    subject: paperMetadata.subject,
    exam: paperMetadata.exam,
    manualDraft: {
      paper_title: manualDraft.paper_title,
      instructions: manualDraft.instructions,
      duration_minutes: manualDraft.duration_minutes,
    },
    structure,
    renderOptions,
  }), [manualDraft.duration_minutes, manualDraft.instructions, manualDraft.paper_title, paperMetadata.exam, paperMetadata.subject, renderOptions, resolvedClassObj, structure])

  // Paper details only: the block editor saves the questions itself (never send manual_questions
  // from here, the server would replace the paper's questions with them).
  const buildAutosavePayload = useCallback(() => buildEnsurePayload(), [buildEnsurePayload])

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
    // Same payload that just failed validation server-side -- don't hammer the API
    // with it again. Only a real edit (which changes the hash) re-arms the retry.
    if (debouncedAutosaveTrigger === lastFailedAutosavePayloadRef.current) return

    const payload = buildAutosavePayload()
    const payloadHash = JSON.stringify(payload)
    if (payloadHash === lastAutosavePayloadRef.current) return
    if (payloadHash === lastFailedAutosavePayloadRef.current) return

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

  // Feedback-only confirm call for image-capture uploads: records the PaperFeedback
  // learning-loop row and links/marks the upload CONFIRMED, but never creates
  // ExamPaper/Question rows itself — those already exist via ensure-draft + autosave.
  const confirmPaperUploadMutation = useMutation({
    mutationFn: ({ uploadId, payload }) => questionPaperApi.confirmPaperUpload(uploadId, payload),
    onError: () => {
      showError('Could not record OCR feedback for the uploaded paper (your draft is unaffected).')
    },
  })

  const [pendingImageConfirm, setPendingImageConfirm] = useState(null)
  useEffect(() => {
    if (!draftId || !pendingImageConfirm) return
    const { uploadIds, questions, blocks } = pendingImageConfirm
    setPendingImageConfirm(null)
    // A multi-page capture confirms every page's PaperUpload row that contributed
    // to this accepted paper (each accumulated equally into the one merged
    // questions list) -- not just the single most-recent page, so the learning-loop
    // feedback and CONFIRMED linkage covers every page the user actually reviewed.
    uploadIds.forEach((uploadId) => {
      confirmPaperUploadMutation.mutate({
        uploadId,
        // A block scan records the blocks the teacher kept, for comparing with what the AI read.
        payload: { exam_paper_id: draftId, confirmed_data: blocks ? { blocks } : { questions } },
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, pendingImageConfirm])

  // A photographed paper added in the editor: record the OCR feedback rows for its uploads.
  const handleCapturedPaper = useCallback((prefill) => {
    setPendingImageConfirm({ uploadIds: prefill.uploadIds || [prefill.uploadId], questions: prefill.questions, blocks: prefill.blocks })
  }, [])

  const linkLessonPlansMutation = useMutation({
    mutationFn: ({ id, lessonPlanIds }) => questionPaperApi.linkLessonPlans(id, { lesson_plan_ids: lessonPlanIds }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paperCoverageStats', draftId] })
    },
  })

  // Lesson plans narrow the bank picker and are linked to the paper for coverage. Opening
  // the builder from a lesson plan preselects it.
  const [selectedLessonPlanIds, setSelectedLessonPlanIds] = useState(
    location.state?.lessonPlanId ? [location.state.lessonPlanId] : [],
  )
  const handleLessonPlanIdsChange = useCallback((lessonPlanIds) => {
    setSelectedLessonPlanIds(lessonPlanIds)
  }, [])

  // Seeded from the server's current linkage (via coverage stats) before any sync is
  // allowed to fire — otherwise the default empty selection, reported on
  // mount before the user touches anything, would wipe out lesson plans already linked
  // to a resumed draft.
  const lastLinkedLessonPlanIdsRef = useRef(null)
  useEffect(() => {
    if (lastLinkedLessonPlanIdsRef.current === null && coverageStatsRes) {
      lastLinkedLessonPlanIdsRef.current = JSON.stringify(linkedLessonPlanIds)
      // Resumed draft: show the plans already linked as selected (keeps a lesson plan
      // the user arrived with). The hash above is the server's truth, so this only
      // triggers a sync when the arriving plan is not linked yet.
      setSelectedLessonPlanIds((prev) => Array.from(new Set([...linkedLessonPlanIds, ...prev])))
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

  // Build Paper has three columns (questions, preview, form); held to 6xl the preview was only ~400 px wide on a
  // 1920 px screen (demo findings A4), so that step uses the wider page.
  const pageWidth = wizardStep === FILL_STEP ? 'max-w-[1700px]' : 'max-w-6xl'

  return (
    <div className="min-h-screen bg-gray-50">
      <ConfirmModalRoot />
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 py-4 sm:py-6">
        <PageHeader className={`${pageWidth} mx-auto`} title="Question Paper Builder" subtitle="Build papers from activities and written questions, the question bank or a photo of a paper" />
      </div>

      {/* Main Content */}
      <div className={`${pageWidth} mx-auto px-4 sm:px-6 py-6 sm:py-8`}>
        {/* Wizard step nav */}
        <div className="flex items-center gap-1 sm:gap-2 mb-6">
          {WIZARD_STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center gap-1 sm:gap-2 flex-1">
              <button
                type="button"
                onClick={() => setWizardStep(step.id)}
                className={`flex-1 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2 sm:py-3 rounded-lg border text-left transition ${
                  wizardStep === step.id
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`w-5 h-5 sm:w-6 sm:h-6 shrink-0 flex items-center justify-center rounded-full text-[10px] sm:text-xs font-semibold ${
                    wizardStep === step.id ? 'bg-white text-blue-600' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {step.id}.
                </span>
                <span className="font-medium text-xs sm:text-sm">{step.label}</span>
              </button>
              {index < WIZARD_STEPS.length - 1 && (
                <span className="text-gray-300 hidden sm:inline">→</span>
              )}
            </div>
          ))}
        </div>

        {/* Status: a Ready or Published paper is locked; "Edit again" makes it a draft (same as the phone). */}
        {draftId && (
          <div className={`flex flex-wrap items-center gap-3 mb-6 px-4 py-3 rounded-lg border text-sm ${isReadOnlyPaper ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-white border-gray-200 text-gray-700'}`}>
            <label htmlFor="paper-status" className="font-medium">Status</label>
            <select id="paper-status" value={paperStatus} disabled={statusMutation.isPending}
              onChange={(e) => statusMutation.mutate(e.target.value)}
              className="px-2 py-1.5 border border-gray-300 rounded-md text-sm bg-white">
              {PAPER_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            {isReadOnlyPaper ? (
              <>
                <span>This paper is {paperStatus === 'PUBLISHED' ? 'published' : 'ready'}, so it is locked.</span>
                <button type="button" onClick={() => statusMutation.mutate('DRAFT')} disabled={statusMutation.isPending}
                  className="ml-auto px-3 py-1.5 rounded-md bg-primary-600 text-white font-medium hover:bg-primary-700 disabled:opacity-50">
                  Edit again
                </button>
              </>
            ) : (
              <span className="text-gray-500">Changes save by themselves. Set Ready when the paper is finished.</span>
            )}
          </div>
        )}

        {/* Step 1: Paper Setup */}
        {wizardStep === 1 && (
          <div className="bg-white rounded-lg shadow-sm p-4 sm:p-6 mb-6 border border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">Paper Setup</h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="label">
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

              <Field label="Subject" required>
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
</Field>

              <Field label="Exam (Optional)">
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
</Field>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="label">
                  Paper Title *
                </label>
                <input
                  type="text"
                  value={manualDraft.paper_title || ''}
                  onChange={(e) => {
                    titleIsAutoRef.current = e.target.value.trim() === ''
                    handleManualDraftChange({ ...manualDraft, paper_title: e.target.value })
                  }}
                  placeholder={autoPaperTitle || 'e.g., Physics Mid-Term 2026'}
                  disabled={isReadOnlyPaper}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {titleIsAutoRef.current && autoPaperTitle && (
                  <p className="text-xs text-gray-500 mt-1">Auto-generated from exam, class and subject — edit anytime.</p>
                )}
              </div>

              <div>
                <span className="label">Total Marks</span>
                <p className="px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-gray-800">
                  {paperTotal !== null && paperTotal !== undefined ? Number(paperTotal) : '—'}
                </p>
                <p className="text-xs text-gray-500 mt-1">Adds up from the questions in Build Paper.</p>
              </div>

              <Field label="Duration (minutes)">
<input
                  type="number"
                  value={manualDraft.duration_minutes || '60'}
                  onChange={(e) => handleManualDraftChange({ ...manualDraft, duration_minutes: e.target.value })}
                  disabled={isReadOnlyPaper}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
</Field>
            </div>

            <div className="mb-4">
              <label className="label">
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

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setWizardStep(STRUCTURE_STEP)}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg font-medium hover:bg-primary-700"
              >
                Next: Structure
              </button>
            </div>
          </div>
        )}

        {/* Steps 2 and 3: Structure and Fill questions (one block editor) */}
        {wizardStep >= STRUCTURE_STEP && (
          <>
            <BlockPaperEditor
              mode={wizardStep === STRUCTURE_STEP ? 'structure' : 'fill'}
              onModeChange={(next) => setWizardStep(next === 'structure' ? STRUCTURE_STEP : FILL_STEP)}
              paperId={draftId}
              paperTitle={manualDraft.paper_title}
              readOnly={isReadOnlyPaper}
              classId={resolvedClassObj}
              subjectId={paperMetadata.subject}
              lessonPlanIds={selectedLessonPlanIds}
              onLessonPlanIdsChange={handleLessonPlanIdsChange}
              onCapturedPaper={handleCapturedPaper}
              onSaved={(paper) => {
                setPaperTotal(paper?.total_marks ?? null)
                hydrateOverusedQuestionCounts(paper)
                setManualDraft((prev) => ({ ...prev, questions: (paper?.paper_questions || []).map(toQuestionDraft) }))
                // Coverage follows the paper's questions, which the server updates on each block save.
                queryClient.invalidateQueries({ queryKey: ['paperCoverageStats', draftId] })
              }}
            />

            {draftId && wizardStep === FILL_STEP && (
              <section className="mt-6 bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">Curriculum Coverage</h3>
                  <button type="button" onClick={() => setCoverageCollapsed((prev) => !prev)} className="text-xs text-gray-500 hover:text-gray-700">
                    {coverageCollapsed ? 'Expand' : 'Collapse'}
                  </button>
                </div>
                {!coverageCollapsed && (
                  <div className="p-4">
                    {coverageLoading ? (
                      <LoadingState label="Loading coverage data..." compact />
                    ) : coverageError ? (
                      <p className="text-xs text-red-600">Failed to load coverage stats.</p>
                    ) : totalSLOCount === 0 ? (
                      <p className="text-xs text-gray-500 mb-3">Link lesson plans (in “From question bank”) to see which learning outcomes this paper covers.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs text-gray-600">Covered {coveredSLOCount} of {totalSLOCount} SLOs</p>
                            <p className="text-xs font-medium text-gray-700">{coveragePercent}%</p>
                          </div>
                          <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-2 bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${coveragePercent}%` }} />
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1">Covered SLOs</p>
                          <div className="space-y-1 max-h-28 overflow-y-auto">
                            {coveredSLOs.length === 0 ? <p className="text-xs text-gray-500">None yet.</p> : coveredSLOs.map((slo) => (
                              <div key={slo.id} className="text-xs text-emerald-700 flex items-start gap-1"><span>✓</span><span className="truncate">{slo.code || `SLO-${slo.id}`} {slo.statement}</span></div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-700 mb-1">Not covered yet</p>
                          <div className="space-y-1 max-h-28 overflow-y-auto">
                            {uncoveredSLOs.length === 0 ? <p className="text-xs text-gray-500">All covered.</p> : uncoveredSLOs.map((slo) => (
                              <div key={slo.id} className="text-xs text-gray-600 flex items-start gap-1"><span>•</span><span className="truncate">{slo.code || `SLO-${slo.id}`} {slo.statement}</span></div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="pt-3 mt-3 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-700 mb-2">Bloom Distribution</p>
                      {bloomDistribution.total === 0 ? (
                        <p className="text-xs text-gray-500">Set a thinking level on written questions to see the mix.</p>
                      ) : (
                        <>
                          <div className="h-16">
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
                          <div className="flex flex-wrap gap-2 mt-2">
                            {BLOOM_LEVELS.map((level) => (
                              <span key={level.key} className="inline-flex items-center gap-1 text-[11px] text-gray-600">
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
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
