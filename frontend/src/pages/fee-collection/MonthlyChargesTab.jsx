import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { financeApi, studentsApi, classesApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'
import {
  buildSessionClassOptions,
  buildStudentClassFilterParams,
  resolveClassIdToMasterClassId,
} from '../../utils/classScope'
import ClassSelector from '../../components/ClassSelector'
import MonthlyChargesCardView from './MonthlyChargesCardView'

export default function MonthlyChargesTab() {
  const [mode, setMode] = useState('class') // 'class' | 'student'
  const { activeAcademicYear } = useAcademicYear()
  const { activeSchool } = useAuth()
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  // Student mode state
  const [studentClassId, setStudentClassId] = useState('')
  const [studentFees, setStudentFees] = useState([])
  const [localEdits, setLocalEdits] = useState({})
  const [showConfirm, setShowConfirm] = useState(false)
  const [studentEditMode, setStudentEditMode] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().split('T')[0])

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const resolvedStudentClassId = resolveClassIdToMasterClassId(studentClassId, activeAcademicYear?.id, sessionClasses)
  const studentClassFilterParams = useMemo(() => buildStudentClassFilterParams({
    classId: studentClassId,
    activeAcademicYearId: activeAcademicYear?.id,
    sessionClasses,
  }), [studentClassId, activeAcademicYear?.id, sessionClasses])

  // Classes list for selector
  const { data: classesData } = useQuery({
    queryKey: ['classes', activeSchool?.id],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
    enabled: !!activeSchool?.id,
    staleTime: 5 * 60_000,
  })
  const classList = classesData?.data?.results ?? classesData?.data ?? []

  const classOptions = useMemo(() => {
    if (!activeAcademicYear?.id) return classList
    if (!sessionClasses?.length) return []
    return buildSessionClassOptions(sessionClasses)
  }, [activeAcademicYear?.id, classList, sessionClasses])

  // Student-mode queries
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students-for-fee-struct', activeSchool?.id, studentClassFilterParams.class_id, studentClassFilterParams.session_class_id, studentClassFilterParams.academic_year],
    queryFn: () => studentsApi.getStudents({
      ...studentClassFilterParams,
      is_active: true,
      page_size: 9999,
    }),
    enabled: mode === 'student' && !!activeSchool?.id && !!resolvedStudentClassId,
    staleTime: 2 * 60_000,
  })
  const classStudents = studentsData?.data?.results ?? studentsData?.data ?? []

  const { data: structsData, isLoading: structuresLoading } = useQuery({
    queryKey: ['feeStructures-class', activeSchool?.id, resolvedStudentClassId, 'MONTHLY', activeAcademicYear?.id],
    queryFn: () => financeApi.getFeeStructures({
      class_id: resolvedStudentClassId, fee_type: 'MONTHLY', page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: mode === 'student' && !!activeSchool?.id && !!resolvedStudentClassId,
    staleTime: 60_000,
  })
  const classStructures = structsData?.data?.results ?? structsData?.data ?? []

  const bulkStudentFeeMutation = useMutation({
    mutationFn: (payload) => financeApi.bulkSetStudentFeeStructures(payload),
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['feeStructures', activeSchool?.id] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-all', activeAcademicYear?.id] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-class', activeSchool?.id] })
      queryClient.invalidateQueries({ queryKey: ['monthly-fee-structures-all', activeAcademicYear?.id] })
      queryClient.invalidateQueries({ queryKey: ['generate-preview'] })

      const savedCount = res?.data?.created ?? variables?.students?.length ?? 0
      addToast(`Saved monthly fee overrides for ${savedCount} student${savedCount === 1 ? '' : 's'}.`, 'success')
    },
    onError: (err) => {
      const backendMessage = String(
        err?.response?.data?.detail || err?.response?.data?.message || err?.message || ''
      ).toLowerCase()

      if (
        backendMessage.includes('duplicate') ||
        backendMessage.includes('conflict') ||
        backendMessage.includes('integrity')
      ) {
        addToast('Duplicate records found. Please delete those first.', 'warning')
        return
      }

      addToast(getErrorMessage(err, 'Failed to save student fees'), 'error')
    },
  })

  // Build student fee grid
  useEffect(() => {
    if (mode !== 'student' || !resolvedStudentClassId) return
    if (classStudents.length === 0) { setStudentFees([]); return }

    const classDefault = classStructures.find(fs => fs.class_obj && !fs.student && fs.is_active)
    const defaultAmount = classDefault ? String(classDefault.monthly_amount) : ''
    const overrideMap = {}
    classStructures.forEach(fs => {
      if (fs.student && fs.is_active && overrideMap[fs.student] === undefined) {
        overrideMap[fs.student] = String(fs.monthly_amount)
      }
    })
    const edits = localEdits['MONTHLY'] || {}
    const grid = classStudents
      .slice()
      .sort((a, b) => (parseInt(a.roll_number) || 9999) - (parseInt(b.roll_number) || 9999))
      .map(s => {
        const localEdit = edits[s.id]
        const serverAmount = overrideMap[s.id] || defaultAmount
        const amount = localEdit !== undefined ? localEdit : serverAmount
        return {
          student_id: s.id, student_name: s.name,
          roll_number: s.roll_number || '', amount,
          originalAmount: serverAmount,
          isOverride: amount !== defaultAmount, classDefault: defaultAmount,
        }
      })
    setStudentFees(grid)
  }, [classStudents, classStructures, mode, resolvedStudentClassId, localEdits])

  const overrideCount = studentFees.filter(s => s.isOverride).length
  const editedStudentRows = useMemo(() => {
    const edits = localEdits['MONTHLY'] || {}
    return studentFees.filter((s) => {
      if (edits[s.student_id] === undefined) return false
      if (s.amount === '') return false
      return String(s.amount) !== String(s.originalAmount || '')
    })
  }, [localEdits, studentFees])

  const formatAmount = (value) => {
    if (value === '' || value == null) return 'Not set'
    const n = Number(value)
    if (Number.isNaN(n)) return String(value)
    return n.toLocaleString()
  }

  const handleStudentFeeChange = (idx, value) => {
    const s = studentFees[idx]
    if (!s) return
    setLocalEdits(prev => ({
      ...prev, MONTHLY: { ...(prev.MONTHLY || {}), [s.student_id]: value },
    }))
  }

  const handleStudentFeeSave = () => {
    // Save only rows that were edited in this session to make progress explicit.
    const edits = localEdits['MONTHLY'] || {}
    const toSend = studentFees
      .filter(s => edits[s.student_id] !== undefined && s.amount !== '')
      .map(s => ({ student_id: s.student_id, monthly_amount: s.amount }))

    if (toSend.length === 0) {
      addToast('No changes detected. Edit at least one student fee before saving.', 'warning')
      return
    }

    addToast(`Saving ${toSend.length} student update${toSend.length === 1 ? '' : 's'}...`, 'info')

    bulkStudentFeeMutation.mutate({
      class_id: parseInt(resolvedStudentClassId), fee_type: 'MONTHLY',
      effective_from: effectiveFrom, students: toSend,
    }, {
      onSuccess: () => {
        setLocalEdits(prev => { const next = { ...prev }; delete next.MONTHLY; return next })
        setShowConfirm(false)
        setStudentEditMode(false)
      },
    })
  }

  return (
    <div className="card">
      {/* Mode toggle */}
      <div className="flex gap-2 mb-4">
        <button type="button" onClick={() => { setMode('class'); setShowConfirm(false) }}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${mode === 'class' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >By Class</button>
        <button type="button" onClick={() => {
          setMode('student')
          setShowConfirm(false)
          setStudentEditMode(false)
          setLocalEdits({})
        }}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${mode === 'student' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
        >By Student</button>
      </div>

      {/* BY CLASS — card-based category view */}
      {mode === 'class' && <MonthlyChargesCardView />}

      {/* BY STUDENT — per-student override */}
      {mode === 'student' && (
        <>
          <div className="flex flex-wrap items-end gap-3 mb-4 pb-3 border-b border-gray-100">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Class <span className="text-red-500">*</span></label>
              <ClassSelector
                value={studentClassId}
                onChange={(e) => { setStudentClassId(e.target.value); setStudentFees([]); setShowConfirm(false); setStudentEditMode(false); setLocalEdits({}); bulkStudentFeeMutation?.reset?.() }}
                className="input-field text-sm"
                classes={classOptions}
              />
            </div>
            <div className="min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Effective From</label>
              <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input-field text-sm" />
            </div>
            {studentFees.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-gray-500 pb-2">
                <span>{studentFees.length} students</span>
                <span>Default: {studentFees[0]?.classDefault ? Number(studentFees[0].classDefault).toLocaleString() : 'Not set'}</span>
                {overrideCount > 0 && <span className="text-blue-600 font-medium">{overrideCount} override{overrideCount !== 1 ? 's' : ''}</span>}
              </div>
            )}
          </div>

          {!studentClassId ? (
            <div className="text-center py-12 text-gray-400 text-sm">Select a class to view and set student-level fees</div>
          ) : studentsLoading || structuresLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : showConfirm ? (
            <>
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                <p className="text-sm font-medium text-blue-900 mb-2">Confirm fee structures for {editedStudentRows.length} edited student{editedStudentRows.length === 1 ? '' : 's'}:</p>
                <p className="text-xs text-blue-700 mb-3">Fee type: Monthly | Effective from: {effectiveFrom}</p>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {editedStudentRows.map(s => (
                    <p key={s.student_id} className="text-sm text-blue-800">
                      <span className="font-medium">{s.student_name}</span>
                      {s.roll_number && <span className="text-blue-600"> (#{s.roll_number})</span>}: {formatAmount(s.originalAmount)} {' -> '} {formatAmount(s.amount)}
                    </p>
                  ))}
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
                <button onClick={handleStudentFeeSave} disabled={bulkStudentFeeMutation.isPending}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                >{bulkStudentFeeMutation.isPending ? 'Saving...' : 'Confirm & Save'}</button>
              </div>
              {bulkStudentFeeMutation.isError && <p className="mt-3 text-sm text-red-600">{getErrorMessage(bulkStudentFeeMutation.error, 'Failed to save student fees')}</p>}
              {bulkStudentFeeMutation.isSuccess && <p className="mt-3 text-sm text-green-600">Student fees saved! {bulkStudentFeeMutation.data?.data?.created} fee structure(s) set.</p>}
            </>
          ) : (
            <>
              {studentFees.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">No enrolled students found in this class</div>
              ) : (
                <>
                  {!studentEditMode && (
                    <div className="flex justify-end mb-2">
                      <button type="button" onClick={() => setStudentEditMode(true)}
                        className="px-3 py-1 text-xs font-medium text-primary-700 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
                      >✏ Edit</button>
                    </div>
                  )}
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Roll</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-40">Monthly Fee</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {studentFees.map((s, idx) => (
                          <tr key={s.student_id} className={s.isOverride ? 'bg-blue-50/50' : ''}>
                            <td className="px-4 py-1.5 text-sm text-gray-400">{idx + 1}</td>
                            <td className="px-4 py-1.5 text-sm font-mono text-gray-600">{s.roll_number}</td>
                            <td className="px-4 py-1.5 text-sm text-gray-900">
                              {s.student_name}
                              {s.isOverride && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-blue-500" title="Custom override" />}
                            </td>
                            <td className="px-4 py-1.5">
                              {studentEditMode ? (
                                <input type="number" step="0.01" placeholder="0.00"
                                  value={s.amount}
                                  onChange={(e) => handleStudentFeeChange(idx, e.target.value)}
                                  className={`input-field text-sm text-right w-32 ml-auto ${s.isOverride ? 'border-blue-300 bg-blue-50' : ''}`}
                                />
                              ) : (
                                <span className={`block text-sm text-right ${s.isOverride ? 'font-medium text-blue-700' : 'text-gray-900'}`}>
                                  {s.amount ? `Rs. ${Number(s.amount).toLocaleString()}` : '—'}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {studentEditMode && studentFees.length > 0 && (
                <div className="flex gap-3 mt-4">
                  <button type="button" onClick={() => {
                    setStudentEditMode(false)
                    setLocalEdits(prev => { const next = { ...prev }; delete next.MONTHLY; return next })
                  }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                  >Cancel</button>
                  <button type="button" onClick={() => setShowConfirm(true)}
                    disabled={editedStudentRows.length === 0}
                    className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                  >Review & Save</button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
