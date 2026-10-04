import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import { useAcademicYear } from '../../../contexts/AcademicYearContext'
import WhatsAppTick from '../../../components/WhatsAppTick'
import ReportPeriodPicker from '../../../components/ReportPeriodPicker'
import PhotoCropModal from '../../../components/PhotoCropModal'
import Badge from '../../../components/ui/Badge'
import { formatMoney, getApiErrorMessage } from './profileUtils'

const riskColors = {
  HIGH: 'bg-red-100 text-red-800 border-red-200',
  MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  LOW: 'bg-green-100 text-green-800 border-green-200',
}

// Name, photo, contact chips and the lifecycle actions. Details are edited in the
// section cards below, not here; this only reads the student.
export default function StudentProfileHeader({
  student,
  ai,
  canManageLifecycle,
  isDownloadingReport,
  onGenerateReport,
  onUpdateStatus,
  onReclassify,
  onInvite,
  onReadmit,
  summary = null,
  openExit = null,
  onContinueExit,
  onOpenFees,
}) {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const { activeAcademicYear } = useAcademicYear()
  const photoInputRef = useRef(null)
  const [cropImageSrc, setCropImageSrc] = useState(null)
  const studentKey = String(student.id)

  const uploadPhotoMutation = useMutation({
    mutationFn: (file) => studentsApi.uploadPhoto(student.id, file),
    onSuccess: () => {
      showSuccess('Photo uploaded successfully.')
      queryClient.invalidateQueries({ queryKey: ['student', studentKey] })
    },
    onError: (error) => showError(getApiErrorMessage(error, 'Failed to upload photo')),
  })

  const removePhotoMutation = useMutation({
    mutationFn: () => studentsApi.removePhoto(student.id),
    onSuccess: () => {
      showSuccess('Photo removed.')
      queryClient.invalidateQueries({ queryKey: ['student', studentKey] })
    },
    onError: (error) => showError(getApiErrorMessage(error, 'Failed to remove photo')),
  })

  const handlePhotoFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) setCropImageSrc(URL.createObjectURL(file))
    e.target.value = ''
  }

  const closeCropModal = () => {
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc)
    setCropImageSrc(null)
  }

  const handleCropSave = (blob) => {
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
    uploadPhotoMutation.mutate(file)
    closeCropModal()
  }

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="relative w-16 h-16 flex-shrink-0 group">
            {student.photo_url ? (
              <img
                src={student.photo_url}
                alt={student.name}
                className="w-16 h-16 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary-700">
                  {student.name?.charAt(0)?.toUpperCase()}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={uploadPhotoMutation.isPending}
              title={student.photo_url ? 'Change photo' : 'Upload photo'}
              className="absolute inset-0 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity disabled:opacity-100 disabled:bg-black/30"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handlePhotoFileChange}
              className="hidden"
            />
            {student.photo_url && (
              <button
                type="button"
                onClick={() => removePhotoMutation.mutate()}
                disabled={removePhotoMutation.isPending}
                title="Remove photo"
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-red-100 text-red-600 border border-red-200 flex items-center justify-center hover:bg-red-200"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{student.name}</h1>
              {ai?.left_school ? (
                <Badge tone="neutral">Left school</Badge>
              ) : ai?.overall_risk && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${riskColors[ai.overall_risk]}`}>
                  {ai.overall_risk} Risk
                </span>
              )}
              {student.status && student.status !== 'ACTIVE' && (
                <Badge tone="neutral">
                  {student.status}
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm text-gray-500">
              <span>Roll #{student.roll_number}</span>
              <span>{student.class_name}</span>
              {student.admission_number && <span>Adm #{student.admission_number}</span>}
              {student.gender && <span>{student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : 'Other'}</span>}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm text-gray-500">
              {student.parent_phone && <span>Parent: {student.parent_phone}<WhatsAppTick phone={student.parent_phone} /></span>}
              {student.guardian_phone && <span>Guardian: {student.guardian_phone}<WhatsAppTick phone={student.guardian_phone} /></span>}
              {student.parent_name && <span>{student.parent_name}</span>}
            </div>
            {/* Quick-action chips */}
            <div className="flex flex-wrap gap-2 mt-2">
              {summary?.pending_fee > 0 && (
                <button
                  type="button"
                  onClick={onOpenFees}
                  title="Open the fee ledger"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                >
                  Pending fee: PKR {formatMoney(summary.pending_fee)}
                </button>
              )}
              {openExit && canManageLifecycle && (
                <button
                  type="button"
                  onClick={onContinueExit}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100"
                >
                  Exit in progress — Continue
                </button>
              )}
              {student.emergency_contact && (
                <a
                  href={`tel:${student.emergency_contact}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  Emergency: {student.emergency_contact}
                </a>
              )}
              {student.has_user_account ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  Portal: {student.user_username}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500 border border-gray-200">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                  No portal account
                </span>
              )}
              {canManageLifecycle && (
                <button
                  type="button"
                  onClick={onInvite}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-50 text-sky-700 border border-sky-200 hover:bg-sky-100"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Generate Parent Invite
                </button>
              )}
              {student.status && student.status !== 'ACTIVE' && student.status_reason && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200" title={student.status_reason}>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {student.status_reason.length > 40 ? student.status_reason.slice(0, 40) + '…' : student.status_reason}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 flex-shrink-0">
            {canManageLifecycle && (
              <button
                onClick={onUpdateStatus}
                className="px-4 py-2 bg-amber-100 text-amber-800 border border-amber-200 rounded-lg hover:bg-amber-200 text-sm"
              >
                Update Status
              </button>
            )}
            {canManageLifecycle && ['WITHDRAWN', 'TRANSFERRED'].includes(student.status) && (
              <button
                onClick={onReadmit}
                className="px-4 py-2 bg-green-100 text-green-800 border border-green-200 rounded-lg hover:bg-green-200 text-sm"
              >
                Re-admit
              </button>
            )}
            {canManageLifecycle && (
              <button
                onClick={onReclassify}
                className="px-4 py-2 bg-blue-100 text-blue-800 border border-blue-200 rounded-lg hover:bg-blue-200 text-sm"
              >
                Reclassify
              </button>
            )}
            <ReportPeriodPicker
              label={isDownloadingReport ? 'Generating...' : 'Download Report'}
              activeAcademicYearId={activeAcademicYear?.id}
              disabled={isDownloadingReport}
              onSelect={onGenerateReport}
            />
          </div>
        </div>
      </div>

      <ExitBanner exit={summary?.latest_exit} student={student} />

      {cropImageSrc && (
        <PhotoCropModal
          imageSrc={cropImageSrc}
          onCancel={closeCropModal}
          onSave={handleCropSave}
        />
      )}
    </>
  )
}

// Shown for a student who has left: when, and any fee or book waived on the way out,
// with who waived it and why. Only admin roles receive latest_exit from the server.
function ExitBanner({ exit, student }) {
  // Only while the student is actually out: after a re-activation the old exit is history.
  if (!exit || exit.status !== 'FINALIZED' || !['WITHDRAWN', 'TRANSFERRED'].includes(student.status)) return null
  const waived = (exit.items || []).filter((i) => i.state === 'WAIVED')
  const verb = exit.exit_type === 'TRANSFERRED' ? 'Transferred' : 'Withdrawn'
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900" role="status">
      <p className="font-semibold">
        {verb}{exit.destination_school_name ? ` to ${exit.destination_school_name}` : ''} on {new Date(exit.leaving_date).toLocaleDateString()}
      </p>
      {exit.reason && <p className="mt-0.5">Reason: {exit.reason}</p>}
      {waived.length > 0 && (
        <ul className="mt-2 space-y-1">
          {waived.map((i) => (
            <li key={i.kind}>
              <span className="font-medium">{i.kind_label} waived{i.summary ? ` (${i.summary})` : ''}</span>
              {' '}by {i.waived_by_name} on {new Date(i.waived_at).toLocaleDateString()}: {i.waiver_reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
