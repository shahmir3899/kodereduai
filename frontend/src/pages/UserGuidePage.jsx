import { useState, useEffect, useMemo, useCallback, useRef, createContext, useContext } from 'react'
import PageHeader from '../components/ui/PageHeader'
import { useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { filterGuideChapters, buildAvailability, isVisibleFor } from '../utils/guideAccess'
import { useDebounce } from '../hooks/useDebounce'
import { useToast } from '../components/Toast'
import {
  GuideContentContext, HighlightText, ChapterBlock, VIDEOS_BY_ID,
} from '../components/guide/GuideContent'
import GuideVideoModal from '../components/guide/GuideVideoModal'
import GuideVideosTab from '../components/guide/GuideVideosTab'
import ProgressSummary from '../components/guide/ProgressSummary'
import useGuideProgress, { summarizeProgress } from '../hooks/useGuideProgress'
import { nextInGroup } from '../utils/guideVideoGroups'
import guideData from '../data/userGuide.json'
import videoData from '../data/guideVideos.json'

const START_HERE = guideData.meta.startHere || {}

// Where to pick a video up again: only if the person stopped partway, not at the very start, and had not finished it.
function resumePosition(state) {
  if (!state || state.completedAt || !state.duration) return 0
  return state.position > 5 && state.position < state.duration * 0.95 ? state.position : 0
}


// --- Utility ---
function extractText(item) {
  switch (item.type) {
    case 'body_text': return item.text
    case 'step': return item.text
    case 'bullet': return item.text
    case 'info_box': return `${item.title} ${item.text}`
    case 'warning_box': return item.text
    case 'nav_path': return item.path
    case 'sub_section': return item.title
    case 'table': return [...item.headers, ...item.rows.flat()].join(' ')
    default: return ''
  }
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric'
    })
  } catch {
    return ''
  }
}

// --- Icons ---
const SearchIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
)

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
)

// --- "Start here": the short ordered path a new user follows first ---
const plainTitle = (title) => title.replace(/^Step \d+:\s*/, '')

