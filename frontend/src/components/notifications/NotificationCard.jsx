import { useState } from 'react'
import NotificationIcon from './NotificationIcon'
import {
  TONES, BUNDLE_PREVIEW, getEventMeta, schoolColor, NEUTRAL_STRIPE, timeAgo, initials,
} from './notificationMeta'

// Long bodies (e.g. a class's full list of absent students) fold after a few
// lines in a slide, but never lose text: "Show more" reveals all of it.
const FOLD_CHARS = 160

function Body({ text, fold, className = '' }) {
  const [more, setMore] = useState(false)
  if (!text) return null
  const folded = fold && !more && text.length > FOLD_CHARS
  return (
    <div className={className}>
      <p className={`leading-snug whitespace-pre-line break-words ${folded ? 'line-clamp-3' : ''}`}>{text}</p>
      {fold && text.length > FOLD_CHARS && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setMore((v) => !v)
          }}
          className="mt-0.5 text-xs font-semibold text-primary-600 hover:text-primary-700"
        >
          {more ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

/**
 * One notification, shared by the dashboard carousel (variant="slide") and the
 * inbox / bell lists (variant="row"). A bundle renders as one card that lists
 * its members with their own title and body, so names and amounts stay visible.
 *
 * @param {object} props
 * @param {object} props.n - notification, or a bundle from bundleNotifications()
 * @param {boolean} props.multiSchool - show school name + colour stripe only when the user has several schools
 * @param {(n: object) => void} props.onOpen - called when a single notification is activated
 * @param {(open: boolean, bundle: object) => void} [props.onExpandChange]
 */
export default function NotificationCard({ n, variant = 'slide', multiSchool, onOpen, onExpandChange }) {
  const [open, setOpen] = useState(false)
  const meta = getEventMeta(n.event_type)
  const tone = TONES[meta.tone]
  const stripe = multiSchool ? schoolColor(n.school) : NEUTRAL_STRIPE
  const isSlide = variant === 'slide'

  const toggle = (e) => {
    e.stopPropagation()
    const next = !open
    setOpen(next)
    onExpandChange?.(next, n)
  }

  const activate = () => {
    if (!n.bundle) onOpen?.(n)
  }

  // Unread stands out (white, ringed, bold); read recedes (grey, muted).
  const isNew = !n.is_read
  const shell = isSlide
    ? `min-h-[176px] ${isNew ? 'bg-white ring-1 ring-primary-200 shadow-sm' : 'bg-gray-50'}`
    : `border ${isNew ? 'bg-white border-primary-200 shadow-sm' : 'bg-gray-50 border-gray-200 hover:border-gray-300'}`

  const children = n.bundle ? n.children : []
  const hasMore = children.length > BUNDLE_PREVIEW
  const visible = open ? children : children.slice(0, BUNDLE_PREVIEW)

  return (
    <article
      role={n.bundle ? undefined : 'button'}
      tabIndex={n.bundle ? undefined : 0}
      onClick={activate}
      onKeyDown={(e) => {
        if (!n.bundle && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          activate()
        }
      }}
      className={`relative w-full text-left rounded-xl pl-5 pr-3.5 py-3 flex flex-col gap-2 overflow-hidden ${shell} ${n.bundle ? '' : 'cursor-pointer'} transition-colors`}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: stripe }} aria-hidden="true" />

      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full pl-1.5 pr-2.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}>
          <NotificationIcon name={meta.icon} className="w-3.5 h-3.5" />
          {meta.label}
        </span>
        {n.bundle && (
          <span className={`rounded-lg px-1.5 text-xs font-bold tabular-nums ${tone.chip}`}>{n.count}</span>
        )}
        <span className="ml-auto flex items-center gap-1.5 text-[11px] text-gray-500 whitespace-nowrap">
          {isNew && (
            <span className="rounded-full bg-primary-600 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white">New</span>
          )}
          {timeAgo(n.created_at)}
        </span>
      </div>

      <h3 className={`text-[15px] leading-snug break-words ${isNew ? 'font-bold text-gray-900' : 'font-medium text-gray-500'}`}>
        {n.title || meta.label}
      </h3>

      {n.bundle && n.total != null && (
        <p className="text-sm text-gray-700">
          <span className="text-lg font-bold tabular-nums text-gray-900">Rs {n.total.toLocaleString('en-PK')}</span>
          {' '}pending in total
        </p>
      )}

      {!n.bundle && <Body text={n.body} fold={isSlide} className={`text-sm ${isNew ? 'text-gray-700' : 'text-gray-500'}`} />}

      {n.bundle && (
        <ul className={`space-y-1.5 ${open ? 'max-h-52 overflow-y-auto pr-1' : ''}`}>
          {visible.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen?.(c)
                }}
                className={`w-full text-left rounded-lg px-2.5 py-1.5 flex gap-2 items-start hover:bg-gray-100 ${isNew ? 'bg-gray-50' : 'bg-white'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] break-words ${c.is_read ? 'font-medium text-gray-500' : 'font-semibold text-gray-900'}`}>
                    {c.student_name ? `${c.student_name} · ` : ''}{c.title}
                  </span>
                  <Body text={c.body} fold={false} className="text-xs text-gray-600" />
                </span>
                {!c.is_read && <span className="w-1.5 h-1.5 rounded-full bg-primary-500 mt-1.5 shrink-0" aria-label="Unread" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto flex items-center gap-2 text-xs text-gray-500 flex-wrap min-w-0">
        {!n.bundle && n.student_name ? (
          <>
            <span className="w-5 h-5 rounded-full bg-white border border-gray-200 grid place-items-center text-[10px] font-bold text-gray-700">
              {initials(n.student_name)}
            </span>
            <span className="truncate">{n.student_name}</span>
          </>
        ) : null}
        {multiSchool && n.school_name ? (
          <span className="inline-flex items-center gap-1.5">
            <i className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: stripe }} />
            {n.school_name}
          </span>
        ) : null}
        {hasMore && (
          <button
            type="button"
            onClick={toggle}
            className="ml-auto border border-gray-300 rounded-lg px-2.5 py-0.5 font-semibold text-gray-700 hover:bg-white"
          >
            {open ? 'Show fewer' : `Show all ${children.length}`}
          </button>
        )}
      </div>
    </article>
  )
}
