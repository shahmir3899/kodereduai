import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { sessionsApi } from '../../services/api'
import { useBackgroundTask } from '../../hooks/useBackgroundTask'
import { useClasses } from '../../hooks/useClasses'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import ClassSelector from '../../components/ClassSelector'
import { useToast } from '../../components/Toast'

// Recommendation badge component
function RecBadge({ rec }) {
  const styles = {
    PROMOTE: 'bg-green-100 text-green-800 border-green-200',
    NEEDS_REVIEW: 'bg-amber-100 text-amber-800 border-amber-200',
    RETAIN: 'bg-red-100 text-red-800 border-red-200',
    GRADUATE: 'bg-blue-100 text-blue-800 border-blue-200',
    REPEAT: 'bg-purple-100 text-purple-800 border-purple-200',
  }
  const labels = {
    PROMOTE: 'Promote',
    NEEDS_REVIEW: 'Needs Review',
    RETAIN: 'Repeat',
    GRADUATE: 'Graduate',
    REPEAT: 'Repeat',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${styles[rec] || 'bg-gray-100 text-gray-700'}`}>
      {labels[rec] || rec}
    </span>
  )
}

// Confidence bar component
function ConfidenceBar({ value }) {
  const color = value >= 70 ? 'bg-green-500' : value >= 40 ? 'bg-amber-500' : 'bg-red-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs text-gray-500">{value}%</span>
    </div>
  )
}

// Trend indicator
function TrendIndicator({ trend }) {
  if (trend === 'improving') return <span className="text-green-600 text-xs font-medium">Improving</span>
  if (trend === 'declining') return <span className="text-red-600 text-xs font-medium">Declining</span>
  if (trend === 'stable') return <span className="text-gray-600 text-xs font-medium">Stable</span>
  return <span className="text-gray-400 text-xs">N/A</span>
}

function getClassOptionLabel(classObj) {
  if (!classObj) return ''
  if (classObj.label) return classObj.label

  const baseName = classObj.display_name || classObj.name || ''
  if (!baseName) return ''

  return classObj.section ? `${baseName} - ${classObj.section}` : baseName
}

export default function PromotionPage() {
  const queryClient = useQueryClient()
  const { showError, showSuccess, showWarning } = useToast()

  // Step state
  const [step, setStep] = useState(1) // 1: Select years, 2: Select class, 3: Review & promote

  // Selection state
  const [sourceYearId, setSourceYearId] = useState('')
  const [targetYearId, setTargetYearId] = useState('')
  const [sourceClassId, setSourceClassId] = useState('')

  // Promotion data
  const [promotions, setPromotions] = useState([])
  const [result, setResult] = useState(null)
  // History tab: pair-based selection + row-level filters
  const [historyPair, setHistoryPair] = useState({ source: '', target: '' })
  const [historyFilters, setHistoryFilters] = useState({ event_type: '', source_class: '', target_class: '', student_search: '' })
  const [selectedHistoryIds, setSelectedHistoryIds] = useState([])
  const [singleCorrectionModal, setSingleCorrectionModal] = useState(null)
  const [singleCorrectionForm, setSingleCorrectionForm] = useState({ action: 'REPEAT', target_class_id: '', new_roll_number: '', reason: '' })
  const [bulkCorrectionAction, setBulkCorrectionAction] = useState('REPEAT')
  const [bulkCorrectionTargetClassId, setBulkCorrectionTargetClassId] = useState('')
  const [bulkCorrectionReason, setBulkCorrectionReason] = useState('')
  const [showTargetSetupModal, setShowTargetSetupModal] = useState(false)
  const [targetSetupPreview, setTargetSetupPreview] = useState(null)
  const [isTargetSetupLoading, setIsTargetSetupLoading] = useState(false)
  const [selectedTargetCandidateId, setSelectedTargetCandidateId] = useState('')
  const [isInitializingSessionClasses, setIsInitializingSessionClasses] = useState(false)

  // AI Advisor state
  const [showAdvisor, setShowAdvisor] = useState(false)
  const [advisorOverrides, setAdvisorOverrides] = useState({}) // { student_id: 'PROMOTE' | 'RETAIN' | 'NEEDS_REVIEW' }

  // Queries
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const { classes: masterClasses } = useClasses()
  const { sessionClasses: sourceSessionClasses } = useSessionClasses(sourceYearId)
  const { sessionClasses: targetSessionClasses } = useSessionClasses(targetYearId)

  const { data: enrollmentsRes, isLoading: enrollmentsLoading } = useQuery({
    queryKey: ['enrollmentsByClass', sourceClassId, sourceYearId],
    queryFn: () => sessionsApi.getEnrollmentsByClass({
      ...(sourceSessionClasses?.length > 0 ? { session_class_id: sourceClassId } : { class_id: sourceClassId }),
      academic_year_id: sourceYearId,
      page_size: 9999,
    }),
    enabled: !!sourceClassId && !!sourceYearId && step >= 2,
  })

  // AI Promotion Advisor (background task)
  const [advisorData, setAdvisorData] = useState(null)
  const advisorTask = useBackgroundTask({
    mutationFn: (data) => sessionsApi.getPromotionAdvice(data),
    taskType: 'PROMOTION_ADVISOR',
    title: 'Running AI Promotion Analysis',
    onSuccess: (resultData) => {
      if (resultData) setAdvisorData(resultData)
    },
  })
  const advisorLoading = advisorTask.isSubmitting || (advisorTask.submittedTaskId && !advisorTask.isComplete && !advisorTask.isFailed)

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const sourceClassOptions = sourceSessionClasses?.length > 0 ? sourceSessionClasses : masterClasses
  const targetClassOptions = targetSessionClasses?.length > 0 ? targetSessionClasses : masterClasses
  const enrollments = enrollmentsRes?.data?.results || enrollmentsRes?.data || []
  const recommendations = advisorData?.recommendations || []

  // History tab — pair options
  const { data: historyPairsRes, isLoading: historyPairsLoading } = useQuery({
    queryKey: ['promotion-history-pairs'],
    queryFn: () => sessionsApi.getPromotionHistoryPairs(),
    enabled: step === 4,
    staleTime: 60_000,
  })
  const historyPairs = historyPairsRes?.data || []
  const historyPairSelected = !!historyPair.source && !!historyPair.target

  // Session classes scoped to the selected history pair (filters + correction modal)
  const { sessionClasses: historySourceSessionClasses } = useSessionClasses(historyPair.source || '')
  const { sessionClasses: historyTargetSessionClasses } = useSessionClasses(historyPair.target || '')
  const historySourceClassOptions = historySourceSessionClasses?.length > 0 ? historySourceSessionClasses : masterClasses
  const historyTargetClassOptions = historyTargetSessionClasses?.length > 0 ? historyTargetSessionClasses : masterClasses
  const historyTargetUsesSessionClasses = historyTargetSessionClasses?.length > 0

  const { data: promotionHistoryRes, isLoading: historyLoading } = useQuery({
    queryKey: ['promotion-history', historyPair.source, historyPair.target, historyFilters],
    queryFn: () => sessionsApi.getPromotionHistory({
      source_academic_year: historyPair.source,
      target_academic_year: historyPair.target,
      ...(historyFilters.event_type ? { event_type: historyFilters.event_type } : {}),
      ...(historyFilters.source_class ? { source_class: historyFilters.source_class } : {}),
      ...(historyFilters.target_class ? { target_class: historyFilters.target_class } : {}),
      ...(historyFilters.student_search ? { student_search: historyFilters.student_search } : {}),
      page_size: 200,
    }),
    enabled: step === 4 && historyPairSelected,
    staleTime: 30_000,
  })

  const promotionHistory = promotionHistoryRes?.data?.results || promotionHistoryRes?.data || []
  const sourceClass = sourceClassOptions.find(c => String(c.id) === String(sourceClassId))
  const sourceUsesSessionClasses = sourceSessionClasses?.length > 0
  const targetUsesSessionClasses = targetSessionClasses?.length > 0
  const highestGradeLevel = sourceClassOptions.reduce((highest, classObj) => {
    if (typeof classObj.grade_level !== 'number') return highest
    return Math.max(highest, classObj.grade_level)
  }, Number.NEGATIVE_INFINITY)
  const isHighestSourceClass =
    sourceClass && typeof sourceClass.grade_level === 'number' && sourceClass.grade_level === highestGradeLevel

  const getTargetPlanUi = (status) => {
    const map = {
      exists_active: {
        label: 'Ready',
        badgeClass: 'bg-green-100 text-green-800 border-green-200',
        actionLabel: 'Continue',
      },
      exists_inactive: {
        label: 'Needs Reactivation',
        badgeClass: 'bg-amber-100 text-amber-800 border-amber-200',
        actionLabel: 'Reactivate & Continue',
      },
      missing: {
        label: 'Needs Creation',
        badgeClass: 'bg-blue-100 text-blue-800 border-blue-200',
        actionLabel: 'Create & Continue',
      },
      ambiguous: {
        label: 'Manual Setup Required',
        badgeClass: 'bg-red-100 text-red-800 border-red-200',
        actionLabel: 'Manual Setup Needed',
      },
    }
    return map[status] || {
      label: 'Unknown',
      badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
      actionLabel: 'Continue',
    }
  }

  const getDefaultPromoteTargetClassId = () => {
    if (!sourceClass || isHighestSourceClass || typeof sourceClass.grade_level !== 'number') {
      return ''
    }

    const nextGradeClasses = targetClassOptions.filter(classObj => (
      typeof classObj.grade_level === 'number' && classObj.grade_level === sourceClass.grade_level + 1
    ))

    if (nextGradeClasses.length === 0) return ''

    const sourceSection = String(sourceClass.section || '').trim().toLowerCase()
    if (sourceSection) {
      const sameSectionClass = nextGradeClasses.find(
        classObj => classObj.is_active && String(classObj.section || '').trim().toLowerCase() === sourceSection,
      )
      if (sameSectionClass) return String(sameSectionClass.id)

      return ''
    }

    if (nextGradeClasses.length === 1 && nextGradeClasses[0].is_active) {
      return String(nextGradeClasses[0].id)
    }

    return ''
  }

  const buildInitialPromotions = (defaultTargetClassId) => {
    const defaultAction = isHighestSourceClass ? 'GRADUATE' : 'PROMOTE'
    setPromotions(enrollments.slice().sort(rollSort).map(e => ({
      student_id: e.student,
      student_name: e.student_name,
      current_class: e.class_name,
      current_roll: e.roll_number,
      target_class_id: defaultAction === 'PROMOTE' ? (defaultTargetClassId || '') : '',
      new_roll_number: e.roll_number,
      include: true,
      action: defaultAction,
    })))
    setStep(3)
  }

  const handleApplyTargetSetup = async () => {
    if (!targetSetupPreview || !sourceYearId || !targetYearId || !sourceClassId) return
    const statusValue = targetSetupPreview?.target_plan?.status
    if (statusValue === 'ambiguous') {
      showWarning('Target class mapping is ambiguous. Please create or pick the target class manually, then continue.')
      return
    }

    setIsTargetSetupLoading(true)
    try {
      const applyRes = await sessionsApi.applyPromotionTargets({
        source_academic_year: parseInt(sourceYearId),
        target_academic_year: parseInt(targetYearId),
        ...(sourceUsesSessionClasses
          ? { source_session_class: parseInt(sourceClassId) }
          : { source_class: parseInt(sourceClassId) }),
        create_if_missing: true,
        reactivate_if_inactive: true,
      })

      const targetClassId = applyRes?.data?.target_class?.id
      if (!targetClassId) {
        showError('Target class setup did not return a valid target class.')
        return
      }

      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setShowTargetSetupModal(false)
      setTargetSetupPreview(null)
      showSuccess(`Target class ready: ${applyRes.data.target_class.label}`)
      buildInitialPromotions(String(targetClassId))
    } catch (error) {
      showError(error?.response?.data?.detail || 'Failed to apply target class setup.')
    } finally {
      setIsTargetSetupLoading(false)
    }
  }

  const handleUseSelectedTargetCandidate = () => {
    const candidates = targetSetupPreview?.target_plan?.candidates || []
    const selectedCandidate = candidates.find(c => String(c.id) === String(selectedTargetCandidateId))

    if (!selectedCandidate) {
      showWarning('Please select a target class to continue.')
      return
    }

    if (!selectedCandidate.is_active) {
      showWarning('Selected target class is inactive. Please activate it first.')
      return
    }

    setShowTargetSetupModal(false)
    setTargetSetupPreview(null)
    setSelectedTargetCandidateId('')
    showSuccess(`Using target class: ${selectedCandidate.label}`)
    buildInitialPromotions(String(selectedCandidate.id))
  }

  const handleInitializeTargetSessionClasses = async () => {
    if (!targetYearId) {
      showWarning('Please select a target year first.')
      return
    }

    setIsInitializingSessionClasses(true)
    try {
      const res = await sessionsApi.initializeSessionClasses({
        academic_year: parseInt(targetYearId),
        source_academic_year: sourceYearId ? parseInt(sourceYearId) : null,
      })
      queryClient.invalidateQueries({ queryKey: ['session-classes'] })
      showSuccess(res?.data?.message || 'Session classes initialized for target year.')
    } catch (error) {
      showError(error?.response?.data?.detail || 'Failed to initialize target session classes.')
    } finally {
      setIsInitializingSessionClasses(false)
    }
  }

  // Natural sort comparator for roll numbers (handles "1", "2", "10" correctly)
  const rollSort = (a, b) => {
    const ra = a.roll_number ?? a.current_roll ?? ''
    const rb = b.roll_number ?? b.current_roll ?? ''
    return String(ra).localeCompare(String(rb), undefined, { numeric: true, sensitivity: 'base' })
  }

  // Bulk promote (background task)
  const promoteMut = useBackgroundTask({
    mutationFn: (data) => sessionsApi.bulkPromote(data),
    taskType: 'BULK_PROMOTION',
    title: `Promoting students`,
    onSuccess: (resultData) => {
      if (resultData) setResult(resultData)
    },
  })

  const reverseMut = useBackgroundTask({
    mutationFn: (data) => sessionsApi.bulkReversePromote(data),
    taskType: 'BULK_PROMOTION',
    title: 'Reversing mistaken promotion',
    onSuccess: (resultData) => {
      const reverted = resultData?.reverted || 0
      const failed = resultData?.errors?.length || 0
      const skipped = resultData?.skipped?.length || 0
      showSuccess(`Reverse complete: ${reverted} reverted, ${skipped} skipped, ${failed} failed.`)
      queryClient.invalidateQueries({ queryKey: ['enrollmentsByClass'] })
    },
  })

  const singleCorrectionMut = useBackgroundTask({
    mutationFn: (data) => sessionsApi.correctPromotionSingle(data),
    taskType: 'BULK_PROMOTION',
    title: 'Correcting promotion',
    onSuccess: () => {
      showSuccess('Correction applied successfully.')
      setSingleCorrectionModal(null)
      queryClient.invalidateQueries({ queryKey: ['promotion-history'] })
      queryClient.invalidateQueries({ queryKey: ['enrollmentsByClass'] })
    },
  })

  const bulkCorrectionMut = useBackgroundTask({
    mutationFn: (data) => sessionsApi.correctPromotionBulk(data),
    taskType: 'BULK_PROMOTION',
    title: 'Applying bulk promotion corrections',
    onSuccess: () => {
      showSuccess('Bulk corrections applied successfully.')
      setSelectedHistoryIds([])
      queryClient.invalidateQueries({ queryKey: ['promotion-history'] })
      queryClient.invalidateQueries({ queryKey: ['enrollmentsByClass'] })
    },
  })

  const getStudentIdsFromErrors = (errors) => {
    if (!Array.isArray(errors)) return []
    const ids = errors
      .map(err => Number(err?.student_id))
      .filter(id => Number.isInteger(id) && id > 0)
    return [...new Set(ids)]
  }

  const handleReverseStudents = (studentIds) => {
    if (!sourceYearId || !targetYearId) {
      showError('Source and target academic year are required for reverse action.')
      return
    }
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      showWarning('No eligible students found for reverse action.')
      return
    }

    const shouldProceed = window.confirm(
      `Reverse promotion for ${studentIds.length} student(s)?\n\nThis will remove their target-year enrollment and restore source-year active status.`
    )
    if (!shouldProceed) return

    reverseMut.trigger({
      source_academic_year: parseInt(sourceYearId),
      target_academic_year: parseInt(targetYearId),
      student_ids: studentIds,
    })
  }

  const getIncludedStudentIds = () => {
    const ids = promotions
      .filter(p => p.include)
      .map(p => Number(p.student_id))
      .filter(id => Number.isInteger(id) && id > 0)
    return [...new Set(ids)]
  }

  const toggleHistorySelection = (eventId) => {
    setSelectedHistoryIds(prev => (
      prev.includes(eventId)
        ? prev.filter(id => id !== eventId)
        : [...prev, eventId]
    ))
  }

  const selectedHistoryRows = promotionHistory.filter(row => selectedHistoryIds.includes(row.id))

  const openSingleCorrection = (row) => {
    setSingleCorrectionModal(row)
    setSingleCorrectionForm({
      action: row.event_type === 'GRADUATED' ? 'GRADUATE' : (row.event_type === 'REPEATED' ? 'REPEAT' : 'PROMOTE'),
      target_class_id: String(
        historyTargetUsesSessionClasses
          ? (row.target_session_class || '')
          : (row.target_class || '')
      ),
      new_roll_number: row.new_roll_number || row.student_roll_number || '',
      reason: '',
    })
  }

  const submitSingleCorrection = () => {
    if (!singleCorrectionModal) return
    if (!singleCorrectionForm.reason?.trim()) {
      showWarning('Reason is required for correction.')
      return
    }

    const parsedTargetClassId = singleCorrectionForm.target_class_id
      ? parseInt(singleCorrectionForm.target_class_id)
      : null

    singleCorrectionMut.trigger({
      source_academic_year: singleCorrectionModal.source_academic_year || parseInt(sourceYearId),
      target_academic_year: singleCorrectionModal.target_academic_year || parseInt(targetYearId),
      student_id: singleCorrectionModal.student,
      action: singleCorrectionForm.action,
      target_class_id: (
        singleCorrectionForm.action === 'GRADUATE' || historyTargetUsesSessionClasses
      ) ? null : parsedTargetClassId,
      target_session_class_id: (
        singleCorrectionForm.action === 'GRADUATE' || !historyTargetUsesSessionClasses
      ) ? null : parsedTargetClassId,
      new_roll_number: singleCorrectionForm.new_roll_number,
      reason: singleCorrectionForm.reason,
    })
  }

  const submitBulkCorrection = () => {
    if (!selectedHistoryRows.length) {
      showWarning('Select at least one history row for bulk correction.')
      return
    }
    if (!bulkCorrectionReason.trim()) {
      showWarning('Reason is required for bulk correction.')
      return
    }
    if (bulkCorrectionAction !== 'GRADUATE' && !bulkCorrectionTargetClassId) {
      showWarning('Target class is required for Promote/Repeat bulk correction.')
      return
    }

    const firstSource = selectedHistoryRows[0]?.source_academic_year
    const firstTarget = selectedHistoryRows[0]?.target_academic_year
    const mixedPair = selectedHistoryRows.some(
      row => row.source_academic_year !== firstSource || row.target_academic_year !== firstTarget
    )
    if (mixedPair) {
      showWarning('All selected rows must belong to the same promotion pair. Use the pair filter to narrow down before applying bulk correction.')
      return
    }

    const sourceAcademicYear = firstSource || parseInt(sourceYearId)
    const targetAcademicYear = firstTarget || parseInt(targetYearId)

    const parsedBulkTargetClassId = bulkCorrectionTargetClassId
      ? parseInt(bulkCorrectionTargetClassId)
      : null

    bulkCorrectionMut.trigger({
      source_academic_year: sourceAcademicYear,
      target_academic_year: targetAcademicYear,
      corrections: selectedHistoryRows.map(row => ({
        student_id: row.student,
        action: bulkCorrectionAction,
        target_class_id: (
          bulkCorrectionAction === 'GRADUATE' || historyTargetUsesSessionClasses
        ) ? null : parsedBulkTargetClassId,
        target_session_class_id: (
          bulkCorrectionAction === 'GRADUATE' || !historyTargetUsesSessionClasses
        ) ? null : parsedBulkTargetClassId,
        new_roll_number: row.new_roll_number || row.student_roll_number || '',
        reason: bulkCorrectionReason,
      })),
    })
  }

  // Initialize promotions when enrollments load
  const initializePromotions = async () => {
    if (enrollments.length > 0) {
      const defaultAction = isHighestSourceClass ? 'GRADUATE' : 'PROMOTE'
      let defaultTargetClassId = defaultAction === 'PROMOTE' ? getDefaultPromoteTargetClassId() : ''

      if (defaultAction === 'PROMOTE' && !defaultTargetClassId && sourceYearId && targetYearId && sourceClassId) {
        setIsTargetSetupLoading(true)
        try {
          const previewRes = await sessionsApi.previewPromotionTargets({
            source_academic_year: parseInt(sourceYearId),
            target_academic_year: parseInt(targetYearId),
            ...(sourceUsesSessionClasses
              ? { source_session_class: parseInt(sourceClassId) }
              : { source_class: parseInt(sourceClassId) }),
          })

          const targetPlan = previewRes?.data?.target_plan
          const statusValue = targetPlan?.status
          const existingClassId = targetPlan?.existing_class?.id

          if (statusValue === 'exists_active' && existingClassId) {
            defaultTargetClassId = String(existingClassId)
          } else if (statusValue === 'exists_inactive' || statusValue === 'missing' || statusValue === 'ambiguous') {
            if (statusValue === 'ambiguous') {
              const firstActiveCandidate = previewRes?.data?.target_plan?.candidates?.find(c => c.is_active)
              setSelectedTargetCandidateId(firstActiveCandidate ? String(firstActiveCandidate.id) : '')
            } else {
              setSelectedTargetCandidateId('')
            }
            setTargetSetupPreview(previewRes.data)
            setShowTargetSetupModal(true)
            return
          } else {
            showWarning(targetPlan?.reason || 'Target class mapping is ambiguous. Please configure target classes manually.')
            return
          }
        } catch (error) {
          const statusCode = error?.response?.status
          if (statusCode === 404 || statusCode === 405) {
            showWarning('Target setup service is not available on this server yet. Continue with manual target class selection in review step.')
          } else {
            showError(error?.response?.data?.detail || 'Failed to preview target class setup for promotion.')
            return
          }
        } finally {
          setIsTargetSetupLoading(false)
        }
      }

      buildInitialPromotions(defaultTargetClassId)
    }
  }

  const handlePromote = () => {
    const included = promotions.filter(p => p.include && (p.target_class_id || p.action === 'GRADUATE'))
    if (included.length === 0) {
      alert('Please select target classes for at least one student or mark as Graduate.')
      return
    }

    const duplicateRollConflicts = []
    const seenByTargetClassAndRoll = new Map()

    for (const promo of included) {
      if (promo.action === 'GRADUATE') continue

      const targetClassId = String(promo.target_class_id || '').trim()
      const roll = String(promo.new_roll_number || '').trim()
      if (!targetClassId || !roll) {
        alert('Each promoted/repeat student must have a target class and roll number.')
        return
      }

      const key = `${targetClassId}::${roll}`
      if (seenByTargetClassAndRoll.has(key)) {
        const firstStudent = seenByTargetClassAndRoll.get(key)
        duplicateRollConflicts.push(`${firstStudent} and ${promo.student_name} (roll ${roll})`)
      } else {
        seenByTargetClassAndRoll.set(key, promo.student_name)
      }
    }

    if (duplicateRollConflicts.length > 0) {
      const preview = duplicateRollConflicts.slice(0, 5).join('\n')
      alert(`Duplicate roll numbers detected in the same target class:\n${preview}${duplicateRollConflicts.length > 5 ? '\n...' : ''}\n\nPlease fix before promoting.`)
      return
    }

    promoteMut.trigger({
      source_academic_year: parseInt(sourceYearId),
      target_academic_year: parseInt(targetYearId),
      promotions: included.map(p => ({
        student_id: p.student_id,
        ...(targetUsesSessionClasses
          ? { target_session_class_id: p.target_class_id ? parseInt(p.target_class_id) : null }
          : { target_class_id: p.target_class_id ? parseInt(p.target_class_id) : null }),
        new_roll_number: p.new_roll_number,
        action: p.action || 'PROMOTE',
      })),
    })
  }

  const updatePromotion = (idx, field, value) => {
    setPromotions(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p))
  }

  const updatePromotionAction = (idx, action) => {
    setPromotions(prev => prev.map((promotion, promotionIdx) => {
      if (promotionIdx !== idx) return promotion

      if (action === 'GRADUATE') {
        return { ...promotion, action, target_class_id: '' }
      }

      if (action === 'REPEAT') {
        return {
          ...promotion,
          action,
          target_class_id: (
            targetUsesSessionClasses
              ? sourceClassId
              : (sourceUsesSessionClasses ? String(sourceClass?.class_obj || '') : sourceClassId)
          ) || promotion.target_class_id,
        }
      }

      return { ...promotion, action }
    }))
  }

  const setAllTargetClass = (classId) => {
    setPromotions(prev => prev.map(p => (
      p.action === 'PROMOTE' ? { ...p, target_class_id: classId } : p
    )))
  }

  // AI Advisor helpers
  const handleFetchAdvisor = () => {
    if (sourceYearId && sourceClassId) {
      const advisorClassId = sourceUsesSessionClasses ? sourceClass?.class_obj : sourceClassId
      if (sourceUsesSessionClasses && !advisorClassId) {
        showWarning('Selected source session class is not linked to a master class, so the advisor cannot run yet.')
        return
      }

      setShowAdvisor(true)
      setAdvisorOverrides({})
      advisorTask.trigger({ academic_year: sourceYearId, class_id: advisorClassId })
    }
  }

  const overrideRecommendation = (studentId, newRec) => {
    setAdvisorOverrides(prev => ({ ...prev, [studentId]: newRec }))
  }

  const getEffectiveRec = (r) => advisorOverrides[r.student_id] || r.recommendation

  const acceptAllRecommendations = (targetClassId) => {
    if (!targetClassId) {
      alert('Please select a target class first using "Set all target class" before accepting recommendations.')
      return
    }
    // Build promotions from advisor data, sorted by roll number
    const newPromotions = recommendations.map(r => {
      const effectiveRec = getEffectiveRec(r)
      return {
        student_id: r.student_id,
        student_name: r.student_name,
        current_class: r.class_name,
        current_roll: r.roll_number,
        target_class_id: effectiveRec === 'PROMOTE'
          ? targetClassId
          : (effectiveRec === 'REPEAT'
            ? (targetUsesSessionClasses ? sourceClassId : String(sourceClass?.class_obj || sourceClassId || ''))
            : ''),
        new_roll_number: r.roll_number,
        include: effectiveRec === 'PROMOTE' || effectiveRec === 'GRADUATE' || effectiveRec === 'REPEAT',
        action: effectiveRec,
      }
    }).sort(rollSort)
    setPromotions(newPromotions)
    setShowAdvisor(false)
    setStep(3)
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Student Promotion</h1>
          <p className="text-sm text-gray-600">Promote students from one academic year to the next</p>
        </div>
        <button
          type="button"
          onClick={() => setStep(4)}
          className="self-start px-4 py-2 text-sm rounded-lg border border-primary-300 text-primary-700 bg-primary-50 hover:bg-primary-100"
        >
          History & Corrections
        </button>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3, 4].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
              step >= s ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-500'
            }`}>{s}</div>
            <span className={`text-sm hidden sm:inline ${step >= s ? 'text-primary-700 font-medium' : 'text-gray-400'}`}>
              {s === 1 ? 'Select Years' : s === 2 ? 'Select Class' : s === 3 ? 'Review & Promote' : 'What Was Done'}
            </span>
            {s < 4 && <div className="w-8 h-0.5 bg-gray-200"></div>}
          </div>
        ))}
      </div>

      {/* Step 1: Select Years */}
      {step === 1 && (
        <div className="card max-w-lg">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Academic Years</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source Year (promote from) *</label>
              <select value={sourceYearId} onChange={e => setSourceYearId(e.target.value)} className="input w-full">
                <option value="">Select source year...</option>
                {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Year (promote to) *</label>
              <select value={targetYearId} onChange={e => setTargetYearId(e.target.value)} className="input w-full">
                <option value="">Select target year...</option>
                {years.filter(y => y.id !== parseInt(sourceYearId)).map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setStep(2)}
                disabled={!sourceYearId || !targetYearId}
                className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
              >Next</button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Select Class */}
      {step === 2 && (
        <div className="card max-w-lg">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Select Source Class</h2>
          <p className="text-sm text-gray-500 mb-4">
            Promoting from <strong>{years.find(y => y.id === parseInt(sourceYearId))?.name}</strong> to <strong>{years.find(y => y.id === parseInt(targetYearId))?.name}</strong>
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
              <ClassSelector value={sourceClassId} onChange={e => setSourceClassId(e.target.value)} className="input w-full" classes={sourceClassOptions} />
              <p className="text-xs text-gray-500 mt-1">
                Source class list: {sourceSessionClasses?.length > 0 ? 'Session classes' : 'Master classes'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleInitializeTargetSessionClasses}
                  disabled={!targetYearId || isInitializingSessionClasses}
                  className="px-3 py-1.5 text-xs rounded-lg border border-blue-300 text-blue-700 bg-blue-50 hover:bg-blue-100 disabled:opacity-50"
                >{isInitializingSessionClasses ? 'Initializing...' : 'Initialize Target Session Classes'}</button>
                <span className="text-xs text-gray-500">
                  Target list: {targetSessionClasses?.length || 0} session classes
                </span>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleFetchAdvisor}
                  disabled={!sourceClassId || advisorLoading}
                  className="px-4 py-2 text-sm rounded-lg border border-purple-300 text-purple-700 bg-purple-50 hover:bg-purple-100 disabled:opacity-50 flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  {advisorLoading ? 'Analyzing...' : 'AI Advisor'}
                </button>
                <button
                  onClick={initializePromotions}
                  disabled={!sourceClassId || enrollmentsLoading || isTargetSetupLoading}
                  className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
                >{enrollmentsLoading || isTargetSetupLoading ? 'Loading...' : 'Next'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Target Setup Modal */}
      {showTargetSetupModal && targetSetupPreview && (
        (() => {
          const statusValue = targetSetupPreview?.target_plan?.status
          const ui = getTargetPlanUi(statusValue)
          const isAmbiguous = statusValue === 'ambiguous'
          const candidateCount = targetSetupPreview?.target_plan?.candidates?.length || 0

          return (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Prepare Target Class</h3>
                <p className="text-sm text-gray-600 mt-0.5">Review class mapping before generating the promotion list.</p>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border ${ui.badgeClass}`}>
                {ui.label}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4 text-sm">
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                <p className="text-xs text-gray-500 mb-0.5">Source class</p>
                <p className="font-medium text-gray-900">{targetSetupPreview?.source_class?.label}</p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                <p className="text-xs text-gray-500 mb-0.5">Target academic year</p>
                <p className="font-medium text-gray-900">{targetSetupPreview?.target_academic_year?.name}</p>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-3 mb-4 bg-gray-50 text-sm">
              <p className="text-gray-700 mb-1"><strong>Status code:</strong> {targetSetupPreview?.target_plan?.status}</p>
              <p className="text-gray-600">{targetSetupPreview?.target_plan?.reason}</p>
              {targetSetupPreview?.target_plan?.existing_class && (
                <p className="text-gray-700 mt-2">
                  Existing target: <strong>{targetSetupPreview.target_plan.existing_class.label}</strong>
                  {targetSetupPreview.target_plan.existing_class.is_active ? ' (active)' : ' (inactive)'}
                </p>
              )}
              {targetSetupPreview?.target_plan?.proposed_class && (
                <p className="text-gray-700 mt-2">
                  Will create: <strong>{targetSetupPreview.target_plan.proposed_class.label}</strong>
                </p>
              )}
              {isAmbiguous && candidateCount > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-gray-600 uppercase mb-1.5">Possible target classes</p>
                  <div className="max-h-36 overflow-auto rounded border border-gray-200 bg-white">
                    {targetSetupPreview.target_plan.candidates.map(candidate => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => setSelectedTargetCandidateId(String(candidate.id))}
                        className={`w-full px-2.5 py-2 text-sm border-b border-gray-100 last:border-b-0 flex items-center justify-between gap-2 text-left hover:bg-blue-50 ${String(candidate.id) === String(selectedTargetCandidateId) ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
                      >
                        <span className="text-gray-800 flex items-center gap-2">
                          <span className={`inline-block w-2 h-2 rounded-full ${String(candidate.id) === String(selectedTargetCandidateId) ? 'bg-blue-600' : 'bg-gray-300'}`} />
                          {candidate.label}
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${candidate.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                          {candidate.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowTargetSetupModal(false)
                  setTargetSetupPreview(null)
                  setSelectedTargetCandidateId('')
                }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                disabled={isTargetSetupLoading}
              >Cancel</button>
              {isAmbiguous ? (
                <button
                  onClick={handleUseSelectedTargetCandidate}
                  className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
                  disabled={isTargetSetupLoading || !selectedTargetCandidateId}
                >Use Selected Target</button>
              ) : (
                <button
                  onClick={handleApplyTargetSetup}
                  className="btn-primary px-5 py-2 text-sm disabled:opacity-50"
                  disabled={isTargetSetupLoading}
                >{isTargetSetupLoading ? 'Applying...' : ui.actionLabel}</button>
              )}
            </div>
            {isAmbiguous && (
              <p className="text-xs text-red-600 mt-2">
                Automatic setup is blocked because multiple valid targets exist. Select the correct class above to continue.
              </p>
            )}
          </div>
        </div>
          )
        })()
      )}

      {/* AI Advisor Panel */}
      {showAdvisor && step === 2 && (
        <div className="mt-4">
          <div className="card">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  AI Promotion Advisor
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">Recommendations based on attendance, exams, fees & trends</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAdvisor(false)}
                  className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg"
                >Close</button>
              </div>
            </div>

            {advisorLoading && (
              <div className="text-center py-12 text-gray-500">
                <div className="inline-block w-6 h-6 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin mb-3"></div>
                <p className="text-sm">Analyzing student data...</p>
              </div>
            )}

            {!advisorLoading && advisorData && (
              <>
                {/* Summary Cards */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-green-700">{advisorData.summary?.promote || 0}</div>
                    <div className="text-xs text-green-600">Promote</div>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-700">{advisorData.summary?.needs_review || 0}</div>
                    <div className="text-xs text-amber-600">Needs Review</div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-red-700">{advisorData.summary?.retain || 0}</div>
                    <div className="text-xs text-red-600">Retain</div>
                  </div>
                </div>

                {recommendations.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-6">No student data found for this class and academic year.</p>
                ) : (
                  <>
                    {/* Desktop Advisor Table */}
                    <div className="hidden lg:block overflow-x-auto mb-4">
                      <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200 text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                            <th className="px-3 py-2 text-left">Student</th>
                            <th className="px-3 py-2 text-left">Roll #</th>
                            <th className="px-3 py-2 text-center">Recommendation</th>
                            <th className="px-3 py-2 text-center">Confidence</th>
                            <th className="px-3 py-2 text-center">Attendance</th>
                            <th className="px-3 py-2 text-center">Avg Score</th>
                            <th className="px-3 py-2 text-center">Fees Paid</th>
                            <th className="px-3 py-2 text-center">Trend</th>
                            <th className="px-3 py-2 text-left">Risk Flags</th>
                            <th className="px-3 py-2 text-center">Override</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {recommendations.map(r => {
                            const effectiveRec = getEffectiveRec(r)
                            const isOverridden = advisorOverrides[r.student_id] !== undefined
                            return (
                              <tr key={r.student_id} className={`hover:bg-gray-50 ${isOverridden ? 'bg-blue-50/50' : ''}`}>
                                <td className="px-3 py-2 font-medium text-gray-900">{r.student_name}</td>
                                <td className="px-3 py-2 text-gray-600">{r.roll_number}</td>
                                <td className="px-3 py-2 text-center">
                                  <RecBadge rec={effectiveRec} />
                                  {isOverridden && <span className="block text-[10px] text-blue-500 mt-0.5">overridden</span>}
                                </td>
                                <td className="px-3 py-2 text-center"><ConfidenceBar value={r.confidence} /></td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-xs font-medium ${r.attendance_rate >= 75 ? 'text-green-600' : r.attendance_rate >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {r.attendance_rate}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-xs font-medium ${r.average_score >= 50 ? 'text-green-600' : r.average_score >= 35 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {r.average_score}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`text-xs font-medium ${r.fee_paid_rate >= 75 ? 'text-green-600' : r.fee_paid_rate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                                    {r.fee_paid_rate}%
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center"><TrendIndicator trend={r.trend} /></td>
                                <td className="px-3 py-2">
                                  <div className="flex flex-wrap gap-1">
                                    {r.risk_flags.length === 0 && <span className="text-xs text-green-500">None</span>}
                                    {r.risk_flags.map((flag, i) => (
                                      <span key={i} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                        flag.startsWith('Critical') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                      }`}>{flag}</span>
                                    ))}
                                  </div>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <select
                                    value={effectiveRec}
                                    onChange={e => overrideRecommendation(r.student_id, e.target.value)}
                                    className="input text-xs py-0.5 px-1 w-24"
                                  >
                                    <option value="PROMOTE">Promote</option>
                                    <option value="GRADUATE">Graduate</option>
                                    <option value="REPEAT">Repeat</option>
                                    <option value="NEEDS_REVIEW">Review</option>
                                  </select>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Mobile Advisor Cards */}
                    <div className="lg:hidden space-y-3 mb-4">
                      {recommendations.map(r => {
                        const effectiveRec = getEffectiveRec(r)
                        const isOverridden = advisorOverrides[r.student_id] !== undefined
                        return (
                          <div key={r.student_id} className={`card border ${isOverridden ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}>
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <p className="font-medium text-gray-900 text-sm">{r.student_name}</p>
                                <p className="text-xs text-gray-500">Roll: {r.roll_number} | {r.class_name}</p>
                              </div>
                              <RecBadge rec={effectiveRec} />
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-2">
                              <div className="flex justify-between"><span className="text-gray-500">Attendance:</span><span className={r.attendance_rate >= 75 ? 'text-green-600' : r.attendance_rate >= 60 ? 'text-amber-600' : 'text-red-600'}>{r.attendance_rate}%</span></div>
                              <div className="flex justify-between"><span className="text-gray-500">Avg Score:</span><span className={r.average_score >= 50 ? 'text-green-600' : r.average_score >= 35 ? 'text-amber-600' : 'text-red-600'}>{r.average_score}%</span></div>
                              <div className="flex justify-between"><span className="text-gray-500">Fees Paid:</span><span className={r.fee_paid_rate >= 75 ? 'text-green-600' : 'text-amber-600'}>{r.fee_paid_rate}%</span></div>
                              <div className="flex justify-between"><span className="text-gray-500">Trend:</span><TrendIndicator trend={r.trend} /></div>
                              <div className="flex justify-between"><span className="text-gray-500">Confidence:</span><span>{r.confidence}%</span></div>
                            </div>
                            <p className="text-xs text-gray-600 italic mb-2">{r.reasoning}</p>
                            {r.risk_flags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mb-2">
                                {r.risk_flags.map((flag, i) => (
                                  <span key={i} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    flag.startsWith('Critical') ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                                  }`}>{flag}</span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <label className="text-xs text-gray-500">Override:</label>
                              <select
                                value={effectiveRec}
                                onChange={e => overrideRecommendation(r.student_id, e.target.value)}
                                className="input text-xs py-0.5 px-1 flex-1"
                              >
                                <option value="PROMOTE">Promote</option>
                                <option value="GRADUATE">Graduate</option>
                                <option value="REPEAT">Repeat</option>
                                <option value="NEEDS_REVIEW">Review</option>
                              </select>
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Reasoning (desktop only, collapsible) */}
                    <details className="hidden lg:block mb-4">
                      <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700">Show detailed reasoning for all students</summary>
                      <div className="mt-2 space-y-1">
                        {recommendations.map(r => (
                          <div key={r.student_id} className="text-xs text-gray-600 flex gap-2">
                            <span className="font-medium text-gray-800 min-w-[120px]">{r.student_name}:</span>
                            <span className="italic">{r.reasoning}</span>
                          </div>
                        ))}
                      </div>
                    </details>

                    {/* Accept All Button */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-gray-200">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>Target class for promoted students:</span>
                        <select id="advisor-target-class" className="input text-sm py-1 w-40">
                          <option value="">Select class...</option>
                          {targetClassOptions.map(c => <option key={c.id} value={c.id}>{getClassOptionLabel(c)}</option>)}
                        </select>
                      </div>
                      <button
                        onClick={() => {
                          const sel = document.getElementById('advisor-target-class')
                          acceptAllRecommendations(sel?.value || '')
                        }}
                        className="btn-primary px-6 py-2 text-sm flex items-center justify-center gap-1.5"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                        Accept Recommendations & Proceed
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Review & Promote */}
      {step === 3 && !result && (
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Review Promotions</h2>
              <p className="text-xs text-gray-500">{promotions.filter(p => p.include).length} of {promotions.length} students selected</p>
              {isHighestSourceClass && (
                <p className="text-xs text-blue-600 mt-1">This is the highest configured class for the school, so students default to Graduate.</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Set all target class:</label>
              <select onChange={e => setAllTargetClass(e.target.value)} className="input text-sm py-1">
                <option value="">--</option>
                {targetClassOptions.map(c => <option key={c.id} value={c.id}>{getClassOptionLabel(c)}</option>)}
              </select>
            </div>
          </div>

          {promotions.length === 0 ? (
            <div className="card text-center py-8 text-gray-500">
              No students enrolled in this class for the selected academic year.
              <button onClick={() => setStep(2)} className="block mx-auto mt-3 text-primary-600 text-sm hover:underline">Go Back</button>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto mb-4">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-3 py-3 text-center">Include</th>
                      <th className="px-3 py-3 text-left">Student</th>
                      <th className="px-3 py-3 text-left">Current Class</th>
                      <th className="px-3 py-3 text-left">Action</th>
                      <th className="px-3 py-3 text-left">Target Class</th>
                      <th className="px-3 py-3 text-left">New Roll #</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {promotions.map((p, idx) => (
                      <tr key={idx} className={`${p.include ? 'hover:bg-gray-50' : 'bg-gray-50 opacity-60'}`}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={p.include}
                            onChange={e => updatePromotion(idx, 'include', e.target.checked)}
                            className="rounded border-gray-300"
                          />
                        </td>
                        <td className="px-3 py-2 text-sm font-medium text-gray-900">{p.student_name}</td>
                        <td className="px-3 py-2 text-sm text-gray-600">{p.current_class}</td>
                        <td className="px-3 py-2">
                          <select
                            value={p.action || 'PROMOTE'}
                            onChange={e => updatePromotionAction(idx, e.target.value)}
                            className="input text-sm py-1 w-32"
                            disabled={!p.include}
                          >
                            <option value="PROMOTE">Promote</option>
                            <option value="GRADUATE">Graduate</option>
                            <option value="REPEAT">Repeat</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={p.target_class_id}
                            onChange={e => updatePromotion(idx, 'target_class_id', e.target.value)}
                            className="input text-sm py-1 w-40"
                            disabled={!p.include || p.action === 'GRADUATE'}
                          >
                            <option value="">{p.action === 'GRADUATE' ? 'Not needed' : 'Select...'}</option>
                            {targetClassOptions.map(c => <option key={c.id} value={c.id}>{getClassOptionLabel(c)}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          {p.action === 'GRADUATE' ? (
                            <input
                              type="text"
                              value="Not needed"
                              className="input text-sm py-1 w-24"
                              disabled
                            />
                          ) : (
                            <input
                              type="text"
                              value={p.new_roll_number}
                              onChange={e => updatePromotion(idx, 'new_roll_number', e.target.value)}
                              className="input text-sm py-1 w-24"
                              disabled={!p.include}
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3 mb-4">
                {promotions.map((p, idx) => (
                  <div key={idx} className={`card ${!p.include ? 'opacity-60' : ''}`}>
                    <div className="flex items-center gap-3 mb-2">
                      <input
                        type="checkbox"
                        checked={p.include}
                        onChange={e => updatePromotion(idx, 'include', e.target.checked)}
                        className="rounded border-gray-300"
                      />
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{p.student_name}</p>
                        <p className="text-xs text-gray-500">Current: {p.current_class}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-500">Action</label>
                        <select
                          value={p.action || 'PROMOTE'}
                          onChange={e => updatePromotionAction(idx, e.target.value)}
                          className="input text-sm py-1 w-full"
                          disabled={!p.include}
                        >
                          <option value="PROMOTE">Promote</option>
                          <option value="GRADUATE">Graduate</option>
                          <option value="REPEAT">Repeat</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Target Class</label>
                        <select
                          value={p.target_class_id}
                          onChange={e => updatePromotion(idx, 'target_class_id', e.target.value)}
                          className="input text-sm py-1 w-full"
                          disabled={!p.include || p.action === 'GRADUATE'}
                        >
                          <option value="">{p.action === 'GRADUATE' ? 'Not needed' : 'Select...'}</option>
                          {targetClassOptions.map(c => <option key={c.id} value={c.id}>{getClassOptionLabel(c)}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500">Roll #</label>
                        {p.action === 'GRADUATE' ? (
                          <input
                            type="text"
                            value="Not needed"
                            className="input text-sm py-1 w-full"
                            disabled
                          />
                        ) : (
                          <input
                            type="text"
                            value={p.new_roll_number}
                            onChange={e => updatePromotion(idx, 'new_roll_number', e.target.value)}
                            className="input text-sm py-1 w-full"
                            disabled={!p.include}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleReverseStudents(getIncludedStudentIds())}
                    disabled={reverseMut.isSubmitting || promoteMut.isSubmitting || getIncludedStudentIds().length === 0}
                    className="px-4 py-2 text-sm rounded-lg border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 disabled:opacity-50"
                  >{reverseMut.isSubmitting ? 'Reversing...' : 'Reverse Selected'}</button>
                  <button
                    onClick={handlePromote}
                    disabled={promoteMut.isSubmitting || reverseMut.isSubmitting}
                    className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
                  >{promoteMut.isSubmitting ? 'Starting...' : 'Promote Students'}</button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: Promotion History */}
      {step === 4 && (
        <div className="card">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Promotion History</h2>
              <p className="text-sm text-gray-600">Explore what happened, then correct individual or multiple rows if needed.</p>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600 whitespace-nowrap">Promotion Pair</label>
              <select
                value={historyPair.source && historyPair.target ? `${historyPair.source}__${historyPair.target}` : ''}
                onChange={e => {
                  const val = e.target.value
                  if (!val) {
                    setHistoryPair({ source: '', target: '' })
                    setSelectedHistoryIds([])
                    setHistoryFilters({ event_type: '', source_class: '', target_class: '', student_search: '' })
                    return
                  }
                  const [src, tgt] = val.split('__')
                  setHistoryPair({ source: src, target: tgt })
                  setSelectedHistoryIds([])
                  setHistoryFilters({ event_type: '', source_class: '', target_class: '', student_search: '' })
                }}
                className="input text-sm py-1 min-w-72"
              >
                <option value="">Select a promotion pair...</option>
                {historyPairsLoading && <option disabled>Loading pairs...</option>}
                {historyPairs.length === 0 && !historyPairsLoading && <option disabled>No promotions found</option>}
                {historyPairs.map(p => (
                  <option key={`${p.source_academic_year}__${p.target_academic_year}`} value={`${p.source_academic_year}__${p.target_academic_year}`}>
                    {p.source_academic_year_name} → {p.target_academic_year_name} ({p.event_count} events)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter bar — visible only after pair is selected */}
          {historyPairSelected && (
            <div className="mb-4 flex flex-wrap items-center gap-2 p-3 rounded-lg border border-gray-200 bg-gray-50">
              <select
                value={historyFilters.event_type}
                onChange={e => { setHistoryFilters(f => ({ ...f, event_type: e.target.value })); setSelectedHistoryIds([]) }}
                className="input text-sm py-1"
              >
                <option value="">All statuses</option>
                <option value="PROMOTED">Promoted</option>
                <option value="REPEATED">Repeated</option>
                <option value="GRADUATED">Graduated</option>
                <option value="REVERSED">Reversed</option>
                <option value="SKIPPED">Skipped</option>
                <option value="FAILED">Failed</option>
              </select>
              <select
                value={historyFilters.source_class}
                onChange={e => { setHistoryFilters(f => ({ ...f, source_class: e.target.value })); setSelectedHistoryIds([]) }}
                className="input text-sm py-1"
              >
                <option value="">All from-classes</option>
                {masterClasses.map(c => <option key={c.id} value={c.id}>{getClassOptionLabel(c)}</option>)}
              </select>
              <select
                value={historyFilters.target_class}
                onChange={e => { setHistoryFilters(f => ({ ...f, target_class: e.target.value })); setSelectedHistoryIds([]) }}
                className="input text-sm py-1"
              >
                <option value="">All to-classes</option>
                {masterClasses.map(c => <option key={c.id} value={c.id}>{getClassOptionLabel(c)}</option>)}
              </select>
              <input
                type="text"
                value={historyFilters.student_search}
                onChange={e => { setHistoryFilters(f => ({ ...f, student_search: e.target.value })); setSelectedHistoryIds([]) }}
                placeholder="Search student..."
                className="input text-sm py-1 min-w-36"
              />
              {(historyFilters.event_type || historyFilters.source_class || historyFilters.target_class || historyFilters.student_search) && (
                <button
                  onClick={() => { setHistoryFilters({ event_type: '', source_class: '', target_class: '', student_search: '' }); setSelectedHistoryIds([]) }}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >Clear filters</button>
              )}
            </div>
          )}

          {/* Table */}
          {!historyPairSelected ? (
            <div className="py-14 text-center">
              <p className="text-sm text-gray-500">Select a promotion pair above to view history.</p>
              {historyPairs.length === 0 && !historyPairsLoading && (
                <p className="text-xs mt-1 text-gray-400">No promotions have been run for this school yet.</p>
              )}
            </div>
          ) : historyLoading ? (
            <p className="text-sm text-gray-500 py-4">Loading history...</p>
          ) : promotionHistory.length === 0 ? (
            <p className="text-sm text-gray-500 py-4">No records match the current filters.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200 text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={
                          selectedHistoryIds.length > 0 &&
                          selectedHistoryIds.length === promotionHistory.filter(r =>
                            ['PROMOTED', 'REPEATED', 'GRADUATED'].includes(r.event_type)
                          ).length
                        }
                        onChange={e => {
                          const ids = promotionHistory
                            .filter(r => ['PROMOTED', 'REPEATED', 'GRADUATED'].includes(r.event_type))
                            .map(r => r.id)
                          setSelectedHistoryIds(e.target.checked ? ids : [])
                        }}
                        className="rounded border-gray-300"
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Student</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">From Class</th>
                    <th className="px-3 py-2 text-left">To Class</th>
                    <th className="px-3 py-2 text-left">Roll</th>
                    <th className="px-3 py-2 text-left">When</th>
                    <th className="px-3 py-2 text-right">Correct</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {promotionHistory.map(row => {
                    const canCorrect = ['PROMOTED', 'REPEATED', 'GRADUATED'].includes(row.event_type)
                    const eventStyle = {
                      PROMOTED: 'bg-green-100 text-green-800',
                      REPEATED: 'bg-purple-100 text-purple-800',
                      GRADUATED: 'bg-blue-100 text-blue-800',
                      REVERSED: 'bg-amber-100 text-amber-800',
                      SKIPPED: 'bg-gray-100 text-gray-600',
                      FAILED: 'bg-red-100 text-red-800',
                    }[row.event_type] || 'bg-gray-100 text-gray-600'
                    return (
                      <tr key={row.id} className={`hover:bg-gray-50 ${selectedHistoryIds.includes(row.id) ? 'bg-primary-50/40' : ''}`}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={selectedHistoryIds.includes(row.id)}
                            onChange={() => toggleHistorySelection(row.id)}
                            disabled={!canCorrect}
                            className="rounded border-gray-300 disabled:opacity-40"
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-900 font-medium">{row.student_name || `Student ${row.student}`}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${eventStyle}`}>
                            {row.event_type}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{row.source_session_class_label || row.source_class_name || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{row.target_session_class_label || row.target_class_name || '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{row.old_roll_number || '—'} → {row.new_roll_number || '—'}</td>
                        <td className="px-3 py-2 text-gray-500 text-xs">{new Date(row.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            onClick={() => openSingleCorrection(row)}
                            disabled={!canCorrect || singleCorrectionMut.isSubmitting}
                            className="px-3 py-1 text-xs rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:opacity-40"
                          >Edit</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Bulk Correction Panel — shown only when rows are selected */}
          {selectedHistoryIds.length > 0 && (
            <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50">
              <p className="text-xs font-semibold text-amber-800 mb-2">{selectedHistoryIds.length} row(s) selected — Bulk Correction</p>
              <div className="flex flex-wrap items-center gap-2">
                <select value={bulkCorrectionAction} onChange={e => setBulkCorrectionAction(e.target.value)} className="input text-sm py-1">
                  <option value="PROMOTE">Set Promote</option>
                  <option value="REPEAT">Set Repeat</option>
                  <option value="GRADUATE">Set Graduate</option>
                </select>
                <select
                  value={bulkCorrectionTargetClassId}
                  onChange={e => setBulkCorrectionTargetClassId(e.target.value)}
                  className="input text-sm py-1"
                  disabled={bulkCorrectionAction === 'GRADUATE'}
                >
                  <option value="">Target class...</option>
                  {historyTargetClassOptions.map(c => <option key={c.id} value={c.id}>{getClassOptionLabel(c)}</option>)}
                </select>
                <input
                  type="text"
                  value={bulkCorrectionReason}
                  onChange={e => setBulkCorrectionReason(e.target.value)}
                  placeholder="Reason (required)"
                  className="input text-sm py-1 min-w-56"
                />
                <button
                  onClick={submitBulkCorrection}
                  disabled={bulkCorrectionMut.isSubmitting}
                  className="px-3 py-1.5 text-sm rounded-lg border border-amber-400 text-amber-900 bg-amber-100 hover:bg-amber-200 disabled:opacity-50"
                >{bulkCorrectionMut.isSubmitting ? 'Applying...' : 'Apply Bulk Correction'}</button>
                <button
                  onClick={() => setSelectedHistoryIds([])}
                  className="text-xs text-gray-500 hover:text-gray-700 underline"
                >Clear selection</button>
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-between">
            <button onClick={() => setStep(3)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Back</button>
            <button
              onClick={() => {
                setResult(null)
                setStep(1)
                setPromotions([])
                setSelectedHistoryIds([])
                setHistoryPair({ source: '', target: '' })
                setHistoryFilters({ event_type: '', source_class: '', target_class: '', student_search: '' })
              }}
              className="btn-primary px-6 py-2 text-sm"
            >Start New Promotion</button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && step !== 4 && (
        <div className="card max-w-lg">
          {result.error ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">
                <span className="text-red-600 text-xl">!</span>
              </div>
              <h3 className="text-lg font-semibold text-red-700 mb-2">Promotion Failed</h3>
              <p className="text-sm text-gray-600">{result.error}</p>
            </div>
          ) : (
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-green-700 mb-2">Promotion Complete</h3>
              <p className="text-sm text-gray-600 mb-4">{result.promoted_count || result.promoted || 0} student(s) promoted successfully.</p>
              {Array.isArray(result.skipped) && result.skipped.length > 0 && (
                <div className="text-left bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                  <p className="text-sm font-medium text-blue-800 mb-1">Some students were skipped:</p>
                  <ul className="text-xs text-blue-700 space-y-1">
                    {result.skipped.slice(0, 8).map((item, idx) => (
                      <li key={idx}>Student {item.student_id}: {item.reason}</li>
                    ))}
                    {result.skipped.length > 8 && <li>...and {result.skipped.length - 8} more</li>}
                  </ul>
                </div>
              )}
              {Array.isArray(result.errors) && result.errors.length > 0 && (
                <div className="text-left bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-amber-800 mb-1">Some students were not processed:</p>
                  <ul className="text-xs text-amber-700 space-y-1">
                    {result.errors.slice(0, 8).map((err, idx) => (
                      <li key={idx}>Student {err.student_id}: {err.error}</li>
                    ))}
                    {result.errors.length > 8 && <li>...and {result.errors.length - 8} more</li>}
                  </ul>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => handleReverseStudents(getStudentIdsFromErrors(result.errors))}
                      disabled={reverseMut.isSubmitting}
                      className="px-3 py-1.5 text-xs rounded-lg border border-amber-300 text-amber-800 bg-amber-100 hover:bg-amber-200 disabled:opacity-50"
                    >{reverseMut.isSubmitting ? 'Reversing...' : 'Reverse These Students'}</button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-center mt-4">
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (!historyPair.source && sourceYearId) {
                    setHistoryPair({ source: String(sourceYearId), target: String(targetYearId || '') })
                  }
                  setStep(4)
                }}
                className="px-4 py-2 text-sm rounded-lg border border-primary-300 text-primary-700 bg-primary-50 hover:bg-primary-100"
              >What Was Done</button>
              <button
                onClick={() => { setResult(null); setStep(1); setPromotions([]) }}
                className="btn-primary px-6 py-2 text-sm"
              >Start New Promotion</button>
            </div>
          </div>
        </div>
      )}

      {/* Single Correction Modal */}
      {singleCorrectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl border border-gray-200">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">Edit Promotion Result</h3>
              <p className="text-sm text-gray-600 mt-1">
                {singleCorrectionModal.student_name || `Student ${singleCorrectionModal.student}`}
              </p>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Action</label>
                  <select
                    value={singleCorrectionForm.action}
                    onChange={e => setSingleCorrectionForm(prev => ({ ...prev, action: e.target.value }))}
                    className="input w-full"
                  >
                    <option value="PROMOTE">Promote</option>
                    <option value="REPEAT">Repeat</option>
                    <option value="GRADUATE">Graduate</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Target Class</label>
                  <select
                    value={singleCorrectionForm.target_class_id}
                    onChange={e => setSingleCorrectionForm(prev => ({ ...prev, target_class_id: e.target.value }))}
                    className="input w-full"
                    disabled={singleCorrectionForm.action === 'GRADUATE'}
                  >
                    <option value="">Select target class...</option>
                    {historyTargetClassOptions.map(c => <option key={c.id} value={c.id}>{getClassOptionLabel(c)}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">New Roll Number (optional)</label>
                <input
                  type="text"
                  value={singleCorrectionForm.new_roll_number}
                  onChange={e => setSingleCorrectionForm(prev => ({ ...prev, new_roll_number: e.target.value }))}
                  className="input w-full"
                  placeholder="Enter roll number"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-600 mb-1">Reason</label>
                <textarea
                  value={singleCorrectionForm.reason}
                  onChange={e => setSingleCorrectionForm(prev => ({ ...prev, reason: e.target.value }))}
                  className="input w-full min-h-24"
                  placeholder="Why is this correction needed?"
                />
              </div>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => setSingleCorrectionModal(null)}
                className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >Cancel</button>
              <button
                onClick={submitSingleCorrection}
                disabled={singleCorrectionMut.isSubmitting}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >{singleCorrectionMut.isSubmitting ? 'Applying...' : 'Apply Correction'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
