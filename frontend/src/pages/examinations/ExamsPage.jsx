import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, classesApi, academicsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import ExamWizard from './ExamWizard'

const EMPTY_FORM = {
  academic_year: '', term: '', exam_type: '', class_obj: '',
  name: '', start_date: '', end_date: '', status: 'SCHEDULED',
}

const STATUS_STYLES = {
  SCHEDULED: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  MARKS_ENTRY: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  PUBLISHED: 'bg-purple-100 text-purple-700',
}

export default function ExamsPage() {
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()

  // UI state
  const [showWizard, setShowWizard] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [selectedSubjects, setSelectedSubjects] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [listError, setListError] = useState(null)
  const [expandedGroupId, setExpandedGroupId] = useState(null)
  const [dateSheetGroupId, setDateSheetGroupId] = useState(null)
  const [yearFilter, setYearFilter] = useState('')
  const [activeTab, setActiveTab] = useState('exams') // 'exams' | 'tests'

  // Sync year filter with global session switcher
  useEffect(() => {
    if (activeAcademicYear?.id) setYearFilter(String(activeAcademicYear.id))
  }, [activeAcademicYear?.id])

  // Auto-dismiss list error after 5s
  useEffect(() => {
    if (!listError) return
    const t = setTimeout(() => setListError(null), 5000)
    return () => clearTimeout(t)
  }, [listError])

  // ── Queries ──

  // Exam Groups
  const { data: groupsRes, isLoading: groupsLoading } = useQuery({
    queryKey: ['examGroups', yearFilter],
    queryFn: () => examinationsApi.getExamGroups({
      academic_year: yearFilter || undefined,
      page_size: 9999,
    }),
  })
  const groups = groupsRes?.data?.results || groupsRes?.data || []

  // Standalone (ungrouped) exams
  const { data: standaloneRes, isLoading: standaloneLoading } = useQuery({
    queryKey: ['exams', 'ungrouped', yearFilter],
    queryFn: () => examinationsApi.getExams({
      academic_year: yearFilter || undefined,
      ungrouped: true,
      page_size: 9999,
    }),
  })
  const standaloneExams = standaloneRes?.data?.results || standaloneRes?.data || []

  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const { data: termsRes } = useQuery({
    queryKey: ['terms', form.academic_year],
    queryFn: () => sessionsApi.getTerms({ academic_year: form.academic_year, page_size: 9999 }),
    enabled: !!form.academic_year,
  })

  const { data: examTypesRes } = useQuery({
    queryKey: ['examTypes'],
    queryFn: () => examinationsApi.getExamTypes({ page_size: 9999 }),
  })

  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
  })

  // ClassSubjects for Quick Create modal
  const { data: classSubjectsRes, isLoading: classSubjectsLoading } = useQuery({
    queryKey: ['classSubjectsForExam', form.class_obj],
    queryFn: () => academicsApi.getClassSubjects({ class_obj: form.class_obj, page_size: 9999 }),
    enabled: !!form.class_obj && showModal,
  })
  const classSubjects = classSubjectsRes?.data?.results || classSubjectsRes?.data || []

  const { data: allSubjectsRes } = useQuery({
    queryKey: ['allSubjectsForExam'],
    queryFn: () => academicsApi.getSubjects({ page_size: 9999 }),
    enabled: !!form.class_obj && showModal && !classSubjectsLoading && classSubjects.length === 0,
  })
  const allSubjects = allSubjectsRes?.data?.results || allSubjectsRes?.data || []

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const terms = termsRes?.data?.results || termsRes?.data || []
  const examTypes = examTypesRes?.data?.results || examTypesRes?.data || []
  const classes = classesRes?.data?.results || classesRes?.data || []

  // ── Mutations ──

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => examinationsApi.updateExam(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['exams'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => examinationsApi.deleteExam(id),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['exams'] }); queryClient.invalidateQueries({ queryKey: ['examGroups'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to delete exam.'),
  })

  const publishMut = useMutation({
    mutationFn: (id) => examinationsApi.publishExam(id),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['exams'] }); queryClient.invalidateQueries({ queryKey: ['examGroups'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to publish exam.'),
  })

  const deleteGroupMut = useMutation({
    mutationFn: (id) => examinationsApi.deleteExamGroup(id),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['examGroups'] }); queryClient.invalidateQueries({ queryKey: ['exams'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to delete exam group.'),
  })

  const publishAllMut = useMutation({
    mutationFn: (id) => examinationsApi.publishAllExams(id),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['examGroups'] }); queryClient.invalidateQueries({ queryKey: ['exams'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to publish exams.'),
  })

  // ── Modal helpers (Quick Create / Edit) ──

  const openCreate = () => { setForm(EMPTY_FORM); setEditId(null); setErrors({}); setSelectedSubjects([]); setShowModal(true) }
  const openEdit = (item) => {
    setForm({
      academic_year: item.academic_year, term: item.term || '',
      exam_type: item.exam_type, class_obj: item.class_obj,
      name: item.name, start_date: item.start_date || '',
      end_date: item.end_date || '', status: item.status,
    })
    setEditId(item.id); setErrors({}); setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(EMPTY_FORM); setErrors({}); setSelectedSubjects([]) }

  // Find editing exam in either standalone list or inside group exams
  const editingExam = editId ? (
    standaloneExams.find(e => e.id === editId) ||
    groups.flatMap(g => g.exams || []).find(e => e.id === editId)
  ) : null

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (editId) {
      const needsBulkAssign = classSubjects.length === 0 && selectedSubjects.length > 0
      const needsPopulate = editingExam?.subjects_count === 0 && classSubjects.length > 0

      setIsSubmitting(true)
      setErrors({})
      try {
        if (needsBulkAssign) {
          await academicsApi.bulkAssignSubjects({ class_obj: parseInt(form.class_obj), subjects: selectedSubjects })
        }
        if (needsBulkAssign || needsPopulate) {
          await examinationsApi.populateExamSubjects(editId)
        }
        const payload = { ...form, term: form.term || null }
        await examinationsApi.updateExam(editId, payload)
        queryClient.invalidateQueries({ queryKey: ['exams'] })
        closeModal()
      } catch (err) {
        const errData = err.response?.data || {}
        if (typeof errData === 'string') setErrors({ detail: errData })
        else if (errData.detail) setErrors({ detail: errData.detail })
        else setErrors(errData)
      } finally { setIsSubmitting(false) }
      return
    }

    // Create mode
    const needsBulkAssign = classSubjects.length === 0 && selectedSubjects.length > 0
    if (classSubjects.length === 0 && selectedSubjects.length === 0 && !classSubjectsLoading) {
      setErrors({ subjects: 'Please select at least one subject for this class.' })
      return
    }

    setIsSubmitting(true)
    setErrors({})
    try {
      if (needsBulkAssign) {
        await academicsApi.bulkAssignSubjects({ class_obj: parseInt(form.class_obj), subjects: selectedSubjects })
      }
      const payload = { ...form, term: form.term || null }
      await examinationsApi.createExam(payload)
      queryClient.invalidateQueries({ queryKey: ['exams'] })
      closeModal()
    } catch (err) {
      const errData = err.response?.data || {}
      if (typeof errData === 'string') setErrors({ detail: errData })
      else if (errData.detail) setErrors({ detail: errData.detail })
      else setErrors(errData)
    } finally { setIsSubmitting(false) }
  }

  // ── Date Sheet Modal ──

  const DateSheetModal = ({ groupId, onClose: closeDateSheet }) => {
    const [dateSheetData, setDateSheetData] = useState(null)
    const [saving, setSaving] = useState({})

    const { data: dsRes, isLoading: dsLoading } = useQuery({
      queryKey: ['dateSheet', groupId],
      queryFn: () => examinationsApi.getDateSheet(groupId),
      enabled: !!groupId,
    })

    useEffect(() => {
      if (dsRes?.data) {
        setDateSheetData(dsRes.data)
      }
    }, [dsRes])

    const subjects = dateSheetData?.subjects || []

    const handleDateChange = async (subjectId, date) => {
      setSaving(p => ({ ...p, [subjectId]: true }))
      try {
        await examinationsApi.updateDateBySubject(groupId, { subject_id: subjectId, exam_date: date || null })
        queryClient.invalidateQueries({ queryKey: ['dateSheet', groupId] })
        queryClient.invalidateQueries({ queryKey: ['examGroups'] })
      } catch (err) {
        setListError('Failed to update date.')
      } finally {
        setSaving(p => ({ ...p, [subjectId]: false }))
      }
    }

    const handleDownload = async () => {
      try {
        const res = await examinationsApi.downloadDateSheet(groupId)
        const url = window.URL.createObjectURL(new Blob([res.data]))
        const a = document.createElement('a')
        a.href = url
        a.download = `date-sheet-${groupId}.xlsx`
        a.click()
        window.URL.revokeObjectURL(url)
      } catch {
        setListError('Failed to download date sheet.')
      }
    }

    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeDateSheet}>
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Date Sheet</h2>
            <div className="flex items-center gap-2">
              <button onClick={handleDownload} className="text-xs px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg font-medium">
                Download Excel
              </button>
              <button onClick={closeDateSheet} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
          </div>

          {dsLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : subjects.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">No subjects found in this exam group.</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2 text-left">Code</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Classes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {subjects.map(sub => (
                  <tr key={sub.subject_id}>
                    <td className="px-3 py-2 font-medium text-gray-900">{sub.subject_name}</td>
                    <td className="px-3 py-2 text-gray-500">{sub.subject_code || '—'}</td>
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={sub.exam_date || ''}
                        onChange={e => handleDateChange(sub.subject_id, e.target.value)}
                        className="input text-sm py-1 px-2 w-36"
                        disabled={saving[sub.subject_id]}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-xs">{sub.classes?.map(c => c.class_name).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    )
  }

  // ── Render helpers ──

  const isLoading = groupsLoading && standaloneLoading

  const toggleGroup = (id) => setExpandedGroupId(prev => prev === id ? null : id)

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exams & Tests</h1>
          <p className="text-sm text-gray-600">Create and manage exams and tests</p>
        </div>
        {activeTab === 'exams' ? (
          <button onClick={() => setShowWizard(true)} className="btn-primary text-sm px-4 py-2">
            + Create Exam
          </button>
        ) : (
          <button onClick={openCreate} className="btn-primary text-sm px-4 py-2">
            + Create Test
          </button>
        )}
      </div>

      {/* Year Filter + Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="input w-full sm:w-44">
          <option value="">All Years</option>
          {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <div className="flex border-b border-gray-200 sm:ml-4">
          <button
            onClick={() => setActiveTab('exams')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'exams' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Exams{groups.length > 0 ? ` (${groups.length})` : ''}
          </button>
          <button
            onClick={() => setActiveTab('tests')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'tests' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Tests{standaloneExams.length > 0 ? ` (${standaloneExams.length})` : ''}
          </button>
        </div>
      </div>

      {/* List-level error banner */}
      {listError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-red-700">{listError}</span>
          <button onClick={() => setListError(null)} className="text-red-400 hover:text-red-600 ml-3">&times;</button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : (
        <>
          {/* ── Exams Tab ── */}
          {activeTab === 'exams' && (
            groups.length > 0 ? (
            <div>
              <div className="space-y-3">
                {groups.map(group => {
                  const isExpanded = expandedGroupId === group.id
                  const exams = group.exams || []
                  return (
                    <div key={group.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                      {/* Group Header */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleGroup(group.id)}
                      >
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 text-sm">{group.name}</span>
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                              {group.exam_type_name}
                            </span>
                            {group.exam_type_weight != null && (
                              <span className="text-xs text-gray-400">{group.exam_type_weight}%</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {group.academic_year_name}
                            {group.term_name && ` · ${group.term_name}`}
                            {' · '}{group.classes_count || exams.length} class{(group.classes_count || exams.length) !== 1 ? 'es' : ''}
                            {group.start_date && ` · ${group.start_date}`}
                            {group.end_date && ` — ${group.end_date}`}
                          </p>
                        </div>
                        {/* Group actions */}
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setDateSheetGroupId(group.id)}
                            className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded"
                            title="Date Sheet"
                          >
                            Date Sheet
                          </button>
                          <button
                            onClick={() => { if (confirm('Publish all exams in this group? Results will become visible.')) publishAllMut.mutate(group.id) }}
                            className="text-xs px-2 py-1 text-green-600 hover:bg-green-50 rounded"
                            disabled={publishAllMut.isPending}
                          >
                            Publish All
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete "${group.name}" and all its class exams?`)) deleteGroupMut.mutate(group.id) }}
                            className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded"
                            disabled={deleteGroupMut.isPending}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Expanded: Per-class exams table */}
                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          {exams.length === 0 ? (
                            <p className="px-4 py-3 text-sm text-gray-500">No exams in this group.</p>
                          ) : (
                            <>
                              {/* Desktop */}
                              <div className="hidden md:block">
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="bg-gray-50/50 text-xs text-gray-500 uppercase">
                                      <th className="px-4 py-2 text-left">Class</th>
                                      <th className="px-4 py-2 text-center">Subjects</th>
                                      <th className="px-4 py-2 text-center">Status</th>
                                      <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {exams.map(exam => (
                                      <tr key={exam.id} className="hover:bg-gray-50/50">
                                        <td className="px-4 py-2 text-gray-900 font-medium">{exam.class_name}</td>
                                        <td className="px-4 py-2 text-center">
                                          {exam.subjects_count === 0 ? (
                                            <span className="text-amber-600 text-xs">0</span>
                                          ) : exam.subjects_count}
                                        </td>
                                        <td className="px-4 py-2 text-center">
                                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[exam.status] || 'bg-gray-100'}`}>
                                            {exam.status.replace('_', ' ')}
                                          </span>
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                          <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                                          {exam.status !== 'PUBLISHED' && (
                                            <button
                                              onClick={() => { if (confirm('Publish this exam?')) publishMut.mutate(exam.id) }}
                                              className="text-xs text-green-600 hover:underline mr-2"
                                            >Publish</button>
                                          )}
                                          <button
                                            onClick={() => { if (confirm(`Delete "${exam.name}"?`)) deleteMut.mutate(exam.id) }}
                                            className="text-xs text-red-600 hover:underline"
                                          >Delete</button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {/* Mobile */}
                              <div className="md:hidden divide-y divide-gray-100">
                                {exams.map(exam => (
                                  <div key={exam.id} className="px-4 py-2 flex items-center justify-between">
                                    <div>
                                      <p className="text-sm font-medium text-gray-900">{exam.class_name}</p>
                                      <p className="text-xs text-gray-500">
                                        {exam.subjects_count} subjects ·{' '}
                                        <span className={`${STATUS_STYLES[exam.status]?.includes('text-') ? STATUS_STYLES[exam.status].split(' ').find(c => c.startsWith('text-')) : 'text-gray-600'}`}>
                                          {exam.status.replace('_', ' ')}
                                        </span>
                                      </p>
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline">Edit</button>
                                      <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(exam.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            ) : (
            <div className="card text-center py-8">
              <p className="text-gray-500 mb-3">No exams found. Create an exam using the wizard.</p>
              <button onClick={() => setShowWizard(true)} className="btn-primary text-sm px-4 py-2">
                + Create Exam
              </button>
            </div>
            )
          )}

          {/* ── Tests Tab ── */}
          {activeTab === 'tests' && (
            standaloneExams.length > 0 ? (
            <div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">Exam Name</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Class</th>
                      <th className="px-4 py-3 text-left">Year</th>
                      <th className="px-4 py-3 text-left">Dates</th>
                      <th className="px-4 py-3 text-center">Subjects</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {standaloneExams.map(exam => (
                      <tr key={exam.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{exam.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{exam.exam_type_name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{exam.class_name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {exam.academic_year_name}
                          {exam.term_name && <span className="text-xs text-gray-400 ml-1">({exam.term_name})</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {exam.start_date ? `${exam.start_date} — ${exam.end_date || '?'}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-sm text-center">
                          {exam.subjects_count === 0 ? (
                            <span className="inline-flex items-center gap-1 text-amber-600" title="No subjects — marks entry will not work">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              0
                            </span>
                          ) : exam.subjects_count}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[exam.status] || 'bg-gray-100'}`}>
                            {exam.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                          {exam.status !== 'PUBLISHED' && (
                            <button
                              onClick={() => { if (confirm('Publish this exam? Results will become visible.')) publishMut.mutate(exam.id) }}
                              className="text-xs text-green-600 hover:underline mr-2"
                            >Publish</button>
                          )}
                          <button
                            onClick={() => { if (confirm(`Delete "${exam.name}"?`)) deleteMut.mutate(exam.id) }}
                            className="text-xs text-red-600 hover:underline"
                          >Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {standaloneExams.map(exam => (
                  <div key={exam.id} className="card">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{exam.name}</p>
                        <p className="text-xs text-gray-500">{exam.exam_type_name} · {exam.class_name}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[exam.status]}`}>
                        {exam.status.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      {exam.academic_year_name}{exam.term_name ? ` · ${exam.term_name}` : ''} · {exam.subjects_count === 0 ? (
                        <span className="text-amber-600 font-medium">0 subjects (needs setup)</span>
                      ) : (
                        <>{exam.subjects_count} subjects</>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline">Edit</button>
                      {exam.status !== 'PUBLISHED' && (
                        <button onClick={() => { if (confirm('Publish?')) publishMut.mutate(exam.id) }} className="text-xs text-green-600 hover:underline">Publish</button>
                      )}
                      <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(exam.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            ) : (
            <div className="card text-center py-8">
              <p className="text-gray-500 mb-3">No tests found. Create a test to get started.</p>
              <button onClick={openCreate} className="btn-primary text-sm px-4 py-2">
                + Create Test
              </button>
            </div>
            )
          )}
        </>
      )}

      {/* ── Wizard Modal ── */}
      {showWizard && (
        <ExamWizard
          onClose={() => setShowWizard(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['examGroups'] })
            queryClient.invalidateQueries({ queryKey: ['exams'] })
            setShowWizard(false)
          }}
        />
      )}

      {/* ── Date Sheet Modal ── */}
      {dateSheetGroupId && (
        <DateSheetModal groupId={dateSheetGroupId} onClose={() => setDateSheetGroupId(null)} />
      )}

      {/* ── Quick Create / Edit Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editId ? (activeTab === 'exams' ? 'Edit Exam' : 'Edit Test') : 'Create Test'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {(errors.detail || errors.non_field_errors) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {errors.detail || errors.non_field_errors}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Exam Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="input w-full" required placeholder="e.g. Unit Test 1 - Class 5-A" />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
                  <select value={form.academic_year} onChange={e => setForm(p => ({ ...p, academic_year: e.target.value, term: '' }))} className="input w-full" required>
                    <option value="">Select...</option>
                    {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
                  <select value={form.term} onChange={e => setForm(p => ({ ...p, term: e.target.value }))} className="input w-full">
                    <option value="">None</option>
                    {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Exam Type *</label>
                  <select value={form.exam_type} onChange={e => setForm(p => ({ ...p, exam_type: e.target.value }))} className="input w-full" required>
                    <option value="">Select...</option>
                    {examTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
                  <select value={form.class_obj} onChange={e => { setForm(p => ({ ...p, class_obj: e.target.value })); setSelectedSubjects([]) }} className="input w-full" required>
                    <option value="">Select...</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Subject Status / Picker */}
              {form.class_obj && (
                <div>
                  {classSubjectsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                      Checking class subjects...
                    </div>
                  ) : classSubjects.length > 0 ? (
                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm text-green-700">
                        {classSubjects.length} subject{classSubjects.length !== 1 ? 's' : ''} assigned
                        <span className="text-green-600 text-xs ml-1">
                          ({classSubjects.map(cs => cs.subject_name).join(', ')})
                        </span>
                      </span>
                      {editId && editingExam?.subjects_count === 0 && (
                        <button type="button" onClick={async () => {
                          try {
                            await examinationsApi.populateExamSubjects(editId)
                            queryClient.invalidateQueries({ queryKey: ['exams'] })
                            closeModal()
                          } catch {
                            setErrors({ detail: 'Failed to add subjects to exam.' })
                          }
                        }} className="ml-auto text-xs font-medium text-green-700 bg-green-200 hover:bg-green-300 px-2 py-1 rounded">
                          Add to this exam
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-3">
                        <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm text-amber-700">
                          No subjects assigned to this class. Select subjects below to auto-assign them.
                        </span>
                      </div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Select Subjects *</label>
                      <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
                        {allSubjects.length === 0 ? (
                          <p className="text-sm text-gray-400 p-1">No subjects available. Create subjects first in Academics &gt; Subjects.</p>
                        ) : (
                          <>
                            {allSubjects.map(s => (
                              <label key={s.id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${selectedSubjects.includes(s.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                                <input
                                  type="checkbox"
                                  checked={selectedSubjects.includes(s.id)}
                                  onChange={e => setSelectedSubjects(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">{s.code} - {s.name}</span>
                              </label>
                            ))}
                            <div className="flex gap-2 pt-1 border-t mt-1">
                              <button type="button" onClick={() => setSelectedSubjects(allSubjects.map(s => s.id))} className="text-xs text-blue-600 hover:underline">Select All</button>
                              <button type="button" onClick={() => setSelectedSubjects([])} className="text-xs text-gray-500 hover:underline">Clear</button>
                            </div>
                          </>
                        )}
                      </div>
                      {selectedSubjects.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1">{selectedSubjects.length} subject{selectedSubjects.length > 1 ? 's' : ''} selected</p>
                      )}
                      {errors.subjects && <p className="text-xs text-red-600 mt-1">{errors.subjects}</p>}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                  <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} className="input w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                  <input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} className="input w-full" />
                </div>
              </div>
              {editId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className="input w-full">
                    <option value="SCHEDULED">Scheduled</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="MARKS_ENTRY">Marks Entry</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="PUBLISHED">Published</option>
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={isSubmitting || updateMut.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                  {isSubmitting ? 'Setting up...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
