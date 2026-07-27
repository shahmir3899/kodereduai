import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, academicsApi, classesApi } from '../../services/api'
import ClassSelector from '../../components/ClassSelector'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../../utils/classScope'
import ExamWizard from './ExamWizard'
import BulkTestModal from './BulkTestModal'
import { useConfirmModal } from '../../components/ConfirmModal'

const createEmptyForm = (academicYearId = '', termId = '') => ({
  academic_year: academicYearId ? String(academicYearId) : '',
  term: termId ? String(termId) : '',
  exam_type: '',
  class_obj: '',
  name: '',
  start_date: '',
  end_date: '',
  status: 'SCHEDULED',
})

const STATUS_STYLES = {
  SCHEDULED: 'bg-gray-100 text-gray-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  MARKS_ENTRY: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  PUBLISHED: 'bg-purple-100 text-purple-700',
}

// Pivots the date-sheet GET response (subjects -> their per-class dates) into a
// Date x Class grid for the calendar preview, mirroring the backend's
// _build_date_sheet_grid so the in-app view and the downloads read the same way.
// Column order is taken from the payload's own ordering (already grade_level-sorted
// server-side) rather than re-sorted here, so it doesn't need class metadata this
// endpoint doesn't return.
export function buildDateSheetGrid(subjects) {
  const columnsById = {}
  const columnOrder = []
  const cells = {} // `${examDate}|${examId}` -> [subjectName, ...]
  const unscheduled = []

  subjects.forEach(sub => {
    sub.classes.forEach(cls => {
      if (!columnsById[cls.exam_id]) {
        columnsById[cls.exam_id] = { examId: cls.exam_id, label: cls.class_name }
        columnOrder.push(cls.exam_id)
      }
      if (!cls.exam_date) {
        unscheduled.push({ subjectName: sub.subject_name, className: cls.class_name })
        return
      }
      const key = `${cls.exam_date}|${cls.exam_id}`
      cells[key] = [...(cells[key] || []), sub.subject_name]
    })
  })

  const columns = columnOrder.map(id => columnsById[id])
  const dates = [...new Set(Object.keys(cells).map(key => key.split('|')[0]))].sort()

  const rows = dates.map(dateStr => {
    // Parse as UTC so the local timezone offset never shifts the calendar date.
    const dayName = new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long', timeZone: 'UTC',
    })
    const rowCells = {}
    columns.forEach(col => {
      const names = cells[`${dateStr}|${col.examId}`]
      rowCells[col.examId] = names ? names.join(' / ') : ''
    })
    return { date: dateStr, dayName, cells: rowCells }
  })

  unscheduled.sort((a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName))

  return { columns, rows, unscheduled }
}

