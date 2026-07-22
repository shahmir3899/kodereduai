import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { lmsApi, hrApi, schoolsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import { useToast } from '../../components/Toast'
import TeacherScopeSummary from '../../components/teacher/TeacherScopeSummary'
import TeacherScopeBadge, { TeacherScopeHint, useTeacherScopeLookup } from '../../components/teacher/TeacherScopeBadge'
import BulkLessonPlansModal from './BulkLessonPlansModal'
import LessonPlanTopicsPickerModal from './LessonPlanTopicsPickerModal'
import { exportLessonPlansPDF } from './lessonPlansExportPdf'
import { normalizeLessonPlanText, deriveAutoTitleFromCurriculumSummary } from './lessonPlanTextUtils'

const STATUS_BADGES = {
  DRAFT: 'bg-gray-100 text-gray-800',
  PUBLISHED: 'bg-green-100 text-green-800',
}

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
  return text
    .split('\n')
    .map((line) => line.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)
    .map((statement) => makeObjectiveRow({ statement }))
}

function objectiveRowsToPlainText(rows) {
  return rows
    .map((row) => String(row.statement || '').trim())
    .filter(Boolean)
    .map((line) => `- ${line}`)
    .join('\n')
}

const EMPTY_FORM = {
  mode: 'MINIMAL',
  title: '',
  description: '',
  objectives: '',
  objective_rows: [makeObjectiveRow()],
  class_obj: '',
  subject: '',
  teacher: '',
  lesson_date: '',
  duration_minutes: 45,
  materials_needed: '',
  teaching_methods: '',
  status: 'DRAFT',
  chapterIds: [],
  topicIds: [],
  subtopicIds: [],
  curriculumSummary: '',
  custom_topics: [],
}

