import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { lmsApi, questionPaperApi } from '../../services/api'
import Toast from '../../components/Toast'

export default function LessonPlanPaperTab({
  metadata,
  isLoading,
  onPaperCreated,
  initialLessonPlanId,
}) {
  const [selectedLessons, setSelectedLessons] = useState(
    initialLessonPlanId ? [initialLessonPlanId] : []
  )
  const [paperTitle, setPaperTitle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [totalMarks, setTotalMarks] = useState(100)
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [toast, setToast] = useState(null)

  const { data: lessonsData, isLoading: lessonsLoading } = useQuery({
    queryKey: ['lessonPlansForPaperBuilder', metadata?.class_obj, metadata?.subject],
    queryFn: () =>
      lmsApi.getLessonPlans({
        page_size: 999,
        ...(metadata?.class_obj && { class_id: metadata.class_obj }),
        ...(metadata?.subject && { subject_id: metadata.subject }),
      }),
    enabled: Boolean(metadata?.class_obj && metadata?.subject),
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

  const createFromLessonsMutation = useMutation({
    mutationFn: (payload) => questionPaperApi.createFromLessons(payload),
    onSuccess: (response) => {
      const examPaper = response?.data?.exam_paper || response?.data
      setToast({ type: 'success', message: response?.data?.message || 'Paper created successfully' })
      onPaperCreated?.(examPaper)
    },
    onError: (error) => {
      setToast({
        type: 'error',
        message: error?.response?.data?.error || error?.response?.data?.detail || 'Failed to create paper from lessons',
      })
    },
  })

  const generateQuestionsMutation = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        selectedLessons.map((lessonPlanId) =>
          questionPaperApi.generateFromLesson({
            lesson_plan_id: lessonPlanId,
            question_count: 5,
            question_type: 'MCQ',
            difficulty_level: 'MEDIUM',
          })
        )
      )
      const generated = results
        .filter((r) => r.status === 'fulfilled')
        .reduce((count, r) => count + (r.value?.data?.questions?.length || 0), 0)
      return generated
    },
    onSuccess: (count) => {
      setToast({ type: 'success', message: `Generated ${count} question(s)` })
    },
    onError: (error) => {
      setToast({
        type: 'error',
        message: error?.response?.data?.error || error?.response?.data?.detail || 'Failed to generate questions',
      })
    },
  })

  const handleCreate = () => {
    if (!metadata?.class_obj || !metadata?.subject) {
      setToast({ type: 'error', message: 'Please select class and subject in Paper Metadata first' })
      return
    }
    if (!paperTitle.trim()) {
      setToast({ type: 'error', message: 'Paper title is required' })
      return
    }
    if (selectedLessons.length === 0) {
      setToast({ type: 'error', message: 'Select at least one lesson plan' })
      return
    }

    createFromLessonsMutation.mutate({
      lesson_plan_ids: selectedLessons,
      class_id: parseInt(metadata.class_obj, 10),
      subject_id: parseInt(metadata.subject, 10),
      paper_title: paperTitle,
      instructions,
      total_marks: Number(totalMarks) || 100,
      duration_minutes: Number(durationMinutes) || 60,
    })
  }

  return (
    <div className="space-y-6">
      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}

      {!(metadata?.class_obj && metadata?.subject) ? (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">
          Select class and subject in the Paper Metadata section to load lesson plans.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Paper Title *</label>
              <input
                value={paperTitle}
                onChange={(e) => setPaperTitle(e.target.value)}
                placeholder="e.g., Mid-Term Assessment from Lesson Plans"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Marks</label>
              <input
                type="number"
                value={totalMarks}
                onChange={(e) => setTotalMarks(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Duration (minutes)</label>
              <input
                type="number"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Instructions</label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter instructions for students"
              />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Select Lesson Plans</h3>
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
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedLessons((prev) => [...prev, lesson.id])
                          } else {
                            setSelectedLessons((prev) => prev.filter((id) => id !== lesson.id))
                          }
                        }}
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
          </div>

          {selectedTopics.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-semibold text-blue-900 mb-2">Topics Covered ({selectedTopics.length})</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-52 overflow-y-auto">
                {selectedTopics.map((topic) => (
                  <div key={topic.id} className="text-sm bg-white border border-blue-100 rounded px-2 py-1 text-blue-800">
                    {topic.topic_number}. {topic.title}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
            <button
              type="button"
              onClick={() => generateQuestionsMutation.mutate()}
              disabled={generateQuestionsMutation.isPending || selectedLessons.length === 0}
              className={`px-4 py-2 rounded-lg font-medium ${
                generateQuestionsMutation.isPending || selectedLessons.length === 0
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-green-100 text-green-800 hover:bg-green-200'
              }`}
            >
              {generateQuestionsMutation.isPending ? 'Generating...' : 'Generate Questions (Optional)'}
            </button>

            <button
              type="button"
              onClick={handleCreate}
              disabled={isLoading || createFromLessonsMutation.isPending}
              className={`px-6 py-2 rounded-lg font-medium ${
                isLoading || createFromLessonsMutation.isPending
                  ? 'bg-gray-400 cursor-not-allowed text-white'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {createFromLessonsMutation.isPending ? 'Creating...' : 'Create Paper from Lessons'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}