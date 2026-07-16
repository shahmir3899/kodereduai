import { useRef, useState } from 'react'
import PhotoCropModal from './PhotoCropModal'

/**
 * Circular photo-or-initials avatar with hover upload/remove controls.
 * Mirrors the upload/crop/remove flow used on StudentProfilePage.jsx, generalized
 * for reuse across User and StaffMember avatars.
 */
export default function AvatarUpload({
  photoUrl,
  displayName,
  onUpload,
  onRemove,
  uploading = false,
  removing = false,
  sizeClass = 'w-16 h-16',
}) {
  const fileInputRef = useRef(null)
  const [cropImageSrc, setCropImageSrc] = useState(null)

  const handleFileChange = (e) => {
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
    onUpload(file)
    closeCropModal()
  }

  return (
    <div className={`relative ${sizeClass} flex-shrink-0 group`}>
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={displayName}
          className={`${sizeClass} rounded-full object-cover`}
        />
      ) : (
        <div className={`${sizeClass} rounded-full bg-primary-100 flex items-center justify-center`}>
          <span className="text-2xl font-bold text-primary-700">
            {displayName?.charAt(0)?.toUpperCase()}
          </span>
        </div>
      )}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        title={photoUrl ? 'Change photo' : 'Upload photo'}
        className="absolute inset-0 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity disabled:opacity-100 disabled:bg-black/30"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />
      {photoUrl && (
        <button
          type="button"
          onClick={onRemove}
          disabled={removing}
          title="Remove photo"
          className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-red-100 text-red-600 border border-red-200 flex items-center justify-center hover:bg-red-200"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
      {cropImageSrc && (
        <PhotoCropModal
          imageSrc={cropImageSrc}
          onCancel={closeCropModal}
          onSave={handleCropSave}
        />
      )}
    </div>
  )
}
