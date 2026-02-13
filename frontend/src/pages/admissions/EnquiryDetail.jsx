import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { admissionsApi, classesApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { GRADE_LEVEL_LABELS } from '../../constants/gradePresets'

const ALL_STAGES_ORDERED = [
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'VISIT_SCHEDULED', label: 'Visit Scheduled' },
  { key: 'VISIT_DONE', label: 'Visit Done' },
  { key: 'FORM_SUBMITTED', label: 'Form Submitted' },
  { key: 'TEST_SCHEDULED', label: 'Test Scheduled' },
  { key: 'TEST_DONE', label: 'Test Done' },
  { key: 'OFFERED', label: 'Offered' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'ENROLLED', label: 'Enrolled' },
]

const TERMINAL_STAGES = ['REJECTED', 'WITHDRAWN', 'LOST']

const STAGE_BADGE_COLORS = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-indigo-100 text-indigo-800',
  VISIT_SCHEDULED: 'bg-purple-100 text-purple-800',
  VISIT_DONE: 'bg-purple-100 text-purple-800',
  FORM_SUBMITTED: 'bg-orange-100 text-orange-800',
  TEST_SCHEDULED: 'bg-amber-100 text-amber-800',
  TEST_DONE: 'bg-amber-100 text-amber-800',
  OFFERED: 'bg-emerald-100 text-emerald-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  ENROLLED: 'bg-teal-100 text-teal-800',
  REJECTED: 'bg-red-100 text-red-800',
  WITHDRAWN: 'bg-gray-100 text-gray-800',
  LOST: 'bg-gray-100 text-gray-600',
}

const STAGE_TIMELINE_COLORS = {
  completed: 'bg-green-500 border-green-500',
  current: 'bg-primary-500 border-primary-500 ring-4 ring-primary-100',
  pending: 'bg-gray-200 border-gray-300',
}

const PRIORITY_BADGE = {
  HIGH: 'bg-red-100 text-red-700',
  MEDIUM: 'bg-amber-100 text-amber-700',
  LOW: 'bg-green-100 text-green-700',
}

