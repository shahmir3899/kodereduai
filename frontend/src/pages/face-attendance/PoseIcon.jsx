// Tiny head-and-arrow pictogram for each enrollment pose. Drawn as the student
// appears on the (mirrored) screen, so an arrow pointing left means "toward the
// left side of the screen" — the student's own left.
const ARROW = { left: 'M22 30 H10 M14 26 L10 30 L14 34', right: 'M38 30 H50 M46 26 L50 30 L46 34' }

export default function PoseIcon({ pose, className = 'w-12 h-12' }) {
  const turned = pose === 'left' ? -4 : pose === 'right' ? 4 : 0
  return (
    <svg viewBox="0 0 60 60" className={className} role="img" aria-label={`${pose} pose`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* head */}
      <ellipse cx={30 + turned} cy="28" rx="11" ry="14" />
      {/* shoulders */}
      <path d="M12 56 C12 46 20 43 30 43 C40 43 48 46 48 56" />
      {/* eyes + nose shift with the turn; smile gets a mouth curve */}
      <circle cx={26 + turned * 1.6} cy="25" r="0.9" fill="currentColor" />
      <circle cx={34 + turned * 1.6} cy="25" r="0.9" fill="currentColor" />
      {pose === 'smile'
        ? <path d="M25 33 Q30 38 35 33" />
        : <path d={`M${30 + turned * 1.8} 27 V31`} />}
      {pose === 'up' && <path d="M30 8 V2 M26 5 L30 1 L34 5" />}
      {(pose === 'left' || pose === 'right') && <path d={ARROW[pose]} />}
    </svg>
  )
}
