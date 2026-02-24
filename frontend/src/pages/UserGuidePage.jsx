import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useDebounce } from '../hooks/useDebounce'
import { useToast } from '../components/Toast'
import guideData from '../data/userGuide.json'

// --- Utility ---
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

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

const ListIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
  </svg>
)

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
      return (
        <div className="flex items-center gap-1 text-xs text-gray-500 italic flex-wrap">
          <span className="mr-1">Navigate to:</span>
          {item.path.split(' > ').map((segment, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-xs">{segment.trim()}</span>
              {i < arr.length - 1 && <span className="text-gray-400">&rsaquo;</span>}
            </span>
          ))}
        </div>
      )

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

// --- Section Renderer ---
function SectionBlock({ section, chapterId, searchHighlight, showCopyLink }) {
  const { showSuccess } = useToast()

  const handleCopyLink = () => {
    const sectionNum = section.id.split('.')[1]
    const url = `${window.location.origin}/guide?chapter=${chapterId}&section=${sectionNum}`
    navigator.clipboard.writeText(url)
    showSuccess('Link copied to clipboard')
  }

  return (
    <div id={`section-${section.id}`} className="scroll-mt-20">
      <div className="flex items-center gap-2 group mb-3">
        <h3 className="text-base font-semibold text-primary-700">
          {section.id} &nbsp;
          <HighlightText text={section.title} highlight={searchHighlight} />
        </h3>
        {showCopyLink && (
          <button
            onClick={handleCopyLink}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            title="Copy link to section"
          >
            <LinkIcon />
          </button>
        )}
      </div>
      <div className="space-y-3 pl-1">
        {section.content.map((item, idx) => (
          <ContentBlock key={idx} item={item} searchHighlight={searchHighlight} />
        ))}
      </div>
    </div>
  )
}

// --- Chapter Renderer ---
function ChapterBlock({ chapter, isExpanded, onToggle, searchHighlight }) {
  return (
    <div id={`chapter-${chapter.id}`} className="scroll-mt-16">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-white rounded-lg shadow-sm border border-gray-200 hover:border-primary-300 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary-100 text-primary-700 font-bold text-sm flex-shrink-0">
            {chapter.id}
          </span>
          <h2 className="text-lg font-bold text-gray-900 text-left">{chapter.title}</h2>
        </div>
        <ChevronRightIcon className={`transition-transform duration-200 text-gray-400 flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`} />
      </button>

      {isExpanded && (
        <div className="mt-4 ml-2 space-y-6 pb-2">
          {chapter.sections.map(section => (
            <SectionBlock
              key={section.id}
              section={section}
              chapterId={chapter.id}
              searchHighlight={searchHighlight}
              showCopyLink
            />
          ))}
        </div>
      )}
    </div>
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

// --- Main Page Component ---
export default function UserGuidePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)
  const [mobileTocOpen, setMobileTocOpen] = useState(false)
  const contentRef = useRef(null)

  // Initialize from URL
  const initialChapter = parseInt(searchParams.get('chapter')) || 1
  const [activeChapterId, setActiveChapterId] = useState(initialChapter)
  const [expandedChapters, setExpandedChapters] = useState(new Set([initialChapter]))

  // Build search index
  const searchIndex = useMemo(() => {
    const entries = []
    guideData.chapters.forEach(chapter => {
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
  }, [])

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
    setSearchQuery('')
    setMobileTocOpen(false)

    const sectionNum = sectionId ? sectionId.split('.')[1] : null
    setSearchParams(sectionNum
      ? { chapter: chapterId, section: sectionNum }
      : { chapter: chapterId }
    )

    setTimeout(() => {
      const targetId = sectionId ? `section-${sectionId}` : `chapter-${chapterId}`
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 100)
  }, [setSearchParams])

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

  // TOC click handler
  const handleTocClick = useCallback((chapterId) => {
    navigateTo(chapterId)
  }, [navigateTo])

  const isSearchMode = searchResults !== null

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Guide</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {guideData.meta.version} &middot; Updated {formatDate(guideData.meta.generatedAt)}
          </p>
        </div>

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
      </div>

      {/* Search results count */}
      {isSearchMode && (
        <div className="text-sm text-gray-600 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-2">
          Found <strong>{searchResults.count}</strong> result{searchResults.count !== 1 ? 's' : ''} for &quot;{debouncedSearch}&quot;
        </div>
      )}

      {/* Mobile TOC toggle */}
      <button
        className="lg:hidden flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm border border-gray-200 w-full"
        onClick={() => setMobileTocOpen(!mobileTocOpen)}
      >
        <ListIcon />
        <span className="text-sm font-medium text-gray-700">Table of Contents</span>
        <ChevronRightIcon className={`ml-auto transition-transform duration-200 text-gray-400 ${mobileTocOpen ? 'rotate-90' : ''}`} />
      </button>

      {/* Main layout */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* TOC Sidebar */}
        <aside className={`${mobileTocOpen ? 'block' : 'hidden'} lg:block lg:w-72 lg:flex-shrink-0`}>
          <div className="lg:sticky lg:top-4 bg-white rounded-lg shadow-sm border border-gray-200 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 120px)' }}>
            <div className="p-3 border-b border-gray-100">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Contents</h3>
            </div>
            <nav className="p-2">
              {guideData.chapters.map(chapter => (
                <button
                  key={chapter.id}
                  onClick={() => handleTocClick(chapter.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors mb-0.5 ${
                    activeChapterId === chapter.id
                      ? 'bg-primary-50 text-primary-700 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <span className="text-xs text-gray-400 mr-2">{chapter.id}.</span>
                  {chapter.title}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex-1 min-w-0" ref={contentRef}>
          {isSearchMode ? (
            /* Search Results View */
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
            /* Normal Chapter View */
            <div className="space-y-4">
              {guideData.chapters.map(chapter => (
                <ChapterBlock
                  key={chapter.id}
                  chapter={chapter}
                  isExpanded={expandedChapters.has(chapter.id)}
                  onToggle={() => toggleChapter(chapter.id)}
                  searchHighlight={null}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
