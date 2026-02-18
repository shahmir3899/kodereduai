import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { faceAttendanceApi, studentsApi } from '../../services/api'
import LoadingSpinner from '../../components/LoadingSpinner'
import ClassSelector from '../../components/ClassSelector'

export default function FaceEnrollmentPage() {
  const { activeSchool } = useAuth()
  const { showError, showSuccess } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fileInputRef = useRef(null)

  const [selectedClass, setSelectedClass] = useState('')
  const [selectedStudent, setSelectedStudent] = useState('')
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState(null)

  // Load students for selected class
  const { data: studentsData } = useQuery({
    queryKey: ['students', selectedClass],
    queryFn: () => studentsApi.getStudents({ class_obj: selectedClass, page_size: 100, is_active: true }),
    enabled: !!selectedClass,
  })
  const students = studentsData?.data?.results || studentsData?.data || []

  // Load enrollments for selected class
  const { data: enrollmentsData, isLoading: enrollmentsLoading } = useQuery({
    queryKey: ['faceEnrollments', activeSchool?.id, selectedClass],
    queryFn: () => faceAttendanceApi.getEnrollments(
      selectedClass ? { class_obj: selectedClass } : {}
    ),
    enabled: !!activeSchool,
  })
  const enrollments = enrollmentsData?.data?.results || enrollmentsData?.data || []

  // Enroll mutation
  const enrollMutation = useMutation({
    mutationFn: async (file) => {
      setUploading(true)
      // Upload image
      const uploadRes = await faceAttendanceApi.uploadImage(
        file, activeSchool?.id, selectedClass || 0
      )
      const imageUrl = uploadRes.data.url || uploadRes.data.image_url

      // Enroll face
      return faceAttendanceApi.enrollFace({
        student_id: parseInt(selectedStudent),
        image_url: imageUrl,
      })
    },
    onSuccess: () => {
      setUploading(false)
      setPreviewUrl(null)
      setSelectedStudent('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      showSuccess('Face enrollment started! Processing...')
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

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
              <ClassSelector
                value={selectedClass}
                onChange={(e) => { setSelectedClass(e.target.value); setSelectedStudent('') }}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
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
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (#{s.roll_number})
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
              {selectedClass && ` (${enrollments.length})`}
            </h2>
          </div>

          {enrollmentsLoading ? (
            <div className="p-8"><LoadingSpinner /></div>
          ) : enrollments.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">
              {selectedClass
                ? 'No students enrolled in this class yet.'
                : 'Select a class to see enrolled students.'}
            </div>
          ) : (
            <div className="divide-y max-h-[500px] overflow-y-auto">
              {enrollments.map((enrollment) => (
                <div key={enrollment.id} className="p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{enrollment.student_name}</div>
                    <div className="text-xs text-gray-500">
                      #{enrollment.student_roll} &middot; {enrollment.class_name} &middot;
                      Quality: {(enrollment.quality_score * 100).toFixed(0)}%
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (confirm('Remove this face enrollment?')) {
                        deleteMutation.mutate(enrollment.id)
                      }
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
          {selectedClass && students.length > 0 && (
            <div className="p-3 border-t bg-gray-50 text-xs text-gray-600">
              {enrolledStudentIds.size} of {students.length} students enrolled
              {students.length - enrolledStudentIds.size > 0 && (
                <span className="text-orange-600 ml-1">
                  ({students.length - enrolledStudentIds.size} missing)
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
