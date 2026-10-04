export default function StudentAvatar({ student, sizeClass = 'w-8 h-8' }) {
  if (student.photo_url) {
    return (
      <img
        src={student.photo_url}
        alt={student.name}
        className={`${sizeClass} rounded-full object-cover flex-shrink-0`}
      />
    )
  }
  return (
    <div className={`${sizeClass} rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0`}>
      <span className="text-xs font-bold text-primary-700">
        {student.name?.charAt(0)?.toUpperCase()}
      </span>
    </div>
  )
}
