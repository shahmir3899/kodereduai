import { useMemo, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import { useBackgroundTasks } from '../../contexts/BackgroundTaskContext'
import { faceAttendanceApi, studentsApi } from '../../services/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { getClassSelectorScope, getResolvedMasterClassId, resolveSessionClassId } from '../../utils/classScope'

export default function FaceEnrollmentPage() {
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { showError, showSuccess } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const { addTask } = useBackgroundTasks()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)

  const [selectedClass, setSelectedClass] = useState('')
  const [selectedStudent, setSelectedStudent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedSelectedClass = getResolvedMasterClassId(selectedClass, activeAcademicYear?.id, sessionClasses)
  const resolvedSelectedSessionClass = resolveSessionClassId(selectedClass, activeAcademicYear?.id, sessionClasses)

  // Load students for selected class
  const { data: studentsData } = useQuery({
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

  // Load enrollments for selected class
  const { data: enrollmentsData, isLoading: enrollmentsLoading } = useQuery({
    queryKey: ['faceEnrollments', activeSchool?.id, resolvedSelectedClass],
    queryFn: () => faceAttendanceApi.getEnrollments(
      resolvedSelectedClass ? { class_obj: resolvedSelectedClass } : {}
    ),
    enabled: !!activeSchool,
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

  const sortedEnrollments = useMemo(() => {
    return [...enrollments].sort((a, b) => {
      const rollCmp = parseRollForSort(a.student_roll) - parseRollForSort(b.student_roll)
      if (rollCmp !== 0) return rollCmp
      return String(a.student_name || '').localeCompare(String(b.student_name || ''))
    })
  }, [enrollments])

  // Enroll mutation
  const enrollMutation = useMutation({
    mutationFn: async (file) => {
      setUploading(true)
      // Upload image
      const uploadRes = await faceAttendanceApi.uploadImage(
        file, activeSchool?.id, resolvedSelectedClass || 0
      )
      const imageUrl = uploadRes.data.url || uploadRes.data.image_url

      // Enroll face
      return faceAttendanceApi.enrollFace({
        student_id: parseInt(selectedStudent),
        image_url: imageUrl,
      })
    },
    onSuccess: (data) => {
      setUploading(false)
      setPreviewUrl(null)
      setSelectedStudent('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      
      // Register task with background task context for monitoring
      const taskId = data.data?.task_id || data.task_id
      const studentName = data.data?.student_name || data.student_name || 'Student'
      
      if (taskId) {
        addTask(
          taskId,
          `Enroll face: ${studentName}`,
          'FACE_ATTENDANCE',
          (result) => {
            // Task completed (success or already handled by context)
            queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
          }
        )
      }
      
      showSuccess('Processing enrollment...')
      queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
    },
    onError: (err) => {
      setUploading(false)
      showError(err.response?.data?.error || err.response?.data?.detail || 'Enrollment failed')
    },
  })

  // Delete enrollment mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => faceAttendanceApi.deleteEnrollment(id),
    onSuccess: () => {
      showSuccess('Face enrollment removed')
      queryClient.invalidateQueries({ queryKey: ['faceEnrollments'] })
    },
    onError: (err) => {
      showError(err.response?.data?.error || 'Failed to remove enrollment')
    },
  })

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setPreviewUrl(ev.target.result)
    reader.readAsDataURL(file)
  }

  const handleEnroll = () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) {
      showError('Please select a photo.')
      return
    }
    if (!selectedStudent) {
      showError('Please select a student.')
      return
    }
    enrollMutation.mutate(file)
  }

  // Build enrollment status for students
  const enrolledStudentIds = new Set(enrollments.map((e) => e.student))
  const enrolledVisibleCount = sortedStudents.filter((s) => enrolledStudentIds.has(s.id)).length

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => navigate('/face-attendance')}
            className="text-sm text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1"
          >
            <span>&larr;</span> Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Face Enrollment</h1>
          <p className="text-sm text-gray-500 mt-1">
            Enroll student photos for face recognition
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Enrollment form */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">Enroll Student Face</h2>

          {/* Photo Requirements Card */}
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="text-sm font-semibold text-blue-900 mb-3">Photo Requirements</h3>
            <div className="space-y-2 text-sm text-blue-800">
              <div className="flex gap-2">
                <span className="text-green-600 font-semibold">✓</span>
                <span>Clear portrait crop (head and shoulders)</span>
              </div>
              <div className="flex gap-2">
                <span className="text-green-600 font-semibold">✓</span>
                <span>Exactly one face visible</span>
              </div>
              <div className="flex gap-2">
                <span className="text-green-600 font-semibold">✓</span>
                <span>Front-facing angle (minimal side angle)</span>
              </div>
              <div className="flex gap-2">
                <span className="text-green-600 font-semibold">✓</span>
                <span>Good lighting (no harsh shadows)</span>
              </div>
              <div className="flex gap-2">
                <span className="text-green-600 font-semibold">✓</span>
                <span>Sharp focus (no motion blur)</span>
              </div>
              <div className="flex gap-2">
                <span className="text-green-600 font-semibold">✓</span>
                <span>JPG or PNG format, high resolution</span>
              </div>
              <div className="mt-3 pt-3 border-t border-blue-200">
                <div className="flex gap-2">
                  <span className="text-red-600 font-semibold">✗</span>
                  <span>No masks, sunglasses, or heavy accessories</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-red-600 font-semibold">✗</span>
                  <span>Avoid compressed/blurry images</span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
              <ClassSelector
                value={selectedClass}
                onChange={(e) => { setSelectedClass(e.target.value); setSelectedStudent('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                scope={classSelectorScope}
                academicYearId={activeAcademicYear?.id}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student</label>
              <select
                value={selectedStudent}
                onChange={(e) => setSelectedStudent(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                disabled={!selectedClass}
              >
                <option value="">Select student...</option>
                {sortedStudents.map((s) => (
                  <option key={s.id} value={s.id}>
                    {`${s.roll_number || '-'} - ${s.name}`}
                    {enrolledStudentIds.has(s.id) ? ' [enrolled]' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student Photo</label>
              <p className="text-xs text-gray-500 mb-2">
                Upload a clear portrait photo with exactly one face visible.
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="user"
                onChange={handleFileSelect}
                className="w-full text-sm border border-gray-300 rounded-lg p-2"
              />
            </div>

            {previewUrl && (
              <div className="text-center">
                <img src={previewUrl} alt="Preview" className="h-40 mx-auto rounded-lg" />
              </div>
            )}

            <button
              onClick={handleEnroll}
              disabled={uploading || !selectedStudent || !previewUrl}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? 'Enrolling...' : 'Enroll Face'}
            </button>
          </div>
        </div>

        {/* Current enrollments */}
        <div className="bg-white rounded-lg border">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">
              Enrolled Faces
              {selectedClass && ` (${sortedEnrollments.length})`}
            </h2>
          </div>

          {enrollmentsLoading ? (
            <div className="p-8"><LoadingSpinner /></div>
          ) : sortedEnrollments.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              {selectedClass
                ? 'No students enrolled in this class yet.'
                : 'Select a class to see enrolled students.'}
            </div>
          ) : (
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {sortedEnrollments.map((enrollment) => (
                <div key={enrollment.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{enrollment.student_name}</div>
                    <div className="text-xs text-gray-500">
                      #{enrollment.student_roll} &middot; {enrollment.class_name} &middot;
                      Quality: {(enrollment.quality_score * 100).toFixed(0)}%
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      const ok = await confirm({ title: 'Remove Enrollment', message: 'Remove this face enrollment?', confirmLabel: 'Remove' })
                      if (ok) deleteMutation.mutate(enrollment.id)
                    }}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Summary for selected class */}
          {selectedClass && sortedStudents.length > 0 && (
            <div className="p-3 border-t bg-gray-50 text-xs text-gray-600">
              {enrolledVisibleCount} of {sortedStudents.length} students enrolled
              {sortedStudents.length - enrolledVisibleCount > 0 && (
                <span className="text-orange-600 ml-1">
                  ({sortedStudents.length - enrolledVisibleCount} missing)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <ConfirmModalRoot />
    </div>
  )
}
