import { useState } from 'react'
import { lmsApi } from '../../services/api'
import { useToast } from '../../components/Toast'
import { normalizeLessonPlanText } from './lessonPlanTextUtils'

/**
 * AI lesson plan generation in a dedicated modal.
 * One API call per open — used by single-lesson wizard and per-date bulk rows.
 */
export default function LessonPlanAIModal({
  open,
  onClose,
  chapterIds = [],
  topicIds = [],
  subtopicIds = [],
  lessonDate,
  durationMinutes = 45,
  onApply,
}) {
  const { showSuccess, showError } = useToast()
  const [loading, setLoading] = useState(false)

  if (!open) return null

  const handleGenerate = async () => {
    if (!chapterIds?.length && !topicIds?.length && !subtopicIds?.length) {
      showError('Select at least one chapter, topic, or sub-topic before using AI.')
      return
    }
    if (!lessonDate) {
      showError('Lesson date is required for AI generation.')
      return
    }
    setLoading(true)
    try {
      const res = await lmsApi.generateLessonPlan({
        chapter_ids: chapterIds,
        topic_ids: topicIds,
        subtopic_ids: subtopicIds,
        lesson_date: lessonDate,
        duration_minutes: durationMinutes,
      })
      const data = res.data
      if (data.success === false) {
        showError(data.error || 'AI generation failed')
        return
      }
      onApply?.({
        title: normalizeLessonPlanText(data.title) || 'Lesson Plan',
        objectives: normalizeLessonPlanText(data.objectives) || 'Teacher to complete.',
        description: normalizeLessonPlanText(data.description) || 'Teacher to complete.',
        teaching_methods: normalizeLessonPlanText(data.teaching_methods) || 'Teacher to complete.',
        materials_needed: normalizeLessonPlanText(data.materials_needed) || 'Teacher to complete.',
      })
      showSuccess('AI content generated — review and edit if needed.')
      onClose?.()
    } catch (err) {
      showError(err.response?.data?.detail || err.response?.data?.error || 'AI generation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Generate with AI</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">
            &times;
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Sends <strong>{chapterIds?.length || 0}</strong> chapter(s), <strong>{topicIds?.length || 0}</strong>{' '}
          topic(s), <strong>{subtopicIds?.length || 0}</strong> sub-topic(s), and date <strong>{lessonDate}</strong>{' '}
          to draft title, objectives, description, methods, and materials.
        </p>
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleGenerate} disabled={loading}>
            {loading ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}
