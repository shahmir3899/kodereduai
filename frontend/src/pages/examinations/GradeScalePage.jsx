import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi } from '../../services/api'

const EMPTY_FORM = { grade_label: '', min_percentage: '', max_percentage: '', gpa_points: '', order: '' }

export default function GradeScalePage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})

  const { data: res, isLoading } = useQuery({
    queryKey: ['gradeScales'],
    queryFn: () => examinationsApi.getGradeScales(),
  })

  const items = res?.data?.results || res?.data || []

  const createMut = useMutation({
    mutationFn: (data) => examinationsApi.createGradeScale(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['gradeScales'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => examinationsApi.updateGradeScale(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['gradeScales'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => examinationsApi.deleteGradeScale(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gradeScales'] }),
  })

  const openCreate = () => { setForm(EMPTY_FORM); setEditId(null); setErrors({}); setShowModal(true) }
  const openEdit = (item) => {
    setForm({
      grade_label: item.grade_label, min_percentage: item.min_percentage,
      max_percentage: item.max_percentage, gpa_points: item.gpa_points, order: item.order,
    })
    setEditId(item.id); setErrors({}); setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(EMPTY_FORM); setErrors({}) }

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = { ...form, order: parseInt(form.order) || 0 }
    if (editId) updateMut.mutate({ id: editId, data: payload })
    else createMut.mutate(payload)
  }

  // Color mapping for grade labels
  const getGradeColor = (label) => {
    const l = label.toUpperCase()
    if (l.startsWith('A')) return 'bg-green-100 text-green-700 border-green-200'
    if (l.startsWith('B')) return 'bg-blue-100 text-blue-700 border-blue-200'
    if (l.startsWith('C')) return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    if (l.startsWith('D')) return 'bg-orange-100 text-orange-700 border-orange-200'
    if (l === 'F') return 'bg-red-100 text-red-700 border-red-200'
    return 'bg-gray-100 text-gray-700 border-gray-200'
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Grade Scale</h1>
          <p className="text-sm text-gray-600">Define grade boundaries for result calculation</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm px-4 py-2">+ Add Grade</button>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">
          No grade scale defined. Add grades like A+, A, B, C, D, F to enable grade calculation.
        </div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3 text-center w-16">Order</th>
                  <th className="px-4 py-3 text-center">Grade</th>
                  <th className="px-4 py-3 text-center">Min %</th>
                  <th className="px-4 py-3 text-center">Max %</th>
                  <th className="px-4 py-3 text-center">GPA Points</th>
                  <th className="px-4 py-3 text-center">Range</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-sm text-center text-gray-400">{item.order}</td>
                    <td className="px-4 py-2 text-center">
                      <span className={`inline-block px-3 py-1 rounded-lg text-sm font-bold border ${getGradeColor(item.grade_label)}`}>
                        {item.grade_label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-center">{item.min_percentage}%</td>
                    <td className="px-4 py-2 text-sm text-center">{item.max_percentage}%</td>
                    <td className="px-4 py-2 text-sm text-center font-medium">{item.gpa_points}</td>
                    <td className="px-4 py-2 text-center">
                      <div className="w-full bg-gray-200 rounded-full h-2 max-w-[120px] mx-auto">
                        <div
                          className="bg-primary-500 h-2 rounded-full"
                          style={{ width: `${item.max_percentage - item.min_percentage}%`, marginLeft: `${item.min_percentage}%` }}
                        ></div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => openEdit(item)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                      <button
                        onClick={() => { if (confirm(`Delete grade "${item.grade_label}"?`)) deleteMut.mutate(item.id) }}
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
            {items.map(item => (
              <div key={item.id} className="card">
                <div className="flex items-center justify-between mb-2">
                  <span className={`px-3 py-1 rounded-lg text-sm font-bold border ${getGradeColor(item.grade_label)}`}>
                    {item.grade_label}
                  </span>
                  <span className="text-xs text-gray-500">GPA: {item.gpa_points}</span>
                </div>
                <p className="text-sm text-gray-600">Range: {item.min_percentage}% — {item.max_percentage}%</p>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => openEdit(item)} className="text-xs text-primary-600 hover:underline">Edit</button>
                  <button onClick={() => { if (confirm('Delete?')) deleteMut.mutate(item.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editId ? 'Edit Grade' : 'Add Grade'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {(errors.detail || errors.non_field_errors) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {errors.detail || errors.non_field_errors}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grade Label *</label>
                  <input type="text" value={form.grade_label} onChange={e => setForm(p => ({ ...p, grade_label: e.target.value }))}
                    className="input w-full" required maxLength={5} placeholder="e.g. A+" />
                  {errors.grade_label && <p className="text-xs text-red-600 mt-1">{errors.grade_label}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
                  <input type="number" min="0" value={form.order} onChange={e => setForm(p => ({ ...p, order: e.target.value }))}
                    className="input w-full" placeholder="0" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min % *</label>
                  <input type="number" step="0.01" min="0" max="100" value={form.min_percentage}
                    onChange={e => setForm(p => ({ ...p, min_percentage: e.target.value }))}
                    className="input w-full" required />
                  {errors.min_percentage && <p className="text-xs text-red-600 mt-1">{errors.min_percentage}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max % *</label>
                  <input type="number" step="0.01" min="0" max="100" value={form.max_percentage}
                    onChange={e => setForm(p => ({ ...p, max_percentage: e.target.value }))}
                    className="input w-full" required />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">GPA Points</label>
                <input type="number" step="0.1" min="0" max="5" value={form.gpa_points}
                  onChange={e => setForm(p => ({ ...p, gpa_points: e.target.value }))}
                  className="input w-32" placeholder="e.g. 4.0" />
              </div>
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
