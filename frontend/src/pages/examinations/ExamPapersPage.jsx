import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { questionPaperApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
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
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
  const { showError, showSuccess, showWarning } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()

  const [filterClassId, setFilterClassId] = useState('')
  const [filterSubjectId, setFilterSubjectId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  // Tracks which paper/format is generating so only that row's button shows
  // a loading state — generation embeds a full-page letterhead image and can
  // take several seconds, and with no feedback users assumed the click did nothing.
  const [downloadingKey, setDownloadingKey] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())

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

  // Selection is page-scoped — ids from a page that's no longer loaded (filter/page
  // change) would silently vanish from a bulk action, so drop the whole selection
  // whenever the underlying query changes rather than trying to reconcile it.
  useEffect(() => {
    setSelectedIds(new Set())
  }, [queryParams])

  const deleteMutation = useMutation({
    mutationFn: (id) => questionPaperApi.deleteExamPaper(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['examPapersList'] })
      showSuccess('Paper deleted.')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete paper.'),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => questionPaperApi.bulkDeleteExamPapers(ids),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['examPapersList'] })
      const { deleted = [], skipped = [] } = res?.data || {}
      setSelectedIds(new Set())
      if (deleted.length) showSuccess(`Deleted ${deleted.length} paper${deleted.length === 1 ? '' : 's'}.`)
      if (skipped.length) showWarning(`${skipped.length} paper${skipped.length === 1 ? '' : 's'} could not be deleted (no permission or not found).`)
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete selected papers.'),
  })

  const toggleSelectOne = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allOnPageSelected = papers.length > 0 && papers.every((paper) => selectedIds.has(paper.id))

  const toggleSelectAllOnPage = () => {
    setSelectedIds((current) => {
      if (allOnPageSelected) {
        const next = new Set(current)
        papers.forEach((paper) => next.delete(paper.id))
        return next
      }
      const next = new Set(current)
      papers.forEach((paper) => next.add(paper.id))
      return next
    })
  }

  const handleDeleteOne = async (paper) => {
    const ok = await confirm({
      title: 'Delete paper?',
      message: `Delete "${paper.paper_title}"? This can't be undone from here.`,
    })
    if (ok) deleteMutation.mutate(paper.id)
  }

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    const ok = await confirm({
      title: 'Delete selected papers?',
      message: `Delete ${ids.length} selected paper${ids.length === 1 ? '' : 's'}? This can't be undone from here.`,
    })
    if (ok) bulkDeleteMutation.mutate(ids)
  }

  const handleDownload = async (paper, format) => {
    const key = `${paper.id}-${format}`
    setDownloadingKey(key)
    try {
      const isPdf = format === 'pdf'
      const res = isPdf
        ? await questionPaperApi.generatePDF(paper.id)
        : await questionPaperApi.generateDOCX(paper.id)
      const mimeType = isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      const blob = new Blob([res.data], { type: mimeType })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${paper.paper_title || 'paper'}.${format}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      showError(err.response?.data?.detail || `Failed to generate ${format.toUpperCase()}. Please try again.`)
    } finally {
      setDownloadingKey((current) => (current === key ? null : current))
    }
  }

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
                    <th className="px-4 py-3 text-left w-10">
                      <input
                        type="checkbox"
                        checked={allOnPageSelected}
                        onChange={toggleSelectAllOnPage}
                        aria-label="Select all papers on this page"
                        className="rounded border-gray-300"
                      />
                    </th>
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
                        <input
                          type="checkbox"
                          checked={selectedIds.has(paper.id)}
                          onChange={() => toggleSelectOne(paper.id)}
                          aria-label={`Select ${paper.paper_title}`}
                          className="rounded border-gray-300"
                        />
                      </td>
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
                            onClick={() => handleDownload(paper, 'pdf')}
                            disabled={downloadingKey === `${paper.id}-pdf`}
                            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-100 disabled:opacity-50 disabled:cursor-wait"
                          >
                            {downloadingKey === `${paper.id}-pdf` ? 'Generating…' : 'PDF'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownload(paper, 'docx')}
                            disabled={downloadingKey === `${paper.id}-docx`}
                            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-100 disabled:opacity-50 disabled:cursor-wait"
                          >
                            {downloadingKey === `${paper.id}-docx` ? 'Generating…' : 'DOCX'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(paper)}
                            disabled={deleteMutation.isPending}
                            className="px-3 py-1.5 rounded border border-red-200 text-red-700 text-xs hover:bg-red-50 disabled:opacity-50"
                          >
                            Delete
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

      {selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-white rounded-xl shadow-2xl border border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">{selectedIds.size} selected</span>
          <button
            type="button"
            onClick={handleBulkDelete}
            disabled={bulkDeleteMutation.isPending}
            className="px-3 py-1.5 text-red-600 border border-red-300 rounded-lg text-sm hover:bg-red-50 disabled:opacity-50"
          >
            {bulkDeleteMutation.isPending ? 'Deleting…' : `Delete Selected (${selectedIds.size})`}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      )}

      <ConfirmModalRoot />
    </div>
  )
}
