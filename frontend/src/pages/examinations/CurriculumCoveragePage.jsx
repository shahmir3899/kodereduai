import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { lmsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import TopicStatusBadge from './TopicStatusBadge'
import CurriculumTimeline from './CurriculumTimeline'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import PageHeader from '../../components/ui/PageHeader'

export default function CurriculumCoveragePage() {
  const { isTeacher } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { showError } = useToast()
  const queryClient = useQueryClient()
  const [view, setView] = useViewPreference('curriculum-coverage')
  const [mode, setMode] = useState('list') // 'list' | 'timeline'
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [coverage, setCoverage] = useState('')
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedClassId = getResolvedMasterClassId(classId, activeAcademicYear?.id, sessionClasses)
  const { subjects: classSubjects, isLoading: classSubjectsLoading } = useClassSubjects(resolvedClassId)
  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass: classId,
    setSelectedClass: setClassId,
    autoSelectFirst: true,
    queryKey: 'teacherCurriculumCoverageClasses',
  })

  const topicsQueryKey = ['curriculumCoverageTopics', resolvedClassId, subjectId, coverage, activeAcademicYear?.id]
  const { data, isLoading } = useQuery({
    queryKey: topicsQueryKey,
    queryFn: () =>
      lmsApi.getTopics({
        page_size: 999,
        ...(resolvedClassId && { class_id: resolvedClassId }),
        ...(subjectId && { subject_id: subjectId }),
        ...(coverage && { coverage }),
        ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
      }),
    enabled: Boolean(resolvedClassId && subjectId),
  })

  const topics = data?.data?.results || data?.data || []
  const taughtCount = topics.filter((t) => t.is_covered).length
  const testedCount = topics.filter((t) => t.is_tested).length

  const plannedDateMutation = useMutation({
    mutationFn: ({ topicId, plannedDate }) =>
      lmsApi.setTopicPlannedDate(topicId, { academicYear: activeAcademicYear?.id, plannedDate }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: topicsQueryKey }),
    onError: (err) => showError(err.response?.data?.detail || 'Failed to save planned date.'),
  })
  const handlePlannedDateChange = (topicId, value) => {
    if (!activeAcademicYear?.id) {
      showError('Select an academic year first.')
      return
    }
    plannedDateMutation.mutate({ topicId, plannedDate: value || null })
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Curriculum Coverage" subtitle="Track taught vs tested topics by class and subject." />

      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="label">Class</label>
            <ClassSelector
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="input"
              scope={classSelectorScope}
              academicYearId={activeAcademicYear?.id}
              showAllOption={showAllOption}
              classes={teacherClassOptions || undefined}
            />
          </div>
          <div>
            <label className="label">Subject</label>
            <select
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              className="input"
              disabled={!resolvedClassId || classSubjectsLoading}
            >
              <option value="">
                {!resolvedClassId
                  ? 'Select class first'
                  : classSubjectsLoading
                  ? 'Loading subjects...'
                  : classSubjects.length > 0
                  ? 'Select subject...'
                  : 'No subjects assigned'}
              </option>
              {classSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.code ? `${subject.code} - ` : ''}{subject.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Coverage Filter</label>
            <select className="input" value={coverage} onChange={(e) => setCoverage(e.target.value)}>
              <option value="">All topics</option>
              <option value="taught_only">Taught only</option>
              <option value="tested_only">Tested only</option>
              <option value="both">Taught & tested</option>
              <option value="uncovered">Uncovered</option>
            </select>
          </div>
        </div>
      </div>

      {classId && subjectId && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500">Total Topics</p>
            <p className="text-2xl font-bold text-gray-900">{topics.length}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500">Taught</p>
            <p className="text-2xl font-bold text-green-700">{taughtCount}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-500">Tested</p>
            <p className="text-2xl font-bold text-blue-700">{testedCount}</p>
          </div>
        </div>
      )}

      <div className="card">
        {!classId || !subjectId ? (
          <p className="text-sm text-gray-500">Select class and subject to view coverage.</p>
        ) : isLoading ? (
          <p className="text-sm text-gray-500">Loading topics...</p>
        ) : topics.length === 0 ? (
          <p className="text-sm text-gray-500">No topics found for selected filters.</p>
        ) : (
          <>
            <div className="flex justify-between items-center mb-3">
              <div className="inline-flex items-center bg-gray-100 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setMode('list')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setMode('timeline')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${mode === 'timeline' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                  Timeline
                </button>
              </div>
              {mode === 'list' && <ViewToggle view={view} onChange={setView} />}
            </div>

            {mode === 'timeline' ? (
              <CurriculumTimeline topics={topics} academicYear={activeAcademicYear} />
            ) : view === 'cards' ? (
            <CardGrid>
              {topics.map((topic) => (
                <RecordCard
                  key={topic.id}
                  title={`${topic.topic_number}. ${topic.title}`}
                  status={<TopicStatusBadge topic={topic} />}
                  fields={[
                    { label: 'Lesson Plans', value: topic.lesson_plan_count || 0 },
                    { label: 'Questions', value: topic.test_question_count || 0 },
                    { label: 'Planned Date', value: topic.planned_date || 'Not set' },
                    { label: 'Taught Date', value: topic.taught_date || 'Not yet' },
                  ]}
                />
              ))}
            </CardGrid>
            ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Topic</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Planned Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Taught Date</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Lesson Plans</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Questions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {topics.map((topic) => (
                  <tr key={topic.id}>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {topic.topic_number}. {topic.title}
                    </td>
                    <td className="px-4 py-3 text-sm"><TopicStatusBadge topic={topic} /></td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      <input
                        type="date"
                        defaultValue={topic.planned_date || ''}
                        onBlur={(e) => {
                          if (e.target.value !== (topic.planned_date || '')) {
                            handlePlannedDateChange(topic.id, e.target.value)
                          }
                        }}
                        disabled={!activeAcademicYear?.id || plannedDateMutation.isPending}
                        className="input text-xs py-1"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{topic.taught_date || <span className="text-gray-400">Not yet</span>}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{topic.lesson_plan_count || 0}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{topic.test_question_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
