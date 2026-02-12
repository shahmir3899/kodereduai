import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { academicsApi, classesApi, hrApi } from '../../services/api'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const DAY_LABELS = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat' }
const DAY_LABELS_FULL = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday' }

const SLOT_TYPES = [
  { value: 'PERIOD', label: 'Period' },
  { value: 'BREAK', label: 'Break' },
  { value: 'LUNCH', label: 'Lunch' },
  { value: 'ASSEMBLY', label: 'Assembly' },
]

const EMPTY_SLOT = { name: '', slot_type: 'PERIOD', start_time: '', end_time: '', order: '' }

export default function TimetablePage() {
  const queryClient = useQueryClient()
  const [selectedClassId, setSelectedClassId] = useState('')
  const [showSlotsModal, setShowSlotsModal] = useState(false)
  const [editingCell, setEditingCell] = useState(null)
  const [cellForm, setCellForm] = useState({ subject: '', teacher: '', room: '' })
  const [localGrid, setLocalGrid] = useState({})
  const [hasChanges, setHasChanges] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [expandedDay, setExpandedDay] = useState('MON')

  // Slot management state
  const [slotForm, setSlotForm] = useState(EMPTY_SLOT)
  const [editSlotId, setEditSlotId] = useState(null)
  const [slotErrors, setSlotErrors] = useState({})

  // AI feature state
  const [autoGenerating, setAutoGenerating] = useState(false)
  const [showAutoGenConfirm, setShowAutoGenConfirm] = useState(false)
  const [showScoreModal, setShowScoreModal] = useState(false)
  const [conflictInfo, setConflictInfo] = useState(null)
  const [resolutionData, setResolutionData] = useState(null)
  const [loadingResolution, setLoadingResolution] = useState(false)
  const [showSubstituteModal, setShowSubstituteModal] = useState(false)
  const [subTeacher, setSubTeacher] = useState('')
  const [subDate, setSubDate] = useState(new Date().toISOString().slice(0, 10))
  const [substituteData, setSubstituteData] = useState(null)
  const [loadingSubstitute, setLoadingSubstitute] = useState(false)

  // Queries
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses(),
  })

  const { data: slotsData, isLoading: slotsLoading } = useQuery({
    queryKey: ['timetableSlots'],
    queryFn: () => academicsApi.getTimetableSlots(),
  })

  const { data: timetableData, isLoading: ttLoading } = useQuery({
    queryKey: ['timetable', selectedClassId],
    queryFn: () => academicsApi.getTimetableByClass(selectedClassId),
    enabled: !!selectedClassId,
  })

  const { data: classSubjectsData } = useQuery({
    queryKey: ['classSubjectsByClass', selectedClassId],
    queryFn: () => academicsApi.getClassSubjectsByClass(selectedClassId),
    enabled: !!selectedClassId,
  })

  const { data: staffData } = useQuery({
    queryKey: ['hrStaffActive'],
    queryFn: () => hrApi.getStaff({ employment_status: 'ACTIVE', page_size: 500 }),
  })

  // Quality score query
  const { data: qualityData } = useQuery({
    queryKey: ['qualityScore', selectedClassId],
    queryFn: () => academicsApi.getTimetableQualityScore(selectedClassId),
    enabled: !!selectedClassId && !!timetableData?.data?.entries?.length && !hasChanges,
  })

  const classes = classesData?.data?.results || classesData?.data || []
  const slots = slotsData?.data?.results || slotsData?.data || []
  const classSubjects = classSubjectsData?.data || []
  const staffList = staffData?.data?.results || staffData?.data || []
  const qualityScore = qualityData?.data

  // Build subject map for quick lookup of default teacher
  const subjectTeacherMap = useMemo(() => {
    const map = {}
    classSubjects.forEach(cs => {
      map[cs.subject] = { teacher: cs.teacher, teacher_name: cs.teacher_name }
    })
    return map
  }, [classSubjects])

  // Initialize local grid from API data
  useEffect(() => {
    if (timetableData?.data) {
      const grid = {}
      const entries = timetableData.data.entries || []
      entries.forEach(entry => {
        const key = `${entry.day}-${entry.slot}`
        grid[key] = {
          subject: entry.subject,
          teacher: entry.teacher,
          room: entry.room || '',
          subject_name: entry.subject_name,
          subject_code: entry.subject_code,
          teacher_name: entry.teacher_name,
        }
      })
      setLocalGrid(grid)
      setHasChanges(false)
    }
  }, [timetableData])

  // Reset grid when class changes
  useEffect(() => {
    setLocalGrid({})
    setHasChanges(false)
    setSaveMsg('')
    setEditingCell(null)
  }, [selectedClassId])

  // Cell editing
  const openCellEditor = (day, slot) => {
    const key = `${day}-${slot.id}`
    const cell = localGrid[key]
    setCellForm({
      subject: cell?.subject || '',
      teacher: cell?.teacher || '',
      room: cell?.room || '',
    })
    setConflictInfo(null)
    setResolutionData(null)
    setEditingCell({ day, slotId: slot.id, slotName: slot.name })
  }

  const saveCellEdit = () => {
    if (!editingCell) return
    const key = `${editingCell.day}-${editingCell.slotId}`
    const subjectId = cellForm.subject || null
    const subjectInfo = classSubjects.find(cs => cs.subject == subjectId)

    setLocalGrid(prev => ({
      ...prev,
      [key]: {
        subject: subjectId ? parseInt(subjectId) : null,
        teacher: cellForm.teacher ? parseInt(cellForm.teacher) : null,
        room: cellForm.room,
        subject_name: subjectInfo?.subject_name || null,
        subject_code: subjectInfo?.subject_code || null,
        teacher_name: cellForm.teacher
          ? staffList.find(s => s.id == cellForm.teacher)?.full_name || null
          : null,
      },
    }))
    setHasChanges(true)
    setEditingCell(null)
  }

  const clearCell = () => {
    if (!editingCell) return
    const key = `${editingCell.day}-${editingCell.slotId}`
    setLocalGrid(prev => {
      const updated = { ...prev }
      delete updated[key]
      return updated
    })
    setHasChanges(true)
    setEditingCell(null)
  }

  // Auto-fill teacher when subject changes
  const handleSubjectChange = (subjectId) => {
    const defaultTeacher = subjectTeacherMap[subjectId]
    setCellForm(prev => ({
      ...prev,
      subject: subjectId,
      teacher: defaultTeacher?.teacher || prev.teacher,
    }))
    setConflictInfo(null)
    setResolutionData(null)
  }

  // Check teacher conflict when teacher changes in cell editor
  const handleTeacherChange = async (teacherId) => {
    setCellForm(p => ({ ...p, teacher: teacherId }))
    setConflictInfo(null)
    setResolutionData(null)

    if (teacherId && editingCell) {
      try {
        const res = await academicsApi.checkTeacherConflicts({
          teacher: teacherId,
          day: editingCell.day,
          slot: editingCell.slotId,
          exclude_class: selectedClassId,
        })
        if (res.data.has_conflict) {
          setConflictInfo(res.data)
        }
      } catch { /* ignore */ }
    }
  }

  // Fetch conflict resolution suggestions
  const handleSuggestResolution = async () => {
    if (!editingCell || !cellForm.teacher) return
    setLoadingResolution(true)
    try {
      const res = await academicsApi.suggestConflictResolution({
        teacher: cellForm.teacher,
        day: editingCell.day,
        slot: editingCell.slotId,
        class_id: selectedClassId,
        subject: cellForm.subject || undefined,
      })
      setResolutionData(res.data)
    } catch { setResolutionData(null) }
    setLoadingResolution(false)
  }

  // Auto-generate timetable
  const handleAutoGenerate = async () => {
    setAutoGenerating(true)
    setShowAutoGenConfirm(false)
    setSaveMsg('')
    try {
      const res = await academicsApi.autoGenerateTimetable({ class_id: parseInt(selectedClassId) })
      const { grid: aiGrid, score, warnings } = res.data

      // Transform AI grid into localGrid format
      const newGrid = {}
      for (const day of DAYS) {
        const dayEntries = aiGrid[day] || []
        dayEntries.forEach(entry => {
          const key = `${day}-${entry.slot_id}`
          newGrid[key] = {
            subject: entry.subject_id,
            teacher: entry.teacher_id,
            room: entry.room || '',
            subject_name: entry.subject_name,
            subject_code: classSubjects.find(cs => cs.subject === entry.subject_id)?.subject_code || null,
            teacher_name: entry.teacher_name,
          }
        })
      }

      setLocalGrid(newGrid)
      setHasChanges(true)

      let msg = `AI generated timetable (score: ${score?.toFixed(0) || '?'}/100).`
      if (warnings?.length) msg += ' Warnings: ' + warnings.join('; ')
      msg += ' Review and click "Save Timetable" to apply.'
      setSaveMsg(msg)
    } catch (err) {
      const detail = err.response?.data?.detail || 'Auto-generation failed'
      setSaveMsg(detail)
    }
    setAutoGenerating(false)
  }

  // Substitute teacher search
  const handleFindSubstitute = async () => {
    if (!subTeacher || !subDate) return
    setLoadingSubstitute(true)
    try {
      const res = await academicsApi.suggestSubstitute({ teacher: subTeacher, date: subDate })
      setSubstituteData(res.data)
    } catch { setSubstituteData({ error: 'Failed to find substitutes.' }) }
    setLoadingSubstitute(false)
  }

  // Bulk save
  const handleSaveAll = async () => {
    setSaving(true)
    setSaveMsg('')
    const errors = []
    let savedDays = 0

    for (const day of DAYS) {
      const periodSlots = slots.filter(s => s.slot_type === 'PERIOD')
      const entries = periodSlots.map(s => ({
        slot: s.id,
        subject: localGrid[`${day}-${s.id}`]?.subject || null,
        teacher: localGrid[`${day}-${s.id}`]?.teacher || null,
        room: localGrid[`${day}-${s.id}`]?.room || '',
      }))

      const hasEntries = entries.some(e => e.subject || e.teacher)
      if (!hasEntries && !timetableData?.data?.grid?.[day]?.length) continue

      try {
        await academicsApi.bulkSaveTimetable({
          class_obj: parseInt(selectedClassId),
          day,
          entries,
        })
        savedDays++
      } catch (err) {
        const detail = err.response?.data?.detail
        if (Array.isArray(detail)) {
          errors.push(`${DAY_LABELS_FULL[day]}: ${detail.join(', ')}`)
        } else {
          errors.push(`${DAY_LABELS_FULL[day]}: ${detail || 'Failed to save'}`)
        }
      }
    }

    if (errors.length > 0) {
      setSaveMsg(errors.join('\n'))
    } else {
      setSaveMsg(`Timetable saved successfully (${savedDays} day${savedDays !== 1 ? 's' : ''}).`)
      setHasChanges(false)
      queryClient.invalidateQueries({ queryKey: ['timetable', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['qualityScore', selectedClassId] })
    }
    setSaving(false)
  }

  // Slot CRUD mutations
  const createSlotMut = useMutation({
    mutationFn: (data) => academicsApi.createTimetableSlot(data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['timetableSlots'] }); resetSlotForm() },
    onError: (err) => setSlotErrors(err.response?.data || { detail: 'Failed' }),
  })

  const updateSlotMut = useMutation({
    mutationFn: ({ id, data }) => academicsApi.updateTimetableSlot(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['timetableSlots'] }); resetSlotForm() },
    onError: (err) => setSlotErrors(err.response?.data || { detail: 'Failed' }),
  })

  const deleteSlotMut = useMutation({
    mutationFn: (id) => academicsApi.deleteTimetableSlot(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['timetableSlots'] }),
  })

  const resetSlotForm = () => { setSlotForm(EMPTY_SLOT); setEditSlotId(null); setSlotErrors({}) }

  const handleSlotSubmit = (e) => {
    e.preventDefault()
    const payload = { ...slotForm, order: parseInt(slotForm.order) }
    if (editSlotId) updateSlotMut.mutate({ id: editSlotId, data: payload })
    else createSlotMut.mutate(payload)
  }

  const isBreakSlot = (slot) => ['BREAK', 'LUNCH', 'ASSEMBLY'].includes(slot.slot_type)

  const isLoading = slotsLoading || (selectedClassId && ttLoading)

  const scoreColor = (s) => s >= 80 ? 'bg-green-100 text-green-700' : s >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Timetable</h1>
          <p className="text-sm text-gray-600">Build class timetables with AI assistance</p>
        </div>
      </div>

      {/* Controls */}
      <div className="card mb-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="flex-1 flex items-center gap-2">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Select Class</label>
            <select
              value={selectedClassId}
              onChange={e => setSelectedClassId(e.target.value)}
              className="input w-full sm:w-52"
            >
              <option value="">-- Select Class --</option>
              {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {/* Quality Score Badge */}
          {qualityScore && qualityScore.overall_score > 0 && (
            <button
              onClick={() => setShowScoreModal(true)}
              className={`mt-5 px-2.5 py-1 rounded-full text-xs font-semibold ${scoreColor(qualityScore.overall_score)}`}
              title="Timetable Quality Score"
            >
              {qualityScore.overall_score.toFixed(0)}/100
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowSlotsModal(true)}
            className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Time Slots ({slots.length})
          </button>
          {selectedClassId && classSubjects.length > 0 && (
            <button
              onClick={() => setShowAutoGenConfirm(true)}
              disabled={autoGenerating}
              className="px-3 py-2 text-sm bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 disabled:opacity-50"
            >
              {autoGenerating ? (
                <span className="flex items-center gap-1">
                  <span className="animate-spin h-3 w-3 border-2 border-indigo-500 border-t-transparent rounded-full"></span>
                  Generating...
                </span>
              ) : 'AI Generate'}
            </button>
          )}
          <button
            onClick={() => { setShowSubstituteModal(true); setSubstituteData(null) }}
            className="px-3 py-2 text-sm bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100"
          >
            Find Substitute
          </button>
          {selectedClassId && hasChanges && (
            <button
              onClick={handleSaveAll}
              disabled={saving}
              className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Timetable'}
            </button>
          )}
        </div>
      </div>

      {saveMsg && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${saveMsg.includes('Failed') || (saveMsg.includes(':') && !saveMsg.includes('successfully') && !saveMsg.includes('score')) ? 'bg-red-50 text-red-700' : saveMsg.includes('AI generated') ? 'bg-indigo-50 text-indigo-700' : 'bg-green-50 text-green-700'}`}>
          <pre className="whitespace-pre-wrap font-sans">{saveMsg}</pre>
        </div>
      )}

      {!selectedClassId ? (
        <div className="card text-center py-12 text-gray-500">
          Select a class to view or build its timetable.
        </div>
      ) : slots.length === 0 ? (
        <div className="card text-center py-12 text-gray-500">
          No time slots defined yet. Click "Time Slots" to set up your school's daily schedule.
        </div>
      ) : isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
        </div>
      ) : (
        <>
          {classSubjects.length === 0 && (
            <div className="mb-4 p-3 bg-yellow-50 text-yellow-700 rounded-lg text-sm">
              No subjects assigned to this class yet. Go to Subjects &rarr; Class Assignments to set them up.
            </div>
          )}

          {/* Desktop Grid */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="min-w-full border-collapse bg-white rounded-xl shadow-sm">
              <thead>
                <tr>
                  <th className="border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-36">
                    Time
                  </th>
                  {DAYS.map(day => (
                    <th key={day} className="border border-gray-200 bg-gray-50 px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">
                      {DAY_LABELS[day]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map(slot => (
                  <tr key={slot.id}>
                    <td className="border border-gray-200 px-3 py-2 bg-gray-50">
                      <div className="text-sm font-medium text-gray-700">{slot.name}</div>
                      <div className="text-xs text-gray-400">
                        {slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}
                      </div>
                    </td>
                    {DAYS.map(day => {
                      const key = `${day}-${slot.id}`
                      const cell = localGrid[key]
                      const isBreak = isBreakSlot(slot)
                      return (
                        <td
                          key={key}
                          className={`border border-gray-200 px-2 py-2 text-center transition-colors ${
                            isBreak
                              ? 'bg-gray-100 text-gray-400'
                              : 'cursor-pointer hover:bg-primary-50'
                          }`}
                          onClick={() => !isBreak && openCellEditor(day, slot)}
                        >
                          {isBreak ? (
                            <span className="text-xs italic">{slot.name}</span>
                          ) : cell?.subject_name ? (
                            <div>
                              <div className="text-xs font-semibold text-gray-800">{cell.subject_code || cell.subject_name}</div>
                              {cell.teacher_name && <div className="text-xs text-gray-500">{cell.teacher_name}</div>}
                              {cell.room && <div className="text-xs text-gray-400">{cell.room}</div>}
                            </div>
                          ) : (
                            <span className="text-gray-300 text-lg">+</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: Day Accordion */}
          <div className="lg:hidden space-y-3">
            {DAYS.map(day => (
              <div key={day} className="card">
                <button
                  onClick={() => setExpandedDay(expandedDay === day ? '' : day)}
                  className="w-full flex items-center justify-between"
                >
                  <span className="font-semibold text-gray-900 text-sm">{DAY_LABELS_FULL[day]}</span>
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedDay === day ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
                {expandedDay === day && (
                  <div className="mt-3 space-y-2">
                    {slots.map(slot => {
                      const key = `${day}-${slot.id}`
                      const cell = localGrid[key]
                      const isBreak = isBreakSlot(slot)
                      return (
                        <div
                          key={slot.id}
                          className={`flex items-center justify-between p-2 rounded-lg ${
                            isBreak ? 'bg-gray-100' : 'bg-gray-50 cursor-pointer hover:bg-primary-50'
                          }`}
                          onClick={() => !isBreak && openCellEditor(day, slot)}
                        >
                          <div>
                            <div className="text-xs font-medium text-gray-700">{slot.name}</div>
                            <div className="text-xs text-gray-400">{slot.start_time?.slice(0, 5)} - {slot.end_time?.slice(0, 5)}</div>
                          </div>
                          {isBreak ? (
                            <span className="text-xs text-gray-400 italic">{slot.slot_type_display}</span>
                          ) : cell?.subject_name ? (
                            <div className="text-right">
                              <div className="text-xs font-semibold text-gray-800">{cell.subject_code || cell.subject_name}</div>
                              {cell.teacher_name && <div className="text-xs text-gray-500">{cell.teacher_name}</div>}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-300">Tap to assign</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Cell Edit Modal with Conflict Resolution */}
      {editingCell && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditingCell(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">
                {DAY_LABELS_FULL[editingCell.day]} &mdash; {editingCell.slotName}
              </h3>
              <button onClick={() => setEditingCell(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Subject</label>
                <select
                  value={cellForm.subject}
                  onChange={e => handleSubjectChange(e.target.value)}
                  className="input w-full text-sm"
                >
                  <option value="">-- None --</option>
                  {classSubjects.map(cs => (
                    <option key={cs.subject} value={cs.subject}>
                      {cs.subject_code} - {cs.subject_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Teacher</label>
                <select
                  value={cellForm.teacher}
                  onChange={e => handleTeacherChange(e.target.value)}
                  className="input w-full text-sm"
                >
                  <option value="">-- None --</option>
                  {staffList.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </select>
              </div>

              {/* Conflict Warning */}
              {conflictInfo && (
                <div className="p-2.5 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="text-xs text-yellow-800 font-medium">
                    Conflict: Teacher already assigned to {conflictInfo.conflicts?.[0]?.class_name} at this slot.
                  </p>
                  <button
                    onClick={handleSuggestResolution}
                    disabled={loadingResolution}
                    className="mt-1.5 text-xs text-indigo-600 hover:underline font-medium"
                  >
                    {loadingResolution ? 'Loading...' : 'Suggest Alternatives'}
                  </button>

                  {/* Resolution Suggestions */}
                  {resolutionData && (
                    <div className="mt-2 space-y-2">
                      {resolutionData.alternative_teachers?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">Available Teachers:</p>
                          <div className="space-y-1">
                            {resolutionData.alternative_teachers.slice(0, 5).map(t => (
                              <button
                                key={t.teacher_id}
                                onClick={() => { setCellForm(p => ({ ...p, teacher: String(t.teacher_id) })); setConflictInfo(null); setResolutionData(null) }}
                                className="block w-full text-left text-xs px-2 py-1 bg-white rounded hover:bg-indigo-50 border border-gray-100"
                              >
                                <span className="font-medium">{t.teacher_name}</span>
                                {t.qualification_match > 0 && <span className="ml-1 text-green-600">({t.reason})</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {resolutionData.alternative_slots?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">Free Slots for This Teacher:</p>
                          <div className="flex flex-wrap gap-1">
                            {resolutionData.alternative_slots.slice(0, 8).map((s, i) => (
                              <span key={i} className="text-xs px-2 py-0.5 bg-gray-100 rounded">{DAY_LABELS[s.day]} {s.slot_name}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {resolutionData.swap_suggestions?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-600 mb-1">Swap Options:</p>
                          {resolutionData.swap_suggestions.map((s, i) => (
                            <p key={i} className="text-xs text-gray-600">{s.reason}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs text-gray-500 mb-1">Room</label>
                <input
                  type="text"
                  value={cellForm.room}
                  onChange={e => setCellForm(p => ({ ...p, room: e.target.value }))}
                  className="input w-full text-sm"
                  placeholder="e.g. Room 101"
                />
              </div>
            </div>

            <div className="flex justify-between mt-4">
              <button onClick={clearCell} className="text-xs text-red-600 hover:underline">Clear</button>
              <div className="flex gap-2">
                <button onClick={() => setEditingCell(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                <button onClick={saveCellEdit} className="btn-primary px-3 py-1.5 text-sm">Set</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Generate Confirm Modal */}
      {showAutoGenConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowAutoGenConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">AI Auto-Generate Timetable</h3>
            <p className="text-xs text-gray-600 mb-4">
              This will generate a new timetable for <strong>{classes.find(c => c.id == selectedClassId)?.name}</strong> using
              AI. Your current unsaved changes will be replaced. You can review and edit before saving.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAutoGenConfirm(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleAutoGenerate} className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Generate</button>
            </div>
          </div>
        </div>
      )}

      {/* Quality Score Modal */}
      {showScoreModal && qualityScore && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowScoreModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Timetable Quality Score</h3>
              <button onClick={() => setShowScoreModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="text-center mb-4">
              <span className={`inline-block px-4 py-2 rounded-full text-2xl font-bold ${scoreColor(qualityScore.overall_score)}`}>
                {qualityScore.overall_score.toFixed(0)}
              </span>
              <p className="text-xs text-gray-500 mt-1">out of 100</p>
            </div>

            <div className="space-y-3">
              {[
                { label: 'Constraint Satisfaction', value: qualityScore.constraint_satisfaction, weight: '25%' },
                { label: 'Subject Distribution', value: qualityScore.subject_distribution, weight: '25%' },
                { label: 'Teacher Idle Gaps', value: qualityScore.teacher_idle_gaps, weight: '20%' },
                { label: 'Break Placement', value: qualityScore.break_placement, weight: '15%' },
                { label: 'Workload Balance', value: qualityScore.workload_balance, weight: '15%' },
              ].map(m => (
                <div key={m.label}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600">{m.label}</span>
                    <span className="font-medium">{m.value?.toFixed(0)}<span className="text-gray-400 ml-1">({m.weight})</span></span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${m.value >= 80 ? 'bg-green-500' : m.value >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`}
                      style={{ width: `${m.value || 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Substitute Teacher Modal */}
      {showSubstituteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowSubstituteModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Find Substitute Teacher</h3>
              <button onClick={() => setShowSubstituteModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="flex gap-3 mb-4">
              <div className="flex-1">
                <label className="block text-xs text-gray-500 mb-1">Absent Teacher</label>
                <select value={subTeacher} onChange={e => setSubTeacher(e.target.value)} className="input w-full text-sm">
                  <option value="">-- Select --</option>
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date</label>
                <input type="date" value={subDate} onChange={e => setSubDate(e.target.value)} className="input text-sm" />
              </div>
              <button
                onClick={handleFindSubstitute}
                disabled={!subTeacher || loadingSubstitute}
                className="self-end px-3 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {loadingSubstitute ? 'Finding...' : 'Find'}
              </button>
            </div>

            {substituteData && !substituteData.error && (
              <div>
                <p className="text-xs text-gray-600 mb-3">
                  <strong>{substituteData.absent_teacher_name}</strong> on {substituteData.date}
                  {substituteData.message && <span className="ml-1 text-gray-500">— {substituteData.message}</span>}
                </p>
                {substituteData.entries_needing_cover?.length > 0 ? (
                  <div className="space-y-3">
                    {substituteData.entries_needing_cover.map((entry, i) => (
                      <div key={i} className="p-3 bg-gray-50 rounded-lg">
                        <div className="flex justify-between mb-2">
                          <span className="text-xs font-semibold text-gray-800">{entry.slot_name} ({entry.slot_start}-{entry.slot_end})</span>
                          <span className="text-xs text-gray-500">{entry.class_name} — {entry.subject_name}</span>
                        </div>
                        {entry.suggested_substitutes?.length > 0 ? (
                          <div className="space-y-1">
                            {entry.suggested_substitutes.map((sub, j) => (
                              <div key={j} className="flex items-center justify-between text-xs px-2 py-1 bg-white rounded border border-gray-100">
                                <span className="font-medium text-gray-800">{sub.teacher_name}</span>
                                <span className={`px-1.5 py-0.5 rounded ${sub.score >= 70 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{sub.reason}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">No substitutes available for this slot.</p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">No classes need cover.</p>
                )}
              </div>
            )}
            {substituteData?.error && (
              <p className="text-xs text-red-600">{substituteData.error}</p>
            )}
          </div>
        </div>
      )}

      {/* Time Slots Modal */}
      {showSlotsModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowSlotsModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Manage Time Slots</h2>
              <button onClick={() => setShowSlotsModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            {slots.length > 0 && (
              <div className="mb-4 space-y-2">
                {slots.map(s => (
                  <div key={s.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded font-mono">{s.order}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        s.slot_type === 'PERIOD' ? 'bg-blue-100 text-blue-700' :
                        s.slot_type === 'BREAK' ? 'bg-yellow-100 text-yellow-700' :
                        s.slot_type === 'LUNCH' ? 'bg-orange-100 text-orange-700' :
                        'bg-purple-100 text-purple-700'
                      }`}>
                        {s.slot_type}
                      </span>
                      <span className="text-sm text-gray-700">{s.name}</span>
                      <span className="text-xs text-gray-400">{s.start_time?.slice(0, 5)}-{s.end_time?.slice(0, 5)}</span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          setSlotForm({
                            name: s.name, slot_type: s.slot_type,
                            start_time: s.start_time?.slice(0, 5), end_time: s.end_time?.slice(0, 5),
                            order: s.order,
                          })
                          setEditSlotId(s.id)
                        }}
                        className="text-xs text-primary-600 hover:underline"
                      >Edit</button>
                      <button
                        onClick={() => { if (confirm(`Delete slot "${s.name}"?`)) deleteSlotMut.mutate(s.id) }}
                        className="text-xs text-red-600 hover:underline"
                      >Del</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-gray-200 pt-4">
              <h3 className="text-sm font-medium text-gray-700 mb-3">{editSlotId ? 'Edit Slot' : 'Add New Slot'}</h3>

              {(slotErrors.detail || slotErrors.non_field_errors) && (
                <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-xs">
                  {slotErrors.detail || slotErrors.non_field_errors}
                </div>
              )}

              <form onSubmit={handleSlotSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Name *</label>
                    <input
                      type="text"
                      value={slotForm.name}
                      onChange={e => setSlotForm(p => ({ ...p, name: e.target.value }))}
                      className="input w-full text-sm"
                      required
                      placeholder="Period 1"
                    />
                    {slotErrors.name && <p className="text-xs text-red-600">{slotErrors.name}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Type *</label>
                    <select
                      value={slotForm.slot_type}
                      onChange={e => setSlotForm(p => ({ ...p, slot_type: e.target.value }))}
                      className="input w-full text-sm"
                    >
                      {SLOT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Start *</label>
                    <input
                      type="time"
                      value={slotForm.start_time}
                      onChange={e => setSlotForm(p => ({ ...p, start_time: e.target.value }))}
                      className="input w-full text-sm"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">End *</label>
                    <input
                      type="time"
                      value={slotForm.end_time}
                      onChange={e => setSlotForm(p => ({ ...p, end_time: e.target.value }))}
                      className="input w-full text-sm"
                      required
                    />
                    {slotErrors.end_time && <p className="text-xs text-red-600">{slotErrors.end_time}</p>}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Order *</label>
                    <input
                      type="number"
                      min="1"
                      value={slotForm.order}
                      onChange={e => setSlotForm(p => ({ ...p, order: e.target.value }))}
                      className="input w-full text-sm"
                      required
                    />
                    {slotErrors.order && <p className="text-xs text-red-600">{slotErrors.order}</p>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={createSlotMut.isPending || updateSlotMut.isPending} className="btn-primary px-3 py-1.5 text-sm disabled:opacity-50">
                    {createSlotMut.isPending || updateSlotMut.isPending ? 'Saving...' : editSlotId ? 'Update Slot' : 'Add Slot'}
                  </button>
                  {editSlotId && (
                    <button type="button" onClick={resetSlotForm} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
                  )}
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
