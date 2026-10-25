import { useContext, createContext } from 'react'
import { videoUrl } from '../../utils/guideAssets'
import videoData from '../../data/guideVideos.json'

// What the reading blocks need from whoever hosts them. The signed-in guide passes its video player, page links,
// role rules and copy-link toast; the public guide passes only the video player, so none of this file depends on
// login, the router or the toast layer.
export const GuideContentContext = createContext({
  openVideo: null,
  canOpen: null, // null: no "Show me" links at all
  renderShowMe: () => null,
  showPlanned: false,
  onCopyLink: null,
})

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}


const ChevronRightIcon = ({ className = '' }) => (
  <svg className={`w-5 h-5 ${className}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
)

const LinkIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
  </svg>
)



// --- Highlight Component ---
function HighlightText({ text, highlight }) {
  if (!highlight || !text) return text
  try {
    const parts = text.split(new RegExp(`(${escapeRegex(highlight)})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === highlight.toLowerCase()
        ? <mark key={i} className="bg-yellow-200 text-yellow-900 rounded px-0.5">{part}</mark>
        : part
    )
  } catch {
    return text
  }
}

// --- Navigation path with an optional "Show me" button ---
function NavPathBlock({ item }) {
  const { canOpen, renderShowMe } = useContext(GuideContentContext)
  return (
    <div className="flex items-center gap-1 text-xs text-gray-500 italic flex-wrap">
      <span className="mr-1">Navigate to:</span>
      {item.path.split(' > ').map((segment, i, arr) => (
        <span key={i} className="flex items-center gap-1">
          <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs">{segment.trim()}</span>
          {i < arr.length - 1 && <span className="text-gray-400">&rsaquo;</span>}
        </span>
      ))}
      {item.href && canOpen && (canOpen(item.href) ? renderShowMe(item) : (
        <span className="ml-2 not-italic text-gray-400" title="Your role or school settings do not include this page">
          Not available for your role
        </span>
      ))}
    </div>
  )
}

// --- Content Block Renderers ---
function ContentBlock({ item, searchHighlight }) {
  switch (item.type) {
    case 'body_text':
      return (
        <p className="text-sm text-gray-700 leading-relaxed">
          <HighlightText text={item.text} highlight={searchHighlight} />
        </p>
      )

    case 'step':
      return (
        <div className="flex items-start gap-3">
          <span className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold mt-0.5">
            {item.number}
          </span>
          <p className="text-sm text-gray-700">
            <HighlightText text={item.text} highlight={searchHighlight} />
          </p>
        </div>
      )

    case 'bullet':
      return (
        <div className="flex items-start gap-2 ml-4">
          <span className="text-primary-500 mt-1 flex-shrink-0 text-lg leading-none">&bull;</span>
          <p className="text-sm text-gray-700">
            <HighlightText text={item.text} highlight={searchHighlight} />
          </p>
        </div>
      )

    case 'sub_section':
      return (
        <h4 className="text-sm font-semibold text-gray-800 mt-4 mb-1 border-b border-gray-100 pb-1">
          <HighlightText text={item.title} highlight={searchHighlight} />
        </h4>
      )

    case 'info_box':
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h5 className="text-sm font-semibold text-blue-800 mb-1">{item.title}</h5>
          <p className="text-sm text-blue-700">
            <HighlightText text={item.text} highlight={searchHighlight} />
          </p>
        </div>
      )

    case 'warning_box':
      return (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h5 className="text-sm font-semibold text-yellow-800 mb-1">Important Note</h5>
          <p className="text-sm text-yellow-700">
            <HighlightText text={item.text} highlight={searchHighlight} />
          </p>
        </div>
      )

    case 'nav_path':
      return <NavPathBlock item={item} />

    case 'table':
      return (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-primary-800 text-white">
                {item.headers.map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {item.rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-gray-700 border-t border-gray-100 text-xs">
                      <HighlightText text={cell} highlight={searchHighlight} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )

    default:
      return null
  }
}

// --- Inline video slot for step-by-step sections ---
const VIDEOS_BY_ID = Object.fromEntries(videoData.videos.map((v) => [v.id, v]))

function VideoSlot({ videoId }) {
  const { openVideo, showPlanned } = useContext(GuideContentContext)
  const video = VIDEOS_BY_ID[videoId]
  if (!video) return null

  if (video.status === 'planned') {
    // Placeholders are for admins only, so other roles never see an unfinished guide.
    if (!showPlanned) return null
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-200 text-gray-500">&#9654;</span>
        <div>
          <p className="font-medium text-gray-600">Video tutorial coming soon</p>
          <p className="text-xs text-gray-400">{video.title.en}</p>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => openVideo?.(video.id)}
      className="flex w-full items-center gap-3 rounded-lg border border-primary-200 bg-primary-50/40 px-3 py-2 text-left hover:bg-primary-50"
    >
      <img src={videoUrl(`${video.id}.en.poster.jpg`)} alt="" className="h-12 w-20 rounded object-cover bg-gray-100" loading="lazy" />
      <span className="flex-1">
        <span className="block text-sm font-semibold text-primary-800">Watch: {video.title.en}</span>
        <span className="block text-xs text-gray-500">{formatSeconds(video.seconds.en)} &middot; English or اردو</span>
      </span>
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-white">&#9654;</span>
    </button>
  )
}

