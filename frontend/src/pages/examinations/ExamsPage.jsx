import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, classesApi } from '../../services/api'

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
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [yearFilter, setYearFilter] = useState('')
  const [classFilter, setClassFilter] = useState('')

  // Queries
  const { data: examsRes, isLoading } = useQuery({
    queryKey: ['exams', yearFilter, classFilter],
    queryFn: () => examinationsApi.getExams({
      academic_year: yearFilter || undefined,
      class_obj: classFilter || undefined,
    }),
  })

  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears(),
  })

  const { data: termsRes } = useQuery({
    queryKey: ['terms', form.academic_year],
    queryFn: () => sessionsApi.getTerms({ academic_year: form.academic_year }),
    enabled: !!form.academic_year,
  })

  const { data: examTypesRes } = useQuery({
    queryKey: ['examTypes'],
    queryFn: () => examinationsApi.getExamTypes(),
  })

  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses(),
  })

  const exams = examsRes?.data?.results || examsRes?.data || []
  const years = yearsRes?.data?.results || yearsRes?.data || []
  const terms = termsRes?.data?.results || termsRes?.data || []
  const examTypes = examTypesRes?.data?.results || examTypesRes?.data || []
  const classes = classesRes?.data?.results || classesRes?.data || []

  // Mutations
  const createMut = useMutation({
    mutationFn: (data) => examinationsApi.createExam(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['exams'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => examinationsApi.updateExam(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['exams'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => examinationsApi.deleteExam(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exams'] }),
  })

  const publishMut = useMutation({
    mutationFn: (id) => examinationsApi.publishExam(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['exams'] }),
  })

  const openCreate = () => { setForm(EMPTY_FORM); setEditId(null); setErrors({}); setShowModal(true) }
  const openEdit = (item) => {
    setForm({
      academic_year: item.academic_year, term: item.term || '',
      exam_type: item.exam_type, class_obj: item.class_obj,
      name: item.name, start_date: item.start_date || '',
      end_date: item.end_date || '', status: item.status,
    })
    setEditId(item.id); setErrors({}); setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(EMPTY_FORM); setErrors({}) }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = { ...form, term: form.term || null }
    if (editId) updateMut.mutate({ id: editId, data: payload })
    else createMut.mutate(payload)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exams</h1>
          <p className="text-sm text-gray-600">Create and manage exams for each class</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm px-4 py-2">+ Create Exam</button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="input w-full sm:w-44">
          <option value="">All Years</option>
          {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
        <select value={classFilter} onChange={e => setClassFilter(e.target.value)} className="input w-full sm:w-44">
          <option value="">All Classes</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : exams.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">No exams found. Create one to get started.</div>
      ) : (
        <>
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
                {exams.map(exam => (
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
                    <td className="px-4 py-2 text-sm text-center">{exam.subjects_count}</td>
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
            {exams.map(exam => (
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
                  {exam.academic_year_name}{exam.term_name ? ` · ${exam.term_name}` : ''} · {exam.subjects_count} subjects
                </p>
                <div className="flex gap-2">
                  <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline">Edit</button>
                  {exam.status !== 'PUBLISHED' && (
                    <button
                      onClick={() => { if (confirm('Publish?')) publishMut.mutate(exam.id) }}
                      className="text-xs text-green-600 hover:underline"
                    >Publish</button>
                  )}
                  <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(exam.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editId ? 'Edit Exam' : 'Create Exam'}</h2>
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
                  className="input w-full" required placeholder="e.g. Mid-Term 2025 - Class 5-A" />
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
                  <select value={form.class_obj} onChange={e => setForm(p => ({ ...p, class_obj: e.target.value }))} className="input w-full" required>
                    <option value="">Select...</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
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
                <button type="submit" disabled={createMut.isPending || updateMut.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                  {createMut.isPending || updateMut.isPending ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
