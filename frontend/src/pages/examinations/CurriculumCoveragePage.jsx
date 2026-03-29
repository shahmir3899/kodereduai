import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { lmsApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import SubjectSelector from '../../components/SubjectSelector'
import TopicStatusBadge from './TopicStatusBadge'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'

export default function CurriculumCoveragePage() {
  const { activeAcademicYear } = useAcademicYear()
  const [classId, setClassId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [coverage, setCoverage] = useState('')
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedClassId = getResolvedMasterClassId(classId, activeAcademicYear?.id, sessionClasses)

  const { data, isLoading } = useQuery({
    queryKey: ['curriculumCoverageTopics', resolvedClassId, subjectId, coverage, activeAcademicYear?.id],
    queryFn: () =>
      lmsApi.getTopics({
        page_size: 999,
        ...(resolvedClassId && { class_id: resolvedClassId }),
        ...(subjectId && { subject_id: subjectId }),
        ...(coverage && { coverage }),
      }),
    enabled: Boolean(resolvedClassId && subjectId),
  })

  const topics = data?.data?.results || data?.data || []
  const taughtCount = topics.filter((t) => t.is_covered).length
  const testedCount = topics.filter((t) => t.is_tested).length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Curriculum Coverage</h1>
        <p className="text-sm text-gray-600 mt-1">Track taught vs tested topics by class and subject.</p>
      </div>

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
            />
          </div>
          <div>
            <label className="label">Subject</label>
            <SubjectSelector value={subjectId} onChange={(e) => setSubjectId(e.target.value)} className="input" />
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
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Topic</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
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
                    <td className="px-4 py-3 text-sm text-gray-700">{topic.lesson_plan_count || 0}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{topic.test_question_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