function StartHere({ steps, watched, done, onRead, onWatch, onToggleDone }) {
  if (steps.length < 2) return null

  return (
    <section aria-labelledby="start-here" className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 sm:p-5">
      <h2 id="start-here" className="text-lg font-bold text-gray-900">New here? Start with these</h2>
      <p className="mb-3 text-sm text-gray-600">Do them in this order. Each one takes a few minutes. A step is ticked off when you have watched its video; a step without a video you tick yourself.</p>
      <ol className="space-y-2">
        {steps.map((step, index) => {
          const finished = step.videoId ? watched.has(step.videoId) : done.has(step.sectionId)
          return (
            <li key={step.sectionId} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
              {step.videoId ? (
                <span
                  title={finished ? 'You watched this video' : 'Watch the video to complete this step'}
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${finished ? 'bg-green-600' : 'bg-primary-600'}`}
                >
                  {finished ? <span aria-label={`Step ${index + 1} done`}>&#10003;</span> : index + 1}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onToggleDone(step.sectionId)}
                  aria-pressed={finished}
                  aria-label={finished ? `Step ${index + 1} done. Click to undo.` : `Mark step ${index + 1} as done`}
                  className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${finished ? 'bg-green-600' : 'bg-primary-600 hover:bg-primary-700'}`}
                >
                  {finished ? <span aria-hidden="true">&#10003;</span> : index + 1}
                </button>
              )}
              <span className={`min-w-0 flex-1 text-sm font-medium ${finished ? 'text-gray-500' : 'text-gray-900'}`}>{step.title}</span>
              {step.videoId && (
                <button type="button" onClick={() => onWatch(step.videoId)} className="flex-shrink-0 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700">
                  &#9654; Watch
                </button>
              )}
              <button type="button" onClick={() => onRead(step.chapterId, step.sectionId)} className="flex-shrink-0 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                Read
              </button>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

// --- Search Result Item ---
function SearchResultItem({ result, onNavigate }) {
  return (
    <button
      onClick={() => onNavigate(result.chapterId, result.sectionId)}
      className="w-full text-left p-3 rounded-lg hover:bg-gray-50 border border-gray-100 transition-colors"
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-medium text-primary-600 bg-primary-50 px-2 py-0.5 rounded">
          Ch. {result.chapterId}
        </span>
        <span className="text-xs text-gray-500">{result.sectionTitle}</span>
      </div>
      <p className="text-sm text-gray-700 line-clamp-2">
        <HighlightText text={result.snippet} highlight={result.highlight} />
      </p>
    </button>
  )
}

// --- Videos tab ---
export default function UserGuidePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user, effectiveRole, isSuperAdmin, isParent, isStudent, isStaffLevel, isManager, isModuleEnabled } = useAuth()
  const progress = useGuideProgress(user?.id)

  // Default view follows the user's role and the school's enabled modules;
  // ?view=all shows the whole guide. A deep link to a hidden chapter switches to "all".
  const requestedChapter = parseInt(searchParams.get('chapter')) || null
  const roleChapters = useMemo(
    () => filterGuideChapters(guideData.chapters, { role: effectiveRole, isSuperAdmin, isModuleEnabled }),
    [effectiveRole, isSuperAdmin, isModuleEnabled]
  )
  const roleViewUsable = roleChapters.length > 0
    && (!requestedChapter || roleChapters.some((c) => c.id === requestedChapter))
  const viewAll = searchParams.get('view') === 'all' || !roleViewUsable || isSuperAdmin
  const chapters = viewAll ? guideData.chapters : roleChapters
  const canOpen = useMemo(
    () => buildAvailability({ effectiveRole, isSuperAdmin, isParent, isStudent, isModuleEnabled, isStaffLevel, isManager }),
    [effectiveRole, isSuperAdmin, isParent, isStudent, isModuleEnabled, isStaffLevel, isManager]
  )
  const setView = (view) => {
    const next = new URLSearchParams(searchParams)
    if (view === 'all') next.set('view', 'all')
    else {
      next.delete('view')
      // A deep link to a chapter hidden from this role would force the whole guide back open.
      next.delete('chapter')
      next.delete('section')
    }
    setSearchParams(next, { replace: true })
  }

  const tab = searchParams.get('tab') === 'videos' ? 'videos' : 'guide'
  const videoLang = searchParams.get('lang') === 'ur' ? 'ur' : 'en'
  const selectedVideoId = searchParams.get('video')
  const visibleVideos = useMemo(
    () => videoData.videos
      .filter((v) => v.status !== 'planned')
      .filter((v) => viewAll || isVisibleFor(v, { role: effectiveRole, isSuperAdmin, isModuleEnabled })),
    [viewAll, effectiveRole, isSuperAdmin, isModuleEnabled]
  )
  const updateParams = (changes) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(changes).forEach(([key, value]) => {
      if (value === null || value === undefined) next.delete(key)
      else next.set(key, value)
    })
    setSearchParams(next, { replace: true })
  }
  const setTab = (name) => updateParams({ tab: name === 'videos' ? 'videos' : null, video: null, chapter: null, section: null })
  // The player is a dialog over whatever the reader is looking at, so only the ?video= part changes.
  const openVideo = (id) => updateParams({ video: id })
  const { showSuccess } = useToast()
  const contentContext = useMemo(() => ({
    openVideo,
    canOpen,
    renderShowMe: (item) => (
      <Link
        to={item.href}
        className="ml-2 not-italic font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 px-2 py-0.5 rounded"
      >
        Show me
      </Link>
    ),
    showPlanned: isSuperAdmin || effectiveRole === 'SCHOOL_ADMIN' || effectiveRole === 'PRINCIPAL',
    onCopyLink: (chapterId, sectionNum) => {
      navigator.clipboard.writeText(`${window.location.origin}/guide?chapter=${chapterId}&section=${sectionNum}`)
      showSuccess('Link copied to clipboard')
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [canOpen, isSuperAdmin, effectiveRole])
  const closeVideo = () => updateParams({ video: null })
  // The "Start here" path for this person: the sections, in order, with each one's recorded video if it has one.
  const startSteps = useMemo(() => {
    const byId = {}
    chapters.forEach((chapter) => chapter.sections.forEach((section) => { byId[section.id] = { section, chapterId: chapter.id } }))
    return (START_HERE[isSuperAdmin ? 'SCHOOL_ADMIN' : effectiveRole] || [])
      .map((id) => byId[id])
      .filter(Boolean)
      .map(({ section, chapterId }) => ({
        sectionId: section.id,
        chapterId,
        title: plainTitle(section.title),
        videoId: section.video && VIDEOS_BY_ID[section.video]?.status === 'ready' ? section.video : null,
      }))
  }, [chapters, effectiveRole, isSuperAdmin])
  const startVideos = useMemo(
    () => startSteps.map((step) => visibleVideos.find((v) => v.id === step.videoId)).filter(Boolean),
    [startSteps, visibleVideos],
  )
  const progressSummary = useMemo(
    () => summarizeProgress({ steps: startSteps, videos: visibleVideos, watched: progress.watched, done: progress.done }),
    [startSteps, visibleVideos, progress.watched, progress.done],
  )
  const playingVideo = selectedVideoId ? videoData.videos.find((v) => v.id === selectedVideoId && v.status !== 'planned') : null
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const contentRef = useRef(null)

  // Initialize from URL
  const [, setActiveChapterId] = useState(parseInt(searchParams.get('chapter')) || null)
  // Everything starts closed: a new reader sees the short "Start here" path and a quiet list, not a wall of text.
  // A deep link (?chapter=&section=) opens just what it points at.
  const linkedChapter = parseInt(searchParams.get('chapter')) || null
  const linkedSection = searchParams.get('section')
  const [expandedChapters, setExpandedChapters] = useState(new Set(linkedChapter ? [linkedChapter] : []))
  const [expandedSections, setExpandedSections] = useState(new Set(linkedChapter && linkedSection ? [`${linkedChapter}.${linkedSection}`] : []))
  const toggleSection = useCallback((sectionId) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }, [])

  // Build search index
  const searchIndex = useMemo(() => {
    const entries = []
    chapters.forEach(chapter => {
      chapter.sections.forEach(section => {
        section.content.forEach((item) => {
          const text = extractText(item)
          if (text) {
            entries.push({
              chapterId: chapter.id,
              sectionId: section.id,
              text: text.toLowerCase(),
              snippet: text.length > 150 ? text.slice(0, 150) + '...' : text,
              chapterTitle: chapter.title,
              sectionTitle: section.title,
            })
          }
        })
      })
    })
    return entries
  }, [chapters])

  // Search results
  const searchResults = useMemo(() => {
    if (!debouncedSearch || debouncedSearch.length < 2) return null
    const query = debouncedSearch.toLowerCase()
    const results = searchIndex
      .filter(entry => entry.text.includes(query))
      .slice(0, 50) // cap results
      .map(r => ({ ...r, highlight: debouncedSearch }))

    // Group by chapter
    const grouped = {}
    results.forEach(r => {
      if (!grouped[r.chapterId]) {
        grouped[r.chapterId] = { title: r.chapterTitle, results: [] }
      }
      grouped[r.chapterId].results.push(r)
    })
    return { grouped, count: results.length }
  }, [debouncedSearch, searchIndex])

  // Toggle chapter expansion
  const toggleChapter = useCallback((chapterId) => {
    setExpandedChapters(prev => {
      const next = new Set(prev)
      if (next.has(chapterId)) {
        next.delete(chapterId)
      } else {
        next.add(chapterId)
      }
      return next
    })
  }, [])

  // Navigate to chapter/section
  const navigateTo = useCallback((chapterId, sectionId) => {
    setActiveChapterId(chapterId)
    setExpandedChapters(prev => new Set([...prev, chapterId]))
    if (sectionId) setExpandedSections(prev => new Set([...prev, sectionId]))
    setSearchQuery('')

    const sectionNum = sectionId ? sectionId.split('.')[1] : null
    const view = searchParams.get('view') === 'all' ? { view: 'all' } : {}
    setSearchParams(sectionNum
      ? { chapter: chapterId, section: sectionNum, ...view }
      : { chapter: chapterId, ...view }
    )

    setTimeout(() => {
      const targetId = sectionId ? `section-${sectionId}` : `chapter-${chapterId}`
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [setSearchParams, searchParams])

  // Handle deep-link on mount
  useEffect(() => {
    const chapter = parseInt(searchParams.get('chapter'))
    const section = searchParams.get('section')
    if (chapter) {
      setActiveChapterId(chapter)
      setExpandedChapters(prev => new Set([...prev, chapter]))
      if (section) {
        setTimeout(() => {
          document.getElementById(`section-${chapter}.${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }, 200)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isSearchMode = searchResults !== null

  return (
    <GuideContentContext.Provider value={contentContext}>
    <div className="space-y-4">
      {/* Header */}
      <PageHeader title="User Guide" subtitle="Short steps and videos to get your school running" actions={<>
{/* Search */}
        <div className="relative w-full sm:w-80">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-400">
            <SearchIcon />
          </div>
          <input
            type="text"
            placeholder="Search guide..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600"
            >
              <XIcon />
            </button>
          )}
        </div>
</>} />

      {/* Tabs: written guide or video tutorials */}
      <div className="flex gap-1 border-b border-gray-200" role="tablist" aria-label="Guide sections">
        {[['guide', 'Guide'], ['videos', `Videos (${visibleVideos.length})`]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === key ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Who this is for: one quiet line instead of a toggle and a count */}
      {!isSuperAdmin && roleViewUsable && (
        <p className="text-sm text-gray-500">
          {viewAll ? 'Showing every topic.' : 'Showing the topics for your role.'}{' '}
          <button type="button" onClick={() => setView(viewAll ? 'role' : 'all')} className="text-primary-600 hover:underline">
            {viewAll ? 'Show only mine' : 'Show everything'}
          </button>
        </p>
      )}

      {!isSearchMode && <ProgressSummary {...progressSummary} />}

      {/* Search results count */}
      {isSearchMode && (
        <div className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
          Found <strong>{searchResults.count}</strong> result{searchResults.count !== 1 ? 's' : ''} for &quot;{debouncedSearch}&quot;
        </div>
      )}

      {tab === 'videos' ? (
        <GuideVideosTab
          videos={visibleVideos}
          startVideos={startVideos}
          lang={videoLang}
          onLang={(code) => updateParams({ lang: code === 'ur' ? 'ur' : null })}
          onSelect={openVideo}
          watched={progress.watched}
        />
      ) : isSearchMode ? (
        <div className="space-y-4">
          {Object.keys(searchResults.grouped).length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p className="text-lg">No results found</p>
              <p className="text-sm mt-1">Try different keywords</p>
            </div>
          ) : (
            Object.entries(searchResults.grouped).map(([chapterId, group]) => (
              <div key={chapterId} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary-100 text-primary-700 font-bold text-xs">
                    {chapterId}
                  </span>
                  {group.title}
                </h3>
                <div className="space-y-2">
                  {group.results.map((result, idx) => (
                    <SearchResultItem key={idx} result={result} onNavigate={navigateTo} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="space-y-6" ref={contentRef}>
          <StartHere
            steps={startSteps}
            watched={progress.watched}
            done={progress.done}
            onRead={navigateTo}
            onWatch={openVideo}
            onToggleDone={progress.toggleDone}
          />
          <div className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">Browse by topic</h2>
            {chapters.map(chapter => (
              <ChapterBlock
                key={chapter.id}
                chapter={chapter}
                isExpanded={expandedChapters.has(chapter.id)}
                onToggle={() => toggleChapter(chapter.id)}
                searchHighlight={null}
                expandedSections={expandedSections}
                onToggleSection={toggleSection}
              />
            ))}
          </div>
          <p className="text-xs text-gray-400">Guide updated {formatDate(guideData.meta.generatedAt)}</p>
        </div>
      )}
      {playingVideo && (
        <GuideVideoModal
          video={playingVideo}
          lang={videoLang}
          onLang={(code) => updateParams({ lang: code === 'ur' ? 'ur' : null })}
          onClose={closeVideo}
          nextVideo={nextInGroup(visibleVideos, playingVideo.id)}
          onNext={openVideo}
          onPlayed={progress.recordVideo}
          resumeAt={resumePosition(progress.videoState(playingVideo.id))}
        />
      )}
    </div>
    </GuideContentContext.Provider>
  )
}
