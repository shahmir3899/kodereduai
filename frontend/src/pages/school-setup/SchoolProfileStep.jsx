import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { schoolsApi } from '../../services/api'
import { useToast } from '../../components/Toast'

export default function SchoolProfileStep({ onNext }) {
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [uploadingLetterhead, setUploadingLetterhead] = useState(false)

  const { data: schoolRes, isLoading } = useQuery({
    queryKey: ['currentSchool'],
    queryFn: () => schoolsApi.getMySchool(),
  })

  const school = schoolRes?.data

  const uploadMut = useMutation({
    mutationFn: ({ file, assetType }) => schoolsApi.uploadAsset(file, assetType),
    onSuccess: (_, { assetType }) => {
      queryClient.invalidateQueries({ queryKey: ['currentSchool'] })
      addToast(`${assetType === 'logo' ? 'Logo' : 'Letterhead'} uploaded!`, 'success')
      if (assetType === 'logo') setUploadingLogo(false)
      else setUploadingLetterhead(false)
    },
    onError: (err, { assetType }) => {
      addToast(err.response?.data?.detail || 'Upload failed', 'error')
      if (assetType === 'logo') setUploadingLogo(false)
      else setUploadingLetterhead(false)
    },
  })

  const handleUpload = (e, assetType) => {
    const file = e.target.files?.[0]
    if (!file) return
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
    if (!allowed.includes(file.type)) {
      addToast('Please upload a JPG, PNG, WebP, or SVG file.', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      addToast('File must be under 5MB.', 'error')
      return
    }
    if (assetType === 'logo') setUploadingLogo(true)
    else setUploadingLetterhead(true)
    uploadMut.mutate({ file, assetType })
  }

  if (isLoading) {
    return <StepSkeleton />
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900 mb-1">School Profile</h2>
      <p className="text-sm text-gray-500 mb-6">Review your school information and upload branding assets.</p>

      {/* School Info Card */}
      <div className="bg-white rounded-xl border p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <InfoRow label="School Name" value={school?.name} />
          <InfoRow label="Subdomain" value={school?.subdomain} />
          <InfoRow label="Address" value={school?.address || '—'} />
          <InfoRow label="Contact Email" value={school?.contact_email || '—'} />
          <InfoRow label="Contact Phone" value={school?.contact_phone || '—'} />
          {school?.organization_name && (
            <InfoRow label="Organization" value={school.organization_name} />
          )}
        </div>
        <p className="text-xs text-gray-400 mt-4">
          To edit school details, go to Settings or contact your super admin.
        </p>
      </div>

      {/* Logo & Letterhead Upload */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <AssetCard
          title="School Logo"
          description="Used in header, reports, and notifications"
          currentUrl={school?.logo}
          uploading={uploadingLogo}
          onUpload={(e) => handleUpload(e, 'logo')}
        />
        <AssetCard
          title="Letterhead"
          description="Background for official letters and report cards"
          currentUrl={school?.letterhead_url}
          uploading={uploadingLetterhead}
          onUpload={(e) => handleUpload(e, 'letterhead')}
        />
      </div>
    </div>
  )
}

function InfoRow({ label, value }) {
  return (
    <div>
      <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</span>
      <p className="text-sm text-gray-800 mt-0.5">{value}</p>
    </div>
  )
}

function AssetCard({ title, description, currentUrl, uploading, onUpload }) {
  return (
    <div className="bg-white rounded-xl border p-5">
      <h3 className="text-sm font-medium text-gray-800 mb-1">{title}</h3>
      <p className="text-xs text-gray-500 mb-3">{description}</p>
      {currentUrl ? (
        <div className="mb-3">
          <img
            src={currentUrl}
            alt={title}
            className="h-20 object-contain rounded border bg-gray-50 p-1"
          />
        </div>
      ) : (
        <div className="h-20 bg-gray-50 rounded border-2 border-dashed border-gray-200 flex items-center justify-center mb-3">
          <span className="text-xs text-gray-400">No {title.toLowerCase()} uploaded</span>
        </div>
      )}
      <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
        uploading ? 'bg-gray-100 text-gray-400' : 'bg-sky-50 text-sky-700 hover:bg-sky-100'
      }`}>
        {uploading ? 'Uploading...' : currentUrl ? 'Replace' : 'Upload'}
        <input type="file" accept="image/*" className="hidden" onChange={onUpload} disabled={uploading} />
      </label>
    </div>
  )
}

function StepSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-6 bg-gray-200 rounded w-40 mb-2" />
      <div className="h-4 bg-gray-100 rounded w-64 mb-6" />
      <div className="bg-white rounded-xl border p-6 mb-6">
        <div className="grid grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i}>
              <div className="h-3 bg-gray-100 rounded w-20 mb-2" />
              <div className="h-4 bg-gray-200 rounded w-32" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
