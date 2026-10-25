import { useMemo, useState } from 'react'
import { videoUrl } from '../../utils/guideAssets'
import { groupVideos } from '../../utils/guideVideoGroups'

const PER_GROUP = 4
const LANGS = [['en', 'English'], ['ur', 'اردو']]

function formatSeconds(total) {
  const m = Math.floor(total / 60)
  const sec = String(total % 60).padStart(2, '0')
  return `${m}:${sec}`
}

const minutes = (videos, lang) => Math.max(1, Math.round(videos.reduce((n, v) => n + (v.seconds?.[lang] || v.seconds?.en || 0), 0) / 60))

function VideoCard({ video, lang, watched, onSelect, step }) {
  const title = video.title?.[lang] || video.title?.en
  const seconds = video.seconds?.[lang] || video.seconds?.en || 0
  return (
    <button
      type="button"
      onClick={() => onSelect(video.id)}
      className="group flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white text-left shadow-sm transition-colors hover:border-primary-300"
    >
      <div className="relative">
        <img src={videoUrl(`${video.id}.${lang}.poster.jpg`)} onError={(e) => { e.currentTarget.src = videoUrl(`${video.id}.en.poster.jpg`) }} alt="" className="aspect-video w-full bg-gray-100 object-cover" loading="lazy" />
        {step && <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs font-bold text-white">{step}</span>}
        <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white">{formatSeconds(seconds)}</span>
        {watched && (
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white" title="You watched this">
            <span aria-hidden="true">&#10003;</span> Watched
          </span>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-900" dir={lang === 'ur' ? 'rtl' : 'ltr'}>{title}</p>
        {lang === 'en' && video.summary && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{video.summary}</p>}
      </div>
    </button>
  )
}

/**
 * The Videos tab: your Start here path first, then the rest grouped by job with a few cards each,
 * plus search and a language switch. Searching drops the groups and lists matches.
 */
export default function GuideVideosTab({ videos, startVideos, lang, onLang, onSelect, watched }) {
  const [query, setQuery] = useState('')
  const [openGroups, setOpenGroups] = useState(() => new Set())
  // Videos already in the Start here row are not repeated in their group below.
  const startIds = useMemo(() => new Set(startVideos.length >= 2 ? startVideos.map((v) => v.id) : []), [startVideos])
  const groups = useMemo(() => groupVideos(videos.filter((v) => !startIds.has(v.id))), [videos, startIds])

  const term = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!term) return null
    return videos.filter((v) => `${v.title?.en || ''} ${v.title?.ur || ''} ${v.summary || ''}`.toLowerCase().includes(term))
  }, [term, videos])

  const toggleGroup = (id) => setOpenGroups((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search videos..."
          aria-label="Search videos"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500 sm:w-72"
        />
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-300" role="group" aria-label="Video language">
          {LANGS.map(([code, label]) => (
            <button
              key={code}
              type="button"
              onClick={() => onLang(code)}
              aria-pressed={lang === code}
              className={`px-3 py-2 text-sm ${lang === code ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'} ${code === 'ur' ? 'border-l border-gray-300' : ''}`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500">{videos.length} videos &middot; about {minutes(videos, lang)} minutes</span>
      </div>

      {videos.length === 0 && (
        <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-gray-500">
          <p className="text-lg">No videos for your role yet</p>
          <p className="mt-1 text-sm">Choose &quot;Show everything&quot; on the Guide tab to see every tutorial.</p>
        </div>
      )}

      {matches ? (
        <section aria-live="polite">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">{matches.length} result{matches.length === 1 ? '' : 's'} for &quot;{query.trim()}&quot;</h2>
          {matches.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white py-8 text-center text-sm text-gray-500">No video matches. Try another word.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map((v) => <VideoCard key={v.id} video={v} lang={lang} watched={watched.has(v.id)} onSelect={onSelect} />)}
            </div>
          )}
        </section>
      ) : (
        <>
          {startVideos.length >= 2 && (
            <section aria-labelledby="videos-start">
              <h2 id="videos-start" className="text-lg font-bold text-gray-900">Start here</h2>
              <p className="mb-3 text-sm text-gray-600">Watch these first, in order.</p>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {startVideos.map((v, i) => <VideoCard key={v.id} video={v} lang={lang} watched={watched.has(v.id)} onSelect={onSelect} step={i + 1} />)}
              </div>
            </section>
          )}

          {groups.map((group) => {
            const open = openGroups.has(group.id)
            const shown = open ? group.videos : group.videos.slice(0, PER_GROUP)
            const watchedCount = group.videos.filter((v) => watched.has(v.id)).length
            return (
              <section key={group.id} aria-labelledby={`group-${group.id}`}>
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id={`group-${group.id}`} className="text-base font-semibold text-gray-900">
                    {group.title}
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      {group.videos.length} video{group.videos.length === 1 ? '' : 's'} &middot; {minutes(group.videos, lang)} min
                      {watchedCount > 0 && ` · ${watchedCount} watched`}
                    </span>
                  </h2>
                  {group.videos.length > PER_GROUP && (
                    <button type="button" onClick={() => toggleGroup(group.id)} aria-expanded={open} className="text-xs text-primary-600 hover:underline">
                      {open ? 'Show fewer' : `Show all ${group.videos.length}`}
                    </button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {shown.map((v) => <VideoCard key={v.id} video={v} lang={lang} watched={watched.has(v.id)} onSelect={onSelect} />)}
                </div>
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
