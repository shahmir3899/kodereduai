import { useRef } from 'react'
import StudentAvatar from './StudentAvatar'

// Avatar with upload/remove controls, shown at the top of the edit form. Picking
// a file only reports it (onFileSelected); the page owns cropping and uploading.
export default function StudentPhotoControl({ student, isUploading, isRemoving, onFileSelected, onRemove }) {
  const inputRef = useRef(null)

  const handleChange = (e) => {
    const file = e.target.files?.[0]
    if (file) onFileSelected(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative w-16 h-16 flex-shrink-0 group">
        <StudentAvatar student={student} sizeClass="w-16 h-16" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          title={student.photo_url ? 'Change photo' : 'Upload photo'}
          className="absolute inset-0 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity disabled:opacity-100 disabled:bg-black/30"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleChange}
          className="hidden"
        />
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className="text-sm font-medium text-primary-600 hover:text-primary-700 text-left"
        >
          {student.photo_url ? 'Change Photo' : 'Upload Photo'}
        </button>
        {student.photo_url && (
          <button
            type="button"
            onClick={onRemove}
            disabled={isRemoving}
            className="text-sm font-medium text-red-600 hover:text-red-700 text-left"
          >
            {isRemoving ? 'Removing...' : 'Remove Photo'}
          </button>
        )}
      </div>
    </div>
  )
}
