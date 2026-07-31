import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import { faceAttendanceApi, studentsApi } from '../../services/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId, resolveSessionClassId } from '../../utils/classScope'
import { TIER_A_EMBEDDING_VERSION } from '../../utils/faceApiLoader'
import { LiveEnrollCapture } from './FaceEnrollmentPage'

/**
 * Bulk faceapi_v1 enrollment queue — design doc §5/§10 backlog ("bulk
 * re-enrollment tool for Tier A adoption"). Confirmed via investigation
 * (see design doc) that server-side batch conversion from existing photos
 * (Path A) isn't viable: no school has any existing StudentFaceEmbedding
 * corpus to convert from yet. So this is Path B — the same guided
 * live-capture flow FaceEnrollmentPage already has, driven automatically
 * through a whole class roster instead of requiring the admin to
 * reselect class -> student -> capture for every single student.
 *
 * Deliberately no client-side "progress" model: whether a student still
 * needs capture is re-derived from the enrollments/ list every time this
 * page loads, the same source of truth the roster view already reads from.
 * If the admin closes the tab mid-queue, reopening it and picking the same
 * class naturally resumes on the remaining not-yet-enrolled students —
 * nothing to persist or drift out of sync with the database.
 */
export default function FaceBulkEnrollmentPage() {
  const { activeAcademicYear } = useAcademicYear()
  const { showError, showSuccess } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedClass, setSelectedClass] = useState('')
  const [recaptureOverrides, setRecaptureOverrides] = useState(() => new Set())
  const [phase, setPhase] = useState('setup') // setup | queue | summary
  const [queueIndex, setQueueIndex] = useState(0)
  const [tally, setTally] = useState({ captured: 0, skipped: 0 })
  const [skippedNames, setSkippedNames] = useState([])
  const [queueRoster, setQueueRoster] = useState([]) // frozen at "Start Queue" time
  const [alreadyEnrolledCount, setAlreadyEnrolledCount] = useState(0)

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, undefined)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedSelectedClass = getResolvedMasterClassId(selectedClass, activeAcademicYear?.id, sessionClasses)
  const resolvedSelectedSessionClass = resolveSessionClassId(selectedClass, activeAcademicYear?.id, sessionClasses)
  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass,
    setSelectedClass,
    autoSelectFirst: true,
    queryKey: 'teacherFaceBulkEnrollmentClasses',
  })

  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students', resolvedSelectedClass, resolvedSelectedSessionClass, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      class_id: resolvedSelectedClass,
      ...(resolvedSelectedSessionClass && { session_class_id: resolvedSelectedSessionClass }),
      page_size: 100,
      is_active: true,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!resolvedSelectedClass,
  })
  const students = studentsData?.data?.results || studentsData?.data || []

  const { data: enrollmentsData, isLoading: enrollmentsLoading, refetch: refetchEnrollments } = useQuery({
    queryKey: ['faceEnrollments', resolvedSelectedClass],
    queryFn: () => faceAttendanceApi.getEnrollments({ class_obj: resolvedSelectedClass }),
    enabled: !!resolvedSelectedClass,
  })
  const enrollments = enrollmentsData?.data?.results || enrollmentsData?.data || []

  const parseRollForSort = (rollValue) => {
    const parsed = Number.parseInt(String(rollValue ?? '').trim(), 10)
    return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
  }

  const sortedStudents = useMemo(() => {
    return [...students].sort((a, b) => {
      const rollCmp = parseRollForSort(a.roll_number) - parseRollForSort(b.roll_number)
      if (rollCmp !== 0) return rollCmp
      return String(a.name || '').localeCompare(String(b.name || ''))
    })
  }, [students])

  // Only faceapi_v1 rows count as "already enrolled" for this tool — a
  // student who only has a dlib_v1 row still needs Tier A capture, that's
  // the entire premise of this rollout (design doc §1).
  const enrolledFaceApiIds = useMemo(
    () => new Set(enrollments.filter((e) => e.embedding_version === TIER_A_EMBEDDING_VERSION).map((e) => e.student)),
    [enrollments],
  )

  const toggleRecapture = (studentId) => {
    setRecaptureOverrides((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  const pendingStudents = useMemo(
    () => sortedStudents.filter((s) => !enrolledFaceApiIds.has(s.id) || recaptureOverrides.has(s.id)),
    [sortedStudents, enrolledFaceApiIds, recaptureOverrides],
  )

  const enrollEmbeddingMutation = useMutation({
    mutationFn: ({ studentId, embedding, qualityScore }) => faceAttendanceApi.enrollWithEmbedding({
      student_id: studentId,
      embedding,
      embedding_version: TIER_A_EMBEDDING_VERSION,
      quality_score: qualityScore,
    }),
  })

  const currentStudent = phase === 'queue' ? queueRoster[queueIndex] : null

  const advanceQueue = () => {
    const nextIndex = queueIndex + 1
    if (nextIndex >= queueRoster.length) {
      setPhase('summary')
      showSuccess('Bulk capture complete.')
      queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
    } else {
      setQueueIndex(nextIndex)
    }
  }

  const handleStartQueue = () => {
    setQueueRoster(pendingStudents)
    setAlreadyEnrolledCount(sortedStudents.length - pendingStudents.length)
    setTally({ captured: 0, skipped: 0 })
    setSkippedNames([])
    setQueueIndex(0)
    setPhase('queue')
  }

  const handleCaptureSubmit = (embedding, qualityScore) => {
    if (!currentStudent) return
    enrollEmbeddingMutation.mutate(
      { studentId: currentStudent.id, embedding, qualityScore },
      {
        onSuccess: () => {
          setTally((prev) => ({ ...prev, captured: prev.captured + 1 }))
          advanceQueue()
        },
        onError: (err) => {
          showError(err.response?.data?.error || err.response?.data?.detail || `Failed to enroll ${currentStudent.name}`)
        },
      },
    )
  }

  const handleSkip = () => {
    if (!currentStudent) return
    setTally((prev) => ({ ...prev, skipped: prev.skipped + 1 }))
    setSkippedNames((prev) => [...prev, currentStudent.name])
    advanceQueue()
  }

  const handleFinishEarly = () => {
    setPhase('summary')
    queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
  }

  const handleStartOver = () => {
    setPhase('setup')
    setRecaptureOverrides(new Set())
    refetchEnrollments()
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => navigate('/face-attendance/enrollment')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1"
        >
          <span>&larr;</span> Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Bulk Face Enrollment</h1>
        <p className="text-sm text-gray-500 mt-1">
          Capture faceapi_v1 faces for a whole class, one student after another, without reselecting each one.
        </p>
      </div>

      {phase === 'setup' && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
            <ClassSelector
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              scope={classSelectorScope}
              academicYearId={activeAcademicYear?.id}
              showAllOption={showAllOption}
              classes={teacherClassOptions || undefined}
            />
          </div>

          {!resolvedSelectedClass ? (
            <p className="text-sm text-gray-500">Select a class to see its roster.</p>
          ) : studentsLoading || enrollmentsLoading ? (
            <div className="p-8"><LoadingSpinner /></div>
          ) : sortedStudents.length === 0 ? (
            <p className="text-sm text-gray-500">No active students in this class.</p>
          ) : (
            <>
              <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                {sortedStudents.map((s) => {
                  const isEnrolled = enrolledFaceApiIds.has(s.id)
                  return (
                    <div key={s.id} className="p-3 flex items-center justify-between text-sm">
                      <div>
                        <span className="font-medium">{s.roll_number || '-'} - {s.name}</span>
                        {isEnrolled ? (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-100 text-green-700">
                            Already enrolled
                          </span>
                        ) : (
                          <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-700">
                            Not enrolled
                          </span>
                        )}
                      </div>
                      {isEnrolled && (
                        <label className="flex items-center gap-1.5 text-xs text-gray-600">
                          <input
                            type="checkbox"
                            checked={recaptureOverrides.has(s.id)}
                            onChange={() => toggleRecapture(s.id)}
                          />
                          Re-capture anyway
                        </label>
                      )}
                    </div>
                  )
                })}
              </div>

              <div className="flex items-center justify-between pt-2">
                <p className="text-xs text-gray-500">
                  {pendingStudents.length} of {sortedStudents.length} students will be captured in this run.
                </p>
                <button
                  onClick={handleStartQueue}
                  disabled={pendingStudents.length === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Bulk Capture
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {phase === 'queue' && currentStudent && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">
                {queueIndex + 1} of {queueRoster.length} students captured
              </p>
              <h2 className="text-lg font-semibold text-gray-900">
                {currentStudent.roll_number || '-'} - {currentStudent.name}
              </h2>
            </div>
            <button
              onClick={handleFinishEarly}
              className="text-xs text-gray-500 hover:text-gray-700 underline"
            >
              Stop &amp; view summary
            </button>
          </div>

          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all"
              style={{ width: `${Math.round((queueIndex / queueRoster.length) * 100)}%` }}
            />
          </div>

          <LiveEnrollCapture
            key="bulk-capture" // stable across students on purpose: keeps the same
            // camera stream + loaded model across the whole queue instead of
            // re-requesting camera permission for every single student.
            selectedStudent={String(currentStudent.id)}
            onSubmit={handleCaptureSubmit}
            submitting={enrollEmbeddingMutation.isPending}
          />

          <button
            onClick={handleSkip}
            disabled={enrollEmbeddingMutation.isPending}
            className="w-full py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            Skip this student
          </button>
        </div>
      )}

      {phase === 'summary' && (
        <div className="bg-white rounded-lg border p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Bulk Capture Summary</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-green-50 rounded-lg">
              <div className="text-2xl font-bold text-green-700">{tally.captured}</div>
              <div className="text-xs text-green-800">Captured</div>
            </div>
            <div className="p-3 bg-orange-50 rounded-lg">
              <div className="text-2xl font-bold text-orange-700">{tally.skipped}</div>
              <div className="text-xs text-orange-800">Skipped</div>
            </div>
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-700">{alreadyEnrolledCount}</div>
              <div className="text-xs text-gray-600">Already enrolled</div>
            </div>
          </div>

          {skippedNames.length > 0 && (
            <div className="text-sm text-gray-600">
              <p className="font-medium mb-1">Skipped (needs follow-up):</p>
              <ul className="list-disc list-inside space-y-0.5">
                {skippedNames.map((name, i) => <li key={i}>{name}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleStartOver}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Run Another Class
            </button>
            <button
              onClick={() => navigate('/face-attendance/enrollment')}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Back to Enrollments
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
