import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch'
import { attendanceApi, studentsApi } from '../services/api'

export default function AttendanceReviewPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedAbsent, setSelectedAbsent] = useState(new Set())
  const [nameCorrections, setNameCorrections] = useState({})  // {studentId: true/false}
  const [rollCorrections, setRollCorrections] = useState({})  // {studentId: true/false}
  const [showPreviewModal, setShowPreviewModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null) // Upload ID to delete
  const [reprocessing, setReprocessing] = useState(false)
  const [reprocessError, setReprocessError] = useState('')
  const [reprocessSuccess, setReprocessSuccess] = useState('')
  const [currentPage, setCurrentPage] = useState(1)

  // Fetch pending reviews list
  const { data: pendingList, isLoading: listLoading } = useQuery({
    queryKey: ['pendingReviews'],
    queryFn: () => attendanceApi.getPendingReviews(),
    enabled: !id,
  })

  // Fetch specific upload details
  const { data: uploadData, isLoading: detailLoading } = useQuery({
    queryKey: ['uploadDetail', id],
    queryFn: () => attendanceApi.getUploadDetails(id),
    enabled: !!id,
  })

  const upload = uploadData?.data

  // Fetch all students in the class for manual selection
  const { data: studentsData } = useQuery({
    queryKey: ['classStudents', upload?.class_obj],
    queryFn: () => studentsApi.getStudents({ class_id: upload?.class_obj, is_active: true }),
    enabled: !!upload?.class_obj,
  })

  const allStudents = studentsData?.data?.results || []

  // Initialize selected absent from AI results
  useEffect(() => {
    if (upload?.ai_output_json?.matched) {
      const absentIds = new Set(
        upload.ai_output_json.matched.map((m) => m.student_id)
      )
      setSelectedAbsent(absentIds)
    }
  }, [upload])

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: () => attendanceApi.confirmAttendance(id, {
      absentStudentIds: Array.from(selectedAbsent),
      nameCorrections: Object.entries(nameCorrections).map(([sid, confirmed]) => ({
        student_id: parseInt(sid),
        confirmed,
      })),
      rollCorrections: Object.entries(rollCorrections).map(([sid, confirmed]) => ({
        student_id: parseInt(sid),
        confirmed,
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['pendingReviews'])
      queryClient.invalidateQueries(['uploadDetail', id])
      navigate('/dashboard')
    },
  })

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (uploadId) => attendanceApi.deleteUpload(uploadId),
    onSuccess: () => {
      queryClient.invalidateQueries(['pendingReviews'])
      setShowDeleteConfirm(null)
      if (id) {
        navigate('/attendance/review')
      }
    },
  })

  // Reprocess AI handler
  const handleReprocess = async () => {
    setReprocessing(true)
    setReprocessError('')
    setReprocessSuccess('')
    try {
      const response = await attendanceApi.reprocessUpload(id)
      setReprocessSuccess(`AI reprocessing complete! Found ${response.data.matched_count || 0} absent students.`)
      queryClient.invalidateQueries(['uploadDetail', id])
    } catch (err) {
      setReprocessError(err.response?.data?.error || 'Failed to reprocess with AI')
    } finally {
      setReprocessing(false)
    }
  }

  // Show list view if no ID
  if (!id) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Review Attendance</h1>
          <p className="text-sm sm:text-base text-gray-600">Review and confirm AI-processed attendance uploads</p>
        </div>

        {listLoading ? (
          <div className="card text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="mt-2 text-gray-500">Loading...</p>
          </div>
        ) : pendingList?.data?.length === 0 ? (
          <div className="card text-center py-8">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="mt-2 text-gray-500">No pending reviews</p>
            <Link to="/attendance/upload" className="mt-4 inline-block text-primary-600 hover:text-primary-700">
              Upload new attendance
            </Link>
          </div>
        ) : (
          <div className="grid gap-4">
            {pendingList?.data?.map((item) => (
              <div key={item.id} className="card hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <Link to={`/attendance/review/${item.id}`} className="flex-1">
                    <p className="font-medium text-gray-900">{item.class_name}</p>
                    <p className="text-sm text-gray-500">{item.date}</p>
                  </Link>
                  <div className="flex items-center space-x-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                      item.status === 'REVIEW_REQUIRED'
                        ? 'bg-yellow-100 text-yellow-800'
                        : item.status === 'PROCESSING'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}>
                      {item.status_display}
                    </span>
                    <button
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setShowDeleteConfirm(item.id)
                      }}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete upload"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <Link to={`/attendance/review/${item.id}`}>
                      <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Upload?</h3>
              <p className="text-gray-600 mb-4">
                This will permanently delete this attendance upload. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => deleteMutation.mutate(showDeleteConfirm)}
                  disabled={deleteMutation.isPending}
                  className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                </button>
              </div>
              {deleteMutation.isError && (
                <p className="mt-3 text-sm text-red-600">
                  {deleteMutation.error?.response?.data?.error || 'Failed to delete'}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // Detail view
  if (detailLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!upload) {
    return (
      <div className="card text-center py-8">
        <p className="text-gray-500">Upload not found</p>
        <Link to="/attendance/review" className="mt-2 text-primary-600">
          Back to list
        </Link>
      </div>
    )
  }

  const isConfirmed = upload.status === 'CONFIRMED'
  const matchedStudents = upload.ai_output_json?.matched || []
  const presentStudents = upload.ai_output_json?.present || []
  const unmatchedEntries = upload.ai_output_json?.unmatched || []
  const uncertainStudents = upload.ai_output_json?.uncertain || []
  const pipelineStages = upload.ai_output_json?.pipeline_stages || {}

  // Build a lookup map for AI detection by student_id
  const aiDetectionMap = {}
  matchedStudents.forEach(m => { aiDetectionMap[m.student_id] = { ...m, ai_status: 'ABSENT' } })
  presentStudents.forEach(m => { aiDetectionMap[m.student_id] = { ...m, ai_status: m.status === 'LATE' ? 'LATE' : 'PRESENT' } })
  uncertainStudents.forEach(m => { if (m.student_id) aiDetectionMap[m.student_id] = { ...m, ai_status: 'UNCERTAIN' } })

  // Multi-page support
  const uploadImages = upload.images || []
  const isMultiPage = uploadImages.length > 1
  const totalPages = uploadImages.length || 1

  // Get current image URL (for single page use image_url, for multi-page use page list)
  const getCurrentImageUrl = () => {
    if (uploadImages.length > 0) {
      const img = uploadImages.find(img => img.page_number === currentPage) || uploadImages[0]
      return img?.image_url
    }
    return upload.image_url
  }

  const currentImageUrl = getCurrentImageUrl()

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <Link to="/attendance/review" className="text-primary-600 hover:text-primary-700 text-sm mb-2 inline-flex items-center">
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to list
          </Link>
          <h1 className="text-lg sm:text-2xl font-bold text-gray-900">
            Review: {upload.class_name} - {upload.date}
          </h1>
          <p className="text-sm text-gray-600">
            Confidence: {Math.round((upload.confidence_score || 0) * 100)}%
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <span className={`px-3 py-1 sm:px-4 sm:py-2 rounded-full text-xs sm:text-sm font-medium ${
            upload.status === 'CONFIRMED'
              ? 'bg-green-100 text-green-800'
              : upload.status === 'REVIEW_REQUIRED'
              ? 'bg-yellow-100 text-yellow-800'
              : upload.status === 'PROCESSING'
              ? 'bg-blue-100 text-blue-800'
              : 'bg-gray-100 text-gray-800'
          }`}>
            {upload.status_display}
          </span>
          {!isConfirmed && (
            <>
              <button
                onClick={handleReprocess}
                disabled={reprocessing}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
              >
                {reprocessing ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Processing...
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reprocess AI
                  </>
                )}
              </button>
              <button
                onClick={() => setShowDeleteConfirm(upload.id)}
                className="px-3 py-1.5 sm:px-4 sm:py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal (detail view) */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Upload?</h3>
            <p className="text-gray-600 mb-4">
              This will permanently delete this attendance upload. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(showDeleteConfirm)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
            {deleteMutation.isError && (
              <p className="mt-3 text-sm text-red-600">
                {deleteMutation.error?.response?.data?.error || 'Failed to delete'}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Reprocess Messages */}
      {reprocessError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {reprocessError}
        </div>
      )}
      {reprocessSuccess && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm">
          {reprocessSuccess}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Image Viewer */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Original Register</h2>
              {isMultiPage && (
                <p className="text-sm text-gray-500">{totalPages} pages uploaded</p>
              )}
            </div>
            <button
              onClick={() => setShowPreviewModal(true)}
              className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg flex items-center gap-1"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
              View Full
            </button>
          </div>

          {/* Page Tabs for Multi-Page */}
          {isMultiPage && (
            <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
              {uploadImages.map((img) => (
                <button
                  key={img.id}
                  onClick={() => setCurrentPage(img.page_number)}
                  className={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    currentPage === img.page_number
                      ? 'bg-primary-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  Page {img.page_number}
                  {img.processing_status === 'FAILED' && (
                    <span className="ml-1 text-red-300">!</span>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="border border-gray-200 rounded-lg overflow-hidden bg-gray-100">
            <TransformWrapper key={currentImageUrl}>
              <TransformComponent>
                <img
                  src={currentImageUrl}
                  alt={`Attendance register${isMultiPage ? ` - Page ${currentPage}` : ''}`}
                  className="w-full h-auto"
                />
              </TransformComponent>
            </TransformWrapper>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Scroll to zoom, drag to pan
            {isMultiPage && ` | Page ${currentPage} of ${totalPages}`}
          </p>
        </div>

        {/* Unified Review Table */}
        <div className="card">
          {/* AI Notes */}
          {upload.ai_output_json?.notes && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">AI Notes</h3>
              <p className="text-sm text-gray-600 bg-blue-50 border border-blue-200 p-3 rounded-lg">
                {upload.ai_output_json.notes}
              </p>
            </div>
          )}

          {/* Summary Bar */}
          <div className="mb-4 p-3 bg-gray-100 rounded-lg">
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-gray-700">
                Total: <strong>{allStudents.length}</strong>
              </span>
              <span className="text-blue-600">
                AI matched: <strong>{Object.keys(aiDetectionMap).length}</strong>
              </span>
              <span>
                <span className="text-green-600 font-medium">{allStudents.length - selectedAbsent.size}P</span>
                {' / '}
                <span className="text-red-600 font-medium">{selectedAbsent.size}A</span>
              </span>
              {Object.values(nameCorrections).some(v => v === false) && (
                <span className="text-orange-600">
                  Name rejections: {Object.values(nameCorrections).filter(v => v === false).length}
                </span>
              )}
              {Object.values(rollCorrections).some(v => v === false) && (
                <span className="text-orange-600">
                  Roll rejections: {Object.values(rollCorrections).filter(v => v === false).length}
                </span>
              )}
            </div>
          </div>

          {/* Unified Table */}
          {allStudents.length > 0 ? (
            <>
            {/* Mobile Card View */}
            <div className="sm:hidden space-y-2 max-h-[32rem] overflow-y-auto mb-4">
              {allStudents.map((student) => {
                const aiInfo = aiDetectionMap[student.id]
                const isAbsent = selectedAbsent.has(student.id)

                return (
                  <div
                    key={student.id}
                    className={`p-3 rounded-lg border ${isAbsent ? 'bg-red-50 border-red-200' : 'bg-white border-gray-200'}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-xs text-gray-400 font-mono flex-shrink-0">{student.roll_number}</span>
                        <span className="font-medium text-sm text-gray-900 truncate">{student.name}</span>
                        {isMultiPage && aiInfo?.page && (
                          <button
                            type="button"
                            onClick={() => setCurrentPage(aiInfo.page)}
                            className="text-xs px-1 py-0.5 rounded bg-purple-100 text-purple-600 flex-shrink-0"
                          >
                            P{aiInfo.page}
                          </button>
                        )}
                      </div>
                      {!isConfirmed ? (
                        <div className="inline-flex rounded-md overflow-hidden border border-gray-300 flex-shrink-0 ml-2">
                          <button
                            onClick={() => {
                              const newSet = new Set(selectedAbsent)
                              newSet.delete(student.id)
                              setSelectedAbsent(newSet)
                            }}
                            className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                              !isAbsent
                                ? 'bg-green-500 text-white'
                                : 'bg-white text-gray-400'
                            }`}
                          >P</button>
                          <button
                            onClick={() => {
                              const newSet = new Set(selectedAbsent)
                              newSet.add(student.id)
                              setSelectedAbsent(newSet)
                            }}
                            className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                              isAbsent
                                ? 'bg-red-500 text-white'
                                : 'bg-white text-gray-400'
                            }`}
                          >A</button>
                        </div>
                      ) : (
                        <span className={`px-2 py-1 rounded text-xs font-medium flex-shrink-0 ml-2 ${
                          isAbsent ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                        }`}>
                          {isAbsent ? 'Absent' : 'Present'}
                        </span>
                      )}
                    </div>
                    {aiInfo && (
                      <div className="flex flex-wrap gap-2 mt-1 text-xs">
                        {aiInfo.extracted_name && (
                          <span className="text-gray-500">
                            AI: &quot;{aiInfo.extracted_name}&quot;
                            {aiInfo.match_score > 0 && (
                              <span className={`ml-1 font-medium ${
                                aiInfo.match_score >= 0.7 ? 'text-green-600' : 'text-yellow-600'
                              }`}>
                                {Math.round(aiInfo.match_score * 100)}%
                              </span>
                            )}
                          </span>
                        )}
                        {aiInfo.raw_mark && (
                          <span className={`px-1 py-0.5 rounded ${
                            aiInfo.ai_status === 'ABSENT' ? 'bg-red-100 text-red-600' :
                            'bg-green-100 text-green-600'
                          }`}>
                            mark: {aiInfo.raw_mark}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Desktop Table View */}
            <div className="hidden sm:block overflow-x-auto max-h-[32rem] overflow-y-auto mb-4 border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr className="text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-2 py-2 text-left w-10">#</th>
                    <th className="px-2 py-2 text-left">Student</th>
                    <th className="px-2 py-2 text-left border-l border-gray-200">Name Match</th>
                    <th className="px-2 py-2 text-left border-l border-gray-200">Roll Match</th>
                    <th className="px-2 py-2 text-center border-l border-gray-200 w-28">Attendance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allStudents.map((student) => {
                    const aiInfo = aiDetectionMap[student.id]
                    const isAbsent = selectedAbsent.has(student.id)
                    const nameState = nameCorrections[student.id]
                    const rollState = rollCorrections[student.id]

                    return (
                      <tr key={student.id} className={`${isAbsent ? 'bg-red-50' : 'hover:bg-gray-50'} transition-colors`}>
                        {/* Roll number */}
                        <td className="px-2 py-2 font-mono text-xs text-gray-400">{student.roll_number}</td>

                        {/* Student name */}
                        <td className="px-2 py-2">
                          <span className="font-medium text-gray-900 text-sm">{student.name}</span>
                          {isMultiPage && aiInfo?.page && (
                            <button
                              type="button"
                              onClick={() => setCurrentPage(aiInfo.page)}
                              className="ml-1 text-xs px-1 py-0.5 rounded bg-purple-100 text-purple-600 hover:bg-purple-200"
                            >
                              P{aiInfo.page}
                            </button>
                          )}
                        </td>

                        {/* Name Match column */}
                        <td className="px-2 py-2 border-l border-gray-200">
                          {aiInfo?.extracted_name ? (
                            <div className="flex items-center gap-1">
                              <div className="flex-1 min-w-0">
                                <span className="text-xs text-gray-600 block truncate" title={aiInfo.extracted_name}>
                                  {aiInfo.extracted_name}
                                </span>
                                <div className="flex items-center gap-1">
                                  {aiInfo.match_score > 0 && (
                                    <span className={`text-xs font-medium ${
                                      aiInfo.match_score >= 0.7 ? 'text-green-600' :
                                      aiInfo.match_score >= 0.5 ? 'text-yellow-600' :
                                      'text-red-600'
                                    }`}>
                                      {Math.round(aiInfo.match_score * 100)}%
                                    </span>
                                  )}
                                  {aiInfo.match_method && (
                                    <span className="text-xs text-gray-400">
                                      {aiInfo.match_method === 'name_fuzzy' ? 'name' :
                                       aiInfo.match_method === 'roll_exact' ? 'roll' :
                                       aiInfo.match_method === 'serial_order' ? 'order' : ''}
                                    </span>
                                  )}
                                </div>
                              </div>
                              {!isConfirmed && (
                                <div className="flex gap-0.5 flex-shrink-0">
                                  <button
                                    onClick={() => setNameCorrections(prev => {
                                      const next = {...prev}
                                      if (next[student.id] === true) delete next[student.id]
                                      else next[student.id] = true
                                      return next
                                    })}
                                    className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${
                                      nameState === true
                                        ? 'bg-green-500 text-white'
                                        : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-600'
                                    }`}
                                    title="Confirm name match"
                                  >&#10003;</button>
                                  <button
                                    onClick={() => setNameCorrections(prev => {
                                      const next = {...prev}
                                      if (next[student.id] === false) delete next[student.id]
                                      else next[student.id] = false
                                      return next
                                    })}
                                    className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${
                                      nameState === false
                                        ? 'bg-red-500 text-white'
                                        : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600'
                                    }`}
                                    title="Reject name match"
                                  >&#10007;</button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300 italic">Not detected</span>
                          )}
                        </td>

                        {/* Roll Match column */}
                        <td className="px-2 py-2 border-l border-gray-200">
                          {aiInfo?.extracted_serial ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs font-mono text-gray-600">
                                {aiInfo.extracted_serial}&rarr;{student.roll_number}
                              </span>
                              {!isConfirmed && (
                                <div className="flex gap-0.5 flex-shrink-0">
                                  <button
                                    onClick={() => setRollCorrections(prev => {
                                      const next = {...prev}
                                      if (next[student.id] === true) delete next[student.id]
                                      else next[student.id] = true
                                      return next
                                    })}
                                    className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${
                                      rollState === true
                                        ? 'bg-green-500 text-white'
                                        : 'bg-gray-100 text-gray-400 hover:bg-green-100 hover:text-green-600'
                                    }`}
                                    title="Confirm roll match"
                                  >&#10003;</button>
                                  <button
                                    onClick={() => setRollCorrections(prev => {
                                      const next = {...prev}
                                      if (next[student.id] === false) delete next[student.id]
                                      else next[student.id] = false
                                      return next
                                    })}
                                    className={`w-6 h-6 rounded text-xs flex items-center justify-center transition-colors ${
                                      rollState === false
                                        ? 'bg-red-500 text-white'
                                        : 'bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-600'
                                    }`}
                                    title="Reject roll match"
                                  >&#10007;</button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">--</span>
                          )}
                        </td>

                        {/* Attendance column */}
                        <td className="px-2 py-2 border-l border-gray-200">
                          <div className="flex items-center justify-center gap-1">
                            {aiInfo && (
                              <span className={`text-xs px-1 py-0.5 rounded ${
                                aiInfo.ai_status === 'ABSENT' ? 'bg-red-100 text-red-600' :
                                aiInfo.ai_status === 'PRESENT' ? 'bg-green-100 text-green-600' :
                                aiInfo.ai_status === 'LATE' ? 'bg-yellow-100 text-yellow-600' :
                                'bg-gray-100 text-gray-500'
                              }`} title={`AI: ${aiInfo.ai_status}${aiInfo.raw_mark ? ` (mark: "${aiInfo.raw_mark}")` : ''}`}>
                                {aiInfo.raw_mark || aiInfo.ai_status?.[0] || '?'}
                              </span>
                            )}
                            {!isConfirmed ? (
                              <div className="inline-flex rounded-md overflow-hidden border border-gray-300">
                                <button
                                  onClick={() => {
                                    const newSet = new Set(selectedAbsent)
                                    newSet.delete(student.id)
                                    setSelectedAbsent(newSet)
                                  }}
                                  className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    !isAbsent
                                      ? 'bg-green-500 text-white'
                                      : 'bg-white text-gray-400 hover:bg-green-50 hover:text-green-600'
                                  }`}
                                >P</button>
                                <button
                                  onClick={() => {
                                    const newSet = new Set(selectedAbsent)
                                    newSet.add(student.id)
                                    setSelectedAbsent(newSet)
                                  }}
                                  className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                                    isAbsent
                                      ? 'bg-red-500 text-white'
                                      : 'bg-white text-gray-400 hover:bg-red-50 hover:text-red-600'
                                  }`}
                                >A</button>
                              </div>
                            ) : (
                              <span className={`px-2 py-1 rounded text-xs font-medium ${
                                isAbsent ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                              }`}>
                                {isAbsent ? 'A' : 'P'}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </>
          ) : (
            <div className="text-center py-8 text-gray-500 mb-4">
              <p>No students found in this class.</p>
              <Link to="/students" className="text-primary-600 hover:underline">
                Add students first
              </Link>
            </div>
          )}

          {/* Unmatched OCR Entries */}
          {unmatchedEntries.length > 0 && (
            <details className="mb-4">
              <summary className="text-sm font-medium text-yellow-700 cursor-pointer hover:text-yellow-800">
                Unmatched OCR entries ({unmatchedEntries.length})
              </summary>
              <div className="mt-2 bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-1">
                {unmatchedEntries.map((entry, idx) => (
                  <div key={idx} className="text-xs text-yellow-800 flex items-center justify-between">
                    <span>
                      Serial: {entry.roll_number || '?'} | "{entry.extracted_name || '?'}"
                    </span>
                    <span className="text-yellow-600">{entry.reason}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Pipeline Details (collapsed) */}
          {Object.keys(pipelineStages).length > 0 && (
            <details className="mb-4">
              <summary className="text-sm font-medium text-gray-500 cursor-pointer hover:text-gray-700">
                Pipeline Details
              </summary>
              <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs space-y-2">
                {pipelineStages.google_vision && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z"/>
                        </svg>
                        Google Cloud Vision
                      </span>
                      <span className={`px-2 py-0.5 rounded ${
                        pipelineStages.google_vision.status === 'completed' ? 'bg-green-100 text-green-700' :
                        pipelineStages.google_vision.status === 'failed' ? 'bg-red-100 text-red-700' :
                        'bg-blue-100 text-blue-600'
                      }`}>
                        {pipelineStages.google_vision.status}
                        {pipelineStages.google_vision.students_found !== undefined &&
                          ` (${pipelineStages.google_vision.students_found} students)`}
                      </span>
                    </div>
                    {pipelineStages.google_vision.status === 'completed' && (
                      <div className="mt-1 ml-6 text-gray-500">
                        <span className="text-green-600">{pipelineStages.google_vision.present_count || 0}P</span>
                        {' / '}
                        <span className="text-red-600">{pipelineStages.google_vision.absent_count || 0}A</span>
                        {pipelineStages.google_vision.uncertain_count > 0 && (
                          <span className="text-orange-600"> / {pipelineStages.google_vision.uncertain_count}?</span>
                        )}
                        {pipelineStages.google_vision.date_columns && (
                          <span className="ml-2">Days: {pipelineStages.google_vision.date_columns.join(', ')}</span>
                        )}
                      </div>
                    )}
                    {pipelineStages.google_vision.error && (
                      <div className="mt-1 ml-6 text-red-500">Error: {pipelineStages.google_vision.error}</div>
                    )}
                  </div>
                )}
                {pipelineStages.groq_vision && (
                  <div className="flex items-center justify-between">
                    <span>Groq Vision AI</span>
                    <span className={`px-2 py-0.5 rounded ${
                      pipelineStages.groq_vision.status === 'completed' ? 'bg-green-100 text-green-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {pipelineStages.groq_vision.status}
                    </span>
                  </div>
                )}
              </div>
            </details>
          )}

          {/* Confirm Button */}
          {!isConfirmed && (
            <button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
              className="w-full btn btn-primary py-3 text-lg disabled:opacity-50"
            >
              {confirmMutation.isPending ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Confirming...
                </span>
              ) : (
                `Confirm Attendance (${selectedAbsent.size} Absent)`
              )}
            </button>
          )}

          {confirmMutation.isError && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {confirmMutation.error?.response?.data?.error || 'Failed to confirm attendance'}
            </div>
          )}

          {isConfirmed && (
            <div className="text-center py-4 bg-green-50 rounded-lg">
              <svg className="mx-auto h-8 w-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <p className="mt-2 text-green-700 font-medium">Attendance Confirmed</p>
              <p className="text-sm text-green-600">
                Confirmed by {upload.confirmed_by_name} at {new Date(upload.confirmed_at).toLocaleString()}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Image Preview Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
          <div className="relative w-full h-full p-4">
            {/* Close Button */}
            <button
              onClick={() => setShowPreviewModal(false)}
              className="absolute top-4 right-4 z-10 p-3 bg-white rounded-full shadow-lg hover:bg-gray-100"
            >
              <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Image Info */}
            <div className="absolute top-4 left-4 z-10 bg-white rounded-lg shadow-lg p-2 sm:p-3 max-w-[calc(100%-6rem)]">
              <p className="text-sm font-medium text-gray-900">{upload.class_name}</p>
              <p className="text-xs text-gray-500">{upload.date}</p>
              {isMultiPage && (
                <p className="text-xs text-gray-500 mt-1">Page {currentPage} of {totalPages}</p>
              )}
              <a
                href={currentImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline flex items-center gap-1 mt-1"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Open in new tab
              </a>
            </div>

            {/* Multi-page Navigation */}
            {isMultiPage && (
              <div className="absolute top-16 sm:top-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-1 sm:gap-2 bg-white rounded-lg shadow-lg p-1 sm:p-2">
                {uploadImages.map((img) => (
                  <button
                    key={img.id}
                    onClick={() => setCurrentPage(img.page_number)}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      currentPage === img.page_number
                        ? 'bg-primary-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    Page {img.page_number}
                  </button>
                ))}
              </div>
            )}

            {/* Full Image with Zoom */}
            <div className="w-full h-full flex items-center justify-center">
              <TransformWrapper
                key={currentImageUrl}
                initialScale={1}
                minScale={0.5}
                maxScale={5}
                centerOnInit={true}
              >
                {({ zoomIn, zoomOut, resetTransform }) => (
                  <>
                    {/* Zoom Controls */}
                    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-10 flex gap-2 bg-white rounded-lg shadow-lg p-2">
                      {/* Page navigation arrows for multi-page */}
                      {isMultiPage && (
                        <button
                          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                          className="p-2 hover:bg-gray-100 rounded disabled:opacity-50"
                          title="Previous Page"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>
                      )}
                      <button
                        onClick={() => zoomOut()}
                        className="p-2 hover:bg-gray-100 rounded"
                        title="Zoom Out"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => resetTransform()}
                        className="p-2 hover:bg-gray-100 rounded"
                        title="Reset"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                      <button
                        onClick={() => zoomIn()}
                        className="p-2 hover:bg-gray-100 rounded"
                        title="Zoom In"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
                        </svg>
                      </button>
                      {/* Page navigation arrows for multi-page */}
                      {isMultiPage && (
                        <button
                          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                          disabled={currentPage === totalPages}
                          className="p-2 hover:bg-gray-100 rounded disabled:opacity-50"
                          title="Next Page"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      )}
                    </div>

                    <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }}>
                      <img
                        src={currentImageUrl}
                        alt={`Attendance register full view${isMultiPage ? ` - Page ${currentPage}` : ''}`}
                        className="max-w-full max-h-full object-contain"
                      />
                    </TransformComponent>
                  </>
                )}
              </TransformWrapper>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
