import { useEffect, useMemo, useState } from 'react'
import GuideVideosTab from '../../../../../src/components/guide/GuideVideosTab'
import GuideVideoModal from '../../../../../src/components/guide/GuideVideoModal'
import {
  GuideContentContext, ChapterBlock, HighlightText, VIDEOS_BY_ID,
} from '../../../../../src/components/guide/GuideContent'
import { nextInGroup } from '../../../../../src/utils/guideVideoGroups'
import { setVideoBase } from '../../../../../src/utils/guideAssets'
import guideData from '../../../../../src/data/userGuide.json'
import videoData from '../../../../../src/data/guideVideos.json'

const READY = videoData.videos.filter((v) => v.status === 'ready')
const NO_WATCHED = new Set()

// Same guide as inside the app, without sign-in or progress: nothing here is stored or sent anywhere.
export default function PublicGuide({ videoBase }) {
  setVideoBase(videoBase)
  const [tab, setTab] = useState('videos')
  const [lang, setLang] = useState('en')
  const [playing, setPlaying] = useState(null)
  const [query, setQuery] = useState('')
  const [openChapters, setOpenChapters] = useState(() => new Set())
  const [openSections, setOpenSections] = useState(() => new Set())

  // Links like /guide?video=ch1-logging-in&lang=ur open straight to a video.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (p.get('lang') === 'ur') setLang('ur')
    if (p.get('tab') === 'read') setTab('read')
    const id = p.get('video')
    if (id && VIDEOS_BY_ID[id]) setPlaying(id)
  }, [])

  const open = (id) => {
    setPlaying(id)
    const p = new URLSearchParams(window.location.search)
    p.set('video', id)
    window.history.replaceState(null, '', `?${p}`)
  }
  const close = () => {
    setPlaying(null)
    const p = new URLSearchParams(window.location.search)
    p.delete('video')
    const qs = p.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  const context = useMemo(() => ({ openVideo: open, canOpen: null, renderShowMe: () => null, showPlanned: false, onCopyLink: null }), [])

  const term = query.trim().toLowerCase()
  const chapters = useMemo(() => {
    if (!term) return guideData.chapters
    // A search keeps whole chapters that mention the word anywhere, with the matching topics opened.
    return guideData.chapters.filter((c) => JSON.stringify(c).toLowerCase().includes(term))
  }, [term])
  const sectionHits = useMemo(() => {
    if (!term) return new Set()
    return new Set(guideData.chapters.flatMap((c) => c.sections.filter((s) => JSON.stringify(s).toLowerCase().includes(term)).map((s) => s.id)))
  }, [term])

  const toggle = (set, setter) => (id) => setter((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const video = playing ? VIDEOS_BY_ID[playing] : null

  return (
    <GuideContentContext.Provider value={context}>
      <div className="space-y-5">
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 bg-white" role="tablist">
          {[['videos', `Videos (${READY.length})`], ['read', 'Read the guide']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 text-sm font-medium ${tab === id ? 'bg-primary-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'videos' ? (
          <GuideVideosTab videos={READY} startVideos={[]} lang={lang} onLang={setLang} onSelect={open} watched={NO_WATCHED} />
        ) : (
          <div className="space-y-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the guide..."
              aria-label="Search the guide"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 sm:w-80"
            />
            {chapters.length === 0 && <p className="rounded-lg border border-gray-200 bg-white py-8 text-center text-sm text-gray-500">Nothing matches. Try another word.</p>}
            {chapters.map((chapter) => (
              <ChapterBlock
                key={chapter.id}
                chapter={chapter}
                isExpanded={openChapters.has(chapter.id) || Boolean(term)}
                onToggle={() => toggle(openChapters, setOpenChapters)(chapter.id)}
                searchHighlight={term ? query.trim() : ''}
                expandedSections={term ? sectionHits : openSections}
                onToggleSection={toggle(openSections, setOpenSections)}
              />
            ))}
          </div>
        )}

        {video && (
          <GuideVideoModal
            video={video}
            lang={lang}
            onLang={setLang}
            onClose={close}
            nextVideo={nextInGroup(READY, video.id)}
            onNext={open}
            onPlayed={() => {}}
            resumeAt={0}
          />
        )}
      </div>
    </GuideContentContext.Provider>
  )
}
