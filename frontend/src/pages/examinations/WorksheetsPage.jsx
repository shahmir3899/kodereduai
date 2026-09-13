import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { worksheetApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useToast } from '../../components/Toast'
import { useConfirmModal } from '../../components/ConfirmModal'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useClassSubjects } from '../../hooks/useClassSubjects'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import { useDebounce } from '../../hooks/useDebounce'
import { RecordCard, CardGrid, ViewToggle } from '../../components/cards'
import { useViewPreference } from '../../hooks/useViewPreference'

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

/** Worksheets list -- filter/table/download shell mirrors ExamPapersPage, minus
 * the exam-lifecycle columns (duration/total marks) worksheets don't have, plus
 * a Duplicate action exam papers don't offer (handy for reusing one worksheet
 * across sections of the same class). */
export default function WorksheetsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeAcademicYear } = useAcademicYear()
  const { showError, showSuccess } = useToast()
  const { confirm, ConfirmModalRoot } = useConfirmModal()

  const [filterClassId, setFilterClassId] = useState('')
  const [filterSubjectId, setFilterSubjectId] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [page, setPage] = useState(1)
  const [view, setView] = useViewPreference('worksheets')
  const [downloadingKey, setDownloadingKey] = useState(null)

  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)
  const resolvedClassId = getResolvedMasterClassId(filterClassId, activeAcademicYear?.id, sessionClasses)
  const { subjects: classSubjects, isLoading: classSubjectsLoading } = useClassSubjects(resolvedClassId)

  const { showAllOption, classOptions: teacherClassOptions } = useTeacherScopedClasses({
    academicYearId: activeAcademicYear?.id,
    selectedClass: filterClassId,
    setSelectedClass: (value) => {
      setFilterClassId(value)
      setFilterSubjectId('')
      setPage(1)
    },
    autoSelectFirst: true,
    queryKey: 'teacherWorksheetListClasses',
  })

  const queryParams = useMemo(() => ({
    page,
    page_size: 20,
    ...(resolvedClassId && { class_obj: resolvedClassId }),
    ...(filterSubjectId && { subject: filterSubjectId }),
    ...(filterStatus && { status: filterStatus }),
    ...(debouncedSearch.trim() && { search: debouncedSearch.trim() }),
  }), [debouncedSearch, filterStatus, filterSubjectId, page, resolvedClassId])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['worksheetsList', queryParams],
    queryFn: () => worksheetApi.getWorksheets(queryParams),
  })

  const worksheets = data?.data?.results || data?.data || []
  const count = data?.data?.count || worksheets.length
  const totalPages = Math.max(1, Math.ceil(count / 20))

  const deleteMutation = useMutation({
    mutationFn: (id) => worksheetApi.deleteWorksheet(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worksheetsList'] })
      showSuccess('Worksheet deleted.')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to delete worksheet.'),
  })

  const duplicateMutation = useMutation({
    mutationFn: (id) => worksheetApi.duplicateWorksheet(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['worksheetsList'] })
      showSuccess('Worksheet duplicated.')
      navigate(`/academics/worksheets/${res.data.id}`)
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to duplicate worksheet.'),
  })

  const handleDeleteOne = async (worksheet) => {
    const ok = await confirm({
      title: 'Delete worksheet?',
      message: `Delete "${worksheet.title}"? This can't be undone from here.`,
    })
    if (ok) deleteMutation.mutate(worksheet.id)
  }

  const handleDownload = async (worksheet, format) => {
    const key = `${worksheet.id}-${format}`
    setDownloadingKey(key)
    try {
      const isPdf = format === 'pdf'
      const res = isPdf
        ? await worksheetApi.generatePDF(worksheet.id)
        : await worksheetApi.generateDOCX(worksheet.id)
      const mimeType = isPdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      const blob = new Blob([res.data], { type: mimeType })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${worksheet.title || 'worksheet'}.${format}`
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
            <h1 className="text-2xl font-bold text-gray-900">Worksheets</h1>
            <p className="text-gray-500 text-sm mt-0.5">Practice/homework sheets -- author manually, from the question bank, or by scanning a printed sheet.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/academics/worksheets/new')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
          >
            + New Worksheet
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
              placeholder="Search by worksheet title"
              className="input w-full"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            {isLoading ? 'Loading worksheets...' : `${count} worksheet${count === 1 ? '' : 's'} found`}
            {isFetching && !isLoading && <span className="ml-2 text-blue-600 text-xs">Refreshing…</span>}
          </p>
          {!isLoading && worksheets.length > 0 && <ViewToggle view={view} onChange={setView} />}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading worksheets...</div>
          ) : worksheets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">No worksheets found for the selected filters.</div>
          ) : view === 'cards' ? (
            <CardGrid className="p-3">
              {worksheets.map((worksheet) => (
                <RecordCard
                  key={worksheet.id}
                  title={worksheet.title}
                  meta={`${worksheet.class_name}${worksheet.subject_name ? ` · ${worksheet.subject_name}` : ''}`}
                  status={
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${STATUS_STYLE[worksheet.status] || 'bg-gray-100 text-gray-700'}`}>
                      {worksheet.status}
                    </span>
                  }
                  fields={[
                    { label: 'Items', value: worksheet.item_count || 0 },
                    { label: 'Source', value: worksheet.source },
                    { label: 'Updated', value: worksheet.updated_at ? new Date(worksheet.updated_at).toLocaleString() : '—' },
                  ]}
                  actions={[
                    { label: worksheet.status === 'DRAFT' ? 'Resume' : 'Open', tone: 'info', onClick: () => navigate(`/academics/worksheets/${worksheet.id}`) },
                    { label: 'Duplicate', tone: 'muted', disabled: duplicateMutation.isPending, onClick: () => duplicateMutation.mutate(worksheet.id) },
                    { label: downloadingKey === `${worksheet.id}-pdf` ? 'Generating…' : 'PDF', tone: 'muted', disabled: downloadingKey === `${worksheet.id}-pdf`, onClick: () => handleDownload(worksheet, 'pdf') },
                    { label: downloadingKey === `${worksheet.id}-docx` ? 'Generating…' : 'DOCX', tone: 'muted', disabled: downloadingKey === `${worksheet.id}-docx`, onClick: () => handleDownload(worksheet, 'docx') },
                    { label: 'Delete', tone: 'danger', disabled: deleteMutation.isPending, onClick: () => handleDeleteOne(worksheet) },
                  ]}
                />
              ))}
            </CardGrid>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class / Subject</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Items</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Source</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {worksheets.map((worksheet) => (
                    <tr key={worksheet.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{worksheet.title}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {worksheet.class_name}{worksheet.subject_name ? ` • ${worksheet.subject_name}` : ''}
                      </td>
                      <td className="px-4 py-3 text-sm text-center text-gray-700">{worksheet.item_count || 0}</td>
                      <td className="px-4 py-3 text-sm text-center text-gray-500">{worksheet.source}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[worksheet.status] || 'bg-gray-100 text-gray-700'}`}>
                          {worksheet.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{worksheet.updated_at ? new Date(worksheet.updated_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-2">
                          <button
                            type="button"
                            onClick={() => navigate(`/academics/worksheets/${worksheet.id}`)}
                            className="px-3 py-1.5 rounded border border-blue-200 text-blue-700 text-xs hover:bg-blue-50"
                          >
                            {worksheet.status === 'DRAFT' ? 'Resume' : 'Open'}
                          </button>
                          <button
                            type="button"
                            onClick={() => duplicateMutation.mutate(worksheet.id)}
                            disabled={duplicateMutation.isPending}
                            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-100 disabled:opacity-50"
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownload(worksheet, 'pdf')}
                            disabled={downloadingKey === `${worksheet.id}-pdf`}
                            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-100 disabled:opacity-50 disabled:cursor-wait"
                          >
                            {downloadingKey === `${worksheet.id}-pdf` ? 'Generating…' : 'PDF'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownload(worksheet, 'docx')}
                            disabled={downloadingKey === `${worksheet.id}-docx`}
                            className="px-3 py-1.5 rounded border border-gray-300 text-gray-700 text-xs hover:bg-gray-100 disabled:opacity-50 disabled:cursor-wait"
                          >
                            {downloadingKey === `${worksheet.id}-docx` ? 'Generating…' : 'DOCX'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteOne(worksheet)}
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

      <ConfirmModalRoot />
    </div>
  )
}
