import { useState, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { lmsApi } from '../../services/api'
import { isRTLLanguage } from '../../components/RTLWrapper'

/** Use inside buttons/labels — avoids invalid `<div>` inside `<button>`. */
function RtlText({ language, className = '', children }) {
  const rtl = isRTLLanguage(language)
  return (
    <span dir={rtl ? 'rtl' : 'ltr'} className={`${rtl ? 'font-rtl' : ''} ${className}`.trim()}>
      {children}
    </span>
  )
}

function collectChapterIds(chapter) {
  const topicIds = []
  const subtopicIds = []
  for (const topic of chapter.topics || []) {
    topicIds.push(topic.id)
    for (const st of topic.subtopics || []) {
      subtopicIds.push(st.id)
    }
  }
  return { topicIds, subtopicIds }
}

function collectTopicIds(topic) {
  const subtopicIds = (topic.subtopics || []).map((st) => st.id)
  return { topicIds: [topic.id], subtopicIds }
}

/** Human-readable lines for diary / notes (appended to onApply payload). */
function buildCurriculumSummary(topicIds, subtopicIds, topicMap, subtopicMap) {
  const tSet = new Set(topicIds || [])
  const sSet = new Set(subtopicIds || [])
  const lines = []

  for (const sid of sSet) {
    const st = subtopicMap[sid]
    if (st) {
      lines.push(`• ${st.bookTitle} › ${st.chapterTitle} › ${st.topicTitle}: ${st.title}`)
    }
  }

  for (const tid of tSet) {
    const t = topicMap[tid]
    if (!t) continue
    const subs = t.subtopics || []
    const anySubSelected = subs.some((st) => sSet.has(st.id))
    if (subs.length > 0 && anySubSelected) continue
    lines.push(`• ${t.bookTitle} › ${t.chapterTitle}: ${t.title}`)
  }

  return lines.join('\n')
}

/**
 * Book → Chapter → Topic → Sub-topic picker.
 * onApply receives { topicIds, subtopicIds } (parent topics are merged on save by the API).
 */
export default function LessonPlanTopicsPickerModal({
  open,
  onClose,
  classId,
  subjectId,
  initialTopicIds = [],
  initialSubtopicIds = [],
  onApply,
}) {
  const [selectedTopics, setSelectedTopics] = useState(() => new Set(initialTopicIds))
  const [selectedSubtopics, setSelectedSubtopics] = useState(() => new Set(initialSubtopicIds))
  const [expandedBooks, setExpandedBooks] = useState({})
  const [expandedChapters, setExpandedChapters] = useState({})
  const [expandedTopics, setExpandedTopics] = useState({})

  useEffect(() => {
    if (open) {
      setSelectedTopics(new Set(initialTopicIds))
      setSelectedSubtopics(new Set(initialSubtopicIds))
    }
  }, [open, initialTopicIds, initialSubtopicIds])

  const { data: booksData, isLoading } = useQuery({
    queryKey: ['booksForClassSubjectPicker', classId, subjectId],
    queryFn: () => lmsApi.getBooksForClassSubject({ class_id: classId, subject_id: subjectId }),
    enabled: open && !!classId && !!subjectId,
  })

  const booksExpansionSeed = useMemo(() => {
    const raw = booksData?.data?.results || booksData?.data
    if (!Array.isArray(raw) || raw.length === 0) return null
    return raw
      .map((b) => [b.id, (b.chapters || []).map((c) => c.id).join(',')].join(':'))
      .sort()
      .join('|')
  }, [booksData?.data])

  useEffect(() => {
    if (!open) {
      setExpandedBooks({})
      setExpandedChapters({})
      setExpandedTopics({})
      return
    }
    const raw = booksData?.data?.results || booksData?.data
    if (!Array.isArray(raw) || raw.length === 0) return
    setExpandedBooks(Object.fromEntries(raw.map((b) => [b.id, true])))
    const ch = {}
    raw.forEach((b) => {
      ;(b.chapters || []).forEach((c) => {
        ch[c.id] = true
      })
    })
    setExpandedChapters(ch)
  }, [open, booksExpansionSeed])

  const books = Array.isArray(booksData?.data?.results)
    ? booksData.data.results
    : Array.isArray(booksData?.data)
      ? booksData.data
      : []

  const { topicMap, subtopicMap } = useMemo(() => {
    const tMap = {}
    const sMap = {}
    if (!Array.isArray(books)) return { topicMap: tMap, subtopicMap: sMap }
    books.forEach((book) => {
      ;(book.chapters || []).forEach((chapter) => {
        ;(chapter.topics || []).forEach((topic) => {
          tMap[topic.id] = {
            ...topic,
            chapterTitle: chapter.title,
            bookTitle: book.title,
            language: book.language,
          }
          ;(topic.subtopics || []).forEach((st) => {
            sMap[st.id] = {
              ...st,
              topicTitle: topic.title,
              chapterTitle: chapter.title,
              bookTitle: book.title,
              language: book.language,
            }
          })
        })
      })
    })
    return { topicMap: tMap, subtopicMap: sMap }
  }, [books])

  if (!open) return null

  const toggleTopic = (id) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSubtopic = (id) => {
    setSelectedSubtopics((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const chapterFullySelected = (chapter) => {
    const { topicIds, subtopicIds } = collectChapterIds(chapter)
    if (topicIds.length === 0) return false
    return topicIds.every((id) => selectedTopics.has(id)) && subtopicIds.every((id) => selectedSubtopics.has(id))
  }

  const toggleChapterSelection = (chapter) => {
    const { topicIds, subtopicIds } = collectChapterIds(chapter)
    const allOn = chapterFullySelected(chapter)
    setSelectedTopics((prev) => {
      const next = new Set(prev)
      topicIds.forEach((id) => {
        if (allOn) next.delete(id)
        else next.add(id)
      })
      return next
    })
    setSelectedSubtopics((prev) => {
      const next = new Set(prev)
      subtopicIds.forEach((id) => {
        if (allOn) next.delete(id)
        else next.add(id)
      })
      return next
    })
  }

  const topicFullySelected = (topic) => {
    const { topicIds, subtopicIds } = collectTopicIds(topic)
    const subsOk = subtopicIds.length === 0 || subtopicIds.every((id) => selectedSubtopics.has(id))
    return selectedTopics.has(topicIds[0]) && subsOk
  }

  const toggleTopicBranch = (topic) => {
    const { topicIds, subtopicIds } = collectTopicIds(topic)
    const allOn = topicFullySelected(topic)
    setSelectedTopics((prev) => {
      const next = new Set(prev)
      if (allOn) next.delete(topicIds[0])
      else next.add(topicIds[0])
      return next
    })
    setSelectedSubtopics((prev) => {
      const next = new Set(prev)
      subtopicIds.forEach((id) => {
        if (allOn) next.delete(id)
        else next.add(id)
      })
      return next
    })
  }

  const toggleBook = (bookId) => {
    setExpandedBooks((prev) => ({ ...prev, [bookId]: !prev[bookId] }))
  }

  const toggleChapter = (chapterId) => {
    setExpandedChapters((prev) => ({ ...prev, [chapterId]: !prev[chapterId] }))
  }

  const toggleTopicExpand = (topicId) => {
    setExpandedTopics((prev) => ({ ...prev, [topicId]: !prev[topicId] }))
  }

  const totalCount = selectedTopics.size + selectedSubtopics.size

  const handleSave = () => {
    const topicIds = Array.from(selectedTopics)
    const subtopicIds = Array.from(selectedSubtopics)
    const curriculumSummary = buildCurriculumSummary(topicIds, subtopicIds, topicMap, subtopicMap)
    onApply?.({
      topicIds,
      subtopicIds,
      curriculumSummary,
    })
    onClose?.()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 flex justify-between items-center">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Select curriculum</h3>
            <p className="text-xs text-gray-500 mt-0.5">Chapter → Topic → Sub-topic. Use chapter or topic checkboxes to select a branch.</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
            &times;
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading books…</div>
          ) : !Array.isArray(books) || books.length === 0 ? (
            <p className="text-sm text-gray-600 text-center py-8">No curriculum books for this class and subject.</p>
          ) : (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
              {books.map((book) => (
                <div key={book.id}>
                  <button
                    type="button"
                    onClick={() => toggleBook(book.id)}
                    className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 text-left"
                  >
                    <span className="text-sm font-medium text-gray-800">{book.title}</span>
                    {book.language && (
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          isRTLLanguage(book.language) ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {String(book.language).toUpperCase()}
                      </span>
                    )}
                  </button>
                  {expandedBooks[book.id] &&
                    (book.chapters || []).map((chapter) => (
                      <div key={chapter.id} className="ml-2 border-l border-gray-200 pl-1">
                        <div className="flex items-stretch hover:bg-gray-50">
                          <label className="flex items-center gap-2 px-2 py-2 cursor-pointer shrink-0">
                            <input
                              type="checkbox"
                              checked={chapterFullySelected(chapter)}
                              onChange={() => toggleChapterSelection(chapter)}
                              className="rounded border-gray-300 text-primary-600"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() => toggleChapter(chapter.id)}
                            className="flex-1 min-w-0 w-full self-stretch flex items-center gap-2 py-2 pr-2 text-left text-sm text-gray-700 cursor-pointer hover:bg-gray-100/80 rounded-r-md"
                          >
                            <span className="text-gray-400 shrink-0">{expandedChapters[chapter.id] ? '▼' : '▶'}</span>
                            <span className="font-medium min-w-0 flex-1 truncate">{chapter.title}</span>
                            <span className="text-xs text-gray-400 shrink-0">
                              {(chapter.topics || []).length} topic(s)
                            </span>
                          </button>
                        </div>
                        {expandedChapters[chapter.id] &&
                          (chapter.topics || []).map((topic) => {
                            const subs = topic.subtopics || []
                            const hasSubs = subs.length > 0
                            return (
                              <div key={topic.id} className="ml-4 border-l border-gray-100">
                                <div className="flex items-stretch hover:bg-gray-50">
                                  <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer shrink-0">
                                    <input
                                      type="checkbox"
                                      checked={topicFullySelected(topic)}
                                      onChange={() => toggleTopicBranch(topic)}
                                      className="rounded border-gray-300 text-primary-600"
                                    />
                                  </label>
                                  <div className="flex-1 flex items-center min-w-0">
                                    {hasSubs ? (
                                      <button
                                        type="button"
                                        onClick={() => toggleTopicExpand(topic.id)}
                                        className="flex min-w-0 w-full items-center gap-1 py-1.5 pr-1 text-left text-sm text-gray-700 cursor-pointer hover:bg-gray-100/80 rounded-md flex-1"
                                      >
                                        <span className="text-gray-400 text-xs shrink-0">
                                          {expandedTopics[topic.id] ? '▼' : '▶'}
                                        </span>
                                        <RtlText language={book.language} className="truncate min-w-0 flex-1">
                                          {topic.title}
                                        </RtlText>
                                        <span className="text-xs text-gray-400 shrink-0">{subs.length} sub</span>
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => toggleTopicBranch(topic)}
                                        className="flex min-w-0 w-full flex-1 items-center py-1.5 pl-1 pr-1 text-left text-sm text-gray-700 cursor-pointer hover:bg-gray-100/80 rounded-md"
                                      >
                                        <RtlText language={book.language} className="block w-full">
                                          {topic.title}
                                        </RtlText>
                                      </button>
                                    )}
                                  </div>
                                </div>
                                {hasSubs && expandedTopics[topic.id] && (
                                  <div className="ml-6 border-l border-gray-100 pb-1">
                                    {subs.map((st) => (
                                      <label
                                        key={st.id}
                                        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={selectedSubtopics.has(st.id)}
                                          onChange={() => toggleSubtopic(st.id)}
                                          className="rounded border-gray-300 text-primary-600 shrink-0"
                                        />
                                        <RtlText language={book.language} className="text-gray-700 min-w-0 flex-1">
                                          {st.title}
                                        </RtlText>
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {totalCount > 0 && (
          <div className="px-4 py-2 border-t border-gray-100 bg-gray-50 max-h-28 overflow-y-auto">
            <p className="text-xs font-medium text-gray-600 mb-1">
              Selected: {selectedTopics.size} topic(s), {selectedSubtopics.size} sub-topic(s)
            </p>
            <div className="flex flex-wrap gap-1">
              {Array.from(selectedTopics).map((id) => (
                <span key={`t-${id}`} className="text-xs bg-primary-100 text-primary-800 px-2 py-0.5 rounded">
                  {topicMap[id]?.title || `Topic #${id}`}
                </span>
              ))}
              {Array.from(selectedSubtopics).map((id) => (
                <span key={`s-${id}`} className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded">
                  {subtopicMap[id]?.title || `Sub #${id}`}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="p-4 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave}>
            Apply ({totalCount})
          </button>
        </div>
      </div>
    </div>
  )
}
