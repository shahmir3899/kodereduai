import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { lmsApi } from '../../services/api'
import QuestionSlotEditor from './QuestionSlotEditor'

/**
 * BankFillSource - "From question bank / lesson plans" source for wizard Step 3.
 * An optional lesson-plan multi-select narrows the shared QuestionSlotEditor's bank
 * picker to the selected plans' topics; slots stay editable via the same composer
 * used by the manual source (bank source = "manual with a smarter picker").
 */
export default function BankFillSource({
  classId,
  subjectId,
  initialLessonPlanId,
  initialLessonPlanIds = [],
  onLessonPlanIdsChange,
  ...slotEditorProps
}) {
  // Seeded from the draft's currently-linked lesson plans (when resuming) so the first
  // report up to the parent matches server truth — otherwise an unhydrated empty
  // selection would look like "the user cleared everything" and wipe real links.
  const [selectedLessons, setSelectedLessons] = useState(
    initialLessonPlanId ? [initialLessonPlanId] : initialLessonPlanIds,
  )

  const { data: lessonsData, isLoading: lessonsLoading } = useQuery({
    queryKey: ['lessonPlansForPaperBuilder', classId, subjectId],
    queryFn: () =>
      lmsApi.getLessonPlans({
        page_size: 999,
        ...(classId && { class_id: classId }),
        ...(subjectId && { subject_id: subjectId }),
      }),
    enabled: Boolean(classId && subjectId),
  })

  const lessons = lessonsData?.data?.results || lessonsData?.data || []

  const selectedTopics = useMemo(() => {
    const topicMap = new Map()
    lessons
      .filter((lesson) => selectedLessons.includes(lesson.id))
      .forEach((lesson) => {
        ;(lesson.planned_topics || []).forEach((topic) => {
          topicMap.set(topic.id, topic)
        })
      })
    return Array.from(topicMap.values())
  }, [lessons, selectedLessons])

  const topicIds = useMemo(() => selectedTopics.map((topic) => topic.id), [selectedTopics])

  useEffect(() => {
    onLessonPlanIdsChange?.(selectedLessons)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLessons])

  const toggleLesson = (lessonId, checked) => {
    setSelectedLessons((prev) => (checked ? [...prev, lessonId] : prev.filter((id) => id !== lessonId)))
  }

  return (
    <div className="space-y-6">
      {!(classId && subjectId) ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">
          Select class and subject in Paper Setup to load lesson plans.
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-lg font-semibold text-gray-900">Narrow by Lesson Plans (optional)</h3>
            {selectedLessons.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedLessons([])}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Clear selection
              </button>
            )}
          </div>
          {lessonsLoading ? (
            <p className="text-sm text-gray-500">Loading lesson plans...</p>
          ) : lessons.length === 0 ? (
            <p className="text-sm text-gray-500">No lesson plans found for this class and subject.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {lessons.map((lesson) => {
                const checked = selectedLessons.includes(lesson.id)
                return (
                  <label
                    key={lesson.id}
                    className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer ${
                      checked ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => toggleLesson(lesson.id, e.target.checked)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{lesson.title}</p>
                      <p className="text-xs text-gray-600 mt-1">
                        {lesson.lesson_date || 'No date'} • {(lesson.planned_topics || []).length} topic(s)
                      </p>
                    </div>
                  </label>
                )
              })}
            </div>
          )}

          {selectedTopics.length > 0 && (
            <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-blue-900 mb-2">
                Bank picker narrowed to {selectedTopics.length} topic(s)
              </p>
              <div className="flex flex-wrap gap-1">
                {selectedTopics.map((topic) => (
                  <span key={topic.id} className="text-xs bg-white border border-blue-200 rounded-full px-2 py-0.5 text-blue-800">
                    {topic.topic_number}. {topic.title}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <QuestionSlotEditor
        {...slotEditorProps}
        classId={classId}
        subjectId={subjectId}
        source="bank"
        topicIds={topicIds}
      />
    </div>
  )
}
