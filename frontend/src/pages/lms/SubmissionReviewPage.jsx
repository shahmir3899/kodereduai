import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { lmsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'

const STATUS_BADGES = {
  SUBMITTED: 'bg-blue-100 text-blue-800',
  LATE: 'bg-orange-100 text-orange-800',
  GRADED: 'bg-green-100 text-green-800',
  RETURNED: 'bg-purple-100 text-purple-800',
  PENDING: 'bg-gray-100 text-gray-800',
}

export default function SubmissionReviewPage() {
  const { id: assignmentId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const [gradingId, setGradingId] = useState(null)
  const [gradeForm, setGradeForm] = useState({ marks_obtained: '', feedback: '' })

  // -- Fetch assignment details --

  const { data: assignmentData, isLoading: assignmentLoading } = useQuery({
    queryKey: ['assignment', assignmentId],
    queryFn: () => lmsApi.getAssignment(assignmentId),
    enabled: !!assignmentId,
  })

  const assignment = assignmentData?.data || null

  // -- Fetch submissions --

  const { data: submissionsData, isLoading: submissionsLoading } = useQuery({
    queryKey: ['submissions', assignmentId],
    queryFn: () => lmsApi.getSubmissions({ assignment: assignmentId, page_size: 9999 }),
    enabled: !!assignmentId,
  })

  const submissions = submissionsData?.data?.results || submissionsData?.data || []

  // -- Summary stats --

  const stats = useMemo(() => {
    const total = submissions.length
    const submitted = submissions.filter(
      (s) => s.status === 'SUBMITTED' || s.status === 'LATE'
    ).length
    const graded = submissions.filter((s) => s.status === 'GRADED').length
    const returned = submissions.filter((s) => s.status === 'RETURNED').length
    const pending = submissions.filter((s) => s.status === 'PENDING').length
    const late = submissions.filter((s) => s.status === 'LATE').length
    return { total, submitted, graded, returned, pending, late }
  }, [submissions])

  // -- Mutations --

  const gradeMutation = useMutation({
    mutationFn: ({ id, data }) => lmsApi.gradeSubmission(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions', assignmentId] })
      setGradingId(null)
      setGradeForm({ marks_obtained: '', feedback: '' })
      showSuccess('Submission graded successfully!')
    },
    onError: (error) => {
      showError(
        error.response?.data?.detail ||
          error.response?.data?.marks_obtained?.[0] ||
          'Failed to grade submission'
      )
    },
  })

  const returnMutation = useMutation({
    mutationFn: (id) => lmsApi.returnSubmission(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions', assignmentId] })
      showSuccess('Submission returned to student!')
    },
    onError: (error) => {
      showError(error.response?.data?.detail || 'Failed to return submission')
    },
  })

  // -- Handlers --

  const startGrading = (submission) => {
    setGradingId(submission.id)
    setGradeForm({
      marks_obtained: submission.marks_obtained ?? '',
      feedback: submission.feedback || '',
    })
  }

  const cancelGrading = () => {
    setGradingId(null)
    setGradeForm({ marks_obtained: '', feedback: '' })
  }

  const handleGradeSubmit = () => {
    if (gradeForm.marks_obtained === '' || gradeForm.marks_obtained === null) {
      showError('Please enter marks')
      return
    }
    const marks = parseFloat(gradeForm.marks_obtained)
    if (isNaN(marks) || marks < 0) {
      showError('Marks must be a non-negative number')
      return
    }
    if (assignment?.total_marks && marks > assignment.total_marks) {
      showError(`Marks cannot exceed total marks (${assignment.total_marks})`)
      return
    }
    gradeMutation.mutate({
      id: gradingId,
      data: {
        marks_obtained: marks,
        feedback: gradeForm.feedback,
      },
    })
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '--'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  const truncateText = (text, maxLen = 80) => {
    if (!text) return '--'
    if (text.length <= maxLen) return text
    return text.substring(0, maxLen) + '...'
  }

  const isLoading = assignmentLoading || submissionsLoading

  return (
    <div>
      {/* Back navigation + Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-primary-600 hover:text-primary-800 font-medium mb-3 inline-flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Assignments
        </button>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Submission Review</h1>
        <p className="text-sm text-gray-600">Grade and review student submissions</p>
      </div>

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
          <p className="text-gray-500 mt-2">Loading...</p>
        </div>
      ) : !assignment ? (
        <div className="card text-center py-8 text-gray-500">
          Assignment not found. It may have been deleted.
        </div>
      ) : (
        <>
          {/* Assignment Details Card */}
          <div className="card mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Assignment</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">{assignment.title}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Class / Subject</p>
                <p className="text-sm text-gray-900 mt-1">
                  {assignment.class_name || '--'} / {assignment.subject_name || '--'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Due Date</p>
                <p className="text-sm text-gray-900 mt-1">
                  {assignment.due_date
                    ? new Date(assignment.due_date).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : '--'}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase">Total Marks</p>
                <p className="text-sm font-semibold text-gray-900 mt-1">
                  {assignment.total_marks ?? '--'}
                </p>
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 mb-6">
            <div className="card !p-4 text-center">
              <p className="text-xs font-medium text-gray-500 uppercase">Total</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
            </div>
            <div className="card !p-4 text-center">
              <p className="text-xs font-medium text-gray-500 uppercase">Submitted</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">{stats.submitted}</p>
            </div>
            <div className="card !p-4 text-center">
              <p className="text-xs font-medium text-gray-500 uppercase">Graded</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{stats.graded}</p>
            </div>
            <div className="card !p-4 text-center">
              <p className="text-xs font-medium text-gray-500 uppercase">Returned</p>
              <p className="text-2xl font-bold text-purple-600 mt-1">{stats.returned}</p>
            </div>
            <div className="card !p-4 text-center">
              <p className="text-xs font-medium text-gray-500 uppercase">Pending</p>
              <p className="text-2xl font-bold text-gray-400 mt-1">{stats.pending}</p>
            </div>
            <div className="card !p-4 text-center">
              <p className="text-xs font-medium text-gray-500 uppercase">Late</p>
              <p className="text-2xl font-bold text-orange-600 mt-1">{stats.late}</p>
            </div>
          </div>

          {/* Submissions Table */}
          <div className="card">
            {submissions.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No submissions received yet for this assignment.
              </div>
            ) : (
              <>
                {/* Mobile card view */}
                <div className="sm:hidden space-y-3">
                  {submissions.map((sub) => (
                    <div key={sub.id} className="p-3 border border-gray-200 rounded-lg">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm text-gray-900">
                            {sub.student_name || `Student #${sub.student}`}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            Submitted: {formatDate(sub.submitted_at)}
                          </p>
                        </div>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                            STATUS_BADGES[sub.status] || STATUS_BADGES.PENDING
                          }`}
                        >
                          {sub.status}
                        </span>
                      </div>

                      {sub.submission_text && (
                        <p className="text-xs text-gray-600 mt-2 bg-gray-50 p-2 rounded">
                          {truncateText(sub.submission_text, 120)}
                        </p>
                      )}

                      {sub.file_url && (
                        <a
                          href={sub.file_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium mt-1 inline-block"
                        >
                          View Attachment
                        </a>
                      )}

                      {sub.marks_obtained !== null && sub.marks_obtained !== undefined && (
                        <p className="text-xs text-gray-700 mt-1">
                          Marks: <span className="font-semibold">{sub.marks_obtained}</span>
                          {assignment.total_marks ? ` / ${assignment.total_marks}` : ''}
                        </p>
                      )}

                      {sub.feedback && (
                        <p className="text-xs text-gray-500 mt-1 italic">
                          Feedback: {truncateText(sub.feedback, 100)}
                        </p>
                      )}

                      {/* Inline grading for mobile */}
                      {gradingId === sub.id ? (
                        <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
                          <div>
                            <label className="text-xs font-medium text-gray-600">Marks</label>
                            <input
                              type="number"
                              className="input mt-1"
                              min="0"
                              max={assignment.total_marks || undefined}
                              placeholder={`Out of ${assignment.total_marks || '?'}`}
                              value={gradeForm.marks_obtained}
                              onChange={(e) =>
                                setGradeForm({ ...gradeForm, marks_obtained: e.target.value })
                              }
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600">Feedback</label>
                            <textarea
                              className="input mt-1"
                              rows={2}
                              placeholder="Feedback for the student..."
                              value={gradeForm.feedback}
                              onChange={(e) =>
                                setGradeForm({ ...gradeForm, feedback: e.target.value })
                              }
                            />
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={handleGradeSubmit}
                              disabled={gradeMutation.isPending}
                              className="btn btn-primary text-xs"
                            >
                              {gradeMutation.isPending ? 'Saving...' : 'Save Grade'}
                            </button>
                            <button onClick={cancelGrading} className="btn btn-secondary text-xs">
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                          <button
                            onClick={() => startGrading(sub)}
                            className="text-xs text-blue-600 font-medium"
                          >
                            {sub.status === 'GRADED' ? 'Re-grade' : 'Grade'}
                          </button>
                          {sub.status === 'GRADED' && (
                            <button
                              onClick={() => returnMutation.mutate(sub.id)}
                              disabled={returnMutation.isPending}
                              className="text-xs text-purple-600 font-medium"
                            >
                              Return
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Desktop table view */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Student
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Submitted At
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Submission
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          File
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Marks
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          Feedback
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {submissions.map((sub) => (
                        <tr key={sub.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {sub.student_name || `Student #${sub.student}`}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatDate(sub.submitted_at)}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`px-2 py-1 rounded-full text-xs font-medium ${
                                STATUS_BADGES[sub.status] || STATUS_BADGES.PENDING
                              }`}
                            >
                              {sub.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px]">
                            <span title={sub.submission_text || ''}>
                              {truncateText(sub.submission_text)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {sub.file_url ? (
                              <a
                                href={sub.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-600 hover:text-primary-800 font-medium"
                              >
                                View
                              </a>
                            ) : (
                              <span className="text-gray-400">--</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {/* Inline grade editing */}
                            {gradingId === sub.id ? (
                              <input
                                type="number"
                                className="input w-20"
                                min="0"
                                max={assignment.total_marks || undefined}
                                value={gradeForm.marks_obtained}
                                onChange={(e) =>
                                  setGradeForm({ ...gradeForm, marks_obtained: e.target.value })
                                }
                              />
                            ) : sub.marks_obtained !== null && sub.marks_obtained !== undefined ? (
                              <span className="font-semibold">
                                {sub.marks_obtained}
                                {assignment.total_marks ? ` / ${assignment.total_marks}` : ''}
                              </span>
                            ) : (
                              <span className="text-gray-400">--</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 max-w-[180px]">
                            {gradingId === sub.id ? (
                              <textarea
                                className="input w-full"
                                rows={2}
                                placeholder="Feedback..."
                                value={gradeForm.feedback}
                                onChange={(e) =>
                                  setGradeForm({ ...gradeForm, feedback: e.target.value })
                                }
                              />
                            ) : (
                              <span title={sub.feedback || ''}>
                                {truncateText(sub.feedback, 50)}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {gradingId === sub.id ? (
                              <div className="flex justify-end gap-2">
                                <button
                                  onClick={handleGradeSubmit}
                                  disabled={gradeMutation.isPending}
                                  className="text-sm text-green-600 hover:text-green-800 font-medium"
                                >
                                  {gradeMutation.isPending ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={cancelGrading}
                                  className="text-sm text-gray-600 hover:text-gray-800 font-medium"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <div className="flex justify-end gap-3">
                                <button
                                  onClick={() => startGrading(sub)}
                                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                                >
                                  {sub.status === 'GRADED' ? 'Re-grade' : 'Grade'}
                                </button>
                                {sub.status === 'GRADED' && (
                                  <button
                                    onClick={() => returnMutation.mutate(sub.id)}
                                    disabled={returnMutation.isPending}
                                    className="text-sm text-purple-600 hover:text-purple-800 font-medium"
                                  >
                                    Return
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