export default function LessonPlansPage() {
  const { user, isSchoolAdmin, isTeacher } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const [search, setSearch] = useState('')
  const [exportDateFrom, setExportDateFrom] = useState('')
  const [exportDateTo, setExportDateTo] = useState('')
  const [filterClass, setFilterClass] = useState('')
  const [filterSubject, setFilterSubject] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [topicPickerOpen, setTopicPickerOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [customTopicInput, setCustomTopicInput] = useState('')
  const isMinimal = form.mode === 'MINIMAL' && !editingPlan
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedFilterClass = getResolvedMasterClassId(filterClass, activeAcademicYear?.id, sessionClasses)
  const resolvedFormClassObj = getResolvedMasterClassId(form.class_obj, activeAcademicYear?.id, sessionClasses)
  const { subjects: filterClassSubjects, isLoading: filterSubjectsLoading } = useClassSubjects(resolvedFilterClass)
  const { subjects: formClassSubjects, assignments: formClassAssignments, isLoading: formSubjectsLoading } = useClassSubjects(resolvedFormClassObj)

  // Minimal mode has no visible Teacher field — auto-assign from the class-subject's assigned teacher.
  useEffect(() => {
    if (!isMinimal || !form.subject || formClassAssignments.length === 0) return
    const sid = String(form.subject)
    const match = formClassAssignments.find(
      (cs) => String(cs.subject) === sid && cs.is_active !== false && cs.teacher != null && cs.teacher !== '',
    )
    if (match && String(form.teacher) !== String(match.teacher)) {
      setForm((prev) => ({ ...prev, teacher: String(match.teacher) }))
    }
  }, [isMinimal, form.subject, form.teacher, formClassAssignments])
  const sessionClassIdByMaster = useMemo(() => {
    const map = {}
    sessionClasses.forEach((sc) => {
      if (sc.class_obj) map[String(sc.class_obj)] = String(sc.id)
    })
    return map
  }, [sessionClasses])
  const { classifyScope, isTeacherEnabled } = useTeacherScopeLookup({ academicYearId: activeAcademicYear?.id })

  const modalTopicIds = useMemo(
    () => (editingPlan?.planned_topics || []).map((topic) => topic.id),
    [editingPlan],
  )

  const modalTopicObjectivesQueries = useQueries({
    queries: modalTopicIds.map((topicId) => ({
      queryKey: ['lesson-plan-modal-topic-objectives', topicId],
      queryFn: () => lmsApi.getTopicObjectives(topicId),
      enabled: showModal && !!topicId,
    })),
  })

  const modalObjectivesLoading = modalTopicObjectivesQueries.some((query) => query.isLoading)
  const modalObjectivesError = modalTopicObjectivesQueries.find((query) => query.isError)?.error
  const modalAvailableObjectives = useMemo(() => {
    const seen = new Set()
    const rows = []
    modalTopicObjectivesQueries.forEach((query) => {
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
  }, [modalTopicObjectivesQueries])

  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass: filterClass,
    setSelectedClass: setFilterClass,
    autoSelectFirst: true,
    queryKey: 'teacherLessonPlanClasses',
    fetchClasses: () => lmsApi.getMyLessonPlanClasses(),
  })

  // -- Data fetching --

  const { data: schoolRes } = useQuery({
    queryKey: ['currentSchool'],
    queryFn: () => schoolsApi.getMySchool(),
  })

  const { data: staffData } = useQuery({
    queryKey: ['hrStaff'],
    queryFn: () => hrApi.getStaff({ status: 'ACTIVE', page_size: 9999 }),
  })

  const hasValidDateRange = Boolean(exportDateFrom && exportDateTo && exportDateFrom <= exportDateTo)

  const { data: plansData, isLoading } = useQuery({
    queryKey: ['lessonPlans', resolvedFilterClass, filterSubject, activeAcademicYear?.id],
    queryFn: () =>
      lmsApi.getLessonPlans({
        ...(resolvedFilterClass && { class_id: resolvedFilterClass }),
        ...(filterSubject && { subject_id: filterSubject }),
        ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
        page_size: 9999,
      }),
    // Lesson plans are only fetched once a class AND a valid lesson-date range are applied.
    enabled: !!resolvedFilterClass && hasValidDateRange,
  })

  const staff = staffData?.data?.results || staffData?.data || []
  const allPlans = plansData?.data?.results || plansData?.data || []

  // Client-side search
  const searchedPlans = useMemo(() => {
    if (!search) return allPlans
    const q = search.toLowerCase()
    return allPlans.filter(
      (p) =>
        p.title?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    )
  }, [allPlans, search])

  // Restrict to the applied lesson-date range (the same range gates fetching above).
  const plans = useMemo(() => {
    if (!hasValidDateRange) return []
    return searchedPlans.filter(
      (p) => p.lesson_date && p.lesson_date >= exportDateFrom && p.lesson_date <= exportDateTo,
    )
  }, [searchedPlans, hasValidDateRange, exportDateFrom, exportDateTo])

  const exportPlans = useMemo(
    () => plans.slice().sort((a, b) => String(a.lesson_date).localeCompare(String(b.lesson_date))),
    [plans],
  )

  const canDownloadExport = hasValidDateRange && exportPlans.length > 0

  // Only the currently visible/filtered plans are selectable/actionable in bulk.
  const selectedVisibleIds = useMemo(
    () => plans.filter((p) => selectedIds.has(p.id)).map((p) => p.id),
    [plans, selectedIds],
  )
  const selectedDraftIds = useMemo(
    () => plans.filter((p) => selectedIds.has(p.id) && p.status === 'DRAFT').map((p) => p.id),
    [plans, selectedIds],
  )
  const allVisibleSelected = plans.length > 0 && plans.every((p) => selectedIds.has(p.id))
  const someVisibleSelected = plans.some((p) => selectedIds.has(p.id))

  const toggleSelectPlan = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        plans.forEach((p) => next.delete(p.id))
      } else {
        plans.forEach((p) => next.add(p.id))
      }
      return next
    })
  }

  // -- Mutations --

  const createMutation = useMutation({
    mutationFn: async ({ data, objectiveIds }) => {
      const response = await lmsApi.createLessonPlan(data)
      if (objectiveIds.length > 0 && response?.data?.id) {
        await lmsApi.linkLessonPlanObjectives(response.data.id, objectiveIds)
      }
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      closeModal()
      showSuccess('Lesson plan created successfully!')
    },
    onError: (error) => {
      showError(
        error.response?.data?.detail ||
          error.response?.data?.title?.[0] ||
          'Failed to create lesson plan'
      )
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, data, objectiveIds }) => {
      const response = await lmsApi.updateLessonPlan(id, data)
      if (objectiveIds.length > 0 && response?.data?.id) {
        await lmsApi.linkLessonPlanObjectives(response.data.id, objectiveIds)
      }
      return response
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      closeModal()
      showSuccess('Lesson plan updated successfully!')
    },
    onError: (error) => {
      showError(
        error.response?.data?.detail ||
          error.response?.data?.title?.[0] ||
          'Failed to update lesson plan'
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => lmsApi.deleteLessonPlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      setDeleteConfirm(null)
      showSuccess('Lesson plan deleted successfully!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to delete lesson plan')
    },
  })

  const publishMutation = useMutation({
    mutationFn: (id) => lmsApi.publishLessonPlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      showSuccess('Lesson plan published!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to publish lesson plan')
    },
  })

  const clearSelectedIds = (ids) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => lmsApi.bulkDeleteLessonPlans(ids),
    onSuccess: (response, ids) => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      clearSelectedIds(ids)
      setBulkDeleteConfirm(false)
      const deletedCount = response?.data?.deleted_count ?? ids.length
      showSuccess(`Deleted ${deletedCount} lesson plan(s).`)
    },
    onError: (error) => {
      setBulkDeleteConfirm(false)
      showError(error.response?.data?.detail || 'Failed to delete the selected lesson plans.')
    },
  })

  const bulkPublishMutation = useMutation({
    mutationFn: (ids) => lmsApi.bulkPublishLessonPlans(ids),
    onSuccess: (response, ids) => {
      queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
      clearSelectedIds(ids)
      const publishedCount = response?.data?.published_count ?? ids.length
      showSuccess(`Approved ${publishedCount} lesson plan(s).`)
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to approve the selected lesson plans.')
    },
  })

  // -- Handlers --

  const openAddModal = () => {
    setEditingPlan(null)
    setForm({ ...EMPTY_FORM })
    setCustomTopicInput('')
    setShowModal(true)
  }

  const addCustomTopic = () => {
    const label = customTopicInput.trim()
    if (!label) return
    setForm((prev) => ({
      ...prev,
      custom_topics: (prev.custom_topics || []).includes(label)
        ? prev.custom_topics
        : [...(prev.custom_topics || []), label],
    }))
    setCustomTopicInput('')
  }

  const removeCustomTopic = (index) => {
    setForm((prev) => ({
      ...prev,
      custom_topics: (prev.custom_topics || []).filter((_, i) => i !== index),
    }))
  }

  const addObjectiveRow = () => {
    setForm((prev) => ({
      ...prev,
      objective_rows: [...(prev.objective_rows || []), makeObjectiveRow()],
    }))
  }

  const updateObjectiveRow = (rowId, patch) => {
    setForm((prev) => ({
      ...prev,
      objective_rows: (prev.objective_rows || []).map((row) =>
        row.rowId === rowId ? { ...row, ...patch } : row,
      ),
    }))
  }

  const removeObjectiveRow = (rowId) => {
    setForm((prev) => {
      const nextRows = (prev.objective_rows || []).filter((row) => row.rowId !== rowId)
      return {
        ...prev,
        objective_rows: nextRows.length > 0 ? nextRows : [makeObjectiveRow()],
      }
    })
  }

  const openEditModal = (plan) => {
    const mappedClassObj = classSelectorScope === 'session'
      ? (sessionClassIdByMaster[String(plan.class_obj)] || '')
      : (plan.class_obj ? String(plan.class_obj) : '')

    const linkedObjectiveRows = (plan.linked_objectives || []).map((objective) =>
      makeObjectiveRow({
        id: objective.id,
        statement: objective.statement,
        bloom_level: objective.bloom_level,
      }),
    )
    const objectivesText = normalizeLessonPlanText(plan.objectives_text ?? plan.objectives)
    const parsedObjectiveRows = parseObjectiveTextToRows(objectivesText)

    setEditingPlan(plan)
    setForm({
      mode: 'STANDARD',
      title: plan.title || '',
      description: plan.description || '',
      objectives: objectivesText,
      objective_rows: linkedObjectiveRows.length > 0
        ? linkedObjectiveRows
        : (parsedObjectiveRows.length > 0 ? parsedObjectiveRows : [makeObjectiveRow()]),
      class_obj: mappedClassObj,
      subject: plan.subject ? String(plan.subject) : '',
      teacher: plan.teacher ? String(plan.teacher) : '',
      lesson_date: plan.lesson_date || '',
      duration_minutes: plan.duration_minutes || 45,
      materials_needed: plan.materials_needed || '',
      teaching_methods: plan.teaching_methods || '',
      status: plan.status || 'DRAFT',
      chapterIds: [],
      topicIds: (plan.planned_topics || []).map((t) => t.id),
      subtopicIds: (plan.planned_subtopics || []).map((s) => s.id),
      curriculumSummary: '',
      custom_topics: plan.custom_topics || [],
    })
    setCustomTopicInput('')
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingPlan(null)
    setForm({ ...EMPTY_FORM })
    setCustomTopicInput('')
  }

  const handleSubmit = () => {
    if (!form.class_obj) {
      showError('Please select a class')
      return
    }
    if (!form.subject) {
      showError('Please select a subject')
      return
    }
    const topicSelectionCount = form.chapterIds.length + form.topicIds.length + form.subtopicIds.length

    if (isMinimal) {
      if (!form.lesson_date) {
        showError('Please select a lesson date')
        return
      }
      if (topicSelectionCount === 0) {
        showError('Please select at least one chapter or topic')
        return
      }
      if (!form.teacher) {
        showError('No teacher is assigned to this class and subject. Please select one.')
        return
      }
    } else if (!form.title) {
      showError('Title is required')
      return
    }

    const objectiveRows = form.objective_rows || []
    const payload = {
      ...form,
      title: isMinimal ? deriveAutoTitleFromCurriculumSummary(form.curriculumSummary) : form.title,
      description: isMinimal ? '' : form.description,
      objectives: isMinimal ? '' : (objectiveRowsToPlainText(objectiveRows) || form.objectives),
      materials_needed: isMinimal ? '' : form.materials_needed,
      teaching_methods: isMinimal ? '' : form.teaching_methods,
      status: isMinimal ? 'DRAFT' : form.status,
      class_obj: parseInt(resolvedFormClassObj),
      subject: parseInt(form.subject),
      teacher: form.teacher ? parseInt(form.teacher) : null,
      duration_minutes: isMinimal ? 45 : (parseInt(form.duration_minutes) || 45),
      planned_topic_ids: form.topicIds,
      planned_subtopic_ids: form.subtopicIds,
    }
    const objectiveIds = isMinimal ? [] : Array.from(
      new Set(
        objectiveRows
          .map((row) => row.objectiveId)
          .filter((id) => Number.isInteger(id)),
      ),
    )

    if (editingPlan) {
      updateMutation.mutate({ id: editingPlan.id, data: payload, objectiveIds })
    } else {
      createMutation.mutate({ data: payload, objectiveIds })
    }
  }

  const isSubmitting = createMutation.isPending || updateMutation.isPending

  const formatDate = (dateStr) => {
    if (!dateStr) return '--'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  const handleDownloadLessonPlansExport = async () => {
    if (!exportDateFrom || !exportDateTo) {
      showError('Select a start and end date to download.')
      return
    }
    if (exportDateFrom > exportDateTo) {
      showError('Start date must be on or before end date.')
      return
    }
    if (exportPlans.length === 0) {
      showError('No lesson plans in the selected date range for your current filters.')
      return
    }
    try {
      await exportLessonPlansPDF({
        plans: exportPlans,
        dateFrom: exportDateFrom,
        dateTo: exportDateTo,
        academicYearLabel: activeAcademicYear?.name || activeAcademicYear?.year_name || '',
        schoolData: schoolRes?.data || null,
      })
      showSuccess(`Downloaded ${exportPlans.length} lesson plan(s) as PDF.`)
    } catch (e) {
      console.error(e)
      showError('Could not generate the PDF. Try again or use a smaller date range.')
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Lesson Plans</h1>
          <p className="text-sm text-gray-600">Create and manage lesson plans for your classes</p>
        </div>
        <button type="button" onClick={() => setShowBulkModal(true)} className="btn btn-primary">
          Add Lesson Plan
        </button>
      </div>

      <div className="mb-6">
        <TeacherScopeSummary compact />
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
          <div>
            <label className="label">Class</label>
            <ClassSelector
              className="input"
              value={filterClass}
              onChange={(e) => {
                setFilterClass(e.target.value)
                setFilterSubject('')
              }}
              showAllOption={showAllOption}
              scope={classSelectorScope}
              academicYearId={activeAcademicYear?.id}
              classes={teacherClassOptions || undefined}
            />
          </div>
          <div>
            <label className="label">Subject</label>
            <select
              className="input"
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              disabled={!resolvedFilterClass || filterSubjectsLoading}
            >
              <option value="">
                {!resolvedFilterClass
                  ? 'Select class first'
                  : filterSubjectsLoading
                  ? 'Loading subjects...'
                  : 'All Assigned Subjects'}
              </option>
              {filterClassSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.code ? `${subject.code} - ` : ''}{subject.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Search</label>
            <input
              type="text"
              className="input"
              placeholder="Search by title or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mt-4 pt-4 border-t border-gray-100">
          <div>
            <label className="label">Lesson date — from</label>
            <input
              type="date"
              className="input"
              value={exportDateFrom}
              onChange={(e) => setExportDateFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Lesson date — to</label>
            <input
              type="date"
              className="input"
              value={exportDateTo}
              onChange={(e) => setExportDateTo(e.target.value)}
            />
          </div>
          <div className="flex flex-col justify-end">
            <button
              type="button"
              className="btn btn-secondary w-full sm:w-auto"
              disabled={!canDownloadExport}
              onClick={handleDownloadLessonPlansExport}
              title={
                !exportDateFrom || !exportDateTo
                  ? 'Choose both dates to download full lesson plans in this range'
                  : exportDateFrom > exportDateTo
                  ? 'Start date must be on or before end date'
                  : exportPlans.length === 0
                  ? 'No plans in this range for current class/subject/search'
                  : `Download ${exportPlans.length} plan(s) as PDF`
              }
            >
              Download lesson plans (PDF)
            </button>
            <p className="text-xs text-gray-500 mt-1">
              This date range also controls which lesson plans are shown below. Download gets a formatted
              PDF with full details for every plan in range (respects class, subject, and search above).
            </p>
          </div>
        </div>
        <TeacherScopeHint
          className="mt-3"
          classId={resolvedFilterClass}
          subjectId={filterSubject}
          academicYearId={activeAcademicYear?.id}
          fallbackText="Filter by class and subject to confirm whether the table is showing class-wide or subject-only access."
        />
      </div>

      {/* Table */}
      <div className="card">
        {!resolvedFilterClass ? (
          <div className="p-4 sm:p-6">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Step 1 */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-blue-100 text-blue-700 ring-2 ring-blue-300">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500 text-white">1</span>
                Filter Class / Subject
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              {/* Step 2 */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">2</span>
                Create Lesson Plan
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              {/* Step 3 */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
                Publish &amp; Track
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              No lesson plans yet. Select a class above to get started.
            </p>
          </div>
        ) : !hasValidDateRange ? (
          <div className="p-4 sm:p-6 text-center text-gray-500">
            <p className="text-sm">
              Select a valid lesson-date range above ("Lesson date - from/to") to view lesson plans for this class.
            </p>
          </div>
        ) : isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading lesson plans...</p>
          </div>
        ) : plans.length === 0 ? (
          allPlans.length === 0 ? (
            <div className="p-4 sm:p-6 text-center text-gray-500">
              <p className="text-sm">
                No lesson plans found for the selected class/subject and date range.
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">Tip:</span> Use the AI Wizard to auto-generate lesson plans from your curriculum topics.
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              No lesson plans match your search within the selected date range.
            </div>
          )
        ) : (
          <>
            {/* Bulk actions toolbar */}
            {someVisibleSelected && (
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100">
                <span className="text-sm text-blue-800 font-medium">
                  {selectedVisibleIds.length} selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-gray-600 hover:text-gray-800"
                    onClick={() => clearSelectedIds(selectedVisibleIds)}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary text-xs py-1 px-3"
                    disabled={selectedDraftIds.length === 0 || bulkPublishMutation.isPending}
                    onClick={() => bulkPublishMutation.mutate(selectedDraftIds)}
                    title={
                      selectedDraftIds.length === 0
                        ? 'No draft plans selected'
                        : `Approve ${selectedDraftIds.length} plan(s)`
                    }
                  >
                    {bulkPublishMutation.isPending
                      ? 'Approving...'
                      : `Approve Selected (${selectedDraftIds.length})`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger text-xs py-1 px-3"
                    onClick={() => setBulkDeleteConfirm(true)}
                  >
                    Delete Selected ({selectedVisibleIds.length})
                  </button>
                </div>
              </div>
            )}

            {/* Mobile card view */}
            <div className="sm:hidden space-y-2 p-2">
              <label className="flex items-center gap-2 px-1 pb-1 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                  }}
                  onChange={toggleSelectAllVisible}
                />
                Select all ({plans.length})
              </label>
              {plans.map((plan) => (
                <div key={plan.id} className="p-3 border border-gray-200 rounded-lg">
                  <div className="flex items-start justify-between gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedIds.has(plan.id)}
                      onChange={() => toggleSelectPlan(plan.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm text-gray-900 truncate">{plan.title}</p>
                      {plan.description?.trim() && (
                        <p className="text-xs text-gray-600 mt-0.5 line-clamp-2 whitespace-pre-wrap break-words">
                          {plan.description.trim()}
                        </p>
                      )}
                      {Array.isArray(plan.linked_objectives) && plan.linked_objectives.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {plan.linked_objectives.slice(0, 2).map((objective) => (
                            <span key={objective.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 text-xs">
                              <span className="truncate max-w-[170px]">{objective.statement}</span>
                              {objective.bloom_level && (
                                <span className={`px-1 py-0.5 rounded-full ${BLOOM_BADGE_CLASSES[objective.bloom_level] || 'bg-gray-100 text-gray-700'}`}>
                                  {OBJECTIVE_BLOOM_OPTIONS.find((option) => option.value === objective.bloom_level)?.label || objective.bloom_level}
                                </span>
                              )}
                            </span>
                          ))}
                          {plan.linked_objectives.length > 2 && (
                            <span className="text-xs text-gray-500">+{plan.linked_objectives.length - 2} objectives</span>
                          )}
                        </div>
                      )}
                      <p className="text-xs text-gray-500 mt-0.5">
                        {plan.class_name || 'N/A'} | {plan.subject_name || 'N/A'}
                      </p>
                      {isTeacherEnabled && (
                        <TeacherScopeBadge scope={classifyScope({ classId: plan.class_obj, subjectId: plan.subject })} className="mt-1" />
                      )}
                      <p className="text-xs text-gray-500">
                        {formatDate(plan.lesson_date)} | {plan.duration_minutes || '--'} min
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                        STATUS_BADGES[plan.status] || STATUS_BADGES.DRAFT
                      }`}
                    >
                      {plan.status}
                    </span>
                  </div>
                  {plan.planned_topics?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {plan.planned_topics.slice(0, 3).map((topic) => (
                        <span key={topic.id} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                          {topic.title}
                        </span>
                      ))}
                      {plan.planned_topics.length > 3 && (
                        <span className="text-xs text-gray-500">+{plan.planned_topics.length - 3} more</span>
                      )}
                    </div>
                  )}
                  {plan.custom_topics?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {plan.custom_topics.slice(0, 3).map((label, index) => (
                        <span key={`${label}-${index}`} className="px-1.5 py-0.5 bg-amber-50 text-amber-800 text-xs rounded">
                          {label}
                        </span>
                      ))}
                      {plan.custom_topics.length > 3 && (
                        <span className="text-xs text-gray-500">+{plan.custom_topics.length - 3} more</span>
                      )}
                    </div>
                  )}
                  {plan.ai_generated && (
                    <span className="inline-block mt-1 px-1.5 py-0.5 bg-purple-50 text-purple-700 text-xs rounded">
                      AI Generated
                    </span>
                  )}
                  <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => openEditModal(plan)}
                      className="text-xs text-blue-600 font-medium"
                    >
                      Edit
                    </button>
                    {plan.status === 'DRAFT' && (
                      <button
                        onClick={() => publishMutation.mutate(plan.id)}
                        className="text-xs text-green-600 font-medium"
                      >
                        Publish
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteConfirm(plan)}
                      className="text-xs text-red-600 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table view */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left w-8">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                        }}
                        onChange={toggleSelectAllVisible}
                      />
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Title
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Class
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Subject
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Teacher
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Duration
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {plans.map((plan) => (
                    <tr key={plan.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(plan.id)}
                          onChange={() => toggleSelectPlan(plan.id)}
                        />
                      </td>
                      <td className="px-4 py-3 text-sm max-w-[280px]">
                        <div className="font-medium text-gray-900 truncate">{plan.title}</div>
                        {plan.description?.trim() && (
                          <p className="text-xs text-gray-600 mt-0.5 line-clamp-2 whitespace-pre-wrap break-words">
                            {plan.description.trim()}
                          </p>
                        )}
                        {Array.isArray(plan.linked_objectives) && plan.linked_objectives.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {plan.linked_objectives.slice(0, 2).map((objective) => (
                              <span key={objective.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 text-xs">
                                <span className="truncate max-w-[180px]">{objective.statement}</span>
                                {objective.bloom_level && (
                                  <span className={`px-1 py-0.5 rounded-full ${BLOOM_BADGE_CLASSES[objective.bloom_level] || 'bg-gray-100 text-gray-700'}`}>
                                    {OBJECTIVE_BLOOM_OPTIONS.find((option) => option.value === objective.bloom_level)?.label || objective.bloom_level}
                                  </span>
                                )}
                              </span>
                            ))}
                            {plan.linked_objectives.length > 2 && (
                              <span className="text-xs text-gray-500">+{plan.linked_objectives.length - 2} objectives</span>
                            )}
                          </div>
                        )}
                        {plan.planned_topics?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {plan.planned_topics.slice(0, 2).map((topic) => (
                              <span key={topic.id} className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                                {topic.title}
                              </span>
                            ))}
                            {plan.planned_topics.length > 2 && (
                              <span className="text-xs text-gray-500">+{plan.planned_topics.length - 2}</span>
                            )}
                          </div>
                        )}
                        {plan.custom_topics?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {plan.custom_topics.slice(0, 2).map((label, index) => (
                              <span key={`${label}-${index}`} className="px-1.5 py-0.5 bg-amber-50 text-amber-800 text-xs rounded">
                                {label}
                              </span>
                            ))}
                            {plan.custom_topics.length > 2 && (
                              <span className="text-xs text-gray-500">+{plan.custom_topics.length - 2}</span>
                            )}
                          </div>
                        )}
                        {plan.ai_generated && (
                          <span className="inline-block mt-1 px-1.5 py-0.5 bg-purple-50 text-purple-700 text-xs rounded">
                            AI
                          </span>
                        )}
                        {isTeacherEnabled && (
                          <div className="mt-1">
                            <TeacherScopeBadge scope={classifyScope({ classId: plan.class_obj, subjectId: plan.subject })} />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {plan.class_name || '--'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {plan.subject_name || '--'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {plan.teacher_name || '--'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(plan.lesson_date)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {plan.duration_minutes ? `${plan.duration_minutes} min` : '--'}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            STATUS_BADGES[plan.status] || STATUS_BADGES.DRAFT
                          }`}
                        >
                          {plan.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => openEditModal(plan)}
                          className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                        >
                          Edit
                        </button>
                        {plan.status === 'DRAFT' && (
                          <button
                            onClick={() => publishMutation.mutate(plan.id)}
                            disabled={publishMutation.isPending}
                            className="text-sm text-green-600 hover:text-green-800 font-medium mr-3"
                          >
                            Publish
                          </button>
                        )}
                        <button
                          onClick={() => setDeleteConfirm(plan)}
                          className="text-sm text-red-600 hover:text-red-800 font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingPlan ? 'Edit Lesson Plan' : 'Create Lesson Plan'}
            </h2>

            {!editingPlan && (
              <div className="flex items-center gap-4 mb-4 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="lessonPlanMode"
                    checked={form.mode === 'MINIMAL'}
                    onChange={() => setForm({ ...form, mode: 'MINIMAL' })}
                  />
                  Minimal <span className="text-xs text-gray-500">(date, subject, chapter/topic only)</span>
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="lessonPlanMode"
                    checked={form.mode === 'STANDARD'}
                    onChange={() => setForm({ ...form, mode: 'STANDARD' })}
                  />
                  Standard <span className="text-xs text-gray-500">(full details)</span>
                </label>
              </div>
            )}

            <div className="space-y-4">
              {/* Title */}
              {!isMinimal && (
                <div>
                  <label className="label">Title *</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g., Introduction to Photosynthesis"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </div>
              )}

              {/* Class & Subject row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Class *</label>
                  <ClassSelector
                    className="input"
                    value={form.class_obj}
                    onChange={(e) => setForm({ ...form, class_obj: e.target.value, subject: '' })}
                    scope={classSelectorScope}
                    academicYearId={activeAcademicYear?.id}
                    showAllOption={showAllOption}
                    classes={teacherClassOptions || undefined}
                  />
                </div>
                <div>
                  <label className="label">Subject *</label>
                  <select
                    className="input"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                    disabled={!resolvedFormClassObj || formSubjectsLoading}
                    required
                  >
                    <option value="">
                      {!resolvedFormClassObj
                        ? 'Select class first'
                        : formSubjectsLoading
                        ? 'Loading subjects...'
                        : formClassSubjects.length > 0
                        ? 'Select subject'
                        : 'No subjects assigned'}
                    </option>
                    {formClassSubjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.code ? `${subject.code} - ` : ''}{subject.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <TeacherScopeHint
                classId={resolvedFormClassObj}
                subjectId={form.subject}
                academicYearId={activeAcademicYear?.id}
                fallbackText="Select both class and subject to confirm whether this lesson plan is using class-wide or subject-only access."
              />

              {/* Chapter / Topic */}
              <div>
                <label className="label">
                  Chapter / Topic {isMinimal ? '*' : '(optional)'}
                </label>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-600">
                    {form.chapterIds.length + form.topicIds.length + form.subtopicIds.length} item(s) selected
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary text-xs py-1 px-2"
                    disabled={!resolvedFormClassObj || !form.subject}
                    onClick={() => setTopicPickerOpen(true)}
                  >
                    Select chapter / topic
                  </button>
                </div>
                {(!resolvedFormClassObj || !form.subject) && (
                  <p className="text-xs text-gray-500 mt-1">Select class and subject first.</p>
                )}
              </div>

              {/* Custom topics — freeform labels not tied to a curriculum book, shown alongside chapter/topic selection above */}
              <div>
                <label className="label">Custom topics (optional)</label>
                <p className="text-xs text-gray-500 mb-1">
                  Add a topic label that isn&apos;t in a curriculum book — it shows alongside any selected chapter/topic.
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input flex-1"
                    placeholder="e.g., Guest speaker session"
                    value={customTopicInput}
                    onChange={(e) => setCustomTopicInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        addCustomTopic()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary text-xs py-1 px-2 shrink-0"
                    onClick={addCustomTopic}
                  >
                    Add
                  </button>
                </div>
                {form.custom_topics?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {form.custom_topics.map((label, index) => (
                      <span
                        key={`${label}-${index}`}
                        className="inline-flex items-center gap-1 bg-amber-50 text-amber-800 text-xs px-2.5 py-1 rounded-full"
                      >
                        {label}
                        <button
                          type="button"
                          onClick={() => removeCustomTopic(index)}
                          className="text-amber-500 hover:text-amber-700 ml-0.5"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Teacher & Date row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(!isMinimal || !form.teacher) && (
                  <div>
                    <label className="label">
                      Teacher{isMinimal ? ' (no default found — please choose)' : ''}
                    </label>
                    <select
                      className="input"
                      value={form.teacher}
                      onChange={(e) => setForm({ ...form, teacher: e.target.value })}
                    >
                      <option value="">Select Teacher</option>
                      {staff.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.full_name || t.user_name || `Staff #${t.id}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div>
                  <label className="label">Lesson Date {isMinimal ? '*' : ''}</label>
                  <input
                    type="date"
                    className="input"
                    value={form.lesson_date}
                    onChange={(e) => setForm({ ...form, lesson_date: e.target.value })}
                  />
                </div>
              </div>

              {!isMinimal && (
                <>
                  {/* Duration & Status row */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="label">Duration (minutes)</label>
                      <input
                        type="number"
                        className="input"
                        min="1"
                        value={form.duration_minutes}
                        onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="label">Status</label>
                      <select
                        className="input"
                        value={form.status}
                        onChange={(e) => setForm({ ...form, status: e.target.value })}
                      >
                        <option value="DRAFT">Draft</option>
                        <option value="PUBLISHED">Published</option>
                      </select>
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="label">Description</label>
                    <textarea
                      className="input"
                      rows={3}
                      placeholder="Brief description of the lesson..."
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                </>
              )}

              {/* Objectives */}
              {!isMinimal && (
              <div>
                <label className="label">Objectives</label>
                <div className="space-y-2">
                  {(form.objective_rows || []).map((row) => (
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
                        value={row.bloom_level || ''}
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
                  <p className="text-xs font-medium text-gray-600 mb-1">Topic objective suggestions (edit mode)</p>
                  {modalObjectivesLoading ? (
                    <p className="text-xs text-gray-500">Loading topic objectives...</p>
                  ) : modalObjectivesError ? (
                    <p className="text-xs text-red-600">Could not load topic objectives.</p>
                  ) : modalAvailableObjectives.length === 0 ? (
                    <p className="text-xs text-gray-500">No topic objectives available for this lesson plan yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {modalAvailableObjectives.slice(0, 8).map((objective) => (
                        <button
                          key={objective.id}
                          type="button"
                          onClick={() => setForm((prev) => ({
                            ...prev,
                            objective_rows: [
                              ...(prev.objective_rows || []),
                              makeObjectiveRow({
                                id: objective.id,
                                statement: objective.statement,
                                bloom_level: objective.bloom_level,
                              }),
                            ],
                          }))}
                          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 hover:bg-blue-100"
                          title={objective.statement}
                        >
                          <span className="truncate max-w-[220px]">{objective.statement}</span>
                          {objective.bloom_level && (
                            <span className={`px-1.5 py-0.5 rounded-full ${BLOOM_BADGE_CLASSES[objective.bloom_level] || 'bg-gray-100 text-gray-700'}`}>
                              {OBJECTIVE_BLOOM_OPTIONS.find((option) => option.value === objective.bloom_level)?.label || objective.bloom_level}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              )}

              {!isMinimal && (
                <>
                  {/* Materials Needed */}
                  <div>
                    <label className="label">Materials Needed</label>
                    <textarea
                      className="input"
                      rows={2}
                      placeholder="Textbook, whiteboard, projector..."
                      value={form.materials_needed}
                      onChange={(e) => setForm({ ...form, materials_needed: e.target.value })}
                    />
                  </div>

                  {/* Teaching Methods */}
                  <div>
                    <label className="label">Teaching Methods</label>
                    <textarea
                      className="input"
                      rows={2}
                      placeholder="Lecture, group discussion, hands-on activity..."
                      value={form.teaching_methods}
                      onChange={(e) => setForm({ ...form, teaching_methods: e.target.value })}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeModal} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="btn btn-primary"
              >
                {isSubmitting
                  ? 'Saving...'
                  : editingPlan
                  ? 'Save Changes'
                  : 'Create Lesson Plan'}
              </button>
            </div>
          </div>
        </div>
      )}

      <LessonPlanTopicsPickerModal
        open={topicPickerOpen}
        onClose={() => setTopicPickerOpen(false)}
        classId={parseInt(resolvedFormClassObj, 10)}
        subjectId={parseInt(form.subject, 10)}
        initialChapterIds={form.chapterIds}
        initialTopicIds={form.topicIds}
        initialSubtopicIds={form.subtopicIds}
        onApply={({ chapterIds, topicIds, subtopicIds, curriculumSummary }) => {
          setForm((prev) => ({ ...prev, chapterIds, topicIds, subtopicIds, curriculumSummary }))
        }}
      />

      {showBulkModal && (
        <BulkLessonPlansModal
          onClose={() => setShowBulkModal(false)}
          onSuccess={() => {
            setShowBulkModal(false)
            queryClient.invalidateQueries({ queryKey: ['lessonPlans'] })
          }}
          onCreateSingle={() => {
            setShowBulkModal(false)
            openAddModal()
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Lesson Plan</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.title}</strong>? This action
              cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="btn btn-danger"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Lesson Plans</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{selectedVisibleIds.length}</strong> selected lesson
              plan(s)? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setBulkDeleteConfirm(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => bulkDeleteMutation.mutate(selectedVisibleIds)}
                disabled={bulkDeleteMutation.isPending}
                className="btn btn-danger"
              >
                {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
