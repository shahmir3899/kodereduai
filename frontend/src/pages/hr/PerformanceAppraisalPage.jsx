import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { hrApi } from '../../services/api'

const EMPTY_FORM = {
  staff_member: '',
  review_period_start: '',
  review_period_end: '',
  rating: 0,
  strengths: '',
  areas_for_improvement: '',
  goals: '',
  comments: '',
}

function StarRating({ value, onChange, readonly = false }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map(star => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          className={`text-2xl transition-colors ${readonly ? 'cursor-default' : 'cursor-pointer'}`}
        >
          <svg
            className={`w-6 h-6 ${(hover || value) >= star ? 'text-yellow-400 fill-yellow-400' : 'text-gray-300'}`}
            fill={((hover || value) >= star) ? 'currentColor' : 'none'}
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
      ))}
    </div>
  )
}

const ratingLabels = { 1: 'Poor', 2: 'Below Average', 3: 'Average', 4: 'Good', 5: 'Excellent' }

export default function PerformanceAppraisalPage() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [detailAppraisal, setDetailAppraisal] = useState(null)

  const { data: appraisalRes, isLoading } = useQuery({
    queryKey: ['hrAppraisals', search],
    queryFn: () => hrApi.getAppraisals({ search, page_size: 100 }),
  })

  const { data: staffRes } = useQuery({
    queryKey: ['hrStaffActive'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 }),
  })

  const appraisals = appraisalRes?.data?.results || appraisalRes?.data || []
  const staffList = staffRes?.data?.results || staffRes?.data || []

  const createMutation = useMutation({
    mutationFn: (data) => hrApi.createAppraisal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrAppraisals'] })
      closeModal()
    },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed to create appraisal' }),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => hrApi.updateAppraisal(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hrAppraisals'] })
      closeModal()
    },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed to update appraisal' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => hrApi.deleteAppraisal(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hrAppraisals'] }),
  })

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditId(null)
    setErrors({})
    setShowModal(true)
  }

  const openEdit = (appraisal) => {
    setForm({
      staff_member: appraisal.staff_member,
      review_period_start: appraisal.review_period_start,
      review_period_end: appraisal.review_period_end,
      rating: appraisal.rating,
      strengths: appraisal.strengths || '',
      areas_for_improvement: appraisal.areas_for_improvement || '',
      goals: appraisal.goals || '',
      comments: appraisal.comments || '',
    })
    setEditId(appraisal.id)
    setErrors({})
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditId(null)
    setForm(EMPTY_FORM)
    setErrors({})
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.staff_member || !form.review_period_start || !form.review_period_end || !form.rating) {
      setErrors({ detail: 'Please fill all required fields (staff, period, rating).' })
      return
    }
    const payload = { ...form, rating: parseInt(form.rating) }
    if (editId) {
      updateMutation.mutate({ id: editId, data: payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Performance Appraisals</h1>
          <p className="text-sm text-gray-600">Track and manage staff performance reviews</p>
        </div>
        <button onClick={openCreate} className="btn-primary text-sm px-4 py-2 whitespace-nowrap">
          + New Appraisal
        </button>
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search by staff name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-full sm:w-72"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : appraisals.length === 0 ? (
        <div className="card text-center py-8 text-gray-500">No appraisals found. Create one to get started.</div>
      ) : (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3 text-left">Staff Member</th>
                  <th className="px-4 py-3 text-left">Review Period</th>
                  <th className="px-4 py-3 text-center">Rating</th>
                  <th className="px-4 py-3 text-left">Reviewer</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {appraisals.map(a => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <p className="text-sm font-medium text-gray-900">{a.staff_member_name}</p>
                      <p className="text-xs text-gray-500">{a.staff_employee_id}</p>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">
                      {a.review_period_start} to {a.review_period_end}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <StarRating value={a.rating} readonly />
                        <span className="text-xs text-gray-500 ml-1">({ratingLabels[a.rating] || a.rating})</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">{a.reviewer_name || '-'}</td>
                    <td className="px-4 py-2 text-sm text-gray-500">{a.created_at?.split('T')[0]}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setDetailAppraisal(a)} className="text-xs text-primary-600 hover:underline mr-2">View</button>
                      <button onClick={() => openEdit(a)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                      <button
                        onClick={() => { if (confirm('Delete this appraisal?')) deleteMutation.mutate(a.id) }}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {appraisals.map(a => (
              <div key={a.id} className="card">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{a.staff_member_name}</p>
                    <p className="text-xs text-gray-500">{a.staff_employee_id}</p>
                  </div>
                  <StarRating value={a.rating} readonly />
                </div>
                <div className="text-xs text-gray-600 mb-2">
                  <span>Period: {a.review_period_start} to {a.review_period_end}</span>
                  {a.reviewer_name && <span className="ml-3">Reviewer: {a.reviewer_name}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setDetailAppraisal(a)} className="text-xs text-primary-600 hover:underline">View</button>
                  <button onClick={() => openEdit(a)} className="text-xs text-primary-600 hover:underline">Edit</button>
                  <button
                    onClick={() => { if (confirm('Delete this appraisal?')) deleteMutation.mutate(a.id) }}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Detail Modal */}
      {detailAppraisal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetailAppraisal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Appraisal Details</h2>
              <button onClick={() => setDetailAppraisal(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500">Staff Member</p>
                <p className="text-sm font-medium">{detailAppraisal.staff_member_name} ({detailAppraisal.staff_employee_id})</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Review Period</p>
                <p className="text-sm">{detailAppraisal.review_period_start} to {detailAppraisal.review_period_end}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Rating</p>
                <div className="flex items-center gap-2">
                  <StarRating value={detailAppraisal.rating} readonly />
                  <span className="text-sm text-gray-600">{ratingLabels[detailAppraisal.rating]}</span>
                </div>
              </div>
              {detailAppraisal.strengths && (
                <div>
                  <p className="text-xs text-gray-500">Strengths</p>
                  <p className="text-sm whitespace-pre-wrap">{detailAppraisal.strengths}</p>
                </div>
              )}
              {detailAppraisal.areas_for_improvement && (
                <div>
                  <p className="text-xs text-gray-500">Areas for Improvement</p>
                  <p className="text-sm whitespace-pre-wrap">{detailAppraisal.areas_for_improvement}</p>
                </div>
              )}
              {detailAppraisal.goals && (
                <div>
                  <p className="text-xs text-gray-500">Goals</p>
                  <p className="text-sm whitespace-pre-wrap">{detailAppraisal.goals}</p>
                </div>
              )}
              {detailAppraisal.comments && (
                <div>
                  <p className="text-xs text-gray-500">Comments</p>
                  <p className="text-sm whitespace-pre-wrap">{detailAppraisal.comments}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500">Reviewer</p>
                <p className="text-sm">{detailAppraisal.reviewer_name || '-'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editId ? 'Edit Appraisal' : 'New Appraisal'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {(errors.detail || errors.non_field_errors) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {errors.detail || errors.non_field_errors}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Staff Member *</label>
                <select
                  value={form.staff_member}
                  onChange={e => setForm(p => ({ ...p, staff_member: e.target.value }))}
                  className="input w-full"
                  required
                >
                  <option value="">Select staff...</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name} ({s.employee_id})</option>
                  ))}
                </select>
                {errors.staff_member && <p className="text-xs text-red-600 mt-1">{errors.staff_member}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Period Start *</label>
                  <input
                    type="date"
                    value={form.review_period_start}
                    onChange={e => setForm(p => ({ ...p, review_period_start: e.target.value }))}
                    className="input w-full"
                    required
                  />
                  {errors.review_period_start && <p className="text-xs text-red-600 mt-1">{errors.review_period_start}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Period End *</label>
                  <input
                    type="date"
                    value={form.review_period_end}
                    onChange={e => setForm(p => ({ ...p, review_period_end: e.target.value }))}
                    className="input w-full"
                    required
                  />
                  {errors.review_period_end && <p className="text-xs text-red-600 mt-1">{errors.review_period_end}</p>}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rating * ({ratingLabels[form.rating] || 'Select'})</label>
                <StarRating value={form.rating} onChange={val => setForm(p => ({ ...p, rating: val }))} />
                {errors.rating && <p className="text-xs text-red-600 mt-1">{errors.rating}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Strengths</label>
                <textarea
                  value={form.strengths}
                  onChange={e => setForm(p => ({ ...p, strengths: e.target.value }))}
                  className="input w-full"
                  rows={2}
                  placeholder="Key strengths demonstrated..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Areas for Improvement</label>
                <textarea
                  value={form.areas_for_improvement}
                  onChange={e => setForm(p => ({ ...p, areas_for_improvement: e.target.value }))}
                  className="input w-full"
                  rows={2}
                  placeholder="Areas needing development..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Goals</label>
                <textarea
                  value={form.goals}
                  onChange={e => setForm(p => ({ ...p, goals: e.target.value }))}
                  className="input w-full"
                  rows={2}
                  placeholder="Goals for next review period..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Comments</label>
                <textarea
                  value={form.comments}
                  onChange={e => setForm(p => ({ ...p, comments: e.target.value }))}
                  className="input w-full"
                  rows={2}
                  placeholder="Additional comments..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
                >
                  {createMutation.isPending || updateMutation.isPending ? 'Saving...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
