import { useEffect, useMemo, useRef, useState } from 'react'
import EmptyState from '../ui/EmptyState'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { notificationsApi } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import NotificationCard from './NotificationCard'
import { SparkleIcon } from './NotificationIcon'
import { BUNDLE_PREVIEW, bundleNotifications, sortForRole } from './notificationMeta'
import { useNotificationActions } from './useNotificationActions'

const SLIDE_SECONDS = 6
const PAGE_SIZE = 10
// Stop pulling history past this; the "See all" slide covers the rest.
const MAX_LOADED = 40
// A slide counts as seen once it has been on screen this long.
const SEEN_DWELL_MS = 1500
const MODE_STORAGE_KEY = 'notificationCarouselMode'

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const readStoredMode = () => {
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'all' ? 'all' : 'unread'
  } catch {
    return 'unread'
  }
}

function DigestSlide({ digest }) {
  return (
    <div className="rounded-xl bg-sky-950 text-sky-50 px-4 py-3.5 min-h-[176px] flex flex-col gap-2.5">
      <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-sky-300">
        <SparkleIcon className="w-3.5 h-3.5" />
        Daily digest{digest.source === 'ai' ? ' · AI summary' : ''}
      </span>
      <p className="text-[15px] leading-relaxed">{digest.text}</p>
      <div className="mt-auto flex flex-wrap gap-2">
        {digest.stats.map((s) => (
          <span key={s.event_type} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs tabular-nums">
            <b className="text-sm">{s.count}</b> {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function EndSlide({ remaining, mode, onShowAll }) {
  const unreadMode = mode === 'unread'
  return (
    <div className="rounded-xl bg-gray-50 min-h-[176px] flex flex-col items-center justify-center gap-2 text-center px-4">
      {remaining > 0 && <div className="text-2xl font-bold tabular-nums text-gray-900">+{remaining}</div>}
      <p className="text-sm text-gray-500">
        {remaining > 0
          ? `more ${unreadMode ? 'unread ' : ''}notifications in your inbox`
          : unreadMode ? "You're all caught up" : 'That is everything'}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Link to="/notifications" className="btn btn-primary text-sm">
          See all notifications
        </Link>
        {unreadMode && (
          <button type="button" onClick={onShowAll} className="btn btn-secondary text-sm">
            Include read
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Dashboard / bell notification slideshow for every role.
 *
 * Unread gets the screen time:
 *  - It opens on "Unread" (switchable to "All"); the AI digest leads, then
 *    unread notifications by role priority, then a "see all" slide.
 *  - Autoplay plays each unread slide once, skips read ones and then rests.
 *  - A slide shown for a moment is marked read and drops behind the unread ones,
 *    but only once the viewer has moved off it, so slides never jump underneath.
 *  - Dots are coloured for unread; read slides are grey.
 * History loads in the background near the end, so there is no Load more button.
 */
export default function NotificationCarousel({ allSchools = false, showViewAll = true, onNavigate }) {
  const { user, activeSchool: authSchool } = useAuth()
  // The bell spans every school; dashboards follow the active school.
  const activeSchool = allSchools ? null : authSchool
  const { open: openNotification, markSeen } = useNotificationActions()
  const open = (n) => {
    openNotification(n)
    onNavigate?.()
  }
  const schoolId = activeSchool?.id || 'all'
  const multiSchool = (user?.schools?.length || 0) > 1

  const [mode, setMode] = useState(readStoredMode)
  const changeMode = (m) => {
    setMode(m)
    setActiveKey(null)
    visitedRef.current = new Set()
    setPlayDone(false)
    try {
      localStorage.setItem(MODE_STORAGE_KEY, m)
    } catch {
      // Remembering the choice is a convenience only.
    }
  }

  const feed = useInfiniteQuery({
    queryKey: ['notificationCarousel', schoolId, mode],
    queryFn: ({ pageParam }) =>
      notificationsApi.getMyNotifications({
        page: pageParam,
        page_size: PAGE_SIZE,
        ordering: 'unread_first',
        unread: mode === 'unread' ? 1 : undefined,
        school_id: activeSchool?.id || undefined,
      }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.data?.next ? pages.length + 1 : undefined),
    staleTime: 2 * 60 * 1000,
    // The cached pages may predate reads made elsewhere (and seen-state is lost
    // on unmount), so always reconcile with the server when the carousel mounts.
    refetchOnMount: 'always',
  })

  // Same source as the bell badge, so the two numbers can never disagree.
  // The dashboard follows the active school; the bell spans all schools.
  const unreadQuery = useQuery({
    queryKey: allSchools ? ['notificationUnreadCount'] : ['notificationUnreadCount', schoolId],
    queryFn: () => notificationsApi.getUnreadCount(allSchools ? undefined : { school_id: activeSchool?.id || undefined }),
    refetchInterval: 30000,
    staleTime: 15000,
  })

  const digestQuery = useQuery({
    queryKey: ['notificationDigest', schoolId],
    queryFn: () => notificationsApi.getDigest({ school_id: activeSchool?.id || undefined }),
    staleTime: 30 * 60 * 1000,
  })

  // Rows move between pages as they are marked read, so a later page can repeat
  // one already loaded; dedupe by id.
  const loaded = useMemo(() => {
    const all = feed.data?.pages.flatMap((p) => p.data?.results || p.data || []) || []
    return [...new Map(all.map((n) => [n.id, n])).values()]
  }, [feed.data])
  const totalCount = feed.data?.pages[0]?.data?.count ?? loaded.length

  // Ids the user has seen this session, kept apart from the fetched data so
  // marking something read never refetches and re-sorts the slides.
  const [seen, setSeen] = useState(() => new Set())
  const localUnread = loaded.filter((n) => !n.is_read && !seen.has(n.id)).length
  const serverUnread = unreadQuery.data?.data?.unread_count
  const unreadCount = serverUnread ?? localUnread

  const cardsView = useMemo(
    () => bundleNotifications(sortForRole(loaded, user?.role)).map((c) => {
      if (c.bundle) {
        const children = c.children.map((k) => ({ ...k, is_read: k.is_read || seen.has(k.id) }))
        return { ...c, children, is_read: children.every((k) => k.is_read) }
      }
      return seen.has(c.id) ? { ...c, is_read: true } : c
    }),
    [loaded, user?.role, seen],
  )

  // Refs keep markIds stable so the dwell timer isn't reset by unrelated renders.
  const seenRef = useRef(seen)
  seenRef.current = seen
  const markSeenRef = useRef(markSeen.mutate)
  markSeenRef.current = markSeen.mutate
  const markIds = useRef((ids) => {
    const fresh = ids.filter((id) => !seenRef.current.has(id))
    if (!fresh.length) return
    setSeen((prev) => new Set([...prev, ...fresh]))
    markSeenRef.current(fresh)
  }).current

  const [activeKey, setActiveKey] = useState(null)
  const [userPaused, setUserPaused] = useState(false)
  const [playDone, setPlayDone] = useState(false)
  const [hold, setHold] = useState({ hover: false, focus: false, expanded: false })
  const [hidden, setHidden] = useState(typeof document !== 'undefined' && document.hidden)
  const visitedRef = useRef(new Set())
  const lastIndex = useRef(0)
  const reduced = useRef(prefersReducedMotion())
  const touchX = useRef(null)
  const swiped = useRef(false)

  const digest = digestQuery.data?.data
  const hasDigest = !!digest?.text && unreadCount > 0

  // The slide being viewed counts as unread for ordering, so a slide that was
  // just marked read stays put until the viewer leaves it.
  const orderedCards = useMemo(() => {
    const live = (c) => !c.is_read || String(c.id) === activeKey
    const front = cardsView.filter(live)
    return mode === 'unread' ? front : [...front, ...cardsView.filter((c) => !live(c))]
  }, [cardsView, activeKey, mode])

  const slides = useMemo(() => {
    const list = []
    if (hasDigest) list.push({ key: 'digest', kind: 'digest', unread: true })
    orderedCards.forEach((c) => list.push({ key: String(c.id), kind: 'card', card: c, unread: !c.is_read }))
    list.push({ key: 'end', kind: 'end', unread: false })
    return list
  }, [hasDigest, orderedCards])

  const slideCount = slides.length
  const found = slides.findIndex((s) => s.key === activeKey)
  const index = found >= 0 ? found : Math.min(lastIndex.current, slideCount - 1)
  lastIndex.current = index
  const current = slides[index]
  const paused = userPaused || hold.hover || hold.focus || hold.expanded || hidden
  const autoplaying = !playDone && !reduced.current

  const go = (i) => {
    const s = slides[((i % slideCount) + slideCount) % slideCount]
    if (s) setActiveKey(s.key)
  }

  // Pin the key of whatever is on screen and note it as visited. Wait for the
  // data first, or the lone "see all" slide gets pinned and the show starts at the end.
  const ready = !feed.isLoading
  useEffect(() => {
    if (!ready || !current) return
    if (current.key !== activeKey) setActiveKey(current.key)
    visitedRef.current.add(current.key)
  }, [ready, current, activeKey])

  useEffect(() => {
    const onVis = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Showing a notification long enough counts as reading it. A bundle counts
  // only when all its members are on screen; a larger one is marked when the
  // user opens "Show all", not just passed over.
  const card = current?.kind === 'card' ? current.card : null
  const dwellIds = (() => {
    if (!card) return ''
    if (!card.bundle) return card.is_read ? '' : String(card.id)
    if (card.children.length > BUNDLE_PREVIEW) return ''
    return card.children.filter((k) => !k.is_read).map((k) => k.id).join(',')
  })()
  useEffect(() => {
    if (!dwellIds || hidden) return undefined
    const t = setTimeout(() => markIds(dwellIds.split(',').map(Number)), SEEN_DWELL_MS)
    return () => clearTimeout(t)
  }, [dwellIds, hidden, markIds])

  // Pull the next page quietly when within two slides of the end.
  useEffect(() => {
    if (index >= slideCount - 3 && feed.hasNextPage && !feed.isFetchingNextPage && loaded.length < MAX_LOADED) {
      feed.fetchNextPage()
    }
  }, [index, slideCount, feed, loaded.length])

  // Autoplay plays each unread slide once: jump to the next one not yet shown,
  // wrapping around, and rest when nothing is left.
  const advance = () => {
    const playable = (s) => s.unread && !visitedRef.current.has(s.key)
    const order = [...slides.slice(index + 1), ...slides.slice(0, index)]
    const next = order.find(playable)
    if (next) setActiveKey(next.key)
    else setPlayDone(true)
  }

  const togglePlay = () => {
    if (playDone) {
      visitedRef.current = new Set(current ? [current.key] : [])
      setPlayDone(false)
      setUserPaused(false)
      return
    }
    setUserPaused((v) => !v)
  }

  if (feed.isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-44 rounded-xl bg-gray-100" />
        <div className="h-6 rounded bg-gray-100 w-1/2 mx-auto" />
      </div>
    )
  }

  if (!loaded.length && mode === 'all') {
    return <EmptyState title="No notifications" compact />
  }

  const remaining = Math.max(totalCount - loaded.length, 0)
  const nodes = slides.map((s) => {
    if (s.kind === 'digest') return <DigestSlide key="digest" digest={digest} />
    if (s.kind === 'end') return <EndSlide key="end" remaining={remaining} mode={mode} onShowAll={() => changeMode('all')} />
    return (
      <NotificationCard
        key={s.key}
        n={s.card}
        multiSchool={multiSchool}
        onOpen={open}
        onExpandChange={(v, bundle) => {
          setHold((h) => ({ ...h, expanded: v }))
          if (v && bundle?.children) markIds(bundle.children.map((k) => k.id))
        }}
      />
    )
  })

  const dotTone = (s, i) => {
    if (i === index) return 'w-6 bg-gray-200'
    if (s.kind === 'end') return 'w-1.5 bg-gray-200'
    return s.unread ? 'w-1.5 bg-primary-500' : 'w-1.5 bg-gray-300'
  }

  return (
    <div
      className="space-y-3"
      onMouseEnter={() => setHold((h) => ({ ...h, hover: true }))}
      onMouseLeave={() => setHold((h) => ({ ...h, hover: false }))}
      onFocus={() => setHold((h) => ({ ...h, focus: true }))}
      onBlur={() => setHold((h) => ({ ...h, focus: false }))}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(index + 1)
        if (e.key === 'ArrowLeft') go(index - 1)
      }}
      role="region"
      aria-roledescription="carousel"
      aria-label="Notifications"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">
          {unreadCount > 0 ? `${unreadCount} unread` : 'All read'}
        </span>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg bg-gray-100 p-0.5 text-xs font-medium" role="group" aria-label="Show">
            {[['unread', 'Unread'], ['all', 'All']].map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => mode !== m && changeMode(m)}
                className={`px-2.5 py-0.5 rounded-md ${mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {showViewAll && (
            <Link to="/notifications" className="text-xs text-primary-600 hover:text-primary-700 font-medium">
              View all
            </Link>
          )}
        </div>
      </div>

      <div
        className="overflow-hidden rounded-xl touch-pan-y"
        onPointerDown={(e) => { touchX.current = e.clientX }}
        onPointerUp={(e) => {
          if (touchX.current === null) return
          const dx = e.clientX - touchX.current
          touchX.current = null
          if (Math.abs(dx) > 40) {
            swiped.current = true
            go(index + (dx < 0 ? 1 : -1))
          }
        }}
        // A swipe that ends on a card must not also open it.
        onClickCapture={(e) => {
          if (swiped.current) {
            swiped.current = false
            e.stopPropagation()
          }
        }}
      >
        <div
          className="flex transition-transform duration-500 ease-out motion-reduce:transition-none"
          style={{ transform: `translateX(-${index * 100}%)` }}
        >
          {nodes.map((node, i) => (
            <div
              key={node.key}
              className="w-full shrink-0 min-w-0 flex [&>*]:flex-1 [&>*]:min-w-0"
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} of ${slideCount}`}
              aria-hidden={i !== index}
              // Keep off-screen slides out of the tab order.
              inert={i !== index ? '' : undefined}
            >
              {node}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => go(index - 1)} aria-label="Previous slide" className="w-7 h-7 rounded-full border border-gray-200 grid place-items-center hover:bg-gray-50 shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>

        <div className="flex-1 min-w-0 flex items-center justify-center gap-1.5 flex-wrap">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => go(i)}
              aria-label={`Go to slide ${i + 1}${s.unread ? ' (unread)' : ''}`}
              aria-current={i === index}
              className={`relative h-1.5 rounded-full overflow-hidden transition-all ${dotTone(s, i)}`}
            >
              {i === index && (
                <span
                  // key restarts the fill whenever the slide changes
                  key={`${s.key}-${playDone}`}
                  className={`absolute inset-0 bg-primary-600 origin-left ${autoplaying ? 'notif-progress' : ''}`}
                  style={{
                    animationDuration: `${SLIDE_SECONDS}s`,
                    animationPlayState: paused ? 'paused' : 'running',
                    transform: autoplaying ? undefined : 'none',
                  }}
                  onAnimationEnd={advance}
                />
              )}
            </button>
          ))}
        </div>

        <button type="button" onClick={() => go(index + 1)} aria-label="Next slide" className="w-7 h-7 rounded-full border border-gray-200 grid place-items-center hover:bg-gray-50 shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
        </button>
        {!reduced.current && (
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playDone ? 'Replay unread' : userPaused ? 'Play slideshow' : 'Pause slideshow'}
            className="w-7 h-7 rounded-full border border-gray-200 grid place-items-center hover:bg-gray-50 shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              {playDone || userPaused ? <path d="M8 5l11 7-11 7z" fill="currentColor" /> : <path d="M9 5v14M15 5v14" />}
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
