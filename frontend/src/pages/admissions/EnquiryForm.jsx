import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { admissionsApi, gradesApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const SOURCES = [
  { value: 'WALK_IN', label: 'Walk-in' },
  { value: 'PHONE', label: 'Phone Call' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'SOCIAL_MEDIA', label: 'Social Media' },
  { value: 'NEWSPAPER', label: 'Newspaper' },
  { value: 'OTHER', label: 'Other' },
]

const PRIORITIES = [
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' },
]

const GENDERS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
]

const INITIAL_FORM = {
  // Child info
  child_name: '',
  child_dob: '',
  child_gender: '',
  grade_applied: '',
  previous_school: '',
  // Parent info
  parent_name: '',
  parent_phone: '',
  parent_email: '',
  parent_occupation: '',
  address: '',
  // Lead info
  source: 'WALK_IN',
  referral_details: '',
  priority: 'MEDIUM',
  assigned_to: '',
  next_followup_date: '',
  notes: '',
  admission_session: '',
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

  // Grades
  const { data: gradesRes } = useQuery({
    queryKey: ['grades'],
    queryFn: () => gradesApi.getGrades(),
    staleTime: 5 * 60 * 1000,
  })

  // Admission sessions for optional linking
  const { data: sessionsRes } = useQuery({
    queryKey: ['admissionSessions'],
    queryFn: () => admissionsApi.getSessions(),
    staleTime: 5 * 60 * 1000,
  })

  const grades = gradesRes?.data?.results || gradesRes?.data || []
  const sessions = sessionsRes?.data?.results || sessionsRes?.data || []

  // Populate form on edit
  useEffect(() => {
    if (isEdit && enquiryRes?.data) {
      const e = enquiryRes.data
      setForm({
        child_name: e.child_name || '',
        child_dob: e.child_dob || '',
        child_gender: e.child_gender || '',
        grade_applied: e.grade_applied ? String(e.grade_applied) : '',
        previous_school: e.previous_school || '',
        parent_name: e.parent_name || '',
        parent_phone: e.parent_phone || '',
        parent_email: e.parent_email || '',
        parent_occupation: e.parent_occupation || '',
        address: e.address || '',
        source: e.source || 'WALK_IN',
        referral_details: e.referral_details || '',
        priority: e.priority || 'MEDIUM',
        assigned_to: e.assigned_to ? String(e.assigned_to) : '',
        next_followup_date: e.next_followup_date || '',
        notes: '',
        admission_session: e.admission_session ? String(e.admission_session) : '',
      })
    }
  }, [isEdit, enquiryRes])

  // Create mutation
  const createMut = useMutation({
    mutationFn: (data) => admissionsApi.createEnquiry(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      queryClient.invalidateQueries({ queryKey: ['admissionPipeline'] })
      showSuccess('Enquiry created successfully!')
      const newId = res?.data?.id
      if (newId) {
        navigate(`/admissions/enquiries/${newId}`)
      } else {
        navigate('/admissions/enquiries')
      }
    },
    onError: (err) => {
      const data = err.response?.data
      if (data && typeof data === 'object') {
        setErrors(data)
      }
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
      navigate(`/admissions/enquiries/${id}`)
    },
    onError: (err) => {
      const data = err.response?.data
      if (data && typeof data === 'object') {
        setErrors(data)
      }
      showError(data?.detail || data?.non_field_errors?.[0] || 'Failed to update enquiry')
    },
  })

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
    // Clear field error on change
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const validate = () => {
    const newErrors = {}
    if (!form.child_name.trim()) newErrors.child_name = 'Child name is required'
    if (!form.parent_name.trim()) newErrors.parent_name = 'Parent name is required'
    if (!form.parent_phone.trim()) newErrors.parent_phone = 'Parent phone is required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!validate()) return

    // Build payload, omitting empty optional fields
    const payload = {}
    Object.entries(form).forEach(([key, value]) => {
      if (key === 'notes' && !isEdit && value.trim()) {
        payload.initial_note = value.trim()
      } else if (key === 'notes') {
        // Skip notes field for edit mode (notes are added separately)
      } else if (value !== '' && value !== null && value !== undefined) {
        payload[key] = value
      }
    })

    // Convert grade_applied to number if present
    if (payload.grade_applied) {
      payload.grade_applied = parseInt(payload.grade_applied)
    }
    if (payload.admission_session) {
      payload.admission_session = parseInt(payload.admission_session)
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
    <div className="max-w-3xl mx-auto">
      {/* Back link */}
      <Link
        to={isEdit ? `/admissions/enquiries/${id}` : '/admissions/enquiries'}
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {isEdit ? 'Back to Enquiry' : 'Back to Enquiries'}
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

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Section: Child Information */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Child Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Child Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.child_name}
                  onChange={(e) => handleChange('child_name', e.target.value)}
                  className={`input w-full ${errors.child_name ? 'border-red-300 focus:ring-red-500' : ''}`}
                  placeholder="Full name of the child"
                />
                {errors.child_name && <p className="text-xs text-red-600 mt-1">{errors.child_name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                <input
                  type="date"
                  value={form.child_dob}
                  onChange={(e) => handleChange('child_dob', e.target.value)}
                  className="input w-full"
                />
                {errors.child_dob && <p className="text-xs text-red-600 mt-1">{errors.child_dob}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Gender</label>
                <select
                  value={form.child_gender}
                  onChange={(e) => handleChange('child_gender', e.target.value)}
                  className="input w-full"
                >
                  <option value="">Select gender...</option>
                  {GENDERS.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
                {errors.child_gender && <p className="text-xs text-red-600 mt-1">{errors.child_gender}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Grade Applied For</label>
                <select
                  value={form.grade_applied}
                  onChange={(e) => handleChange('grade_applied', e.target.value)}
                  className="input w-full"
                >
                  <option value="">Select grade...</option>
                  {grades.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                {errors.grade_applied && <p className="text-xs text-red-600 mt-1">{errors.grade_applied}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Previous School</label>
                <input
                  type="text"
                  value={form.previous_school}
                  onChange={(e) => handleChange('previous_school', e.target.value)}
                  className="input w-full"
                  placeholder="Name of previous school"
                />
                {errors.previous_school && <p className="text-xs text-red-600 mt-1">{errors.previous_school}</p>}
              </div>
            </div>
          </div>

          {/* Section: Parent Information */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Parent / Guardian Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Parent Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.parent_name}
                  onChange={(e) => handleChange('parent_name', e.target.value)}
                  className={`input w-full ${errors.parent_name ? 'border-red-300 focus:ring-red-500' : ''}`}
                  placeholder="Full name"
                />
                {errors.parent_name && <p className="text-xs text-red-600 mt-1">{errors.parent_name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.parent_phone}
                  onChange={(e) => handleChange('parent_phone', e.target.value)}
                  className={`input w-full ${errors.parent_phone ? 'border-red-300 focus:ring-red-500' : ''}`}
                  placeholder="0300-1234567"
                />
                {errors.parent_phone && <p className="text-xs text-red-600 mt-1">{errors.parent_phone}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.parent_email}
                  onChange={(e) => handleChange('parent_email', e.target.value)}
                  className="input w-full"
                  placeholder="parent@example.com"
                />
                {errors.parent_email && <p className="text-xs text-red-600 mt-1">{errors.parent_email}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Occupation</label>
                <input
                  type="text"
                  value={form.parent_occupation}
                  onChange={(e) => handleChange('parent_occupation', e.target.value)}
                  className="input w-full"
                  placeholder="e.g. Engineer, Doctor"
                />
                {errors.parent_occupation && <p className="text-xs text-red-600 mt-1">{errors.parent_occupation}</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea
                  value={form.address}
                  onChange={(e) => handleChange('address', e.target.value)}
                  className="input w-full min-h-[60px]"
                  placeholder="Full address"
                  rows={2}
                />
                {errors.address && <p className="text-xs text-red-600 mt-1">{errors.address}</p>}
              </div>
            </div>
          </div>

          {/* Section: Lead Information */}
          <div>
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Lead Information
            </h2>
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
                {errors.source && <p className="text-xs text-red-600 mt-1">{errors.source}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Referral Details</label>
                <input
                  type="text"
                  value={form.referral_details}
                  onChange={(e) => handleChange('referral_details', e.target.value)}
                  className="input w-full"
                  placeholder="If referral, who referred?"
                />
                {errors.referral_details && <p className="text-xs text-red-600 mt-1">{errors.referral_details}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                <select
                  value={form.priority}
                  onChange={(e) => handleChange('priority', e.target.value)}
                  className="input w-full"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                {errors.priority && <p className="text-xs text-red-600 mt-1">{errors.priority}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Admission Session</label>
                <select
                  value={form.admission_session}
                  onChange={(e) => handleChange('admission_session', e.target.value)}
                  className="input w-full"
                >
                  <option value="">Select session...</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {errors.admission_session && <p className="text-xs text-red-600 mt-1">{errors.admission_session}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Next Followup Date</label>
                <input
                  type="date"
                  value={form.next_followup_date}
                  onChange={(e) => handleChange('next_followup_date', e.target.value)}
                  className="input w-full"
                />
                {errors.next_followup_date && <p className="text-xs text-red-600 mt-1">{errors.next_followup_date}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assigned To</label>
                <input
                  type="text"
                  value={form.assigned_to}
                  onChange={(e) => handleChange('assigned_to', e.target.value)}
                  className="input w-full"
                  placeholder="Staff member ID or name"
                />
                {errors.assigned_to && <p className="text-xs text-red-600 mt-1">{errors.assigned_to}</p>}
              </div>
              {!isEdit && (
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Initial Notes</label>
                  <textarea
                    value={form.notes}
                    onChange={(e) => handleChange('notes', e.target.value)}
                    className="input w-full min-h-[80px]"
                    placeholder="Any initial notes about this enquiry..."
                    rows={3}
                  />
                  {errors.notes && <p className="text-xs text-red-600 mt-1">{errors.notes}</p>}
                </div>
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <Link
              to={isEdit ? `/admissions/enquiries/${id}` : '/admissions/enquiries'}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg font-medium"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
            >
              {isPending
                ? 'Saving...'
                : isEdit
                  ? 'Update Enquiry'
                  : 'Create Enquiry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
