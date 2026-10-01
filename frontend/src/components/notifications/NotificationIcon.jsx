const PATHS = {
  absence: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M17 8l5 5M22 8l-5 5" />
    </>
  ),
  fee: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14.5" r="1" />
    </>
  ),
  result: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  schedule: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  general: (
    <>
      <path d="M6 17V11a6 6 0 1112 0v6l1.5 2h-15z" />
      <path d="M10 21h4" />
    </>
  ),
  transport: (
    <>
      <rect x="4" y="3" width="16" height="15" rx="3" />
      <path d="M4 12h16M8 21v-3M16 21v-3" />
    </>
  ),
  library: <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2zM4 19V5" />,
  assign: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 4h6v3H9zM9 12h6M9 16h4" />
    </>
  ),
  risk: (
    <>
      <path d="M12 4l9.5 16h-19z" />
      <path d="M12 10v4M12 17v.5" />
    </>
  ),
  leave: <path d="M5 12l4.5 4.5L19 7" />,
}

export default function NotificationIcon({ name, className = 'w-4 h-4' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name] || PATHS.general}
    </svg>
  )
}

export function SparkleIcon({ className = 'w-4 h-4' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
    </svg>
  )
}
