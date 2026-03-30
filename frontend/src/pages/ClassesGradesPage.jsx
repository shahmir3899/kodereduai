import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { classesApi, schoolsApi, sessionsApi } from '../services/api'
import { useToast } from '../components/Toast'
import SectionAllocator from './sessions/SectionAllocator'
import { GRADE_PRESETS, GRADE_LEVEL_LABELS } from '../constants/gradePresets'
import { useSessionClasses } from '../hooks/useSessionClasses'

const SECTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F']

const EMPTY_CLASS = { name: '', section: '', grade_level: '' }

export default function ClassesGradesPage() {
  const { user, activeSchool } = useAuth()
  const queryClient = useQueryClient()
  const { addToast } = useToast()
  const showError = (msg) => addToast(msg, 'error')
  const showSuccess = (msg) => addToast(msg, 'success')
  const { activeAcademicYear } = useAcademicYear()
  const isSuperAdmin = user?.is_super_admin

  // School selection (super admin can switch; regular users always use activeSchool)
  const [selectedSchoolId, setSelectedSchoolId] = useState(activeSchool?.id || null)

  // Sync selectedSchoolId when activeSchool becomes available (non-super-admin)
  useEffect(() => {
    if (!isSuperAdmin && activeSchool?.id) {
      setSelectedSchoolId(activeSchool.id)
    }
  }, [activeSchool?.id, isSuperAdmin])

  // View state
  const [classScope, setClassScope] = useState('master') // 'master' or 'session'
  const [viewMode, setViewMode] = useState('grouped') // 'grouped' or 'grid'
  const [expandedLevels, setExpandedLevels] = useState(new Set())
  const [lastYearId, setLastYearId] = useState(null)

  // Class modal state
  const [showClassModal, setShowClassModal] = useState(false)
  const [editingClass, setEditingClass] = useState(null)
  const [classForm, setClassForm] = useState(EMPTY_CLASS)

  // Delete confirm & section allocator
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showAllocator, setShowAllocator] = useState(false)

  // Link master class picker modal
  const [linkPickerModal, setLinkPickerModal] = useState({ open: false, sessionClass: null, selectedMasterId: '' })
  const closeLinkPicker = () => setLinkPickerModal({ open: false, sessionClass: null, selectedMasterId: '' })

  // ─── Queries ────────────────────────────────────────────────

  const { data: schoolsData } = useQuery({
    queryKey: ['admin-schools'],
    queryFn: () => schoolsApi.getAdminSchools(),
    enabled: !!isSuperAdmin,
  })

  useEffect(() => {
    if (isSuperAdmin && schoolsData?.data?.results?.length > 0 && !selectedSchoolId) {
      setSelectedSchoolId(schoolsData.data.results[0].id)
    }
  }, [isSuperAdmin, schoolsData, selectedSchoolId])

  const { data: classesRes, isLoading } = useQuery({
    queryKey: ['classes', selectedSchoolId],
    queryFn: () => classesApi.getClasses({ school_id: selectedSchoolId, page_size: 200 }),
    enabled: !!selectedSchoolId,
  })

  const classes = classesRes?.data?.results || classesRes?.data || []
  const schools = schoolsData?.data?.results || []
  const {
    sessionClasses,
    isLoading: sessionClassesLoading,
  } = useSessionClasses(activeAcademicYear?.id, selectedSchoolId)

  // When academic year changes, default to session scope so users immediately see year-specific classes.
  useEffect(() => {
    const currentYearId = activeAcademicYear?.id || null
    if (currentYearId && lastYearId !== currentYearId) {
      setClassScope('session')
    }
    setLastYearId(currentYearId)
  }, [activeAcademicYear?.id, lastYearId])

  // ─── Class Mutations ────────────────────────────────────────

  const createClassMut = useMutation({
    mutationFn: (data) => classesApi.createClass(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      closeClassModal()
      showSuccess('Class added!')
    },
    onError: (err) => {
      const msg = err.response?.data?.name?.[0] || err.response?.data?.detail || err.message || 'Failed to add class'
      showError(msg)
    },
  })

  const updateClassMut = useMutation({
    mutationFn: ({ id, data }) => classesApi.updateClass(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      closeClassModal()
      showSuccess('Class updated!')
    },
    onError: (err) => {
      const msg = err.response?.data?.name?.[0] || err.response?.data?.detail || err.message || 'Failed to update class'
      showError(msg)
    },
  })

  const deleteClassMut = useMutation({
    mutationFn: (id) => classesApi.deleteClass(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setDeleteConfirm(null)
      showSuccess('Class deleted!')
    },
    onError: (err) => showError(err.response?.data?.detail || err.message || 'Failed to delete class'),
  })

  const createSessionClassMut = useMutation({
    mutationFn: (data) => sessionsApi.createSessionClass(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-classes'] })
      closeClassModal()
      showSuccess('Session class added!')
    },
    onError: (err) => {
      const msg = err.response?.data?.display_name?.[0] || err.response?.data?.detail || err.message || 'Failed to add session class'
      showError(msg)
    },
  })

  const updateSessionClassMut = useMutation({
    mutationFn: ({ id, data }) => sessionsApi.updateSessionClass(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-classes'] })
      closeClassModal()
      showSuccess('Session class updated!')
    },
    onError: (err) => {
      const msg = err.response?.data?.display_name?.[0] || err.response?.data?.detail || err.message || 'Failed to update session class'
      showError(msg)
    },
  })

  const deleteSessionClassMut = useMutation({
    mutationFn: (id) => sessionsApi.deleteSessionClass(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-classes'] })
      setDeleteConfirm(null)
      showSuccess('Session class deleted!')
    },
    onError: (err) => showError(err.response?.data?.detail || err.message || 'Failed to delete session class'),
  })

  const linkSessionClassMut = useMutation({
    mutationFn: ({ id, classObjId }) => sessionsApi.updateSessionClass(id, { class_obj: classObjId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-classes'] })
      showSuccess('Session class linked to master class.')
    },
    onError: (err) => showError(err.response?.data?.detail || err.message || 'Failed to link session class'),
  })

  // Quick-add sections for a grade level
  const quickAddSectionsMut = useMutation({
    mutationFn: async ({ level, sections }) => {
      const baseName = GRADE_LEVEL_LABELS[level] || `Level ${level}`
      const results = []
      const targetSessionYear = activeAcademicYear?.id
      for (const sec of sections) {
        try {
          let res
          if (classScope === 'session') {
            if (!targetSessionYear) throw new Error('No active academic year selected for session classes.')
            const linked = classes.find(c => (
              String(c.name || '').toLowerCase() === String(baseName || '').toLowerCase()
              && String(c.section || '') === String(sec || '')
            ))
            res = await sessionsApi.createSessionClass({
              academic_year: targetSessionYear,
              class_obj: linked?.id || null,
              display_name: baseName,
              section: sec,
              grade_level: level,
            })
          } else {
            res = await classesApi.createClass({
              school: selectedSchoolId,
              name: baseName,
              section: sec,
              grade_level: level,
            })
          }
          results.push(res.data)
        } catch (err) {
          const payload = err.response?.data || {}
          const duplicateMsg = [
            payload.detail,
            payload.non_field_errors?.[0],
            payload.display_name?.[0],
            payload.name?.[0],
            payload.class_obj?.[0],
          ].filter(Boolean).join(' ')
          const lowered = String(duplicateMsg).toLowerCase()
          if (!(lowered.includes('already exists') || lowered.includes('already linked'))) throw err
        }
      }
      return results
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: classScope === 'session' ? ['session-classes'] : ['classes'] })
      showSuccess(classScope === 'session' ? 'Session sections added!' : 'Sections added!')
    },
    onError: (err) => showError(err.response?.data?.detail || err.message || 'Failed to add sections'),
  })

  // Add standard classes (bulk)
  const addStandardMut = useMutation({
    mutationFn: async () => {
      const existingNames = (classScope === 'session'
        ? sessionClasses.map(c => `${(c.display_name || '').toLowerCase()}::${(c.section || '').toLowerCase()}`)
        : classes.map(c => `${(c.name || '').toLowerCase()}::${(c.section || '').toLowerCase()}`)
      )
      const toAdd = GRADE_PRESETS.filter(p => !existingNames.includes(`${p.name.toLowerCase()}::`))
      for (const cls of toAdd) {
        if (classScope === 'session') {
          if (!activeAcademicYear?.id) throw new Error('No active academic year selected for session classes.')
          const linked = classes.find(c => (
            String(c.name || '').toLowerCase() === String(cls.name || '').toLowerCase()
            && Number(c.grade_level) === Number(cls.numeric_level)
            && !c.section
          ))
          await sessionsApi.createSessionClass({
            academic_year: activeAcademicYear.id,
            class_obj: linked?.id || null,
            display_name: cls.name,
            section: '',
            grade_level: cls.numeric_level,
          })
        } else {
          await classesApi.createClass({
            school: selectedSchoolId,
            name: cls.name,
            grade_level: cls.numeric_level,
          })
        }
      }
      return toAdd.length
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: classScope === 'session' ? ['session-classes'] : ['classes'] })
      showSuccess(classScope === 'session' ? `Added ${count} standard session classes!` : `Added ${count} standard classes!`)
    },
    onError: (err) => showError(err.response?.data?.detail || err.message || 'Failed to add standard classes'),
  })

  const initializeSessionClassesMut = useMutation({
    mutationFn: () => sessionsApi.initializeSessionClasses({
      academic_year: activeAcademicYear?.id,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['session-classes'] })
      showSuccess(res?.data?.message || 'Session classes initialized for active academic year.')
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to initialize session classes'),
  })

  // ─── Class Modal Helpers ────────────────────────────────────

  const openClassCreate = (presetLevel) => {
    setEditingClass(null)
    if (presetLevel !== undefined && presetLevel !== null) {
      const baseName = GRADE_LEVEL_LABELS[presetLevel] || ''
      setClassForm({ name: baseName, section: '', grade_level: presetLevel.toString() })
    } else {
      setClassForm(EMPTY_CLASS)
    }
    setShowClassModal(true)
  }

  const openClassEdit = (cls) => {
    setEditingClass(cls)
    setClassForm({
      name: cls.name,
      section: cls.section || '',
      grade_level: cls.grade_level?.toString() || '',
    })
    setShowClassModal(true)
  }

  const closeClassModal = () => {
    setShowClassModal(false)
    setEditingClass(null)
    setClassForm(EMPTY_CLASS)
  }

  const handleGradeLevelChange = (levelStr) => {
    const level = parseInt(levelStr)
    setClassForm(prev => {
      const baseName = GRADE_LEVEL_LABELS[level] || ''
      const name = baseName || prev.name
      return { ...prev, grade_level: levelStr, name }
    })
  }

  const handleClassSectionChange = (section) => {
    setClassForm(prev => {
      const level = parseInt(prev.grade_level)
      const baseName = GRADE_LEVEL_LABELS[level]
      // Name stays as the base grade level name; section is stored separately
      const name = baseName || prev.name
      return { ...prev, section, name }
    })
  }

  const handleClassSubmit = () => {
    if (classScope === 'session') {
      if (!activeAcademicYear?.id) {
        showError('Select an active academic year to manage session classes.')
        return
      }
      const linked = classes.find(c => (
        String(c.name || '').toLowerCase() === String(classForm.name || '').toLowerCase()
        && String(c.section || '') === String(classForm.section || '')
      ))
      const data = {
        academic_year: activeAcademicYear.id,
        class_obj: linked?.id || null,
        display_name: classForm.name,
        section: classForm.section || '',
        grade_level: classForm.grade_level ? parseInt(classForm.grade_level) : 0,
      }
      if (editingClass) updateSessionClassMut.mutate({ id: editingClass.id, data })
      else createSessionClassMut.mutate(data)
      return
    }

    const data = {
      name: classForm.name,
      section: editingClass ? (classForm.section || '') : '',
      grade_level: classForm.grade_level ? parseInt(classForm.grade_level) : 0,
    }
    if (editingClass) updateClassMut.mutate({ id: editingClass.id, data })
    else createClassMut.mutate({ school: selectedSchoolId, ...data })
  }

  const handleDeleteClass = (cls) => {
    if (classScope !== 'session' && cls.student_count > 0) {
      showError(`Cannot delete class with ${cls.student_count} students. Remove students first.`)
      return
    }
    setDeleteConfirm(cls)
  }

  const handleQuickAddSections = (level, count) => {
    const sectionLabels = SECTION_LABELS.slice(0, count)
    quickAddSectionsMut.mutate({ level, sections: sectionLabels })
  }

  // ─── Derived Data ───────────────────────────────────────────

  const isClassSubmitting = (
    createClassMut.isPending
    || updateClassMut.isPending
    || createSessionClassMut.isPending
    || updateSessionClassMut.isPending
  )

  const activeClasses = classScope === 'session'
    ? sessionClasses.map(sc => ({
      ...sc,
      name: sc.display_name,
      linked_master_name: sc.class_obj_name || '',
      student_count: sc.student_count || 0,
      enrollment_count: sc.enrollment_count || 0,
    }))
    : classes.filter(c => !String(c.section || '').trim())

  // Group classes by grade_level for the grouped view
  const classesByLevel = {}
  for (const cls of activeClasses) {
    const level = cls.grade_level ?? -1
    if (!classesByLevel[level]) classesByLevel[level] = []
    classesByLevel[level].push(cls)
  }

  const sortedLevels = Object.keys(classesByLevel).map(Number).sort((a, b) => a - b)

  const toggleExpand = (level) => {
    setExpandedLevels(prev => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  const normalizeClassKey = (value) => String(value || '').trim().toLowerCase()

  const findMasterClassCandidate = (sessionClass) => {
    const sessionName = normalizeClassKey(sessionClass.name || sessionClass.display_name)
    const sessionSection = normalizeClassKey(sessionClass.section)

    // 1. Exact name + section match
    const byNameSection = classes.filter(c =>
      normalizeClassKey(c.name) === sessionName && normalizeClassKey(c.section) === sessionSection
    )
    if (byNameSection.length === 1) return byNameSection[0]

    // 2. Name match where master has no section (most common: session has section 'A' but master has none)
    const byNameNoSection = classes.filter(c =>
      normalizeClassKey(c.name) === sessionName && !c.section
    )
    if (byNameNoSection.length === 1) return byNameNoSection[0]

    // 3. Name-only match (any master section)
    const byNameAll = classes.filter(c => normalizeClassKey(c.name) === sessionName)
    if (byNameAll.length === 1) return byNameAll[0]

    return null
  }

  const handleLinkNow = (sessionClass) => {
    const candidate = findMasterClassCandidate(sessionClass)
    if (candidate) {
      linkSessionClassMut.mutate({ id: sessionClass.id, classObjId: candidate.id })
    } else {
      // Auto-match failed → open picker so user can select manually
      setLinkPickerModal({ open: true, sessionClass, selectedMasterId: '' })
    }
  }

  // ─── Render ─────────────────────────────────────────────────

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6 gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Classes</h1>
          <p className="text-sm text-gray-600">Manage classes and sections by master catalog or session</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex bg-blue-50 rounded-lg p-0.5 border border-blue-200">
            <button
              onClick={() => setClassScope('master')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${classScope === 'master' ? 'bg-white shadow text-blue-900' : 'text-blue-700'}`}
            >Master</button>
            <button
              onClick={() => setClassScope('session')}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${classScope === 'session' ? 'bg-white shadow text-blue-900' : 'text-blue-700'}`}
            >Session</button>
          </div>
          {activeClasses.length > 0 && (
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'grouped' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
              >By Grade</button>
              <button
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
              >Grid</button>
            </div>
          )}
          <button onClick={() => setShowAllocator(true)} disabled={classScope === 'session'} className="text-sm px-3 py-1.5 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-lg font-medium transition-colors disabled:opacity-50">
            AI Allocator
          </button>
          {activeClasses.length === 0 && selectedSchoolId && (
            <button
              onClick={() => addStandardMut.mutate()}
              disabled={addStandardMut.isPending || (classScope === 'session' && !activeAcademicYear?.id)}
              className="text-sm px-3 py-1.5 bg-gray-100 text-gray-700 hover:bg-gray-200 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {addStandardMut.isPending ? 'Adding...' : (classScope === 'session' ? 'Add Standard Session Classes' : 'Add Standard Classes')}
            </button>
          )}
          <button onClick={() => openClassCreate()} disabled={!selectedSchoolId || (classScope === 'session' && !activeAcademicYear?.id)} className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50">
            + {classScope === 'session' ? 'Session Class' : 'Class'}
          </button>
        </div>
      </div>

      {/* Session classes quick panel */}
      <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/60 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-blue-900">Session Classes</h2>
            <p className="text-xs text-blue-700 mt-0.5">
              Active year: {activeAcademicYear?.name || 'Not selected'}
            </p>
            <p className="text-xs text-blue-700 mt-0.5">
              {sessionClassesLoading ? 'Loading...' : `${sessionClasses.length} session classes configured`}
            </p>
            <p className="text-xs text-blue-700 mt-1">
              Master classes should stay section-free. Create sections like A/B/C inside Session Classes for each academic year.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (classScope !== 'session') setClassScope('session')
              initializeSessionClassesMut.mutate()
            }}
            disabled={!activeAcademicYear?.id || initializeSessionClassesMut.isPending}
            className="px-3 py-2 text-xs rounded-lg border border-blue-300 text-blue-800 bg-white hover:bg-blue-100 disabled:opacity-50"
          >
            {initializeSessionClassesMut.isPending ? 'Initializing...' : 'Initialize From Master Classes'}
          </button>
        </div>
      </div>

      {classScope === 'session' && !activeAcademicYear?.id && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Select an active academic year from the session switcher to manage session classes.
        </div>
      )}

      {classScope === 'master' && (
        <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
          Master classes are the shared class catalog only. Keep them section-free and create sections in Session Classes for each academic year.
        </div>
      )}

      {/* Super Admin school selector */}
      {isSuperAdmin && (
        <div className="mb-6">
          <label className="label">Select School</label>
          <select
            className="input max-w-full sm:max-w-md"
            value={selectedSchoolId || ''}
            onChange={(e) => setSelectedSchoolId(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">-- Select a school --</option>
            {schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}

      {!selectedSchoolId && (
        isSuperAdmin ? (
          <div className="card p-4 sm:p-6">
            <div className="flex items-center gap-3 flex-wrap">
              {/* Step 1 */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-blue-100 text-blue-700 ring-2 ring-blue-300">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500 text-white">1</span>
                Select School
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              {/* Step 2 */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">2</span>
                View Classes
              </div>
              <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              {/* Step 3 */}
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
                Add / Manage Classes
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              Select a school above to view and manage its classes.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-3">
              <p className="text-xs text-blue-700">
                <span className="font-semibold">Tip:</span> Use "Add Standard Classes" to quickly create classes for all grade levels.
              </p>
            </div>
          </div>
        ) : (
          <div className="card text-center py-8 text-gray-500">
            No school assigned to your account.
          </div>
        )
      )}

      {/* Guideline: No academic year */}
      {selectedSchoolId && activeClasses.length > 0 && !activeAcademicYear && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-blue-50 border border-blue-200 rounded-lg">
          <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-blue-800">
            Classes are set up. Next step: create an <strong>Academic Year</strong> in <strong>Settings &gt; Academic Years</strong> before adding students.
          </span>
        </div>
      )}

      {/* Main Content */}
      {selectedSchoolId && (isLoading || (classScope === 'session' && sessionClassesLoading) ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto" />
        </div>
      ) : activeClasses.length === 0 ? (
        <div className="card p-4 sm:p-6">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-green-100 text-green-700">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-green-500 text-white">{'\u2713'}</span>
              School Selected
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-blue-100 text-blue-700 ring-2 ring-blue-300">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-blue-500 text-white">2</span>
              Create Classes
            </div>
            <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm bg-gray-100 text-gray-400">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold bg-gray-300 text-white">3</span>
              Manage Sections
            </div>
          </div>
          <p className="text-sm text-gray-500 mt-3">
            No {classScope === 'session' ? 'session classes' : 'classes'} found. Use quick add or add manually.
          </p>
        </div>
      ) : viewMode === 'grouped' ? (
        /* ───── By Grade Level View ───── */
        <div className="space-y-3">
          {sortedLevels.map(level => {
            const levelClasses = classesByLevel[level] || []
            const isExpanded = expandedLevels.has(level)
            const label = GRADE_LEVEL_LABELS[level] || `Level ${level}`
            const editableClass = levelClasses.find(c => !c.section) || levelClasses[0]

            return (
              <div key={level} className="card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(level)}>
                    <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center">
                      <span className="text-primary-700 font-bold text-sm">{level}</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{label}</h3>
                      <p className="text-xs text-gray-500">
                        {classScope === 'session'
                          ? `Level ${level} · ${levelClasses.length} section(s) · ${levelClasses.reduce((sum, c) => sum + (c.enrollment_count || 0), 0)} students`
                          : `Level ${level} · Master catalog`
                        }
                      </p>
                    </div>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => editableClass && openClassEdit(editableClass)}
                      disabled={!editableClass}
                      className="text-xs text-sky-600 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                      title={levelClasses.length > 1 ? 'Editing primary class in this level. Expand row to edit specific sections.' : 'Edit class'}
                    >
                      Edit
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    {levelClasses.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 mb-3">
                        {levelClasses.map(c => (
                          <div key={c.id} className="px-3 py-2 bg-gray-50 rounded-lg group relative">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="text-sm font-medium text-gray-900">{c.name}</p>
                                {c.section && <p className="text-xs text-primary-600">Section {c.section}</p>}
                                {classScope === 'session' && (
                                  <p className="text-xs text-gray-400">
                                    {c.enrollment_count || 0} students
                                  </p>
                                )}
                                {classScope === 'session' && (
                                  <div className="text-[11px] text-blue-700 flex items-center gap-2 flex-wrap">
                                    <span>Master: {c.linked_master_name || 'Not linked'}</span>
                                    {!c.class_obj && (
                                      <button
                                        type="button"
                                        onClick={() => handleLinkNow(c)}
                                        disabled={linkSessionClassMut.isPending}
                                        className="px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 disabled:opacity-50"
                                      >
                                        Link Now
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button onClick={() => openClassEdit(c)} className="text-xs text-blue-600 hover:underline">Edit</button>
                                <button onClick={() => handleDeleteClass(c)} className="text-xs text-red-600 hover:underline">Del</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400 mb-3">No classes at this level yet.</p>
                    )}
                    {classScope === 'session' ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500">Quick add sections:</span>
                        {[1, 2, 3, 4, 5, 6].map(count => (
                          <button
                            key={count}
                            onClick={() => handleQuickAddSections(level, count)}
                            disabled={quickAddSectionsMut.isPending}
                            className="px-2 py-1 text-xs bg-primary-50 text-primary-700 hover:bg-primary-100 rounded transition-colors disabled:opacity-50"
                          >+{count}</button>
                        ))}
                        {quickAddSectionsMut.isPending && <span className="text-xs text-gray-400">Creating...</span>}
                      </div>
                    ) : (
                      <p className="text-xs text-sky-700">Sections are created in Session Classes, not in the master catalog.</p>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* ───── Grid View ───── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeClasses.map(cls => (
            <div key={cls.id} className="card">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{cls.name}</h3>
                  <p className="text-xs text-gray-500">
                    {GRADE_LEVEL_LABELS[cls.grade_level] || `Level ${cls.grade_level}`}
                    {cls.section ? ` / Section ${cls.section}` : ''}
                  </p>
                </div>
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                  cls.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }`}>
                  {cls.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="space-y-2 text-sm text-gray-500">
                {classScope === 'session' && (
                  <div className="flex justify-between">
                    <span>Students:</span>
                    <span className="font-medium text-gray-900">{cls.enrollment_count || 0}</span>
                  </div>
                )}
                {classScope === 'session' && (
                  <div className="flex justify-between items-center gap-2 flex-wrap">
                    <span>Master Class:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-blue-700">{cls.linked_master_name || 'Not linked'}</span>
                      {!cls.class_obj && (
                        <button
                          type="button"
                          onClick={() => handleLinkNow(cls)}
                          disabled={linkSessionClassMut.isPending}
                          className="text-[11px] px-1.5 py-0.5 rounded border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700 disabled:opacity-50"
                        >
                          Link Now
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {cls.section && (
                  <div className="flex justify-between">
                    <span>Section:</span>
                    <span className="font-medium text-primary-700">{cls.section}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Grade Level:</span>
                  <span className="font-medium text-gray-900">{cls.grade_level}</span>
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-4 pt-4 border-t border-gray-100">
                <button onClick={() => openClassEdit(cls)} className="text-sm text-blue-600 hover:text-blue-800 font-medium">Edit</button>
                <button onClick={() => handleDeleteClass(cls)} className="text-sm text-red-600 hover:text-red-800 font-medium">Delete</button>
              </div>
            </div>
          ))}
        </div>
      ))}

      {/* ───── Class Modal ───── */}
      {showClassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeClassModal}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">{editingClass ? 'Edit Class' : 'Add Class'}</h2>
              <button onClick={closeClassModal} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label">Grade Level</label>
                <select className="input" value={classForm.grade_level} onChange={(e) => handleGradeLevelChange(e.target.value)}>
                  <option value="">-- Select grade level --</option>
                  {GRADE_PRESETS.map(p => (
                    <option key={p.numeric_level} value={p.numeric_level}>{p.name} (Level {p.numeric_level})</option>
                  ))}
                </select>
              </div>

              {classScope === 'session' ? (
                <div>
                  <label className="label">Section (Optional)</label>
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    {SECTION_LABELS.map(s => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleClassSectionChange(classForm.section === s ? '' : s)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          classForm.section === s
                            ? 'bg-primary-100 border-primary-300 text-primary-700 font-medium'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >{s}</button>
                    ))}
                  </div>
                  <input
                    type="text"
                    className="input mt-1"
                    placeholder="Or type custom section..."
                    value={classForm.section}
                    onChange={(e) => handleClassSectionChange(e.target.value.toUpperCase())}
                    maxLength={10}
                  />
                </div>
              ) : editingClass && classForm.section ? (
                <div>
                  <label className="label">Legacy Section</label>
                  <input type="text" className="input mt-1 bg-gray-50" value={classForm.section} disabled />
                  <p className="text-xs text-gray-500 mt-1">This older master class still has a section. New master classes should be section-free.</p>
                </div>
              ) : (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                  Sections are managed in Session Classes. Master classes should stay section-free.
                </div>
              )}

              <div>
                <label className="label">Class Name</label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Class 1-A, PlayGroup"
                  value={classForm.name}
                  onChange={(e) => setClassForm({ ...classForm, name: e.target.value })}
                  required
                />
                {classForm.grade_level && <p className="text-xs text-gray-400 mt-1">Auto-generated from grade level</p>}
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button onClick={closeClassModal} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={handleClassSubmit}
                disabled={isClassSubmitting || !classForm.name}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {isClassSubmitting ? 'Saving...' : (editingClass ? 'Save Changes' : `Add ${classScope === 'session' ? 'Session Class' : 'Class'}`)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Delete Confirmation ───── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete Class</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={() => (classScope === 'session' ? deleteSessionClassMut.mutate(deleteConfirm.id) : deleteClassMut.mutate(deleteConfirm.id))}
                disabled={deleteClassMut.isPending || deleteSessionClassMut.isPending}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteClassMut.isPending || deleteSessionClassMut.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Link Master Class Picker Modal ───── */}
      {linkPickerModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={closeLinkPicker}>
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Link Master Class</h2>
              <button onClick={closeLinkPicker} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Select a master class to link to{' '}
              <strong>
                {linkPickerModal.sessionClass?.display_name || linkPickerModal.sessionClass?.name}
                {linkPickerModal.sessionClass?.section ? ` — ${linkPickerModal.sessionClass.section}` : ''}
              </strong>.
            </p>
            <select
              className="input w-full mb-4"
              value={linkPickerModal.selectedMasterId}
              onChange={e => setLinkPickerModal(prev => ({ ...prev, selectedMasterId: e.target.value }))}
            >
              <option value="">-- Select master class --</option>
              {classes.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.section ? ` — ${c.section}` : ''} (Level {c.grade_level})
                </option>
              ))}
            </select>
            <div className="flex justify-end space-x-3">
              <button onClick={closeLinkPicker} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button
                onClick={() => {
                  if (!linkPickerModal.selectedMasterId) return
                  linkSessionClassMut.mutate(
                    { id: linkPickerModal.sessionClass.id, classObjId: parseInt(linkPickerModal.selectedMasterId) },
                    { onSuccess: closeLinkPicker }
                  )
                }}
                disabled={!linkPickerModal.selectedMasterId || linkSessionClassMut.isPending}
                className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
              >
                {linkSessionClassMut.isPending ? 'Linking...' : 'Link'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── Section Allocator Modal ───── */}
      {showAllocator && (
        <SectionAllocator onClose={() => {
          setShowAllocator(false)
          queryClient.invalidateQueries({ queryKey: ['classes'] })
        }} />
      )}
    </div>
  )
}
