import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { questionPaperApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'READY', label: 'Ready' },
  { value: 'PUBLISHED', label: 'Published' },
]

const STATUS_STYLE = {
  DRAFT: 'bg-yellow-100 text-yellow-800',
  READY: 'bg-blue-100 text-blue-800',
  PUBLISHED: 'bg-green-100 text-green-800',
}

export default function ExamPapersPage() {
  const navigate = useNavigate()
  const { activeAcademicYear } = useAcademicYear()

  const [filterClassId, setFilterClassId] = useState('')
  const [filterSubjectId, setFilterSubjectId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const resolvedClassId = getResolvedMasterClassId(filterClassId, activeAcademicYear?.id, sessionClasses)
  const { subjects: classSubjects, isLoading: classSubjectsLoading } = useClassSubjects(resolvedClassId)

  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass: filterClassId,
    setSelectedClass: (value) => {
      setFilterClassId(value)
      setFilterSubjectId('')
      setPage(1)
    },
    autoSelectFirst: true,
    queryKey: 'teacherExamPaperListClasses',
  })

  const queryParams = useMemo(() => ({
    page,
    page_size: 20,
    ...(resolvedClassId && { class_obj: resolvedClassId }),
    ...(filterSubjectId && { subject: filterSubjectId }),
    ...(filterStatus && { status: filterStatus }),
    ...(search.trim() && { search: search.trim() }),
  }), [filterStatus, filterSubjectId, page, resolvedClassId, search])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['examPapersList', queryParams],
    queryFn: () => questionPaperApi.getExamPapers(queryParams),
  })

  const papers = data?.data?.results || data?.data || []
  const count = data?.data?.count || papers.length
  const totalPages = Math.max(1, Math.ceil(count / 20))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Question Papers</h1>
            <p className="text-gray-500 text-sm mt-0.5">Resume drafts, review ready papers, and export published papers.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/academics/paper-builder')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + New Paper
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Class</label>
            <ClassSelector
              value={filterClassId}
              onChange={(e) => {
                setFilterClassId(e.target.value)
                setFilterSubjectId('')
                setPage(1)
              }}
              className="input w-full"
              scope={classSelectorScope}
              academicYearId={activeAcademicYear?.id}
              showAllOption={showAllOption}
              classes={teacherClassOptions || undefined}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Subject</label>
            <select
              value={filterSubjectId}
              onChange={(e) => {
                setFilterSubjectId(e.target.value)
                setPage(1)
              }}
              disabled={!resolvedClassId || classSubjectsLoading}
              className="input w-full"
            >
              <option value="">
                {!resolvedClassId
                  ? 'Select class first'
                  : classSubjectsLoading
                    ? 'Loading subjects...'
                    : 'All Subjects'}
              </option>
              {classSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.code ? `${subject.code} - ` : ''}{subject.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value)
                setPage(1)
              }}
              className="input w-full"
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status.value || 'all'} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search by paper title"
              className="input w-full"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {isLoading ? 'Loading papers...' : `${count} paper${count === 1 ? '' : 's'} found`}
            {isFetching && !isLoading && <span className="ml-2 text-blue-600 text-xs">Refreshing…</span>}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading papers...</div>
          ) : papers.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No papers found for the selected filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class / Subject</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Questions</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {papers.map((paper) => (
                    <tr key={paper.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{paper.paper_title}</div>
                        <div className="text-xs text-gray-500">{paper.duration_minutes} min • {paper.total_marks} marks</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">{paper.class_name} • {paper.subject_name}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{paper.question_count || 0}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[paper.status] || 'bg-gray-100 text-gray-700'}`}>
                          {paper.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{paper.updated_at ? new Date(paper.updated_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/examinations/papers/${paper.id}`)}
                            className="px-3 py-1.5 rounded border border-blue-200 text-blue-700 text-xs hover:bg-blue-50"
                          >
                            {paper.status === 'DRAFT' ? 'Resume' : 'Open'}
                          </button>
                          <button
                            type="button"
                            onClick={() => navigate(`/academics/papers/${paper.id}/responses`)}
                            className="px-3 py-1.5 rounded border border-emerald-200 text-emerald-700 text-xs hover:bg-emerald-50"
                          >
                            Responses
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await questionPaperApi.generatePDF(paper.id)
                              const blob = new Blob([res.data], { type: 'application/pdf' })
                              const url = window.URL.createObjectURL(blob)
                              const link = document.createElement('a')
                              link.href = url
                              link.download = `${paper.paper_title || 'paper'}.pdf`
                              document.body.appendChild(link)
                              link.click()
                              link.remove()
                              window.URL.revokeObjectURL(url)
                            }}
                            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-100"
                          >
                            PDF
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const res = await questionPaperApi.generateDOCX(paper.id)
                              const blob = new Blob(
                                [res.data],
                                { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
                              )
                              const url = window.URL.createObjectURL(blob)
                              const link = document.createElement('a')
                              link.href = url
                              link.download = `${paper.paper_title || 'paper'}.docx`
                              document.body.appendChild(link)
                              link.click()
                              link.remove()
                              window.URL.revokeObjectURL(url)
                            }}
                            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-100"
                          >
                            DOCX
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Prev
            </button>
            <span className="text-sm text-gray-600">Page {page} of {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