export default function EnquiryDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const [showNoteForm, setShowNoteForm] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [showConvertModal, setShowConvertModal] = useState(false)
  const [convertForm, setConvertForm] = useState({ class_id: '', roll_number: '' })

  // Main enquiry data
  const { data: enquiryRes, isLoading, error } = useQuery({
    queryKey: ['enquiry', id],
    queryFn: () => admissionsApi.getEnquiry(id),
  })

  // Notes
  const { data: notesRes } = useQuery({
    queryKey: ['enquiryNotes', id],
    queryFn: () => admissionsApi.getNotes(id),
    enabled: !!id,
  })

  // Documents
  const { data: docsRes, refetch: refetchDocs } = useQuery({
    queryKey: ['enquiryDocuments', id],
    queryFn: () => admissionsApi.getDocuments(id),
    enabled: !!id,
  })

  // Classes for convert modal
  const { data: classesRes } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses(),
    enabled: showConvertModal,
    staleTime: 5 * 60 * 1000,
  })

  const enquiry = enquiryRes?.data
  const notes = notesRes?.data?.results || notesRes?.data || []
  const docs = docsRes?.data?.results || docsRes?.data || []
  const classes = classesRes?.data?.results || classesRes?.data || []

  // Stage update mutation
  const stageUpdateMut = useMutation({
    mutationFn: (stage) => admissionsApi.updateStage(id, { stage }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiry', id] })
      queryClient.invalidateQueries({ queryKey: ['enquiryNotes', id] })
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      queryClient.invalidateQueries({ queryKey: ['admissionPipeline'] })
      showSuccess('Stage updated successfully')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to update stage')
    },
  })

  // Add note mutation
  const addNoteMut = useMutation({
    mutationFn: (data) => admissionsApi.addNote(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiryNotes', id] })
      setNoteText('')
      setShowNoteForm(false)
      showSuccess('Note added')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to add note')
    },
  })

  // Convert to student mutation
  const convertMut = useMutation({
    mutationFn: (data) => admissionsApi.convertToStudent(id, data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['enquiry', id] })
      queryClient.invalidateQueries({ queryKey: ['enquiries'] })
      queryClient.invalidateQueries({ queryKey: ['students'] })
      setShowConvertModal(false)
      showSuccess('Enquiry converted to student successfully!')
      // Navigate to the new student if ID is returned
      if (res?.data?.student_id) {
        navigate(`/students/${res.data.student_id}`)
      }
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to convert to student')
    },
  })

  // Document upload
  const uploadDocMut = useMutation({
    mutationFn: (formData) => admissionsApi.uploadDocument(id, formData),
    onSuccess: () => {
      refetchDocs()
      showSuccess('Document uploaded')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to upload document')
    },
  })

  // Delete document
  const deleteDocMut = useMutation({
    mutationFn: (docId) => admissionsApi.deleteDocument(docId),
    onSuccess: () => {
      refetchDocs()
      showSuccess('Document deleted')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to delete document')
    },
  })

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const formData = new FormData()
    formData.append('file', file)
    formData.append('name', file.name)
    uploadDocMut.mutate(formData)
    e.target.value = ''
  }

  const handleAddNote = () => {
    if (!noteText.trim()) return
    addNoteMut.mutate({ content: noteText.trim() })
  }

  const getNextStage = () => {
    if (!enquiry) return null
    const idx = ALL_STAGES_ORDERED.findIndex((s) => s.key === enquiry.stage)
    if (idx === -1 || idx >= ALL_STAGES_ORDERED.length - 1) return null
    return ALL_STAGES_ORDERED[idx + 1]
  }

  const currentStageIndex = enquiry ? ALL_STAGES_ORDERED.findIndex((s) => s.key === enquiry.stage) : -1
  const isTerminal = enquiry ? TERMINAL_STAGES.includes(enquiry.stage) : false
  const nextStage = getNextStage()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error || !enquiry) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-3">Enquiry not found</p>
        <Link to="/admissions/enquiries" className="text-sm text-primary-600 hover:text-primary-700 font-medium">
          Back to Enquiries
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/admissions/enquiries" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Enquiries
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{enquiry.child_name}</h1>
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${STAGE_BADGE_COLORS[enquiry.stage] || 'bg-gray-100 text-gray-700'}`}>
                {(enquiry.stage || '').replace(/_/g, ' ')}
              </span>
              {enquiry.priority && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_BADGE[enquiry.priority] || 'bg-gray-100 text-gray-700'}`}>
                  {enquiry.priority}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-500 mt-1">
              Source: <span className="capitalize">{(enquiry.source || 'N/A').replace(/_/g, ' ').toLowerCase()}</span>
              {enquiry.referral_details && <span> ({enquiry.referral_details})</span>}
              {' | '}Created: {enquiry.created_at ? new Date(enquiry.created_at).toLocaleDateString() : 'N/A'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/admissions/enquiries/${id}/edit`}
              className="inline-flex items-center px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 font-medium text-gray-700"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              Edit
            </Link>
          </div>
        </div>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Child Information */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              Child Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoField label="Full Name" value={enquiry.child_name} />
              <InfoField label="Date of Birth" value={enquiry.child_dob || 'Not provided'} />
              <InfoField label="Gender" value={enquiry.child_gender ? enquiry.child_gender.charAt(0).toUpperCase() + enquiry.child_gender.slice(1).toLowerCase() : 'Not provided'} />
              <InfoField label="Grade Applied" value={GRADE_LEVEL_LABELS[enquiry.applying_for_grade_level] || 'Not specified'} />
              <InfoField label="Previous School" value={enquiry.previous_school || 'Not provided'} className="sm:col-span-2" />
            </div>
          </div>

          {/* Parent Information */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Parent / Guardian Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <InfoField label="Parent Name" value={enquiry.parent_name} />
              <InfoField label="Phone" value={enquiry.parent_phone} />
              <InfoField label="Email" value={enquiry.parent_email || 'Not provided'} />
              <InfoField label="Occupation" value={enquiry.parent_occupation || 'Not provided'} />
              <InfoField label="Address" value={enquiry.address || 'Not provided'} className="sm:col-span-2" />
            </div>
          </div>

          {/* Documents */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Documents
              </h2>
              <label className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 cursor-pointer transition-colors">
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload
                <input type="file" className="hidden" onChange={handleFileUpload} />
              </label>
            </div>

            {docs.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">No documents uploaded yet</p>
            ) : (
              <div className="space-y-2">
                {docs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                      <div className="min-w-0">
                        <p className="text-sm text-gray-900 truncate">{doc.name || doc.file_name || 'Document'}</p>
                        {doc.created_at && (
                          <p className="text-xs text-gray-400">{new Date(doc.created_at).toLocaleDateString()}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {doc.file && (
                        <a href={doc.file} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-primary-600">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                        </a>
                      )}
                      <button
                        onClick={() => { if (confirm('Delete this document?')) deleteDocMut.mutate(doc.id) }}
                        className="p-1.5 text-gray-400 hover:text-red-600"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Activity Timeline */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Activity Timeline
              </h2>
              <button
                onClick={() => setShowNoteForm(!showNoteForm)}
                className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-primary-600 bg-primary-50 border border-primary-200 rounded-lg hover:bg-primary-100 transition-colors"
              >
                <svg className="w-3.5 h-3.5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Note
              </button>
            </div>

            {/* Add note form */}
            {showNoteForm && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  className="input w-full text-sm min-h-[80px]"
                  placeholder="Add a note about this enquiry..."
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={() => { setShowNoteForm(false); setNoteText('') }}
                    className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddNote}
                    disabled={!noteText.trim() || addNoteMut.isPending}
                    className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                  >
                    {addNoteMut.isPending ? 'Saving...' : 'Save Note'}
                  </button>
                </div>
              </div>
            )}

            {/* Timeline entries */}
            {notes.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-6">No activity yet</p>
            ) : (
              <div className="space-y-0">
                {notes.map((note, i) => (
                  <div key={note.id} className="relative flex gap-3">
                    {/* Timeline line */}
                    {i < notes.length - 1 && (
                      <div className="absolute left-[11px] top-6 bottom-0 w-0.5 bg-gray-200" />
                    )}
                    {/* Dot */}
                    <div className={`w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 ${
                      note.note_type === 'STAGE_CHANGE' || note.type === 'stage_change'
                        ? 'bg-primary-100'
                        : 'bg-gray-100'
                    }`}>
                      {note.note_type === 'STAGE_CHANGE' || note.type === 'stage_change' ? (
                        <svg className="w-3 h-3 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      ) : (
                        <svg className="w-3 h-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                        </svg>
                      )}
                    </div>
                    {/* Content */}
                    <div className="pb-4 flex-1 min-w-0">
                      <p className="text-sm text-gray-900">{note.content || note.text}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                        {note.created_by_name && <span>{note.created_by_name}</span>}
                        {note.created_at && (
                          <span>{new Date(note.created_at).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN (1/3) */}
        <div className="space-y-6">
          {/* Quick Actions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              {/* Move to next stage */}
              {nextStage && !isTerminal && (
                <button
                  onClick={() => stageUpdateMut.mutate(nextStage.key)}
                  disabled={stageUpdateMut.isPending}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  {stageUpdateMut.isPending ? 'Moving...' : `Move to ${nextStage.label}`}
                </button>
              )}

              {/* Add note */}
              <button
                onClick={() => setShowNoteForm(true)}
                className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                </svg>
                Add Note
              </button>

              {/* Convert to student - only when ACCEPTED */}
              {enquiry.stage === 'ACCEPTED' && (
                <button
                  onClick={() => setShowConvertModal(true)}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Convert to Student
                </button>
              )}

              {/* Mark as lost/withdrawn */}
              {!isTerminal && enquiry.stage !== 'ENROLLED' && (
                <div className="pt-2 border-t border-gray-100">
                  <div className="flex gap-2">
                    <button
                      onClick={() => { if (confirm('Mark this enquiry as withdrawn?')) stageUpdateMut.mutate('WITHDRAWN') }}
                      className="flex-1 text-xs text-gray-500 hover:text-gray-700 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      Withdrawn
                    </button>
                    <button
                      onClick={() => { if (confirm('Mark this enquiry as lost?')) stageUpdateMut.mutate('LOST') }}
                      className="flex-1 text-xs text-gray-500 hover:text-gray-700 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50"
                    >
                      Lost
                    </button>
                    <button
                      onClick={() => { if (confirm('Mark this enquiry as rejected?')) stageUpdateMut.mutate('REJECTED') }}
                      className="flex-1 text-xs text-red-500 hover:text-red-700 py-1.5 border border-red-200 rounded-lg hover:bg-red-50"
                    >
                      Rejected
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Stage Progression */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Stage Progression</h3>
            <div className="space-y-0">
              {ALL_STAGES_ORDERED.map((stage, i) => {
                let status = 'pending'
                if (currentStageIndex >= 0) {
                  if (i < currentStageIndex) status = 'completed'
                  else if (i === currentStageIndex) status = 'current'
                }
                // For terminal stages, mark as current regardless
                if (isTerminal && stage.key === enquiry.stage) status = 'current'

                return (
                  <div key={stage.key} className="relative flex items-center gap-3">
                    {/* Connector line */}
                    {i < ALL_STAGES_ORDERED.length - 1 && (
                      <div className={`absolute left-[9px] top-5 h-6 w-0.5 ${
                        status === 'completed' || status === 'current' ? 'bg-green-300' : 'bg-gray-200'
                      }`} />
                    )}
                    {/* Dot */}
                    <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      status === 'completed'
                        ? 'bg-green-500 border-green-500'
                        : status === 'current'
                          ? 'bg-primary-500 border-primary-500 ring-2 ring-primary-100'
                          : 'bg-white border-gray-300'
                    }`}>
                      {status === 'completed' && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      {status === 'current' && (
                        <div className="w-2 h-2 bg-white rounded-full" />
                      )}
                    </div>
                    {/* Label */}
                    <span className={`text-xs py-2 ${
                      status === 'current'
                        ? 'font-semibold text-gray-900'
                        : status === 'completed'
                          ? 'text-green-700'
                          : 'text-gray-400'
                    }`}>
                      {stage.label}
                    </span>
                  </div>
                )
              })}

              {/* Show terminal stage if applicable */}
              {isTerminal && (
                <div className="relative flex items-center gap-3 mt-2 pt-2 border-t border-gray-100">
                  <div className="w-5 h-5 rounded-full bg-red-500 border-2 border-red-500 flex-shrink-0 flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <span className="text-xs font-semibold text-red-700">{enquiry.stage.replace(/_/g, ' ')}</span>
                </div>
              )}
            </div>
          </div>

          {/* Lead Details */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Lead Details</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Assigned To</span>
                <span className="text-gray-900 font-medium">{enquiry.assigned_to_name || 'Unassigned'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Next Followup</span>
                <span className={`font-medium ${
                  enquiry.next_followup_date && new Date(enquiry.next_followup_date) < new Date()
                    ? 'text-red-600'
                    : 'text-gray-900'
                }`}>
                  {enquiry.next_followup_date || 'Not set'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Session</span>
                <span className="text-gray-900 font-medium">{enquiry.admission_session_name || 'N/A'}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Convert to Student Modal */}
      {showConvertModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowConvertModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Convert to Student</h2>
              <button onClick={() => setShowConvertModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Convert <strong>{enquiry.child_name}</strong> to an enrolled student. This will create a student record and mark this enquiry as Enrolled.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
                <select
                  value={convertForm.class_id}
                  onChange={(e) => setConvertForm({ ...convertForm, class_id: e.target.value })}
                  className="input w-full"
                  required
                >
                  <option value="">Select a class...</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Roll Number</label>
                <input
                  type="text"
                  value={convertForm.roll_number}
                  onChange={(e) => setConvertForm({ ...convertForm, roll_number: e.target.value })}
                  className="input w-full"
                  placeholder="Enter roll number"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowConvertModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={() => convertMut.mutate(convertForm)}
                disabled={!convertForm.class_id || convertMut.isPending}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {convertMut.isPending ? 'Converting...' : 'Convert to Student'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Helper component for info fields
function InfoField({ label, value, className = '' }) {
  return (
    <div className={className}>
      <p className="text-xs font-medium text-gray-500 uppercase mb-0.5">{label}</p>
      <p className="text-sm text-gray-900">{value}</p>
    </div>
  )
}
