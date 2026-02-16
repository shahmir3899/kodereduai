import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi } from '../../services/api'

const EMPTY_FORM = { name: '', weight: '100.00' }

export default function ExamTypesPage() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})

  const { data: res, isLoading } = useQuery({
    queryKey: ['examTypes'],
    queryFn: () => examinationsApi.getExamTypes({ page_size: 9999 }),
  })

  const items = res?.data?.results || res?.data || []

  const createMut = useMutation({
    mutationFn: (data) => examinationsApi.createExamType(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['examTypes'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed' }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => examinationsApi.updateExamType(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['examTypes'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => examinationsApi.deleteExamType(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['examTypes'] }),
  })

  const openCreate = () => { setForm(EMPTY_FORM); setEditId(null); setErrors({}); setShowModal(true) }
  const openEdit = (item) => {
    setForm({ name: item.name, weight: item.weight })
    setEditId(item.id); setErrors({}); setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(EMPTY_FORM); setErrors({}) }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (editId) updateMut.mutate({ id: editId, data: form })
    else createMut.mutate(form)
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exam Types</h1>
          <p className="text-sm text-gray-600">Define exam categories like Mid-Term, Final, Unit Test</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm px-4 py-2">+ Add Exam Type</button>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : items.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">No exam types yet. Create one to get started.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(item => (
            <div key={item.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-semibold text-gray-900">{item.name}</h3>
                <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                  {item.weight}%
                </span>
              </div>
              <p className="text-xs text-gray-500">Weight: {item.weight}% for GPA calculation</p>
              <div className="flex gap-2 mt-3 pt-2 border-t border-gray-100">
                <button onClick={() => openEdit(item)} className="text-xs text-primary-600 hover:underline">Edit</button>
                <button
                  onClick={() => { if (confirm(`Delete "${item.name}"?`)) deleteMut.mutate(item.id) }}
                  className="text-xs text-red-600 hover:underline"
                >Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editId ? 'Edit Exam Type' : 'Add Exam Type'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {(errors.detail || errors.non_field_errors) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {errors.detail || errors.non_field_errors}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input
                  type="text" value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="input w-full" required placeholder="e.g. Mid-Term Exam"
                />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Weight (%)</label>
                <input
                  type="number" step="0.01" min="0" max="100" value={form.weight}
                  onChange={e => setForm(p => ({ ...p, weight: e.target.value }))}
                  className="input w-32"
                />
                <p className="text-xs text-gray-400 mt-1">Weightage for GPA calculation (default 100%)</p>
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
