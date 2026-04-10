import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { MONTHS } from './FeeFilters'
import ClassSelector from '../../components/ClassSelector'
import SearchableSelect from '../../components/SearchableSelect'
import { studentsApi, financeApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'
import FeeGenerationSurface from './FeeGenerationSurface'
import {
  buildSessionClassOptions,
  buildStudentClassFilterParams,
  resolveClassIdToMasterClassId,
} from '../../utils/classScope'

const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'ONLINE', label: 'Online Payment' },
  { value: 'OTHER', label: 'Other' },
]


export function PaymentModal({ payment, form, setForm, onSubmit, onClose, isPending, error, accountsList }) {
  if (!payment) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-1">Record Payment</h3>
          <p className="text-sm text-gray-500 mb-4">
            {payment.student_name} - {payment.class_name}
            <br />
            Total Payable: {Number(payment.amount_due).toLocaleString()} | Already Paid: {Number(payment.amount_paid).toLocaleString()}
            {Number(payment.previous_balance) > 0 && (
              <><br /><span className="text-orange-600">Includes {Number(payment.previous_balance).toLocaleString()} carry-forward balance</span></>
            )}
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <input
                type="number" step="0.01"
                value={form.amount_paid}
                onChange={(e) => setForm(f => ({ ...f, amount_paid: e.target.value }))}
                className="input-field" required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                <select value={form.payment_method} onChange={(e) => setForm(f => ({ ...f, payment_method: e.target.value }))} className="input-field">
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account <span className="text-red-500">*</span></label>
                <select value={form.account} onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))} className="input-field" required>
                  <option value="">-- Select --</option>
                  {accountsList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date <span className="text-red-500">*</span></label>
                <input type="date" value={form.payment_date} onChange={(e) => setForm(f => ({ ...f, payment_date: e.target.value }))} className="input-field" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Receipt # <span className="text-gray-400 font-normal">(opt)</span></label>
                <input type="text" value={form.receipt_number} onChange={(e) => setForm(f => ({ ...f, receipt_number: e.target.value }))} className="input-field" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(opt)</span></label>
              <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="input-field" rows={2} />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                {isPending ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to record payment')}</p>}
          </form>
        </div>
      </div>
    </div>
  )
}

export function GenerateModal({
  show,
  onClose,
  month,
  year,
  classList,
  mutation,
  annualMutation,
  academicYearId,
  annualCategories = [],
  monthlyCategories = [],
}) {
  return (
    <FeeGenerationSurface
      mode="modal"
      show={show}
      onClose={onClose}
      month={month}
      year={year}
      classList={classList}
      monthlyMutation={mutation}
      annualMutation={annualMutation}
      academicYearId={academicYearId}
      annualCategories={annualCategories}
      monthlyCategories={monthlyCategories}
    />
  )
}

const FEE_TYPE_TABS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'ANNUAL', label: 'Annual' },
]

const FEE_TYPE_DESCRIPTIONS = {
  MONTHLY: 'Set the monthly recurring fee for each class.',
  ANNUAL: 'Set the annual fee for each class (charged once per year).',
}

