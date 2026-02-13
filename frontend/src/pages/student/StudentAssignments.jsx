import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'

const TYPE_COLORS = {
  HOMEWORK: 'bg-blue-100 text-blue-800',
  PROJECT: 'bg-purple-100 text-purple-800',
  TEST: 'bg-red-100 text-red-800',
  QUIZ: 'bg-amber-100 text-amber-800',
  LAB: 'bg-green-100 text-green-800',
  CLASSWORK: 'bg-cyan-100 text-cyan-800',
}

const SUBMISSION_STATUS = {
  NOT_SUBMITTED: { label: 'Not Submitted', cls: 'bg-gray-100 text-gray-800' },
  SUBMITTED: { label: 'Submitted', cls: 'bg-green-100 text-green-800' },
  LATE: { label: 'Late', cls: 'bg-yellow-100 text-yellow-800' },
  GRADED: { label: 'Graded', cls: 'bg-blue-100 text-blue-800' },
}

export default function StudentAssignments() {
  const queryClient = useQueryClient()
  const [showModal, setShowModal] = useState(false)
  const [selectedAssignment, setSelectedAssignment] = useState(null)
  const [submissionText, setSubmissionText] = useState('')
  const [fileUrl, setFileUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const { data: assignmentsData, isLoading, error } = useQuery({
    queryKey: ['studentAssignments'],
    queryFn: () => studentPortalApi.getAssignments(),
  })

  const submitMutation = useMutation({
    mutationFn: ({ assignmentId, data }) => studentPortalApi.submitAssignment(assignmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studentAssignments'] })
      setShowModal(false)
      setSubmissionText('')
      setFileUrl('')
      setFileName('')
      setSelectedAssignment(null)
      setSuccessMsg('Assignment submitted successfully!')
      setTimeout(() => setSuccessMsg(''), 4000)
    },
  })

  const assignments = assignmentsData?.data?.results || assignmentsData?.data || []

  const isOverdue = (dueDate) => {
    if (!dueDate) return false
    return new Date(dueDate) < new Date()
  }

  const getSubmissionStatus = (assignment) => {
    if (assignment.submission_status) return assignment.submission_status
    if (assignment.submission) {
      if (assignment.submission.marks != null) return 'GRADED'
      if (assignment.submission.is_late) return 'LATE'
      return 'SUBMITTED'
    }
    return 'NOT_SUBMITTED'
  }

  const openSubmitModal = (assignment) => {
    setSelectedAssignment(assignment)
    setSubmissionText('')
    setFileUrl('')
    setFileName('')
    setShowModal(true)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!selectedAssignment) return

    submitMutation.mutate({
      assignmentId: selectedAssignment.id,
      data: {
        submission_text: submissionText,
        file_url: fileUrl || undefined,
        file_name: fileName || undefined,
      },
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load assignments</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Assignments</h1>
        <p className="text-sm text-gray-500 mt-1">View and submit your assignments</p>
      </div>

      {/* Success Message */}
      {successMsg && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-green-800">{successMsg}</p>
        </div>
      )}

      {/* Assignments List */}
      {assignments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <h3 className="text-base font-medium text-gray-900 mb-1">No assignments yet</h3>
          <p className="text-sm text-gray-500">Assignments will appear here when your teachers create them.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map((assignment, idx) => {
            const subStatus = getSubmissionStatus(assignment)
            const statusInfo = SUBMISSION_STATUS[subStatus] || SUBMISSION_STATUS.NOT_SUBMITTED
            const overdue = isOverdue(assignment.due_date) && subStatus === 'NOT_SUBMITTED'

            return (
              <div
                key={assignment.id || idx}
                className={`bg-white rounded-xl border p-4 sm:p-5 transition-all ${
                  overdue ? 'border-red-300 bg-red-50/30' : 'border-gray-200'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  {/* Left: Assignment Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-gray-900">{assignment.title}</h3>
                      {assignment.type && (
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${TYPE_COLORS[assignment.type] || 'bg-gray-100 text-gray-800'}`}>
                          {assignment.type}
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusInfo.cls}`}>
                        {statusInfo.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                      {assignment.subject_name && (
                        <span className="flex items-center gap-1">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                          {assignment.subject_name}
                        </span>
                      )}
                      {assignment.due_date && (
                        <span className={`flex items-center gap-1 ${overdue ? 'text-red-600 font-medium' : ''}`}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          Due: {new Date(assignment.due_date).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric'
                          })}
                          {overdue && ' (Overdue)'}
                        </span>
                      )}
                      {assignment.total_marks != null && (
                        <span>Marks: {assignment.total_marks}</span>
                      )}
                    </div>

                    {assignment.description && (
                      <p className="text-xs text-gray-500 mt-2 line-clamp-2">{assignment.description}</p>
                    )}

                    {/* Graded feedback */}
                    {subStatus === 'GRADED' && assignment.submission && (
                      <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <div className="flex items-center gap-3">
                          {assignment.submission.marks != null && (
                            <div>
                              <span className="text-xs text-blue-600">Marks:</span>{' '}
                              <span className="text-sm font-bold text-blue-800">
                                {assignment.submission.marks}
                                {assignment.total_marks ? ` / ${assignment.total_marks}` : ''}
                              </span>
                            </div>
                          )}
                        </div>
                        {assignment.submission.feedback && (
                          <p className="text-xs text-blue-700 mt-2">
                            <span className="font-medium">Feedback:</span> {assignment.submission.feedback}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Action Button */}
                  <div className="flex-shrink-0">
                    {subStatus === 'NOT_SUBMITTED' && (
                      <button
                        onClick={() => openSubmitModal(assignment)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                      >
                        Submit
                      </button>
                    )}
                    {subStatus === 'SUBMITTED' && (
                      <div className="flex items-center gap-1.5 text-green-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-xs font-medium">Submitted</span>
                      </div>
                    )}
                    {subStatus === 'LATE' && (
                      <div className="flex items-center gap-1.5 text-yellow-600">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-xs font-medium">Late Submission</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Submit Modal */}
      {showModal && selectedAssignment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">Submit Assignment</h3>
                <p className="text-sm text-gray-500 mt-0.5">{selectedAssignment.title}</p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Submission Text <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={submissionText}
                  onChange={(e) => setSubmissionText(e.target.value)}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                  placeholder="Write your answer or submission notes here..."
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  File URL (optional)
                </label>
                <input
                  type="text"
                  value={fileUrl}
                  onChange={(e) => setFileUrl(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="https://drive.google.com/..."
                />
                <p className="text-xs text-gray-400 mt-1">Link to your file on Google Drive, OneDrive, etc.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  File Name (optional)
                </label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="my-assignment.pdf"
                />
              </div>

              {/* Error */}
              {submitMutation.isError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm text-red-700">
                    {submitMutation.error?.response?.data?.detail || submitMutation.error?.message || 'Failed to submit. Please try again.'}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitMutation.isPending || !submissionText.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {submitMutation.isPending && (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  )}
                  {submitMutation.isPending ? 'Submitting...' : 'Submit Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