function SectionBlock({ section, chapterId, searchHighlight, showCopyLink, isOpen, onToggle }) {
  const { onCopyLink } = useContext(GuideContentContext)
  const video = section.video && VIDEOS_BY_ID[section.video]?.status === 'ready' ? VIDEOS_BY_ID[section.video] : null

  const handleCopyLink = () => onCopyLink(chapterId, section.id.split('.')[1])

  return (
    <div id={`section-${section.id}`} className="scroll-mt-20 rounded-lg border border-gray-200 bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <ChevronRightIcon className={`flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
        <span className="flex-1 text-sm font-medium text-gray-900">
          <HighlightText text={section.title} highlight={searchHighlight} />
        </span>
        {video && <span className="flex-shrink-0 rounded bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">&#9654; Video</span>}
      </button>
      {isOpen && (
        <div className="space-y-3 border-t border-gray-100 px-4 py-4">
          {section.video && <VideoSlot videoId={section.video} />}
          {section.content.map((item, idx) => (
            <ContentBlock key={idx} item={item} searchHighlight={searchHighlight} />
          ))}
          {showCopyLink && onCopyLink && (
            <button type="button" onClick={handleCopyLink} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
              <LinkIcon /> Copy link to this topic
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// --- Chapter Renderer ---
// A chapter is one quiet row. Opened, it shows its introduction and a list of topics; each topic opens on demand.
function ChapterBlock({ chapter, isExpanded, onToggle, searchHighlight, expandedSections, onToggleSection }) {
  const intro = chapter.sections.filter((section) => section.title === 'Introduction')
  const topics = chapter.sections.filter((section) => section.title !== 'Introduction')
  const videoCount = topics.filter((section) => section.video && VIDEOS_BY_ID[section.video]?.status === 'ready').length

  return (
    <div id={`chapter-${chapter.id}`} className="scroll-mt-16">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-primary-300 sm:p-4"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-sm font-bold text-primary-700">
            {chapter.id}
          </span>
          <div className="min-w-0 text-left">
            <h2 className="truncate text-base font-semibold text-gray-900">{chapter.title}</h2>
            <p className="text-xs text-gray-500">
              {topics.length} topic{topics.length === 1 ? '' : 's'}
              {videoCount > 0 && ` · ${videoCount} video${videoCount === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>
        <ChevronRightIcon className={`flex-shrink-0 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2 pl-2 sm:pl-4">
          {intro.map((section) => (
            <div key={section.id} id={`section-${section.id}`} className="space-y-2 px-1 pb-1">
              {section.content.map((item, idx) => (
                <ContentBlock key={idx} item={item} searchHighlight={searchHighlight} />
              ))}
            </div>
          ))}
          {topics.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              chapterId={chapter.id}
              searchHighlight={searchHighlight}
              showCopyLink
              isOpen={expandedSections.has(section.id)}
              onToggle={() => onToggleSection(section.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}


function formatSeconds(total) {
  const m = Math.floor(total / 60)
  const sec = String(total % 60).padStart(2, '0')
  return `${m}:${sec}`
}

// --- Main Page Component ---

export { escapeRegex, ChevronRightIcon, LinkIcon, HighlightText, ContentBlock, SectionBlock, ChapterBlock, VIDEOS_BY_ID, formatSeconds }
