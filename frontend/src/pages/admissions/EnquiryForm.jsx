import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { GRADE_PRESETS } from '../../constants/gradePresets'

const SOURCES = [
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'PHONE', label: 'Phone Call' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'SOCIAL_MEDIA', label: 'Social Media' },
  { value: 'NEWSPAPER', label: 'Newspaper' },
  { value: 'OTHER', label: 'Other' },
]

const INITIAL_FORM = {
  name: '',
  father_name: '',
  mobile: '',
  applying_for_grade_level: '',
  source: 'WALK_IN',
  next_followup_date: '',
  notes: '',
}

export default function EnquiryForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const isEdit = !!id && id !== 'new'

  const [form, setForm] = useState(INITIAL_FORM)
  const [errors, setErrors] = useState({})

  // Fetch existing enquiry for edit
  const { data: enquiryRes, isLoading: enquiryLoading } = useQuery({
    queryKey: ['enquiry', id],
    queryFn: () => admissionsApi.getEnquiry(id),
    enabled: isEdit,
  })

  // Populate form on edit
  useEffect(() => {
    if (isEdit && enquiryRes?.data) {
      const e = enquiryRes.data
      setForm({
        name: e.name || '',
        father_name: e.father_name || '',
        mobile: e.mobile || '',
        applying_for_grade_level: e.applying_for_grade_level != null ? String(e.applying_for_grade_level) : '',
        source: e.source || 'WALK_IN',
        next_followup_date: e.next_followup_date || '',
        notes: e.notes || '',
      })
    }
  }, [isEdit, enquiryRes])

  // Create mutation
  const createMut = useMutation({
    mutationFn: (data) => admissionsApi.createEnquiry(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      showSuccess('Enquiry created successfully!')
      navigate('/admissions')
    },
    onError: (err) => {
      const data = err.response?.data
      if (data && typeof data === 'object') setErrors(data)
      showError(data?.detail || data?.non_field_errors?.[0] || 'Failed to create enquiry')
    },
  })

  // Update mutation
  const updateMut = useMutation({
    mutationFn: (data) => admissionsApi.updateEnquiry(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiry', id] })
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      showSuccess('Enquiry updated successfully!')
      navigate('/admissions')
    },
    onError: (err) => {
      const data = err.response?.data
      if (data && typeof data === 'object') setErrors(data)
      showError(data?.detail || data?.non_field_errors?.[0] || 'Failed to update enquiry')
    },
  })

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const validate = () => {
    const newErrors = {}
    if (!form.name.trim()) newErrors.name = 'Name is required'
    if (!form.father_name.trim()) newErrors.father_name = 'Father name is required'
    if (!form.mobile.trim()) newErrors.mobile = 'Mobile number is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    const payload = {}
    Object.entries(form).forEach(([key, value]) => {
      if (value !== '' && value !== null && value !== undefined) {
        payload[key] = value
      }
    })

    // Convert grade level to number
    if (payload.applying_for_grade_level) {
      payload.applying_for_grade_level = parseInt(payload.applying_for_grade_level)
    }

    if (isEdit) {
      updateMut.mutate(payload)
    } else {
      createMut.mutate(payload)
    }
  }

  const isPending = createMut.isPending || updateMut.isPending

  if (isEdit && enquiryLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Back link */}
      <Link
        to="/admissions"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Admissions
      </Link>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
        <h1 className="text-xl font-bold text-gray-900 mb-6">
          {isEdit ? 'Edit Enquiry' : 'New Enquiry'}
        </h1>

        {/* Global errors */}
        {(errors.detail || errors.non_field_errors) && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
            {errors.detail || errors.non_field_errors}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Student Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => handleChange('name', e.target.value)}
                className={`input w-full ${errors.name ? 'border-red-300 focus:ring-red-500' : ''}`}
                placeholder="Full name"
              />
              {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Father Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.father_name}
                onChange={(e) => handleChange('father_name', e.target.value)}
                className={`input w-full ${errors.father_name ? 'border-red-300 focus:ring-red-500' : ''}`}
                placeholder="Father's full name"
              />
              {errors.father_name && <p className="text-xs text-red-600 mt-1">{errors.father_name}</p>}
            </div>
          </div>

          {/* Mobile & Grade */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mobile <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.mobile}
                onChange={(e) => handleChange('mobile', e.target.value)}
                className={`input w-full ${errors.mobile ? 'border-red-300 focus:ring-red-500' : ''}`}
                placeholder="0300-1234567"
              />
              {errors.mobile && <p className="text-xs text-red-600 mt-1">{errors.mobile}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Grade Applied For</label>
              <select
                value={form.applying_for_grade_level}
                onChange={(e) => handleChange('applying_for_grade_level', e.target.value)}
                className="input w-full"
              >
                <option value="">Select grade...</option>
                {GRADE_PRESETS.map((p) => (
                  <option key={p.numeric_level} value={p.numeric_level}>{p.name}</option>
                ))}
              </select>
              {errors.applying_for_grade_level && <p className="text-xs text-red-600 mt-1">{errors.applying_for_grade_level}</p>}
            </div>
          </div>

          {/* Source & Follow-up */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
              <select
                value={form.source}
                onChange={(e) => handleChange('source', e.target.value)}
                className="input w-full"
              >
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Next Follow-up Date</label>
              <input
                type="date"
                value={form.next_followup_date}
                onChange={(e) => handleChange('next_followup_date', e.target.value)}
                className="input w-full"
              />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              className="input w-full min-h-[80px]"
              placeholder="Any notes about this enquiry..."
              rows={3}
            />
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <Link
              to="/admissions"
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
            >
              {isPending ? 'Saving...' : isEdit ? 'Update Enquiry' : 'Create Enquiry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
