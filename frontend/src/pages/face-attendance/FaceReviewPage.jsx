import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '../../components/Toast'
import { faceAttendanceApi } from '../../services/api'
import LoadingSpinner from '../../components/LoadingSpinner'

export default function FaceReviewPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const { showError, showSuccess } = useToast()
  const queryClient = useQueryClient()

  const [presentIds, setPresentIds] = useState(null) // null = not initialized yet
  const [removedDetections, setRemovedDetections] = useState(new Set())
  const [imgNaturalSize, setImgNaturalSize] = useState(null) // {width, height} of session.image_url
  const [activeDetectionId, setActiveDetectionId] = useState(null) // box tapped/hovered — shows label + alt-match picker
  const [overrideMatches, setOverrideMatches] = useState({}) // detectionId -> {id, name, confidence} reassigned via alt-match picker

  // Fetch session with polling while processing
  const { data: sessionRes, isLoading } = useQuery({
    queryKey: ['faceSession', sessionId],
    queryFn: () => faceAttendanceApi.getSession(sessionId),
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status
      return status === 'PROCESSING' || status === 'UPLOADING' ? 3000 : false
    },
  })
  const session = sessionRes?.data

  // Initialize present IDs from auto-matched + flagged detections
  useMemo(() => {
    if (session && session.status === 'NEEDS_REVIEW' && presentIds === null) {
      const autoPresent = new Set()
      for (const det of session.detections || []) {
        if (
          det.match_status === 'AUTO_MATCHED' ||
          det.match_status === 'FLAGGED'
        ) {
          if (det.matched_student?.id) {
            autoPresent.add(det.matched_student.id)
          }
        }
      }
      setPresentIds(autoPresent)
    }
  }, [session, presentIds])

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: () =>
      faceAttendanceApi.confirmSession(sessionId, {
        present_student_ids: Array.from(presentIds || []),
        removed_detection_ids: Array.from(removedDetections),
        corrections: Object.values(overrideMatches).map((override) => ({
          detection_face_index: override.faceIndex,
          correct_student_id: override.id,
        })),
      }),
    onSuccess: (res) => {
      showSuccess(res.data?.message || 'Attendance confirmed!')
      queryClient.invalidateQueries({ queryKey: ['faceSessions'] })
      queryClient.invalidateQueries({ queryKey: ['pendingFaceReviews'] })
      queryClient.invalidateQueries({ queryKey: ['faceSession', sessionId] })
    },
    onError: (err) => {
      showError(err.response?.data?.error || 'Failed to confirm attendance')
    },
  })

  // Reprocess mutation
  const reprocessMutation = useMutation({
    mutationFn: () => faceAttendanceApi.reprocessSession(sessionId),
    onSuccess: () => {
      showSuccess('Reprocessing started...')
      setPresentIds(null)
      setRemovedDetections(new Set())
      queryClient.invalidateQueries({ queryKey: ['faceSession', sessionId] })
    },
    onError: (err) => {
      showError(err.response?.data?.error || 'Failed to reprocess')
    },
  })

  const toggleStudent = (studentId) => {
    setPresentIds((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) {
        next.delete(studentId)
      } else {
        next.add(studentId)
      }
      return next
    })
  }

  const removeDetection = (detectionId) => {
    setRemovedDetections((prev) => new Set([...prev, detectionId]))
  }

  // Reassign a detection from its top match to a runner-up candidate.
  // Updates presentIds immediately (same toggle the Class Roll checkboxes
  // drive, for instant UI feedback) and also records the reassignment in
  // overrideMatches, which confirmMutation turns into the `corrections`
  // array the backend's confirm() action already applies to the
  // FaceDetectionResult row itself (and audits as ADMIN_OVERRIDE) — without
  // this, the reassignment was only ever a local presentIds toggle that
  // never reached the detection record.
  const applyAlternativeMatch = (det, alt) => {
    const currentlyDisplayed = overrideMatches[det.id] || det.matched_student
    setPresentIds((prev) => {
      const next = new Set(prev)
      if (currentlyDisplayed?.id) next.delete(currentlyDisplayed.id)
      if (alt.student_id) next.add(alt.student_id)
      return next
    })
    setOverrideMatches((prev) => ({
      ...prev,
      [det.id]: { id: alt.student_id, name: alt.name, confidence: alt.confidence, faceIndex: det.face_index },
    }))
    setActiveDetectionId(null)
  }

  const getBoxColors = (det) => {
    if (!det.matched_student) return { border: 'border-red-500', bg: 'bg-red-500' }
    if (det.match_status === 'FLAGGED') return { border: 'border-yellow-500', bg: 'bg-yellow-500' }
    if (det.match_status === 'IGNORED' || det.match_status === 'REMOVED') {
      return { border: 'border-gray-400', bg: 'bg-gray-400' }
    }
    return { border: 'border-green-500', bg: 'bg-green-500' } // AUTO_MATCHED / MANUALLY_MATCHED
  }

  if (isLoading) return <LoadingSpinner />

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <p className="text-gray-500">Session not found.</p>
        <button onClick={() => navigate('/face-attendance')} className="mt-4 text-blue-600 underline">
          Back to Face Attendance
        </button>
      </div>
    )
  }

  // Processing state
  if (session.status === 'PROCESSING' || session.status === 'UPLOADING') {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <LoadingSpinner />
        <h2 className="text-xl font-semibold mt-4">Processing Faces...</h2>
        <p className="text-gray-500 mt-2">
          Detecting and matching faces. This usually takes 10-30 seconds.
        </p>
      </div>
    )
  }

  // Failed state
  if (session.status === 'FAILED') {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <h2 className="text-xl font-semibold text-red-800">Processing Failed</h2>
          <p className="text-red-600 mt-2">{session.error_message || 'Unknown error'}</p>
          <div className="flex gap-3 justify-center mt-4">
            <button
              onClick={() => reprocessMutation.mutate()}
              disabled={reprocessMutation.isPending}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {reprocessMutation.isPending ? 'Reprocessing...' : 'Try Again'}
            </button>
            <button
              onClick={() => navigate('/face-attendance')}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm"
            >
              Back
            </button>
          </div>
        </div>
      </div>
    )
  }

  const detections = (session.detections || []).filter(
    (d) => !removedDetections.has(d.id)
  )
  const classStudents = session.class_students || []
  const isConfirmed = session.status === 'CONFIRMED'

  const getMatchBadge = (status) => {
    switch (status) {
      case 'AUTO_MATCHED': return { color: 'bg-green-100 text-green-700 border-green-200', label: 'Auto' }
      case 'FLAGGED': return { color: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'Review' }
      case 'MANUALLY_MATCHED': return { color: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Manual' }
      case 'IGNORED': return { color: 'bg-gray-100 text-gray-500 border-gray-200', label: 'Ignored' }
      case 'REMOVED': return { color: 'bg-red-100 text-red-500 border-red-200', label: 'Removed' }
      default: return { color: 'bg-gray-100 text-gray-500 border-gray-200', label: status }
    }
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/face-attendance')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1"
          >
            <span>&larr;</span> Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">
            Review: {session.class_obj?.name} - {session.date}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {session.total_faces_detected} faces detected &middot;{' '}
            {session.faces_matched} auto-matched &middot;{' '}
            {session.faces_flagged} flagged &middot;{' '}
            {session.faces_ignored} ignored
          </p>
        </div>
        {isConfirmed && (
          <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
            Confirmed
          </span>
        )}
      </div>

      {/* Original image */}
      <div className="bg-white rounded-lg border mb-6 overflow-hidden">
        <div className="p-3 border-b bg-gray-50">
          <h3 className="text-sm font-medium text-gray-700">Captured Image</h3>
        </div>
        <div className="p-4 flex justify-center bg-gray-100">
          <div className="relative inline-block">
            <img
              src={session.image_url}
              alt="Captured"
              className="max-h-72 rounded-lg shadow-sm block"
              onLoad={(e) => setImgNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })}
            />
            {imgNaturalSize && detections.map((det) => {
              if (!det.bounding_box) return null
              const { top, left, right, bottom } = det.bounding_box
              const colors = getBoxColors(det)
              const displayed = overrideMatches[det.id] || det.matched_student
              const displayedConfidence = overrideMatches[det.id]?.confidence ?? det.confidence
              const isActive = activeDetectionId === det.id
              return (
                <div
                  key={det.id || det.face_index}
                  className="absolute group cursor-pointer"
                  style={{
                    left: `${(left / imgNaturalSize.width) * 100}%`,
                    top: `${(top / imgNaturalSize.height) * 100}%`,
                    width: `${((right - left) / imgNaturalSize.width) * 100}%`,
                    height: `${((bottom - top) / imgNaturalSize.height) * 100}%`,
                  }}
                  onClick={() => setActiveDetectionId(isActive ? null : det.id)}
                >
                  <div className={`w-full h-full border-2 rounded-sm ${colors.border}`} />
                  <div
                    className={`absolute -top-6 left-0 whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-medium text-white ${colors.bg} pointer-events-none transition-opacity ${
                      isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {displayed?.name || 'Unknown'}
                    {displayedConfidence > 0 ? ` · ${displayedConfidence.toFixed(0)}%` : ''}
                  </div>
                  {isActive && (det.alternative_matches || []).length > 0 && (
                    <div
                      className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1.5 z-10 w-44"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="text-[10px] text-gray-400 px-1 pb-1">Other candidates</div>
                      {det.alternative_matches.map((alt) => (
                        <button
                          key={alt.student_id}
                          onClick={() => applyAlternativeMatch(det, alt)}
                          className="w-full text-left text-xs px-1.5 py-1 rounded hover:bg-gray-100 flex justify-between gap-2"
                        >
                          <span className="truncate">{alt.name}</span>
                          <span className="text-gray-400 flex-shrink-0">{alt.confidence?.toFixed(0)}%</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Detected faces grid */}
      <div className="bg-white rounded-lg border mb-6">
        <div className="p-3 border-b bg-gray-50">
          <h3 className="text-sm font-medium text-gray-700">
            Detected Faces ({detections.length})
          </h3>
        </div>
        <div className="p-4">
          {detections.length === 0 ? (
            <p className="text-center text-gray-500 py-4">No faces detected</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {detections.map((det) => {
                const badge = getMatchBadge(det.match_status)
                const displayed = overrideMatches[det.id] || det.matched_student
                const displayedConfidence = overrideMatches[det.id]?.confidence ?? det.confidence
                return (
                  <div
                    key={det.id || det.face_index}
                    className={`border rounded-lg p-2 text-center relative ${badge.color.split(' ')[0]} border`}
                  >
                    {det.face_crop_url ? (
                      <img
                        src={det.face_crop_url}
                        alt={`Face #${det.face_index}`}
                        className="w-full h-20 object-cover rounded mb-2"
                      />
                    ) : (
                      <div className="w-full h-20 bg-gray-200 rounded mb-2 flex items-center justify-center text-gray-400 text-xs">
                        No crop
                      </div>
                    )}
                    <div className="text-xs font-medium truncate">
                      {displayed?.name || 'Unknown'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {displayedConfidence > 0 ? `${displayedConfidence.toFixed(1)}%` : '-'}
                    </div>
                    <span className={`inline-block mt-1 px-1.5 py-0.5 text-[10px] font-medium rounded ${badge.color}`}>
                      {badge.label}
                    </span>
                    {!isConfirmed && det.match_status !== 'IGNORED' && (
                      <button
                        onClick={() => removeDetection(det.id)}
                        className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                        title="Remove"
                      >
                        &times;
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Class roll call */}
      <div className="bg-white rounded-lg border mb-6">
        <div className="p-3 border-b bg-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">
            Class Roll ({classStudents.length} students)
          </h3>
          {!isConfirmed && presentIds && (
            <span className="text-xs text-gray-500">
              {presentIds.size} present / {classStudents.length - presentIds.size} absent
            </span>
          )}
        </div>
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {classStudents.map((student) => {
              const isPresent = presentIds?.has(student.id)
              return (
                <button
                  key={student.id}
                  onClick={() => !isConfirmed && toggleStudent(student.id)}
                  disabled={isConfirmed}
                  className={`flex items-center gap-2 p-2 rounded-lg text-sm text-left transition-colors ${
                    isConfirmed
                      ? isPresent ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                      : isPresent
                        ? 'bg-green-50 text-green-800 hover:bg-green-100 border border-green-200'
                        : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  <span className={`w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-xs ${
                    isPresent ? 'bg-green-500 text-white' : 'bg-gray-300 text-white'
                  }`}>
                    {isPresent ? 'P' : 'A'}
                  </span>
                  <span className="truncate flex-1">
                    {student.name}
                    <span className="text-gray-400 ml-1">#{student.roll_number}</span>
                  </span>
                  {student.matched && (
                    <span className="text-[10px] bg-blue-100 text-blue-600 px-1 rounded">matched</span>
                  )}
                  {!student.has_embedding && (
                    <span className="text-[10px] bg-orange-100 text-orange-600 px-1 rounded">no face</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {!isConfirmed && (
        <div className="flex gap-3 justify-end mb-8">
          <button
            onClick={() => reprocessMutation.mutate()}
            disabled={reprocessMutation.isPending}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Reprocess
          </button>
          <button
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending || !presentIds}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {confirmMutation.isPending ? 'Confirming...' : 'Confirm Attendance'}
          </button>
        </div>
      )}
    </div>
  )
}
