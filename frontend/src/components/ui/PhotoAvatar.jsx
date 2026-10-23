import { useState } from 'react'

/**
 * Round student photo that falls back to the first letter of the name. A broken
 * photo_url (deleted file, expired link) must not leave a broken-image icon in the portal.
 */
export default function PhotoAvatar({ url, name, className = 'w-16 h-16', fallbackClassName = 'bg-primary-100 text-primary-700', textClassName = 'text-2xl' }) {
  const [failed, setFailed] = useState(false)

  if (url && !failed) {
    return (
      <img
        src={url}
        alt={name || ''}
        onError={() => setFailed(true)}
        className={`${className} rounded-full object-cover flex-shrink-0`}
      />
    )
  }
  return (
    <div className={`${className} ${fallbackClassName} rounded-full flex items-center justify-center flex-shrink-0`}>
      <span className={`${textClassName} font-bold`}>{name?.charAt(0)?.toUpperCase() || '?'}</span>
    </div>
  )
}
