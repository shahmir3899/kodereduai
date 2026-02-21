import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MONTHS } from './FeeFilters'
import ClassSelector from '../../components/ClassSelector'
import SearchableSelect from '../../components/SearchableSelect'
import { studentsApi, financeApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'

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

export function GenerateModal({ show, onClose, month, year, classList, mutation, onetimeMutation, academicYearId }) {
  const [confirmed, setConfirmed] = useState(false)
  const [generateFeeType, setGenerateFeeType] = useState('MONTHLY')
  const [onetimeClass, setOnetimeClass] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [showStudentList, setShowStudentList] = useState(false)
  const [modalMonth, setModalMonth] = useState(month)
  const [modalYear, setModalYear] = useState(year)
  const [modalClassFilter, setModalClassFilter] = useState('')

  const isMonthly = generateFeeType === 'MONTHLY'

  // Auto-close modal when task completes (monthly = background task, onetime = regular mutation)
  useEffect(() => {
    if (show && (mutation.isComplete || onetimeMutation?.isSuccess)) {
      const timer = setTimeout(() => handleClose(), 1500)
      return () => clearTimeout(timer)
    }
  }, [show, mutation.isComplete, onetimeMutation?.isSuccess])

  // Reset state when modal opens
  useEffect(() => {
    if (show) {
      setConfirmed(false)
      setGenerateFeeType('MONTHLY')
      setOnetimeClass('')
      setShowConfirm(false)
      setShowStudentList(false)
      setModalMonth(month)
      setModalYear(year)
      setModalClassFilter('')
      mutation.reset?.()
      onetimeMutation?.reset?.()
    }
  }, [show])

  // Preview: dry-run showing what will be created (monthly)
  const { data: monthlyPreview, isFetching: monthlyPreviewLoading } = useQuery({
    queryKey: ['generate-preview', 'MONTHLY', modalClassFilter, modalMonth, modalYear, academicYearId],
    queryFn: () => financeApi.previewGeneration({
      fee_type: 'MONTHLY', year: modalYear, month: modalMonth,
      ...(modalClassFilter && { class_id: modalClassFilter }),
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    enabled: show && isMonthly,
    staleTime: 30_000,
  })

  // Preview: dry-run for non-monthly
  const { data: onetimePreview, isFetching: onetimePreviewLoading } = useQuery({
    queryKey: ['generate-preview', generateFeeType, onetimeClass, modalYear, academicYearId],
    queryFn: () => financeApi.previewGeneration({
      fee_type: generateFeeType, class_id: onetimeClass, year: modalYear, month: 0,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    enabled: show && !isMonthly && !!onetimeClass,
    staleTime: 30_000,
  })

  if (!show) return null

  const feeLabel = FEE_TYPE_TABS.find(t => t.value === generateFeeType)?.label || 'Fee'
  const mPreview = monthlyPreview?.data
  const oPreview = onetimePreview?.data

  const handleClose = () => {
    setConfirmed(false)
    setGenerateFeeType('MONTHLY')
    setOnetimeClass('')
    setShowConfirm(false)
    setShowStudentList(false)
    setModalMonth(month)
    setModalYear(year)
    setModalClassFilter('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-3">Generate Fee Records</h3>

          {/* Fee type tabs */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {FEE_TYPE_TABS.map(ft => (
              <button
                key={ft.value}
                type="button"
                onClick={() => { setGenerateFeeType(ft.value); setShowConfirm(false); setShowStudentList(false) }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  generateFeeType === ft.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {ft.label}
              </button>
            ))}
          </div>

          {/* MONTHLY tab */}
          {isMonthly && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
                  <select value={modalMonth} onChange={(e) => setModalMonth(parseInt(e.target.value))} className="input-field text-sm">
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
                  <select value={modalYear} onChange={(e) => setModalYear(parseInt(e.target.value))} className="input-field text-sm">
                    {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Create monthly fee records for all enrolled students for <strong>{MONTHS[modalMonth - 1]} {modalYear}</strong>.
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Unpaid balances from the previous month will be automatically carried forward.
              </p>

              {/* Live preview */}
              {monthlyPreviewLoading && <p className="text-sm text-gray-400 mb-4">Calculating preview...</p>}
              {mPreview && !monthlyPreviewLoading && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1">
                  <p className="text-sm text-blue-800">
                    <span className="font-medium">{mPreview.will_create}</span> new records will be created
                    {mPreview.will_create > 0 && <> (total: <span className="font-medium">{Number(mPreview.total_amount).toLocaleString()}</span>)</>}
                  </p>
                  {mPreview.already_exist > 0 && (
                    <p className="text-xs text-blue-600">{mPreview.already_exist} already exist (will skip)</p>
                  )}
                  {mPreview.no_fee_structure > 0 && (
                    <p className="text-xs text-amber-600">{mPreview.no_fee_structure} students have no fee structure (will skip)</p>
                  )}
                </div>
              )}

              {mPreview?.already_exist > 0 && (
                <div className="mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
                    <span className="text-sm text-amber-700">I understand existing records won't be overwritten</span>
                  </label>
                </div>
              )}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Filter by Class (optional)</label>
                <ClassSelector
                  value={modalClassFilter}
                  onChange={(e) => setModalClassFilter(e.target.value)}
                  className="input-field"
                  showAllOption
                  classes={classList}
                />
              </div>
              <div className="flex gap-3">
                <button onClick={handleClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                <button
                  onClick={() => {
                    const data = { month: modalMonth, year: modalYear, ...(modalClassFilter && { class_id: parseInt(modalClassFilter) }), ...(academicYearId && { academic_year: academicYearId }) }
                    if (mutation.trigger) mutation.trigger(data)
                    else mutation.mutate(data)
                  }}
                  disabled={(mutation.isSubmitting ?? mutation.isPending) || (mPreview?.already_exist > 0 && !confirmed) || mPreview?.will_create === 0}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                >
                  {(mutation.isSubmitting ?? mutation.isPending) ? 'Starting...' : 'Generate'}
                </button>
              </div>
              {mutation.isSuccess && (
                <div className="mt-3 text-sm text-green-700 bg-green-50 p-3 rounded">
                  Created {mutation.data?.data?.created || mutation.data?.data?.result?.created} records.
                  {(mutation.data?.data?.skipped || mutation.data?.data?.result?.skipped) > 0 && ` Skipped ${mutation.data.data.skipped || mutation.data.data.result?.skipped} (already exist).`}
                  {(mutation.data?.data?.no_fee_structure || mutation.data?.data?.result?.no_fee_structure) > 0 && ` ${mutation.data.data.no_fee_structure || mutation.data.data.result?.no_fee_structure} students have no fee structure.`}
                </div>
              )}
            </>
          )}

          {/* Non-MONTHLY tab */}
          {!isMonthly && !showConfirm && (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Generate <strong>{feeLabel}</strong> fee records for all enrolled students in the selected class for <strong>{modalYear}</strong>.
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Class <span className="text-red-500">*</span></label>
                <ClassSelector
                  value={onetimeClass}
                  onChange={(e) => { setOnetimeClass(e.target.value); setShowStudentList(false) }}
                  className="input-field"
                  classes={classList}
                />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <select value={modalYear} onChange={(e) => setModalYear(parseInt(e.target.value))} className="input-field">
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {/* Live preview for non-monthly */}
              {onetimePreviewLoading && onetimeClass && <p className="text-sm text-gray-400 mb-4">Calculating preview...</p>}
              {oPreview && !onetimePreviewLoading && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1">
                  <p className="text-sm text-blue-800">
                    <span className="font-medium">{oPreview.will_create}</span> new {feeLabel.toLowerCase()} records
                    {oPreview.will_create > 0 && <> (total: <span className="font-medium">{Number(oPreview.total_amount).toLocaleString()}</span>)</>}
                  </p>
                  {oPreview.already_exist > 0 && (
                    <p className="text-xs text-blue-600">{oPreview.already_exist} already exist (will skip)</p>
                  )}
                  {oPreview.no_fee_structure > 0 && (
                    <p className="text-xs text-amber-600">{oPreview.no_fee_structure} students have no fee structure (will skip)</p>
                  )}
                  {oPreview.will_create > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowStudentList(!showStudentList)}
                      className="text-xs text-blue-700 hover:text-blue-900 underline mt-1"
                    >
                      {showStudentList ? 'Hide' : 'Show'} student details{oPreview.has_more ? ` (first 50)` : ''}
                    </button>
                  )}
                </div>
              )}

              {/* Expandable student preview list */}
              {showStudentList && oPreview?.students?.length > 0 && (
                <div className="mb-4 max-h-40 overflow-y-auto border border-gray-200 rounded-lg">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left text-gray-500">Student</th>
                        <th className="px-2 py-1 text-right text-gray-500">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {oPreview.students.map(s => (
                        <tr key={s.student_id}>
                          <td className="px-2 py-1 text-gray-700">{s.student_name}</td>
                          <td className="px-2 py-1 text-right text-gray-900">{Number(s.amount).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={handleClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={!onetimeClass || !oPreview || oPreview.will_create === 0}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                >
                  Review & Generate
                </button>
              </div>
            </>
          )}

          {/* Non-MONTHLY confirmation step */}
          {!isMonthly && showConfirm && (
            <>
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2 mb-4">
                <p className="text-sm font-medium text-blue-900">Please confirm {feeLabel.toLowerCase()} fee generation:</p>
                <div className="text-sm text-blue-800 space-y-1">
                  <p><span className="font-medium">Class:</span> {classList.find(c => String(c.id) === String(onetimeClass))?.name}</p>
                  <p><span className="font-medium">Fee Type:</span> {feeLabel}</p>
                  <p><span className="font-medium">Year:</span> {modalYear}</p>
                  <p><span className="font-medium">Records:</span> {oPreview?.will_create} new</p>
                  <p><span className="font-medium">Total Amount:</span> {Number(oPreview?.total_amount || 0).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
                <button
                  onClick={() => {
                    onetimeMutation.mutate({
                      student_ids: oPreview.students.map(s => s.student_id),
                      fee_types: [generateFeeType],
                      year: modalYear,
                      month: 0,
                      ...(academicYearId && { academic_year: academicYearId }),
                    })
                  }}
                  disabled={onetimeMutation?.isPending}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                >
                  {onetimeMutation?.isPending ? 'Generating...' : 'Confirm & Generate'}
                </button>
              </div>
              {onetimeMutation?.isSuccess && (
                <div className="mt-3 text-sm text-green-700 bg-green-50 p-3 rounded">
                  Created {onetimeMutation.data?.data?.created} records.
                  {onetimeMutation.data?.data?.skipped > 0 && ` Skipped ${onetimeMutation.data.data.skipped} (already exist).`}
                </div>
              )}
              {onetimeMutation?.isError && (
                <p className="mt-3 text-sm text-red-600">{getErrorMessage(onetimeMutation.error, 'Failed to generate fees')}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const FEE_TYPE_TABS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'ADMISSION', label: 'Admission' },
  { value: 'BOOKS', label: 'Books' },
  { value: 'FINE', label: 'Fine' },
]

const FEE_TYPE_DESCRIPTIONS = {
  MONTHLY: 'Set the monthly recurring fee for each class.',
  ANNUAL: 'Set the annual fee for each class (charged once per year).',
  ADMISSION: 'Set the one-time admission fee for each class.',
  BOOKS: 'Set the books/materials fee for each class.',
  FINE: 'Set a default fine amount for each class.',
}

export function FeeStructureModal({ show, onClose, classList, bulkEffectiveFrom, setBulkEffectiveFrom, onSubmit, mutation, feeTypeFilter, academicYearId, studentFeeMutation }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [structureFeeType, setStructureFeeType] = useState(feeTypeFilter || 'MONTHLY')
  const [feesByType, setFeesByType] = useState({
    MONTHLY: {}, ANNUAL: {}, ADMISSION: {}, BOOKS: {}, FINE: {},
  })

  // "By Class" vs "By Student" mode
  const [structureMode, setStructureMode] = useState('class')
  const [studentClassId, setStudentClassId] = useState('')
  const [studentFees, setStudentFees] = useState([])
  const [studentShowConfirm, setStudentShowConfirm] = useState(false)
  // Track local edits per fee type so switching tabs preserves unsaved changes
  const [localEdits, setLocalEdits] = useState({})

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
    const grouped = { MONTHLY: {}, ANNUAL: {}, ADMISSION: {}, BOOKS: {}, FINE: {} }
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
    queryKey: ['students-for-fee-struct', studentClassId, academicYearId],
    queryFn: () => studentsApi.getStudents({
      class_id: studentClassId, is_active: true, page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    enabled: show && structureMode === 'student' && !!studentClassId,
    staleTime: 2 * 60_000,
  })

  const { data: classFeeStructures, isLoading: structuresLoading } = useQuery({
    queryKey: ['feeStructures-class', studentClassId, structureFeeType, academicYearId],
    queryFn: () => financeApi.getFeeStructures({
      class_id: studentClassId, fee_type: structureFeeType, page_size: 9999,
      ...(academicYearId && { academic_year: academicYearId }),
    }),
    enabled: show && structureMode === 'student' && !!studentClassId,
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
  const feesWithValues = classList.filter(c => currentFees[c.id] && Number(currentFees[c.id]) > 0)
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
      class_id: parseInt(studentClassId),
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
                          <span className="font-medium">{c.name}{c.section ? ` - ${c.section}` : ''}:</span> {Number(currentFees[c.id]).toLocaleString()} ({feeLabel})
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
                      {classList.map(c => (
                        <tr key={c.id}>
                          <td className="px-3 py-2 text-sm text-gray-900">{c.name}{c.section ? ` - ${c.section}` : ''}</td>
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
                  classes={classList}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="p-6">
          <h3 className="text-lg font-semibold mb-4">Add Other Income</h3>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <select value={form.category} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} className="input-field">
                <option value="">-- Select Category --</option>
                {incomeCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="New category name..."
                  className="input-field text-sm flex-1"
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (newCategoryName.trim()) addCategoryMutation.mutate({ name: newCategoryName.trim() }) } }}
                />
                <button
                  type="button"
                  onClick={() => { if (newCategoryName.trim()) addCategoryMutation.mutate({ name: newCategoryName.trim() }) }}
                  disabled={!newCategoryName.trim() || addCategoryMutation.isPending}
                  className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                >
                  + Add
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
              <input type="number" step="0.01" value={form.amount} onChange={(e) => setForm(f => ({ ...f, amount: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account <span className="text-red-500">*</span></label>
              <select value={form.account} onChange={(e) => setForm(f => ({ ...f, account: e.target.value }))} className="input-field" required>
                <option value="">-- Select Account --</option>
                {accountsList.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={form.date} onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))} className="input-field" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
              <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className="input-field" rows={2} placeholder="e.g., Sold 50 copies" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="submit" disabled={isPending} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
                {isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
            {error && <p className="text-sm text-red-600">{getErrorMessage(error, 'Failed to save income')}</p>}
          </form>
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

export function DeleteConfirmModal({ show, message, onConfirm, onCancel, isPending }) {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        <h3 className="text-lg font-semibold mb-2 text-red-700">Confirm Delete</h3>
        <p className="text-sm text-gray-600 mb-4">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
          <button onClick={onConfirm} disabled={isPending} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-50 text-sm disabled:opacity-50">
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CreateSingleFeeModal({ show, onClose, onSubmit, isPending, error, isSuccess, classList, activeSchoolId, academicYearId, accountsList = [] }) {
  const now = new Date()
  const initialForm = {
    classId: '', student: '', fee_type: 'MONTHLY',
    month: now.getMonth() + 1, year: now.getFullYear(),
    amount_due: '', amount_paid: '0', notes: '',
    account: '', payment_method: 'CASH',
    payment_date: new Date().toISOString().split('T')[0],
  }
  const [form, setForm] = useState(initialForm)

  // Reset form every time modal opens
  useEffect(() => {
    if (show) setForm({ ...initialForm, payment_date: new Date().toISOString().split('T')[0] })
  }, [show])

  // Fetch students for selected class, filtered by academic year
  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students-by-class', form.classId, academicYearId],
    queryFn: () => studentsApi.getStudents({ class_id: form.classId, is_active: true, page_size: 9999, ...(academicYearId && { academic_year: academicYearId }) }),
    enabled: !!form.classId,
    staleTime: 2 * 60_000,
  })
  const studentList = (studentsData?.data?.results || studentsData?.data || [])
    .slice()
    .sort((a, b) => (parseInt(a.roll_number) || 9999) - (parseInt(b.roll_number) || 9999))

  // Auto-resolve fee amount from FeeStructure when student + fee_type are selected
  const { data: resolvedFee, isFetching: resolvingFee } = useQuery({
    queryKey: ['resolve-fee-amount', form.student, form.fee_type],
    queryFn: () => financeApi.resolveFeeAmount({ student_id: form.student, fee_type: form.fee_type }),
    enabled: !!form.student && !!form.fee_type,
    staleTime: 60_000,
  })

  // Auto-fill amount_due when resolved amount arrives
  useEffect(() => {
    const amt = resolvedFee?.data?.amount
    if (amt != null) setForm(f => ({ ...f, amount_due: amt }))
  }, [resolvedFee])

  // Duplicate check
  const isMonthly = form.fee_type === 'MONTHLY'
  const { data: dupCheck } = useQuery({
    queryKey: ['fee-dup-check', form.student, form.fee_type, isMonthly ? form.month : 0, form.year],
    queryFn: () => financeApi.getFeePayments({
      student_id: form.student, fee_type: form.fee_type,
      month: isMonthly ? form.month : 0, year: form.year, page_size: 1,
    }),
    enabled: !!form.student && !!form.fee_type && !!form.year,
    staleTime: 10_000,
  })
  const hasDuplicate = (dupCheck?.data?.results || dupCheck?.data || []).length > 0

  if (!show) return null

  const feeLabel = FEE_TYPE_TABS.find(t => t.value === form.fee_type)?.label || 'Fee'
  const hasPaid = parseFloat(form.amount_paid || 0) > 0
  const feeSource = resolvedFee?.data?.source

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
                classes={classList}
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Fee Type</label>
                <select
                  value={form.fee_type}
                  onChange={(e) => setForm(f => ({ ...f, fee_type: e.target.value, amount_due: '' }))}
                  className="input-field"
                >
                  {FEE_TYPE_TABS.map(ft => (
                    <option key={ft.value} value={ft.value}>{ft.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <select value={form.year} onChange={(e) => setForm(f => ({ ...f, year: e.target.value }))} className="input-field">
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
            </div>
            {isMonthly && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                <select value={form.month} onChange={(e) => setForm(f => ({ ...f, month: e.target.value }))} className="input-field">
                  {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
            )}

            {/* Duplicate warning */}
            {hasDuplicate && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-sm text-amber-800 font-medium">
                  A {feeLabel.toLowerCase()} fee record already exists for this student
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
                {form.student && !resolvingFee && resolvedFee?.data && !resolvedFee.data.amount && (
                  <p className="text-xs text-amber-600 mt-1">No fee structure found for this fee type</p>
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
              <button type="submit" disabled={isPending || hasDuplicate} className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50">
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
