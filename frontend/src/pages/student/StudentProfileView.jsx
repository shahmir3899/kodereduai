import { useQuery } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

export default function StudentProfileView() {
  const { user } = useAuth()

  const { data: profileData, isLoading, error } = useQuery({
    queryKey: ['studentProfile'],
    queryFn: () => studentPortalApi.getProfile(),
  })

  const profile = profileData?.data || {}
  const student = profile.student || profile || {}
  const guardian = profile.guardian || profile.parent || student.guardian || student.parent || {}

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
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load profile</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  const InfoRow = ({ label, value }) => (
    <div className="flex flex-col sm:flex-row sm:items-center py-3 border-b border-gray-100 last:border-0">
      <dt className="text-sm font-medium text-gray-500 sm:w-48 flex-shrink-0">{label}</dt>
      <dd className="text-sm text-gray-900 mt-1 sm:mt-0">{value || '-'}</dd>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Profile</h1>
        <p className="text-sm text-gray-500 mt-1">Your personal and academic information</p>
      </div>

      {/* Profile Header Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-blue-700">
              {(student.name || user?.first_name || user?.username || '?').charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 truncate">
              {student.name || student.full_name || `${user?.first_name || ''} ${user?.last_name || ''}`.trim() || user?.username || 'Student'}
            </h2>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              {student.class_name && (
                <span className="text-sm text-gray-500">
                  {student.class_name}{student.section ? ` - ${student.section}` : ''}
                </span>
              )}
              {student.roll_number && (
                <span className="text-sm text-gray-500">Roll #{student.roll_number}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Student Information */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">Student Information</h3>
        </div>
        <div className="px-5 py-2">
          <dl>
            <InfoRow label="Full Name" value={student.name || student.full_name} />
            <InfoRow label="Roll Number" value={student.roll_number} />
            <InfoRow label="Class" value={
              student.class_name
                ? `${student.class_name}${student.section ? ` - ${student.section}` : ''}`
                : null
            } />
            <InfoRow label="Admission Number" value={student.admission_number} />
            <InfoRow
              label="Date of Birth"
              value={student.date_of_birth
                ? new Date(student.date_of_birth).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric'
                  })
                : null
              }
            />
            <InfoRow label="Gender" value={student.gender} />
            <InfoRow label="Blood Group" value={student.blood_group} />
          </dl>
        </div>
      </div>

      {/* Address */}
      {(student.address || student.current_address || student.permanent_address) && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-900">Address</h3>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-gray-700 leading-relaxed">
              {student.address || student.current_address || student.permanent_address}
            </p>
          </div>
        </div>
      )}

      {/* Guardian / Parent Info */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-5 py-4 border-b border-gray-200">
          <h3 className="text-base font-semibold text-gray-900">Parent / Guardian Information</h3>
        </div>
        <div className="px-5 py-2">
          <dl>
            <InfoRow label="Name" value={
              guardian.name || guardian.full_name || guardian.father_name || student.father_name || student.guardian_name
            } />
            <InfoRow label="Phone" value={
              guardian.phone || guardian.phone_number || guardian.contact_number || student.guardian_phone || student.parent_phone
            } />
            <InfoRow label="Email" value={
              guardian.email || student.guardian_email || student.parent_email
            } />
            <InfoRow label="Relation" value={guardian.relation || guardian.relationship} />
          </dl>
        </div>
      </div>

      {/* School Info */}
      {(student.school_name || profile.school_name) && (
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-4 border-b border-gray-200">
            <h3 className="text-base font-semibold text-gray-900">School Information</h3>
          </div>
          <div className="px-5 py-2">
            <dl>
              <InfoRow label="School Name" value={student.school_name || profile.school_name} />
              <InfoRow label="Academic Year" value={student.academic_year || profile.academic_year} />
            </dl>
          </div>
        </div>
      )}
    </div>
  )
}