export function FeeStructureModal({ show, onClose, classList, bulkEffectiveFrom, setBulkEffectiveFrom, onSubmit, mutation, feeTypeFilter, academicYearId, studentFeeMutation }) {
  const { activeSchool } = useAuth()
  const [showConfirm, setShowConfirm] = useState(false)
  const [structureFeeType, setStructureFeeType] = useState(feeTypeFilter || 'MONTHLY')
  const [feesByType, setFeesByType] = useState({
    MONTHLY: {}, ANNUAL: {},
  })

  // "By Class" vs "By Student" mode
  const [structureMode, setStructureMode] = useState('class')
  const [studentClassId, setStudentClassId] = useState('')
  const [studentFees, setStudentFees] = useState([])
  const [studentShowConfirm, setStudentShowConfirm] = useState(false)
  // Track local edits per fee type so switching tabs preserves unsaved changes
  const [localEdits, setLocalEdits] = useState({})

  const { sessionClasses } = useSessionClasses(academicYearId, activeSchool?.id)
  const feeStructureClassOptions = useMemo(() => {
    if (!academicYearId) return classList
    if (!sessionClasses?.length) return []
    return buildSessionClassOptions(sessionClasses)
  }, [academicYearId, classList, sessionClasses])
  const resolvedStudentClassId = resolveClassIdToMasterClassId(studentClassId, academicYearId, sessionClasses)
  const studentClassFilterParams = useMemo(() => buildStudentClassFilterParams({
    classId: studentClassId,
    activeAcademicYearId: academicYearId,
    sessionClasses,
  }), [studentClassId, academicYearId, sessionClasses])

  // Reset state when modal opens
  useEffect(() => {
    if (show) {
      setShowConfirm(false)
      setStructureMode('class')
      setStudentClassId('')
      setStudentFees([])
      setStudentShowConfirm(false)
      setLocalEdits({})
      mutation.reset?.()
      studentFeeMutation?.reset?.()
    }
  }, [show])

  // Fetch ALL fee structures (no fee_type filter) so each tab has its own data
  const { data: allStructures } = useQuery({
    queryKey: ['feeStructures-all', academicYearId],
    queryFn: () => financeApi.getFeeStructures({
      page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    enabled: show,
    staleTime: 2 * 60_000,
  })

  // Populate per-type fees when structures load
  useEffect(() => {
    if (!allStructures?.data) return
    const list = allStructures.data?.results || allStructures.data || []
    const grouped = { MONTHLY: {}, ANNUAL: {} }
    list.forEach(fs => {
      if (fs.class_obj && !fs.student && fs.is_active) {
        const ft = fs.fee_type || 'MONTHLY'
        if (grouped[ft]) grouped[ft][fs.class_obj] = String(fs.monthly_amount)
      }
    })
    setFeesByType(grouped)
  }, [allStructures])

  // --- Student mode queries ---
  const { data: classStudentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students-for-fee-struct', studentClassFilterParams.class_id, studentClassFilterParams.session_class_id, studentClassFilterParams.academic_year],
    queryFn: () => studentsApi.getStudents({
      ...studentClassFilterParams,
      is_active: true,
      page_size: 9999,
    }),
    enabled: show && structureMode === 'student' && !!resolvedStudentClassId,
    staleTime: 2 * 60_000,
  })

  const { data: classFeeStructures, isLoading: structuresLoading } = useQuery({
    queryKey: ['feeStructures-class', resolvedStudentClassId, structureFeeType, academicYearId],
    queryFn: () => financeApi.getFeeStructures({
      class_id: resolvedStudentClassId, fee_type: structureFeeType, page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    enabled: show && structureMode === 'student' && !!resolvedStudentClassId,
    staleTime: 60_000,
  })

  // Build student fee grid from fetched data, merging any local edits
  useEffect(() => {
    if (structureMode !== 'student' || !studentClassId) return
    const students = classStudentsData?.data?.results || classStudentsData?.data || []
    const structures = classFeeStructures?.data?.results || classFeeStructures?.data || []
    if (students.length === 0) { setStudentFees([]); return }

    const classDefault = structures.find(fs => fs.class_obj && !fs.student && fs.is_active)
    const defaultAmount = classDefault ? String(classDefault.monthly_amount) : ''

    const overrideMap = {}
    structures.forEach(fs => {
      if (fs.student && fs.is_active) overrideMap[fs.student] = String(fs.monthly_amount)
    })

    const edits = localEdits[structureFeeType] || {}

    const grid = students
      .slice()
      .sort((a, b) => (parseInt(a.roll_number) || 9999) - (parseInt(b.roll_number) || 9999))
      .map(s => {
        const localEdit = edits[s.id]
        const serverAmount = overrideMap[s.id] || defaultAmount
        const amount = localEdit !== undefined ? localEdit : serverAmount
        return {
          student_id: s.id,
          student_name: s.name,
          roll_number: s.roll_number || '',
          amount,
          isOverride: amount !== defaultAmount,
          classDefault: defaultAmount,
        }
      })
    setStudentFees(grid)
  }, [classStudentsData, classFeeStructures, structureMode, studentClassId, structureFeeType, localEdits])

  if (!show) return null

  const currentFees = feesByType[structureFeeType] || {}
  const feesWithValues = feeStructureClassOptions.filter(c => currentFees[c.id] && Number(currentFees[c.id]) > 0)
  const feeLabel = FEE_TYPE_TABS.find(t => t.value === structureFeeType)?.label || 'Monthly'

  const handleFeeChange = (classId, value) => {
    setFeesByType(prev => ({
      ...prev,
      [structureFeeType]: { ...prev[structureFeeType], [classId]: value },
    }))
  }

  const handleStudentFeeChange = (idx, value) => {
    const s = studentFees[idx]
    if (!s) return
    setLocalEdits(prev => ({
      ...prev,
      [structureFeeType]: { ...(prev[structureFeeType] || {}), [s.student_id]: value },
    }))
  }

  const handleStudentFeeSave = () => {
    const toSend = studentFees
      .filter(s => s.amount !== '')
      .map(s => ({ student_id: s.student_id, monthly_amount: s.amount }))
    if (toSend.length === 0) return
    studentFeeMutation.mutate({
      class_id: parseInt(resolvedStudentClassId),
      fee_type: structureFeeType,
      effective_from: bulkEffectiveFrom,
      students: toSend,
    }, {
      onSuccess: () => {
        setLocalEdits(prev => { const next = { ...prev }; delete next[structureFeeType]; return next })
        onClose()
      },
    })
  }

  const overrideCount = studentFees.filter(s => s.isOverride).length

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className={`bg-white rounded-lg shadow-xl w-full flex flex-col ${
        structureMode === 'student' ? 'max-w-4xl max-h-[95vh]' : 'max-w-lg max-h-[80vh]'
      }`}>
        <div className={`${structureMode === 'student' ? 'px-6 pt-4 pb-2' : 'p-6'} flex-shrink-0`}>
          <div className={`flex items-center ${structureMode === 'student' ? 'justify-between mb-2' : 'mb-1'}`}>
            <h3 className="text-lg font-semibold">Set Fee Structure</h3>
            {/* Mode toggle */}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setStructureMode('class'); setStudentShowConfirm(false) }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${structureMode === 'class' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >By Class</button>
              <button type="button" onClick={() => { setStructureMode('student'); setShowConfirm(false) }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${structureMode === 'student' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >By Student</button>
            </div>
          </div>

          {/* Fee type tabs */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {FEE_TYPE_TABS.map(ft => (
              <button
                key={ft.value}
                type="button"
                onClick={() => { setStructureFeeType(ft.value); setStudentShowConfirm(false); setShowConfirm(false) }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  structureFeeType === ft.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {ft.label}
              </button>
            ))}
          </div>
          {structureMode === 'class' && (
            <>
              <p className="text-sm text-gray-600 mb-4">{FEE_TYPE_DESCRIPTIONS[structureFeeType]}</p>
              {!showConfirm && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective From</label>
                  <input type="date" value={bulkEffectiveFrom} onChange={(e) => setBulkEffectiveFrom(e.target.value)} className="input-field" />
                </div>
              )}
            </>
          )}
        </div>

        {/* ===== BY CLASS MODE ===== */}
        {structureMode === 'class' && (
          <>
            {showConfirm ? (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto px-6">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-blue-900 mb-2">Please confirm fee structure changes:</p>
                    <p className="text-xs text-blue-700 mb-3">Effective from: {bulkEffectiveFrom}</p>
                    <div className="space-y-1">
                      {feesWithValues.length > 0 ? feesWithValues.map(c => (
                        <p key={c.id} className="text-sm text-blue-800">
                          <span className="font-medium">{c.label || `${c.name}${c.section ? ` - ${c.section}` : ''}`}:</span> {Number(currentFees[c.id]).toLocaleString()} ({feeLabel})
                        </p>
                      )) : (
                        <p className="text-sm text-blue-800">No fees set. Nothing will be saved.</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-6 flex gap-3 border-t flex-shrink-0">
                  <button type="button" onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
                  <button
                    onClick={(e) => { onSubmit(e, structureFeeType, currentFees); setShowConfirm(false) }}
                    disabled={mutation.isPending || feesWithValues.length === 0}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                  >
                    {mutation.isPending ? 'Saving...' : 'Confirm & Save'}
                  </button>
                </div>
                {mutation.isError && <p className="px-6 pb-4 text-sm text-red-600">{getErrorMessage(mutation.error, 'Failed to save fee structures')}</p>}
                {mutation.isSuccess && <p className="px-6 pb-4 text-sm text-green-600">Fee structures saved for {mutation.data?.data?.created} classes!</p>}
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); setShowConfirm(true) }} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto px-6">
                  <table className="min-w-full">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">{feeLabel} Fee</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {feeStructureClassOptions.map(c => (
                        <tr key={c.id}>
                          <td className="px-3 py-2 text-sm text-gray-900">{c.label || `${c.name}${c.section ? ` - ${c.section}` : ''}`}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number" step="0.01" placeholder="0.00"
                              value={currentFees[c.id] || ''}
                              onChange={(e) => handleFeeChange(c.id, e.target.value)}
                              className="input-field text-sm text-right w-32 ml-auto"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="p-6 flex gap-3 border-t flex-shrink-0">
                  <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                  <button type="submit" className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
                    Review Changes
                  </button>
                </div>
                {mutation.isError && <p className="px-6 pb-4 text-sm text-red-600">{getErrorMessage(mutation.error, 'Failed to save fee structures')}</p>}
                {mutation.isSuccess && <p className="px-6 pb-4 text-sm text-green-600">Fee structures saved for {mutation.data?.data?.created} classes!</p>}
              </form>
            )}
          </>
        )}

        {/* ===== BY STUDENT MODE ===== */}
        {structureMode === 'student' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* Compact controls row */}
            <div className="px-6 pb-3 flex flex-wrap items-end gap-3 border-b border-gray-100">
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Class <span className="text-red-500">*</span></label>
                <ClassSelector
                  value={studentClassId}
                  onChange={(e) => { setStudentClassId(e.target.value); setStudentFees([]); setStudentShowConfirm(false); setLocalEdits({}); studentFeeMutation?.reset?.() }}
                  className="input-field text-sm"
                  classes={feeStructureClassOptions}
                />
              </div>
              <div className="min-w-[140px]">
                <label className="block text-xs font-medium text-gray-500 mb-1">Effective From</label>
                <input type="date" value={bulkEffectiveFrom} onChange={(e) => setBulkEffectiveFrom(e.target.value)} className="input-field text-sm" />
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
              <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                Select a class to view and set student-level fees
              </div>
            ) : studentsLoading || structuresLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
              </div>
            ) : studentShowConfirm ? (
              /* Confirmation view */
              <>
                <div className="flex-1 overflow-y-auto px-6 py-4">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-medium text-blue-900 mb-2">Confirm fee structures for {studentFees.filter(s => s.amount !== '').length} students:</p>
                    <p className="text-xs text-blue-700 mb-3">
                      Fee type: {feeLabel} | Effective from: {bulkEffectiveFrom}
                    </p>
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {studentFees.filter(s => s.amount !== '').map(s => (
                        <p key={s.student_id} className="text-sm text-blue-800">
                          <span className="font-medium">{s.student_name}</span>
                          {s.roll_number && <span className="text-blue-600"> (#{s.roll_number})</span>}
                          : {Number(s.amount).toLocaleString()}
                        </p>
                      ))}
                      {studentFees.filter(s => s.amount === '').length > 0 && (
                        <p className="text-sm text-orange-600 mt-2">
                          {studentFees.filter(s => s.amount === '').length} student(s) have no amount and will be skipped.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="px-6 py-3 flex gap-3 border-t flex-shrink-0">
                  <button type="button" onClick={() => setStudentShowConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
                  <button
                    onClick={handleStudentFeeSave}
                    disabled={studentFeeMutation?.isPending}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                  >
                    {studentFeeMutation?.isPending ? 'Saving...' : 'Confirm & Save'}
                  </button>
                </div>
                {studentFeeMutation?.isError && <p className="px-6 pb-3 text-sm text-red-600">{getErrorMessage(studentFeeMutation.error, 'Failed to save student fees')}</p>}
                {studentFeeMutation?.isSuccess && (
                  <p className="px-6 pb-3 text-sm text-green-600">
                    Student fees saved! {studentFeeMutation.data?.data?.created} fee structure(s) set.
                  </p>
                )}
              </>
            ) : (
              /* Student spreadsheet grid */
              <>
                {studentFees.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                    No enrolled students found in this class
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50 sticky top-0 z-10">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-12">#</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-20">Roll</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase w-40">{feeLabel} Fee</th>
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
                              <input
                                type="number" step="0.01" placeholder="0.00"
                                value={s.amount}
                                onChange={(e) => handleStudentFeeChange(idx, e.target.value)}
                                className={`input-field text-sm text-right w-32 ml-auto ${s.isOverride ? 'border-blue-300 bg-blue-50' : ''}`}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="px-6 py-3 flex gap-3 border-t flex-shrink-0">
                  <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                  <button
                    type="button"
                    onClick={() => setStudentShowConfirm(true)}
                    disabled={studentFees.length === 0 || studentFees.every(s => s.amount === '')}
                    className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                  >
                    Review & Save
                  </button>
                </div>
                {studentFeeMutation?.isError && <p className="px-6 pb-3 text-sm text-red-600">{getErrorMessage(studentFeeMutation.error, 'Failed to save student fees')}</p>}
                {studentFeeMutation?.isSuccess && (
                  <p className="px-6 pb-3 text-sm text-green-600">
                    Student fees saved! {studentFeeMutation.data?.data?.created} fee structure(s) set.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function IncomeModal({ show, onClose, form, setForm, onSubmit, isPending, error, accountsList, incomeCategories = [] }) {
  const queryClient = useQueryClient()
  const [newCategoryName, setNewCategoryName] = useState('')

  const addCategoryMutation = useMutation({
    mutationFn: (data) => financeApi.createIncomeCategory(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['incomeCategories'] })
      const newCat = res?.data
      if (newCat?.id) setForm(f => ({ ...f, category: newCat.id }))
      setNewCategoryName('')
    },
  })

  if (!show) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 sm:px-6">
          <h3 className="text-lg font-semibold text-gray-900">Add Other Income</h3>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
          </button>
        </div>

        {/* Body */}
        <div className="max-h-[75vh] overflow-y-auto px-5 py-4 sm:px-6">
          <form onSubmit={onSubmit} className="space-y-4">
            {/* Amount — hero field */}
            <div>
              <label className="label">Amount</label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-xs font-semibold text-gray-400">PKR</span>
                <input
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))}
                  className="input pl-12 text-lg font-semibold"
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            {/* Category + Date row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Category</label>
                <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} className="input">
                  <option value="">Select category</option>
                  {incomeCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Date</label>
                <input type="date" value={form.date} onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))} className="input" required />
              </div>
            </div>

            {/* Quick add category */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category..."
                className="input flex-1 !py-1.5 text-sm"
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newCategoryName.trim()) addCategoryMutation.mutate({ name: newCategoryName.trim() }) } }}
              />
              <button
                type="button"
                onClick={() => { if (newCategoryName.trim()) addCategoryMutation.mutate({ name: newCategoryName.trim() }) }}
                disabled={!newCategoryName.trim() || addCategoryMutation.isPending}
                className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-40"
              >
                + Add
              </button>
            </div>

            {/* Account */}
            <div>
              <label className="label">Account <span className="text-red-500">*</span></label>
              <select value={form.account} onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))} className="input" required>
                <option value="">Select account</option>
                {accountsList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="label">Description <span className="text-xs font-normal text-gray-400">(optional)</span></label>
              <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className="input" rows={2} placeholder="e.g., Sold 50 copies" />
            </div>

            {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to save income')}</p>}
          </form>
        </div>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 border-t border-gray-100 px-5 py-4 sm:flex-row sm:justify-end sm:gap-3 sm:px-6">
          <button type="button" onClick={onClose} className="btn btn-secondary w-full sm:w-auto">Cancel</button>
          <button
            type="submit"
            disabled={isPending}
            className="btn btn-primary w-full sm:w-auto"
            onClick={onSubmit}
          >
            {isPending ? 'Saving...' : 'Add Income'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function StudentFeeModal({ student, amount, setAmount, onSubmit, onClose, isPending, error, isSuccess }) {
  if (!student) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-1">Set Student Fee</h3>
          <p className="text-sm text-gray-500 mb-4">
            Override the class-level fee for <strong>{student.student_name}</strong> ({student.class_name}).
            This will apply from next month's generation onwards.
          </p>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Monthly Fee Amount</label>
              <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="input-field" required />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to set student fee')}</p>}
            {isSuccess && <p className="text-sm text-green-600">Student fee override saved! It will apply on next month's generation.</p>}
          </form>
        </div>
      </div>
    </div>
  )
}

export function CreateSingleFeeModal({ show, onClose, onSubmit, isPending, error, isSuccess, classList, activeSchoolId, academicYearId, accountsList = [] }) {
  const { activeSchool } = useAuth()
  const now = new Date()
  const initialForm = {
    classId: '', student: '', fee_type: 'MONTHLY',
    annualCategoryId: '', monthlyCategoryId: '',
    month: now.getMonth() + 1, year: now.getFullYear(),
    amount_due: '', amount_paid: '0', notes: '',
    account: '', payment_method: 'CASH',
    payment_date: new Date().toISOString().split('T')[0],
  }
  const [form, setForm] = useState(initialForm)
  const { sessionClasses } = useSessionClasses(academicYearId, activeSchool?.id)
  const createSingleClassOptions = useMemo(() => {
    if (!academicYearId) return classList
    if (!sessionClasses?.length) return []
    return buildSessionClassOptions(sessionClasses)
  }, [academicYearId, classList, sessionClasses])
  const resolvedFormClassId = resolveClassIdToMasterClassId(form.classId, academicYearId, sessionClasses)
  const formClassFilterParams = useMemo(() => buildStudentClassFilterParams({
    classId: form.classId,
    activeAcademicYearId: academicYearId,
    sessionClasses,
  }), [form.classId, academicYearId, sessionClasses])

  // Reset form every time modal opens
  useEffect(() => {
    if (show) setForm({ ...initialForm, payment_date: new Date().toISOString().split('T')[0] })
  }, [show])

  // Fetch students for selected class, filtered by academic year
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students-by-class', formClassFilterParams.class_id, formClassFilterParams.session_class_id, formClassFilterParams.academic_year],
    queryFn: () => studentsApi.getStudents({ ...formClassFilterParams, is_active: true, page_size: 9999 }),
    enabled: !!resolvedFormClassId,
    staleTime: 2 * 60_000,
  })
  const studentList = (studentsData?.data?.results || studentsData?.data || [])
    .slice()
    .sort((a, b) => (parseInt(a.roll_number) || 9999) - (parseInt(b.roll_number) || 9999))

  const { data: annualCategoriesData } = useQuery({
    queryKey: ['annual-categories'],
    queryFn: () => financeApi.getAnnualCategories({}),
    staleTime: 5 * 60_000,
  })
  const annualCategories = annualCategoriesData?.data?.results || annualCategoriesData?.data || []

  const { data: monthlyCategoriesData } = useQuery({
    queryKey: ['monthly-categories'],
    queryFn: () => financeApi.getMonthlyCategories({}),
    staleTime: 5 * 60_000,
  })
  const monthlyCategories = monthlyCategoriesData?.data?.results || monthlyCategoriesData?.data || []

  const isMonthly = form.fee_type === 'MONTHLY'
  const selectedCategoryId = isMonthly ? form.monthlyCategoryId : form.annualCategoryId
  const selectedCategories = isMonthly ? monthlyCategories : annualCategories

  // Auto-resolve fee amount from FeeStructure when student + fee_type + category are selected
  const { data: resolvedFee, isFetching: resolvingFee } = useQuery({
    queryKey: ['resolve-fee-amount', form.student, form.fee_type, selectedCategoryId],
    queryFn: () => financeApi.resolveFeeAmount({
      student_id: form.student,
      fee_type: form.fee_type,
      ...(form.fee_type === 'ANNUAL' && form.annualCategoryId && { annual_category: form.annualCategoryId }),
      ...(form.fee_type === 'MONTHLY' && form.monthlyCategoryId && { monthly_category: form.monthlyCategoryId }),
    }),
    enabled: !!form.student && !!form.fee_type && !!selectedCategoryId,
    staleTime: 60_000,
  })

  // Auto-fill amount_due when resolved amount arrives
  useEffect(() => {
    const amt = resolvedFee?.data?.amount
    if (amt != null) setForm(f => ({ ...f, amount_due: amt }))
  }, [resolvedFee])

  // Duplicate check
  const { data: dupCheck } = useQuery({
    queryKey: ['fee-dup-check', form.student, form.fee_type, isMonthly ? form.month : 0, form.year, selectedCategoryId],
    queryFn: () => financeApi.getFeePayments({
      student_id: form.student, fee_type: form.fee_type,
      month: isMonthly ? form.month : 0, year: form.year, page_size: 1,
      ...(form.fee_type === 'ANNUAL' && form.annualCategoryId && { annual_category: form.annualCategoryId }),
      ...(form.fee_type === 'MONTHLY' && form.monthlyCategoryId && { monthly_category: form.monthlyCategoryId }),
    }),
    enabled: !!form.student && !!form.fee_type && !!form.year && !!selectedCategoryId,
    staleTime: 10_000,
  })
  const hasDuplicate = (dupCheck?.data?.results || dupCheck?.data || []).length > 0

  if (!show) return null

  const feeLabel = FEE_TYPE_TABS.find(t => t.value === form.fee_type)?.label || 'Fee'
  const hasPaid = parseFloat(form.amount_paid || 0) > 0
  const feeSource = resolvedFee?.data?.source
  const selectedCategoryName = selectedCategories.find((cat) => String(cat.id) === String(selectedCategoryId))?.name || ''

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({
      school: activeSchoolId,
      student: parseInt(form.student),
      fee_type: form.fee_type,
      month: isMonthly ? parseInt(form.month) : 0,
      year: parseInt(form.year),
      amount_due: parseFloat(form.amount_due),
      amount_paid: parseFloat(form.amount_paid || 0),
      ...(form.fee_type === 'ANNUAL' && form.annualCategoryId && { annual_category: parseInt(form.annualCategoryId) }),
      ...(form.fee_type === 'MONTHLY' && form.monthlyCategoryId && { monthly_category: parseInt(form.monthlyCategoryId) }),
      ...(academicYearId && { academic_year: parseInt(academicYearId) }),
      ...(form.notes && { notes: form.notes }),
      ...(hasPaid && {
        account: parseInt(form.account),
        payment_method: form.payment_method,
        payment_date: form.payment_date,
      }),
    })
  }

  const handleClose = () => {
    setForm(initialForm)
    onClose()
  }

  const studentOptions = studentList.map(s => ({
    value: String(s.id),
    label: `${s.name}${s.roll_number ? ` (Roll #${s.roll_number})` : ''}`,
  }))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Create Fee Record</h3>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Class <span className="text-red-500">*</span></label>
              <ClassSelector
                value={form.classId}
                onChange={(e) => { setForm(f => ({ ...f, classId: e.target.value, student: '', amount_due: '' })) }}
                className="input-field"
                classes={createSingleClassOptions}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Student <span className="text-red-500">*</span></label>
              <SearchableSelect
                options={studentOptions}
                value={form.student}
                onChange={(val) => setForm(f => ({ ...f, student: val, amount_due: '' }))}
                placeholder={!form.classId ? 'Select class first' : 'Search student...'}
                disabled={!form.classId}
                isLoading={studentsLoading}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fee Type <span className="text-red-500">*</span></label>
                <select
                  value={form.fee_type}
                  onChange={(e) => setForm(f => ({
                    ...f,
                    fee_type: e.target.value,
                    annualCategoryId: '',
                    monthlyCategoryId: '',
                    amount_due: '',
                  }))}
                  className="input-field"
                >
                  {FEE_TYPE_TABS.map(ft => (
                    <option key={ft.value} value={ft.value}>{ft.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category <span className="text-red-500">*</span></label>
                <select
                  value={selectedCategoryId}
                  onChange={(e) => setForm(f => ({
                    ...f,
                    amount_due: '',
                    annualCategoryId: f.fee_type === 'ANNUAL' ? e.target.value : '',
                    monthlyCategoryId: f.fee_type === 'MONTHLY' ? e.target.value : '',
                  }))}
                  className="input-field"
                >
                  <option value="">Select category</option>
                  {selectedCategories.map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <select value={form.year} onChange={(e) => setForm(f => ({ ...f, year: e.target.value }))} className="input-field">
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              {isMonthly && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                  <select value={form.month} onChange={(e) => setForm(f => ({ ...f, month: e.target.value }))} className="input-field">
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
              )}
            </div>

            {/* Duplicate warning */}
            {hasDuplicate && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 font-medium">
                  A {feeLabel.toLowerCase()} fee record already exists for this student
                  {selectedCategoryName ? ` for ${selectedCategoryName}` : ''}
                  {isMonthly ? ` in ${MONTHS[form.month - 1]}` : ''} {form.year}.
                </p>
                <p className="text-xs text-amber-600 mt-1">Creating another will fail due to duplicate constraint.</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount Due <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input
                    type="number" step="0.01"
                    value={form.amount_due}
                    onChange={(e) => setForm(f => ({ ...f, amount_due: e.target.value }))}
                    className="input-field" required placeholder="0.00"
                  />
                  {resolvingFee && (
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">...</span>
                  )}
                </div>
                {form.student && !resolvingFee && feeSource && (
                  <p className="text-xs text-gray-500 mt-1">
                    {feeSource === 'student_override' ? 'Student-specific fee' : 'From class fee structure'}
                  </p>
                )}
                {form.student && selectedCategoryId && !resolvingFee && resolvedFee?.data && !resolvedFee.data.amount && (
                  <p className="text-xs text-amber-600 mt-1">No fee structure found for this type and category</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount Paid</label>
                <input
                  type="number" step="0.01"
                  value={form.amount_paid}
                  onChange={(e) => setForm(f => ({ ...f, amount_paid: e.target.value }))}
                  className="input-field" placeholder="0"
                />
              </div>
            </div>

            {/* Payment fields — shown only when amount_paid > 0 */}
            {hasPaid && (
              <div className="space-y-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-xs font-medium text-gray-600 uppercase tracking-wide">Payment Details</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Receiving Account <span className="text-red-500">*</span></label>
                  <select value={form.account} onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))} className="input-field" required>
                    <option value="">-- Select Account --</option>
                    {accountsList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Method</label>
                    <select value={form.payment_method} onChange={(e) => setForm(f => ({ ...f, payment_method: e.target.value }))} className="input-field">
                      {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date <span className="text-red-500">*</span></label>
                    <input type="date" value={form.payment_date} onChange={(e) => setForm(f => ({ ...f, payment_date: e.target.value }))} className="input-field" required />
                  </div>
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                className="input-field" rows={2}
                placeholder={`e.g., ${feeLabel} for new admission`}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={handleClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="submit" disabled={isPending || hasDuplicate || !selectedCategoryId} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                {isPending ? 'Creating...' : 'Create'}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to create fee record')}</p>}
            {isSuccess && <p className="text-sm text-green-600">Fee record created successfully!</p>}
          </form>
        </div>
      </div>
    </div>
  )
}