// UTC-safe date helpers (mirrors ExamWizard.jsx) — avoid local-timezone
// off-by-one bugs when turning a start/end date range into calendar rows.
function parseDateOnly(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function addDaysToDateString(dateStr, days) {
  const date = parseDateOnly(dateStr)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function daysBetweenInclusive(startStr, endStr) {
  const start = parseDateOnly(startStr)
  const end = parseDateOnly(endStr)
  return Math.round((end - start) / 86400000) + 1
}

// Every calendar day in [startStr, endStr], inclusive. [] if either bound is
// missing or the range is invalid.
export function buildDateRange(startStr, endStr) {
  if (!startStr || !endStr) return []
  const days = daysBetweenInclusive(startStr, endStr)
  if (days <= 0) return []
  return Array.from({ length: days }, (_, i) => addDaysToDateString(startStr, i))
}

function dayNameForDate(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

// Groups the date-sheet GET response's per-subject/per-class rows by class
// (exam_id) — each class's ExamSubject records are the fixed pool of subjects
// the Calendar view's per-cell picker can assign to that class's column.
export function buildSubjectPoolByExam(subjects) {
  const pool = {}
  subjects.forEach(sub => {
    sub.classes.forEach(cls => {
      if (!pool[cls.exam_id]) pool[cls.exam_id] = []
      pool[cls.exam_id].push({
        examSubjectId: cls.exam_subject_id,
        subjectName: sub.subject_name,
        examDate: cls.exam_date || '',
      })
    })
  })
  return pool
}

// Hoisted to module scope (not nested inside ExamsPage) so it keeps a stable
// component identity across ExamsPage re-renders -- when it was defined inline,
// every ExamsPage re-render (e.g. from the examGroups query refetching after a
// save) created a *new* DateSheetModal function, which React treated as a
// different component type and remounted, silently resetting viewMode back to
// its default mid-edit. Exported (not just module-scoped) so it can be tested
// directly without mounting all of ExamsPage's other queries/contexts.
export function DateSheetModal({ groupId, onClose: closeDateSheet, queryClient, setListError }) {
  const [localRows, setLocalRows] = useState([])
  const [saving, setSaving] = useState(new Set())
  const [savingCells, setSavingCells] = useState(new Set())
  const [viewMode, setViewMode] = useState('calendar') // 'table' | 'calendar'

  const { data: dsRes, isLoading: dsLoading } = useQuery({
    queryKey: ['dateSheet', groupId],
    queryFn: () => examinationsApi.getDateSheet(groupId),
    enabled: !!groupId,
  })

  useEffect(() => {
    if (dsRes?.data?.subjects) {
      const rows = []
      dsRes.data.subjects.forEach(sub => {
        sub.classes.forEach(cls => {
          rows.push({
            exam_subject_id: cls.exam_subject_id,
            subject_name: sub.subject_name,
            subject_code: sub.subject_code,
            class_name: cls.class_name,
            exam_date: cls.exam_date || '',
            start_time: cls.start_time || '',
            end_time: cls.end_time || '',
          })
        })
      })
      setLocalRows(rows)
    }
  }, [dsRes])

  const handleChange = (examSubjectId, field, value) => {
    setLocalRows(prev => prev.map(r =>
      r.exam_subject_id === examSubjectId ? { ...r, [field]: value } : r
    ))
  }

  const handleSave = async (row) => {
    setSaving(prev => new Set(prev).add(row.exam_subject_id))
    try {
      await examinationsApi.updateDateSheet(groupId, [{
        exam_subject_id: row.exam_subject_id,
        exam_date: row.exam_date || null,
        start_time: row.start_time || null,
        end_time: row.end_time || null,
      }])
      queryClient.invalidateQueries({ queryKey: ['examGroups'] })
    } catch {
      setListError('Failed to save.')
    } finally {
      setSaving(prev => { const s = new Set(prev); s.delete(row.exam_subject_id); return s })
    }
  }

  const handleDownload = async () => {
    try {
      const res = await examinationsApi.downloadDateSheet(groupId)
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `date-sheet-${groupId}.xlsx`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      setListError('Failed to download date sheet.')
    }
  }

  const handleDownloadPdf = async () => {
    try {
      const res = await examinationsApi.downloadDateSheetPdf(groupId)
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `date-sheet-${groupId}.pdf`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      setListError('Failed to download date sheet PDF.')
    }
  }

  const grid = useMemo(() => buildDateSheetGrid(dsRes?.data?.subjects || []), [dsRes])

  // Each class's fixed pool of ExamSubject records, for the Calendar view's
  // per-cell subject picker (assigning = moving that record's exam_date).
  const subjectPool = useMemo(() => buildSubjectPoolByExam(dsRes?.data?.subjects || []), [dsRes])

  // Rows added via "+ Add Date" this session, beyond the group's saved
  // start/end range. Once a subject is assigned to one, it persists and
  // reappears naturally through `grid.rows` on the next load — this state
  // only needs to hold blank rows still waiting for an assignment.
  const [extraDates, setExtraDates] = useState([])

  // Every day in the group's date range, plus any date that already has a
  // subject scheduled outside that range, plus this session's blank rows —
  // union rather than picking one, so a subject placed via "+ Add Date"
  // never causes its own row to disappear when the data refetches.
  const calendarDates = useMemo(() => {
    const range = buildDateRange(dsRes?.data?.start_date, dsRes?.data?.end_date)
    const scheduled = grid.rows.map(r => r.date)
    return [...new Set([...range, ...scheduled, ...extraDates])].sort()
  }, [dsRes, grid, extraDates])

  const lastCalendarDate = calendarDates[calendarDates.length - 1]
  const lastRowIsRemovable = !!lastCalendarDate
    && extraDates.includes(lastCalendarDate)
    && grid.columns.every(col => (subjectPool[col.examId] || []).filter(e => e.examDate === lastCalendarDate).length === 0)

  const handleAddDateRow = () => {
    setOpenCell(null)
    const base = lastCalendarDate || dsRes?.data?.start_date
    if (!base) return
    const nextDate = addDaysToDateString(base, 1)
    setExtraDates(prev => prev.includes(nextDate) ? prev : [...prev, nextDate])
  }

  const handleRemoveLastDateRow = () => {
    if (!lastRowIsRemovable) return
    setOpenCell(null)
    setExtraDates(prev => prev.filter(d => d !== lastCalendarDate))
  }

  // Replace a class+date cell's subject set, persisting immediately.
  // Subjects unchecked go back to unscheduled; subjects newly checked move
  // onto this date (a subject only ever occupies one date per class, so
  // checking one already scheduled elsewhere relocates it here).
  const handleCellSubjectsChange = async (examId, date, nextExamSubjectIds) => {
    const previousIds = (subjectPool[examId] || []).filter(e => e.examDate === date).map(e => e.examSubjectId)
    const nextSet = new Set(nextExamSubjectIds)
    const prevSet = new Set(previousIds)
    const added = nextExamSubjectIds.filter(id => !prevSet.has(id))
    const removed = previousIds.filter(id => !nextSet.has(id))
    if (added.length === 0 && removed.length === 0) return

    const updates = [
      ...removed.map(id => ({ exam_subject_id: id, exam_date: null })),
      ...added.map(id => ({ exam_subject_id: id, exam_date: date })),
    ]

    const cellKey = `${examId}|${date}`
    setSavingCells(prev => new Set(prev).add(cellKey))
    try {
      await examinationsApi.updateDateSheet(groupId, updates)
      queryClient.invalidateQueries({ queryKey: ['dateSheet', groupId] })
      queryClient.invalidateQueries({ queryKey: ['examGroups'] })
    } catch {
      setListError('Failed to update date sheet.')
    } finally {
      setSavingCells(prev => { const s = new Set(prev); s.delete(cellKey); return s })
    }
  }

  const toggleCellSubject = (examId, date, examSubjectId) => {
    const current = (subjectPool[examId] || []).filter(e => e.examDate === date).map(e => e.examSubjectId)
    const next = current.includes(examSubjectId)
      ? current.filter(id => id !== examSubjectId)
      : [...current, examSubjectId]
    handleCellSubjectsChange(examId, date, next)
  }

  // Which cell's subject picker is open — `${examId}|${date}` or null.
  const [openCell, setOpenCell] = useState(null)
  useEffect(() => {
    if (!openCell) return
    const handlePointerDown = (e) => {
      if (!e.target.closest(`[data-cell-key="${openCell}"]`)) setOpenCell(null)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [openCell])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeDateSheet}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Date Sheet</h2>
            <p className="text-xs text-gray-500">
              {viewMode === 'table' ? 'Each class–subject row is independent. Changes save on blur.' : 'Click a cell to check off every subject that class sits on that date.'}
            </p>
          </div>
          <button onClick={closeDateSheet} className="text-gray-400 hover:text-gray-600 text-xl flex-shrink-0">&times;</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <button onClick={handleDownload} className="text-xs px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg font-medium">
            Download Excel
          </button>
          <button onClick={handleDownloadPdf} className="text-xs px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg font-medium">
            Download PDF
          </button>
        </div>

        <div className="flex border-b border-gray-200 mt-2">
          <button
            onClick={() => setViewMode('table')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${viewMode === 'table' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Table
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${viewMode === 'calendar' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Calendar
          </button>
        </div>

        {dsLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
          </div>
        ) : localRows.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No subjects found in this exam group.</p>
        ) : viewMode === 'calendar' ? (
          <div className="overflow-auto mt-4">
            <table className="min-w-full text-sm border border-gray-200">
              <thead>
                <tr className="bg-primary-600 text-white text-xs uppercase">
                  <th className="px-3 py-2 text-left border border-primary-500">Date</th>
                  <th className="px-3 py-2 text-left border border-primary-500">Day</th>
                  {grid.columns.map(col => (
                    <th key={col.examId} className="px-3 py-2 text-center border border-primary-500">{col.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {calendarDates.length === 0 ? (
                  <tr>
                    <td colSpan={2 + grid.columns.length} className="px-3 py-6 text-center text-gray-400">
                      No dates set yet — switch to Table to assign dates.
                    </td>
                  </tr>
                ) : calendarDates.map((date, dateIdx) => {
                  const openUpward = dateIdx >= Math.floor(calendarDates.length / 2)
                  return (
                    <tr key={date} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900 border border-gray-200">{date}</td>
                      <td className="px-3 py-2 text-gray-600 border border-gray-200">{dayNameForDate(date)}</td>
                      {grid.columns.map((col, colIdx) => {
                        // Flip the popover to the cell's left once we're in the
                        // latter half of the columns, so it opens toward the
                        // table's horizontal-scroll center instead of running
                        // off the right edge on a narrow (mobile) viewport.
                        const openLeft = colIdx >= Math.ceil(grid.columns.length / 2)
                        const classSubjectOptions = subjectPool[col.examId] || []
                        const selectedIds = classSubjectOptions.filter(e => e.examDate === date).map(e => e.examSubjectId)
                        const cellKey = `${col.examId}|${date}`
                        const isSaving = savingCells.has(cellKey)
                        const isOpen = openCell === cellKey

                        return (
                          <td key={col.examId} className="px-2 py-1.5 border border-gray-200 relative" data-cell-key={cellKey}>
                            <button
                              type="button"
                              aria-label={`${date} - ${col.label}`}
                              onClick={() => setOpenCell(isOpen ? null : cellKey)}
                              disabled={isSaving}
                              className={`w-full min-h-[30px] text-left rounded border px-2 py-1 flex flex-wrap gap-1 items-center text-xs ${isOpen ? 'border-primary-500 ring-1 ring-primary-200 bg-primary-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                            >
                              {isSaving ? (
                                <span className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-600" />
                              ) : selectedIds.length === 0 ? (
                                <span className="text-gray-300">+ Add subjects</span>
                              ) : selectedIds.map(id => {
                                const subj = classSubjectOptions.find(r => r.examSubjectId === id)
                                return (
                                  <span key={id} className="inline-flex items-center bg-primary-100 text-primary-700 rounded-full px-2 py-0.5 text-[11px] font-medium">
                                    {subj?.subjectName || id}
                                  </span>
                                )
                              })}
                            </button>

                            {isOpen && (
                              <div className={`absolute z-20 w-52 bg-white border border-gray-300 rounded-lg shadow-lg p-2 ${openLeft ? 'right-0' : 'left-0'} ${openUpward ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                                <p className="text-[10px] font-semibold uppercase text-gray-400 px-1 mb-1">{col.label} · {date}</p>
                                <div className="max-h-40 overflow-auto">
                                  {classSubjectOptions.length === 0 ? (
                                    <p className="text-xs text-gray-400 px-1 py-2">No subjects for this class.</p>
                                  ) : classSubjectOptions.map(row => {
                                    const isHere = selectedIds.includes(row.examSubjectId)
                                    const isElsewhere = !isHere && row.examDate && row.examDate !== date
                                    return (
                                      <label key={row.examSubjectId} className="flex items-center gap-2 px-1 py-1 text-xs rounded hover:bg-gray-50 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={isHere}
                                          onChange={() => toggleCellSubject(col.examId, date, row.examSubjectId)}
                                          className="rounded border-gray-300"
                                        />
                                        <span className="flex-1">{row.subjectName}</span>
                                        {isElsewhere && <span className="text-[10px] text-gray-400">{row.examDate}</span>}
                                      </label>
                                    )
                                  })}
                                </div>
                                <div className="flex justify-end pt-1 mt-1 border-t border-gray-100">
                                  <button type="button" onClick={() => setOpenCell(null)} className="text-xs font-medium text-primary-600 hover:text-primary-700 px-2 py-1">
                                    Done
                                  </button>
                                </div>
                              </div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>

            {calendarDates.length > 0 && (
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={handleAddDateRow}
                  className="flex-1 text-xs font-medium text-gray-500 border border-dashed border-gray-300 rounded-lg py-2 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50"
                >
                  + Add Date
                </button>
                {lastRowIsRemovable && (
                  <button
                    type="button"
                    onClick={handleRemoveLastDateRow}
                    className="text-xs font-medium text-gray-400 border border-gray-200 rounded-lg px-3 py-2 hover:border-red-300 hover:text-red-500"
                  >
                    Remove last
                  </button>
                )}
              </div>
            )}

            {grid.unscheduled.length > 0 && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-xs font-medium text-amber-800 mb-1">Not yet scheduled:</p>
                <ul className="text-xs text-amber-700 list-disc list-inside">
                  {grid.unscheduled.map((item, i) => (
                    <li key={i}>{item.subjectName} ({item.className})</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-auto mt-4">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-3 py-2 text-left">Subject</th>
                  <th className="px-3 py-2 text-left">Class</th>
                  <th className="px-3 py-2 text-left w-36">Date</th>
                  <th className="px-3 py-2 text-left w-28">Start</th>
                  <th className="px-3 py-2 text-left w-28">End</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {localRows.map((row, idx) => {
                  const prev = localRows[idx - 1]
                  const isFirst = !prev || prev.subject_name !== row.subject_name
                  const isSaving = saving.has(row.exam_subject_id)
                  return (
                    <tr key={row.exam_subject_id} className={`hover:bg-gray-50 ${isFirst && idx > 0 ? 'border-t-2 border-gray-200' : ''}`}>
                      <td className="px-3 py-2 font-medium text-gray-900">
                        {isFirst ? (
                          <span>{row.subject_name}{row.subject_code ? <span className="text-xs text-gray-400 ml-1">({row.subject_code})</span> : null}</span>
                        ) : (
                          <span className="text-gray-300 text-xs">↳</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs">{row.class_name}</td>
                      <td className="px-3 py-2">
                        <input type="date" value={row.exam_date}
                          onChange={e => handleChange(row.exam_subject_id, 'exam_date', e.target.value)}
                          onBlur={() => handleSave(row)}
                          className="input text-sm py-1 w-full" disabled={isSaving} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="time" value={row.start_time}
                          onChange={e => handleChange(row.exam_subject_id, 'start_time', e.target.value)}
                          onBlur={() => handleSave(row)}
                          className="input text-sm py-1 w-full" disabled={isSaving} />
                      </td>
                      <td className="px-3 py-2">
                        <input type="time" value={row.end_time}
                          onChange={e => handleChange(row.exam_subject_id, 'end_time', e.target.value)}
                          onBlur={() => handleSave(row)}
                          className="input text-sm py-1 w-full" disabled={isSaving} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {isSaving && <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-600 mx-auto" />}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ExamsPage() {
  const queryClient = useQueryClient()
  const { confirm, ConfirmModalRoot } = useConfirmModal()
  const { activeAcademicYear, currentTerm } = useAcademicYear()
  const { activeSchool } = useAuth()
  const getDefaultForm = () => createEmptyForm(activeAcademicYear?.id, currentTerm?.id)

  // UI state
  const [showWizard, setShowWizard] = useState(false)
  const [showBulkTestModal, setShowBulkTestModal] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState(null)
  const [form, setForm] = useState(() => createEmptyForm())
  const [errors, setErrors] = useState({})
  const [selectedSubjects, setSelectedSubjects] = useState([])
  const [testScheduleRows, setTestScheduleRows] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [listError, setListError] = useState(null)
  const [expandedGroupId, setExpandedGroupId] = useState(null)
  const [dateSheetGroupId, setDateSheetGroupId] = useState(null)
  const [yearFilter, setYearFilter] = useState('')
  const [activeTab, setActiveTab] = useState('exams') // 'exams' | 'tests'
  const [examStatusFilter, setExamStatusFilter] = useState('active') // 'active' | 'inactive' | 'all'
  const selectedFormAcademicYearId = form.academic_year || activeAcademicYear?.id
  const { sessionClasses } = useSessionClasses(selectedFormAcademicYearId)
  const classSelectorScope = getClassSelectorScope(selectedFormAcademicYearId)
  const resolvedFormClassObj = getResolvedMasterClassId(form.class_obj, selectedFormAcademicYearId, sessionClasses)
  const sessionClassIdByMaster = useMemo(() => {
    const map = {}
    sessionClasses.forEach((sc) => {
      if (sc.class_obj) map[String(sc.class_obj)] = String(sc.id)
    })
    return map
  }, [sessionClasses])

  // Session classes for resolving exam-row labels (getExamClassLabel below). When a
  // single year is selected in the list filter (the common case), reuse that
  // year-scoped fetch instead of pulling every session class in the school — the
  // SessionClass API can only filter by one academic_year at a time, so "All Years"
  // is the one case that still needs the unscoped, every-year query.
  const { sessionClasses: yearFilterSessionClasses } = useSessionClasses(yearFilter || undefined)
  const { data: allSessionClassesRes } = useQuery({
    queryKey: ['sessionClassesForExamList'],
    queryFn: () => sessionsApi.getSessionClasses({ page_size: 9999, is_active: true }),
    enabled: !yearFilter,
  })

  const allSessionClasses = yearFilter
    ? yearFilterSessionClasses
    : (allSessionClassesRes?.data?.results || allSessionClassesRes?.data || [])

  const sessionClassesByYearMaster = useMemo(() => {
    const map = {}
    allSessionClasses.forEach((sc) => {
      if (!sc?.academic_year || !sc?.class_obj) return
      const key = `${sc.academic_year}:${sc.class_obj}`
      if (!map[key]) map[key] = []
      map[key].push(sc)
    })
    return map
  }, [allSessionClasses])

  const sessionClassIdByYearMaster = useMemo(() => {
    const map = {}
    allSessionClasses.forEach((sc) => {
      if (!sc?.academic_year || !sc?.class_obj || !sc?.id) return
      const key = `${sc.academic_year}:${sc.class_obj}`
      if (!map[key]) map[key] = String(sc.id)
    })
    return map
  }, [allSessionClasses])

  const getExamClassLabel = (exam) => {
    if (!exam?.academic_year || !exam?.class_obj) return exam?.class_name || '—'
    const key = `${exam.academic_year}:${exam.class_obj}`
    const variants = sessionClassesByYearMaster[key] || []
    if (variants.length === 0) return exam.class_name || '—'
    if (variants.length === 1) {
      const only = variants[0]
      return only.label || only.display_name || exam.class_name || '—'
    }
    const sections = [...new Set(
      variants
        .map((row) => String(row.section || '').trim())
        .filter(Boolean),
    )]
    const baseName = variants[0]?.display_name || exam.class_name || 'Class'
    return sections.length > 0 ? `${baseName} (Sections: ${sections.join(', ')})` : `${baseName} (${variants.length} session classes)`
  }

  // Sync year filter with global session switcher
  useEffect(() => {
    if (activeAcademicYear?.id) setYearFilter(String(activeAcademicYear.id))
  }, [activeAcademicYear?.id])

  // Auto-dismiss list error after 5s
  useEffect(() => {
    if (!listError) return
    const t = setTimeout(() => setListError(null), 5000)
    return () => clearTimeout(t)
  }, [listError])

  // ── Queries ──

  // Exam Groups
  const examStatusParams = examStatusFilter === 'all' ? {} : { is_active: examStatusFilter === 'active' }

  const { data: groupsRes, isLoading: groupsLoading } = useQuery({
    queryKey: ['examGroups', yearFilter, examStatusFilter],
    queryFn: () => examinationsApi.getExamGroups({
      academic_year: yearFilter || undefined,
      page_size: 9999,
      ...examStatusParams,
    }),
  })
  const groups = groupsRes?.data?.results || groupsRes?.data || []

  // Standalone (ungrouped) exams
  const { data: standaloneRes, isLoading: standaloneLoading } = useQuery({
    queryKey: ['exams', 'ungrouped', yearFilter, examStatusFilter],
    queryFn: () => examinationsApi.getExams({
      academic_year: yearFilter || undefined,
      ungrouped: true,
      page_size: 9999,
      ...examStatusParams,
    }),
  })
  const standaloneExams = standaloneRes?.data?.results || standaloneRes?.data || []

  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const { data: termsRes } = useQuery({
    queryKey: ['terms', form.academic_year],
    queryFn: () => sessionsApi.getTerms({ academic_year: form.academic_year, page_size: 9999 }),
    enabled: !!form.academic_year,
  })

  const { data: examTypesRes } = useQuery({
    queryKey: ['examTypes'],
    queryFn: () => examinationsApi.getExamTypes({ page_size: 9999 }),
  })

  // ClassSubjects for Quick Create modal
  const { data: classSubjectsRes, isLoading: classSubjectsLoading } = useQuery({
    queryKey: ['classSubjectsForExam', resolvedFormClassObj],
    queryFn: () => academicsApi.getClassSubjects({ class_obj: resolvedFormClassObj, page_size: 9999 }),
    enabled: !!resolvedFormClassObj && showModal,
  })
  const classSubjects = classSubjectsRes?.data?.results || classSubjectsRes?.data || []

  const { data: allSubjectsRes } = useQuery({
    queryKey: ['allSubjectsForExam'],
    queryFn: () => academicsApi.getSubjects({ page_size: 9999 }),
    enabled: !!resolvedFormClassObj && showModal && !classSubjectsLoading && classSubjects.length === 0,
  })
  const allSubjects = allSubjectsRes?.data?.results || allSubjectsRes?.data || []

  const { data: testScheduleRes } = useQuery({
    queryKey: ['testScheduleRows', editId],
    queryFn: () => examinationsApi.getExamSubjects({ exam: editId, page_size: 9999 }),
    enabled: !!showModal && !!editId && activeTab === 'tests',
  })

  const years = yearsRes?.data?.results || yearsRes?.data || []
  const terms = termsRes?.data?.results || termsRes?.data || []
  const examTypes = examTypesRes?.data?.results || examTypesRes?.data || []

  useEffect(() => {
    if (!showModal || !editId || activeTab !== 'tests') {
      setTestScheduleRows([])
      return
    }
    const rows = testScheduleRes?.data?.results || testScheduleRes?.data || []
    setTestScheduleRows(
      rows.map((row) => ({
        id: row.id,
        subject_name: row.subject_name,
        subject_code: row.subject_code,
        exam_date: row.exam_date || '',
        start_time: row.start_time || '',
        end_time: row.end_time || '',
      })),
    )
  }, [testScheduleRes, showModal, editId, activeTab])

  // ── Mutations ──

  const updateMut = useMutation({
    mutationFn: ({ id, data }) => examinationsApi.updateExam(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['exams'] }); closeModal() },
    onError: (err) => setErrors(err.response?.data || { detail: 'Failed' }),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => examinationsApi.deleteExam(id),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['exams'] }); queryClient.invalidateQueries({ queryKey: ['examGroups'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to delete exam.'),
  })

  const publishMut = useMutation({
    mutationFn: (id) => examinationsApi.publishExam(id),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['exams'] }); queryClient.invalidateQueries({ queryKey: ['examGroups'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to publish exam.'),
  })

  const reactivateMut = useMutation({
    mutationFn: (id) => examinationsApi.updateExam(id, { is_active: true }),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['exams'] }); queryClient.invalidateQueries({ queryKey: ['examGroups'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to reactivate exam.'),
  })

  const deleteGroupMut = useMutation({
    mutationFn: (id) => examinationsApi.deleteExamGroup(id),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['examGroups'] }); queryClient.invalidateQueries({ queryKey: ['exams'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to delete exam group.'),
  })

  const publishAllMut = useMutation({
    mutationFn: (id) => examinationsApi.publishAllExams(id),
    onSuccess: () => { setListError(null); queryClient.invalidateQueries({ queryKey: ['examGroups'] }); queryClient.invalidateQueries({ queryKey: ['exams'] }) },
    onError: (err) => setListError(err.response?.data?.detail || 'Failed to publish exams.'),
  })

  // ── Modal helpers (Quick Create / Edit) ──

  const openCreate = () => { setForm(getDefaultForm()); setEditId(null); setErrors({}); setSelectedSubjects([]); setTestScheduleRows([]); setShowModal(true) }
  const openEdit = (item) => {
    const mappedClassObj = classSelectorScope === 'session'
      ? (sessionClassIdByYearMaster[`${item.academic_year}:${item.class_obj}`] || sessionClassIdByMaster[String(item.class_obj)] || '')
      : item.class_obj

    setForm({
      academic_year: item.academic_year, term: item.term || '',
      exam_type: item.exam_type, class_obj: mappedClassObj,
      name: item.name, start_date: item.start_date || '',
      end_date: item.end_date || '', status: item.status,
    })
    setEditId(item.id); setErrors({}); setTestScheduleRows([]); setShowModal(true)
  }
  const closeModal = () => { setShowModal(false); setEditId(null); setForm(getDefaultForm()); setErrors({}); setSelectedSubjects([]); setTestScheduleRows([]) }

  // Find editing exam in either standalone list or inside group exams
  const editingExam = useMemo(() => {
    if (!editId) return null
    return (
      standaloneExams.find(e => e.id === editId) ||
      groups.flatMap(g => g.exams || []).find(e => e.id === editId) ||
      null
    )
  }, [editId, standaloneExams, groups])

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!resolvedFormClassObj) {
      setErrors({ class_obj: 'Please select a valid class.' })
      return
    }

    if (editId) {
      const isTestEdit = activeTab === 'tests'
      const needsBulkAssign = classSubjects.length === 0 && selectedSubjects.length > 0
      const needsPopulate = editingExam?.subjects_count === 0 && classSubjects.length > 0

      setIsSubmitting(true)
      setErrors({})
      try {
        if (!isTestEdit && needsBulkAssign) {
          await academicsApi.bulkAssignSubjects({ class_obj: parseInt(resolvedFormClassObj), subjects: selectedSubjects })
        }
        if (!isTestEdit && (needsBulkAssign || needsPopulate)) {
          await examinationsApi.populateExamSubjects(editId)
        }
        let payload = { ...form, class_obj: resolvedFormClassObj, term: form.term || null }
        if (isTestEdit) {
          const datedRows = testScheduleRows.filter(r => !!r.exam_date)
          if (datedRows.length > 0) {
            const orderedDates = datedRows.map(r => r.exam_date).sort()
            payload = {
              ...payload,
              start_date: orderedDates[0],
              end_date: orderedDates[orderedDates.length - 1],
            }
          }
        }
        await examinationsApi.updateExam(editId, payload)
        if (isTestEdit) {
          for (const row of testScheduleRows) {
            await examinationsApi.updateExamSubject(row.id, {
              exam_date: row.exam_date || null,
              start_time: row.start_time || null,
              end_time: row.end_time || null,
            })
          }
        }
        queryClient.invalidateQueries({ queryKey: ['exams'] })
        queryClient.invalidateQueries({ queryKey: ['testScheduleRows', editId] })
        closeModal()
      } catch (err) {
        const errData = err.response?.data || {}
        if (typeof errData === 'string') setErrors({ detail: errData })
        else if (errData.detail) setErrors({ detail: errData.detail })
        else setErrors(errData)
      } finally { setIsSubmitting(false) }
      return
    }

    // Create mode
    const needsBulkAssign = classSubjects.length === 0 && selectedSubjects.length > 0
    if (classSubjects.length === 0 && selectedSubjects.length === 0 && !classSubjectsLoading) {
      setErrors({ subjects: 'Please select at least one subject for this class.' })
      return
    }

    setIsSubmitting(true)
    setErrors({})
    try {
      if (needsBulkAssign) {
        await academicsApi.bulkAssignSubjects({ class_obj: parseInt(resolvedFormClassObj), subjects: selectedSubjects })
      }
      const payload = { ...form, class_obj: resolvedFormClassObj, term: form.term || null }
      await examinationsApi.createExam(payload)
      queryClient.invalidateQueries({ queryKey: ['exams'] })
      closeModal()
    } catch (err) {
      const errData = err.response?.data || {}
      if (typeof errData === 'string') setErrors({ detail: errData })
      else if (errData.detail) setErrors({ detail: errData.detail })
      else setErrors(errData)
    } finally { setIsSubmitting(false) }
  }

  // ── Prefetch helpers ──
  // Warm caches on hover/focus (before the click that actually needs the data),
  // so the Wizard and Date Sheet modal open with data already in hand instead of
  // showing their own loading state. Query keys/params must match the queries
  // that eventually consume them (ExamWizard's allClassSubjectsForWizard/classes,
  // DateSheetModal's dateSheet) or React Query treats it as a separate fetch.

  const prefetchWizardData = () => {
    queryClient.prefetchQuery({
      queryKey: ['allClassSubjectsForWizard'],
      queryFn: () => academicsApi.getClassSubjects({ page_size: 9999 }),
    })
    if (activeSchool?.id) {
      queryClient.prefetchQuery({
        queryKey: ['classes', activeSchool.id],
        queryFn: () => classesApi.getClasses({ school_id: activeSchool.id, page_size: 9999 }),
      })
    }
  }

  const prefetchDateSheet = (groupId) => {
    queryClient.prefetchQuery({
      queryKey: ['dateSheet', groupId],
      queryFn: () => examinationsApi.getDateSheet(groupId),
    })
  }

  // ── Render helpers ──

  const isLoading = groupsLoading && standaloneLoading

  const toggleGroup = (id) => setExpandedGroupId(prev => prev === id ? null : id)

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Exams & Tests</h1>
          <p className="text-sm text-gray-600">Create and manage exams and tests</p>
        </div>
        {activeTab === 'exams' ? (
          <button
            onClick={() => setShowWizard(true)}
            onMouseEnter={prefetchWizardData}
            onFocus={prefetchWizardData}
            className="btn-primary text-sm px-4 py-2"
          >
            + Create Exam
          </button>
        ) : (
          <button onClick={() => setShowBulkTestModal(true)} className="btn-primary text-sm px-4 py-2">
            + Create Test
          </button>
        )}
      </div>

      {/* Year Filter + Status Filter + Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} className="input w-full sm:w-44">
          <option value="">All Years</option>
          {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>

        <select value={examStatusFilter} onChange={e => setExamStatusFilter(e.target.value)} className="input w-full sm:w-44">
          <option value="active">Active Exams</option>
          <option value="inactive">Inactive Exams</option>
          <option value="all">All Exams</option>
        </select>

        <div className="flex border-b border-gray-200 sm:ml-4">
          <button
            onClick={() => setActiveTab('exams')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'exams' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Exams{groups.length > 0 ? ` (${groups.length})` : ''}
          </button>
          <button
            onClick={() => setActiveTab('tests')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'tests' ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            Tests{standaloneExams.length > 0 ? ` (${standaloneExams.length})` : ''}
          </button>
        </div>
      </div>

      {/* List-level error banner */}
      {listError && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
          <span className="text-sm text-red-700">{listError}</span>
          <button onClick={() => setListError(null)} className="text-red-400 hover:text-red-600 ml-3">&times;</button>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : (
        <>
          {/* ── Exams Tab ── */}
          {activeTab === 'exams' && (
            groups.length > 0 ? (
            <div>
              <div className="space-y-3">
                {groups.map(group => {
                  const isExpanded = expandedGroupId === group.id
                  const exams = group.exams || []
                  return (
                    <div key={group.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                      {/* Group Header */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50"
                        onClick={() => toggleGroup(group.id)}
                      >
                        <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-900 text-sm">{group.name}</span>
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                              {group.exam_type_name}
                            </span>
                            {group.exam_type_weight != null && (
                              <span className="text-xs text-gray-400">{group.exam_type_weight}%</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {group.academic_year_name}
                            {group.term_name && ` · ${group.term_name}`}
                            {' · '}{group.classes_count || exams.length} class{(group.classes_count || exams.length) !== 1 ? 'es' : ''}
                            {group.start_date && ` · ${group.start_date}`}
                            {group.end_date && ` — ${group.end_date}`}
                          </p>
                        </div>
                        {/* Group actions */}
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => setDateSheetGroupId(group.id)}
                            onMouseEnter={() => prefetchDateSheet(group.id)}
                            onFocus={() => prefetchDateSheet(group.id)}
                            className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded"
                            title="Date Sheet"
                          >
                            Date Sheet
                          </button>
                          <button
                            onClick={async () => { const ok = await confirm({ title: 'Publish All Exams', message: 'Publish all exams in this group? Results will become visible.', variant: 'warning', confirmLabel: 'Publish All' }); if (ok) publishAllMut.mutate(group.id) }}
                            className="text-xs px-2 py-1 text-green-600 hover:bg-green-50 rounded"
                            disabled={publishAllMut.isPending}
                          >
                            Publish All
                          </button>
                          <button
                            onClick={async () => { const ok = await confirm({ title: 'Delete Exam Group', message: `Delete "${group.name}" and all its class exams?` }); if (ok) deleteGroupMut.mutate(group.id) }}
                            className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded"
                            disabled={deleteGroupMut.isPending}
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {/* Expanded: Per-class exams table */}
                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          {exams.length === 0 ? (
                            <p className="px-4 py-3 text-sm text-gray-500">No exams in this group.</p>
                          ) : (
                            <>
                              {/* Desktop */}
                              <div className="hidden md:block">
                                <table className="min-w-full text-sm">
                                  <thead>
                                    <tr className="bg-gray-50/50 text-xs text-gray-500 uppercase">
                                      <th className="px-4 py-2 text-left">Class</th>
                                      <th className="px-4 py-2 text-center">Subjects</th>
                                      <th className="px-4 py-2 text-center">Status</th>
                                      <th className="px-4 py-2 text-right">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {exams.map(exam => (
                                      <tr key={exam.id} className={exam.is_active ? 'hover:bg-gray-50/50' : 'bg-gray-50 text-gray-400 opacity-75'}>
                                        <td className="px-4 py-2 text-gray-900 font-medium">{getExamClassLabel(exam)}</td>
                                        <td className="px-4 py-2 text-center">
                                          {exam.subjects_count === 0 ? (
                                            <span className="text-amber-600 text-xs">0</span>
                                          ) : exam.subjects_count}
                                        </td>
                                        <td className="px-4 py-2 text-center">
                                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${exam.is_active ? (STATUS_STYLES[exam.status] || 'bg-gray-100') : 'bg-gray-100 text-gray-500'}`}>
                                            {exam.is_active ? exam.status.replace('_', ' ') : 'Inactive'}
                                          </span>
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                          <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                                          {exam.is_active ? (
                                            exam.status !== 'PUBLISHED' && (
                                              <button
                                                onClick={async () => { const ok = await confirm({ title: 'Publish Exam', message: 'Publish this exam? Results will become visible.', variant: 'warning', confirmLabel: 'Publish' }); if (ok) publishMut.mutate(exam.id) }}
                                                className="text-xs text-green-600 hover:underline mr-2"
                                              >Publish</button>
                                            )
                                          ) : (
                                            <button
                                              onClick={async () => { const ok = await confirm({ title: 'Reactivate Exam', message: `Reactivate "${exam.name}"?`, variant: 'primary', confirmLabel: 'Reactivate' }); if (ok) reactivateMut.mutate(exam.id) }}
                                              className="text-xs text-blue-600 hover:underline mr-2"
                                            >Reactivate</button>
                                          )}
                                          <button
                                            onClick={async () => { const ok = await confirm({ title: 'Delete Exam', message: `Delete "${exam.name}"?` }); if (ok) deleteMut.mutate(exam.id) }}
                                            className="text-xs text-red-600 hover:underline"
                                          >Delete</button>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                              {/* Mobile */}
                              <div className="md:hidden divide-y divide-gray-100">
                                {exams.map(exam => (
                                  <div key={exam.id} className={`px-4 py-2 flex items-center justify-between ${exam.is_active ? '' : 'opacity-75'}`}>
                                    <div>
                                      <p className="text-sm font-medium text-gray-900">{getExamClassLabel(exam)}</p>
                                      <p className="text-xs text-gray-500">
                                        {exam.subjects_count} subjects ·{' '}
                                        <span className={`${exam.is_active ? (STATUS_STYLES[exam.status]?.includes('text-') ? STATUS_STYLES[exam.status].split(' ').find(c => c.startsWith('text-')) : 'text-gray-600') : 'text-gray-500'}`}>
                                          {exam.is_active ? exam.status.replace('_', ' ') : 'Inactive'}
                                        </span>
                                      </p>
                                    </div>
                                    <div className="flex gap-2">
                                      <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline">Edit</button>
                                      {exam.is_active ? null : (
                                        <button onClick={async () => { const ok = await confirm({ title: 'Reactivate Exam', message: `Reactivate "${exam.name}"?`, variant: 'primary', confirmLabel: 'Reactivate' }); if (ok) reactivateMut.mutate(exam.id) }} className="text-xs text-blue-600 hover:underline">Reactivate</button>
                                      )}
                                      <button onClick={async () => { const ok = await confirm({ title: 'Delete Exam', message: `Delete "${exam.name}"?` }); if (ok) deleteMut.mutate(exam.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            ) : (
            <div className="card p-4 sm:p-6">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-blue-100 text-blue-700 ring-2 ring-blue-300">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500 text-white">1</span>
                  Set Up Exam Types
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">2</span>
                  Create Exam
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
                  Add Subjects &amp; Schedule
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-3">No exams yet. Click "+ Create Exam" to get started.</p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">Tip:</span> Use the Exam Wizard for guided setup with date sheets.
                </p>
              </div>
              <button
                onClick={() => setShowWizard(true)}
                onMouseEnter={prefetchWizardData}
                onFocus={prefetchWizardData}
                className="btn-primary text-sm px-4 py-2 mt-3"
              >
                + Create Exam
              </button>
            </div>
            )
          )}

          {/* ── Tests Tab ── */}
          {activeTab === 'tests' && (
            standaloneExams.length > 0 ? (
            <div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="min-w-full bg-white rounded-xl shadow-sm border border-gray-200">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <th className="px-4 py-3 text-left">Exam Name</th>
                      <th className="px-4 py-3 text-left">Type</th>
                      <th className="px-4 py-3 text-left">Class</th>
                      <th className="px-4 py-3 text-left">Year</th>
                      <th className="px-4 py-3 text-left">Dates</th>
                      <th className="px-4 py-3 text-center">Subjects</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {standaloneExams.map(exam => (
                      <tr key={exam.id} className={exam.is_active ? 'hover:bg-gray-50' : 'bg-gray-50 text-gray-400 opacity-75'}>
                        <td className="px-4 py-2 text-sm font-medium text-gray-900">{exam.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{exam.exam_type_name}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">{getExamClassLabel(exam)}</td>
                        <td className="px-4 py-2 text-sm text-gray-600">
                          {exam.academic_year_name}
                          {exam.term_name && <span className="text-xs text-gray-400 ml-1">({exam.term_name})</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-gray-500">
                          {exam.start_date ? `${exam.start_date} — ${exam.end_date || '?'}` : '—'}
                        </td>
                        <td className="px-4 py-2 text-sm text-center">
                          {exam.subjects_count === 0 ? (
                            <span className="inline-flex items-center gap-1 text-amber-600" title="No subjects — marks entry will not work">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              0
                            </span>
                          ) : exam.subjects_count}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${exam.is_active ? (STATUS_STYLES[exam.status] || 'bg-gray-100') : 'bg-gray-100 text-gray-500'}`}>
                            {exam.is_active ? exam.status.replace('_', ' ') : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline mr-2">Edit</button>
                          {exam.is_active ? (
                            exam.status !== 'PUBLISHED' && (
                              <button
                                onClick={async () => { const ok = await confirm({ title: 'Publish Exam', message: 'Publish this exam? Results will become visible.', variant: 'warning', confirmLabel: 'Publish' }); if (ok) publishMut.mutate(exam.id) }}
                                className="text-xs text-green-600 hover:underline mr-2"
                              >Publish</button>
                            )
                          ) : (
                            <button
                              onClick={async () => { const ok = await confirm({ title: 'Reactivate Exam', message: `Reactivate "${exam.name}"?`, variant: 'primary', confirmLabel: 'Reactivate' }); if (ok) reactivateMut.mutate(exam.id) }}
                              className="text-xs text-blue-600 hover:underline mr-2"
                            >Reactivate</button>
                          )}
                          <button
                            onClick={async () => { const ok = await confirm({ title: 'Delete Exam', message: `Delete "${exam.name}"?` }); if (ok) deleteMut.mutate(exam.id) }}
                            className="text-xs text-red-600 hover:underline"
                          >Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {standaloneExams.map(exam => (
                  <div key={exam.id} className={`card ${exam.is_active ? '' : 'opacity-75'}`}>
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{exam.name}</p>
                        <p className="text-xs text-gray-500">{exam.exam_type_name} · {getExamClassLabel(exam)}</p>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${exam.is_active ? (STATUS_STYLES[exam.status] || 'bg-gray-100 text-gray-700') : 'bg-gray-100 text-gray-500'}`}>
                        {exam.is_active ? exam.status.replace('_', ' ') : 'Inactive'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mb-2">
                      {exam.academic_year_name}{exam.term_name ? ` · ${exam.term_name}` : ''} · {exam.subjects_count === 0 ? (
                        <span className="text-amber-600 font-medium">0 subjects (needs setup)</span>
                      ) : (
                        <>{exam.subjects_count} subjects</>
                      )}
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(exam)} className="text-xs text-primary-600 hover:underline">Edit</button>
                      {exam.is_active ? (exam.status !== 'PUBLISHED' && (
                        <button onClick={async () => { const ok = await confirm({ title: 'Publish Exam', message: 'Publish this exam? Results will become visible.', variant: 'warning', confirmLabel: 'Publish' }); if (ok) publishMut.mutate(exam.id) }} className="text-xs text-green-600 hover:underline">Publish</button>
                      )) : (
                        <button onClick={async () => { const ok = await confirm({ title: 'Reactivate Exam', message: `Reactivate "${exam.name}"?`, variant: 'primary', confirmLabel: 'Reactivate' }); if (ok) reactivateMut.mutate(exam.id) }} className="text-xs text-blue-600 hover:underline">Reactivate</button>
                      )}
                      <button onClick={async () => { const ok = await confirm({ title: 'Delete Exam', message: `Delete "${exam.name}"?` }); if (ok) deleteMut.mutate(exam.id) }} className="text-xs text-red-600 hover:underline">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            ) : (
            <div className="card p-4 sm:p-6">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-blue-100 text-blue-700 ring-2 ring-blue-300">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500 text-white">1</span>
                  Create Test
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">2</span>
                  Assign Class &amp; Subject
                </div>
                <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
                  Enter Marks
                </div>
              </div>
              <p className="text-sm text-gray-500 mt-3">No tests yet. Tests are quick assessments — no wizard needed.</p>
              <button onClick={() => setShowBulkTestModal(true)} className="btn-primary text-sm px-4 py-2 mt-3">
                + Create Test
              </button>
            </div>
            )
          )}
        </>
      )}

      {/* ── Wizard Modal ── */}
      {showWizard && (
        <ExamWizard
          onClose={() => setShowWizard(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['examGroups'] })
            queryClient.invalidateQueries({ queryKey: ['exams'] })
            setShowWizard(false)
          }}
        />
      )}

      {showBulkTestModal && (
        <BulkTestModal
          onClose={() => setShowBulkTestModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['exams'] })
            setShowBulkTestModal(false)
          }}
        />
      )}

      {/* ── Date Sheet Modal ── */}
      {dateSheetGroupId && (
        <DateSheetModal
          groupId={dateSheetGroupId}
          onClose={() => setDateSheetGroupId(null)}
          queryClient={queryClient}
          setListError={setListError}
        />
      )}

      <ConfirmModalRoot />

      {/* ── Quick Create / Edit Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeModal}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editId ? (activeTab === 'exams' ? 'Edit Exam' : 'Edit Test') : 'Create Test'}</h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {(errors.detail || errors.non_field_errors) && (
              <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                {errors.detail || errors.non_field_errors}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Exam Name *</label>
                <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="input w-full" required placeholder="e.g. Unit Test 1 - Class 5-A" />
                {errors.name && <p className="text-xs text-red-600 mt-1">{errors.name}</p>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year *</label>
                  <select value={form.academic_year} onChange={e => setForm(p => ({ ...p, academic_year: e.target.value, term: '' }))} className="input w-full" required>
                    <option value="">Select...</option>
                    {years.map(y => <option key={y.id} value={y.id}>{y.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Term</label>
                  <select value={form.term} onChange={e => setForm(p => ({ ...p, term: e.target.value }))} className="input w-full">
                    <option value="">None</option>
                    {terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Exam Type *</label>
                  <select value={form.exam_type} onChange={e => setForm(p => ({ ...p, exam_type: e.target.value }))} className="input w-full" required>
                    <option value="">Select...</option>
                    {examTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Class *</label>
                  <ClassSelector
                    value={form.class_obj}
                    onChange={e => { setForm(p => ({ ...p, class_obj: e.target.value })); setSelectedSubjects([]) }}
                    className="input w-full"
                    scope={classSelectorScope}
                    academicYearId={selectedFormAcademicYearId}
                    required
                    placeholder="Select..."
                  />
                </div>
              </div>

              {/* Subject Status / Picker */}
              {form.class_obj && (
                <div>
                  {classSubjectsLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-600"></div>
                      Checking class subjects...
                    </div>
                  ) : classSubjects.length > 0 ? (
                    <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-sm text-green-700">
                        {classSubjects.length} subject{classSubjects.length !== 1 ? 's' : ''} assigned
                        <span className="text-green-600 text-xs ml-1">
                          ({classSubjects.map(cs => cs.subject_name).join(', ')})
                        </span>
                      </span>
                      {editId && editingExam?.subjects_count === 0 && (
                        <button type="button" onClick={async () => {
                          try {
                            await examinationsApi.populateExamSubjects(editId)
                            queryClient.invalidateQueries({ queryKey: ['exams'] })
                            closeModal()
                          } catch {
                            setErrors({ detail: 'Failed to add subjects to exam.' })
                          }
                        }} className="ml-auto text-xs font-medium text-green-700 bg-green-200 hover:bg-green-300 px-2 py-1 rounded">
                          Add to this exam
                        </button>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg mb-3">
                        <svg className="w-4 h-4 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm text-amber-700">
                          No subjects assigned to this class. Select subjects below to auto-assign them.
                        </span>
                      </div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Select Subjects *</label>
                      <div className="border border-gray-300 rounded-lg max-h-48 overflow-y-auto p-2 space-y-1">
                        {allSubjects.length === 0 ? (
                          <p className="text-sm text-gray-400 p-1">No subjects available. Create subjects first in Academics &gt; Subjects.</p>
                        ) : (
                          <>
                            {allSubjects.map(s => (
                              <label key={s.id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer ${selectedSubjects.includes(s.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}>
                                <input
                                  type="checkbox"
                                  checked={selectedSubjects.includes(s.id)}
                                  onChange={e => setSelectedSubjects(prev => e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id))}
                                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">{s.code} - {s.name}</span>
                              </label>
                            ))}
                            <div className="flex gap-2 pt-1 border-t mt-1">
                              <button type="button" onClick={() => setSelectedSubjects(allSubjects.map(s => s.id))} className="text-xs text-blue-600 hover:underline">Select All</button>
                              <button type="button" onClick={() => setSelectedSubjects([])} className="text-xs text-gray-500 hover:underline">Clear</button>
                            </div>
                          </>
                        )}
                      </div>
                      {selectedSubjects.length > 0 && (
                        <p className="text-xs text-gray-500 mt-1">{selectedSubjects.length} subject{selectedSubjects.length > 1 ? 's' : ''} selected</p>
                      )}
                      {errors.subjects && <p className="text-xs text-red-600 mt-1">{errors.subjects}</p>}
                    </div>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                {activeTab === 'tests' && editId ? (
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Test Schedule (Per Subject)</label>
                    {testScheduleRows.length === 0 ? (
                      <p className="text-xs text-gray-500">No subject rows found for this test.</p>
                    ) : (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                              <th className="px-3 py-2 text-left">Subject</th>
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-left">Start</th>
                              <th className="px-3 py-2 text-left">End</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {testScheduleRows.map((row) => (
                              <tr key={row.id}>
                                <td className="px-3 py-2">
                                  <span className="font-medium text-gray-900">{row.subject_name}</span>
                                  {row.subject_code && <span className="text-xs text-gray-400 ml-1">({row.subject_code})</span>}
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="date"
                                    value={row.exam_date}
                                    onChange={(e) => setTestScheduleRows(prev => prev.map(item => item.id === row.id ? { ...item, exam_date: e.target.value } : item))}
                                    className="input w-full"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="time"
                                    value={row.start_time}
                                    onChange={(e) => setTestScheduleRows(prev => prev.map(item => item.id === row.id ? { ...item, start_time: e.target.value } : item))}
                                    className="input w-full"
                                  />
                                </td>
                                <td className="px-3 py-2">
                                  <input
                                    type="time"
                                    value={row.end_time}
                                    onChange={(e) => setTestScheduleRows(prev => prev.map(item => item.id === row.id ? { ...item, end_time: e.target.value } : item))}
                                    className="input w-full"
                                  />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                      <input type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value }))} className="input w-full" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                      <input type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} className="input w-full" />
                    </div>
                  </>
                )}
              </div>
              {editId && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className="input w-full">
                    <option value="SCHEDULED">Scheduled</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="MARKS_ENTRY">Marks Entry</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="PUBLISHED">Published</option>
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={closeModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button type="submit" disabled={isSubmitting || updateMut.isPending} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                  {isSubmitting ? 'Setting up...' : editId ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
