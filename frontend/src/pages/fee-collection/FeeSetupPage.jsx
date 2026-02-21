import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useFeeSetup } from './useFeeSetup'
import { MONTHS } from './FeeFilters'
import ClassSelector from '../../components/ClassSelector'
import { financeApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'

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

export default function FeeSetupPage() {
  const { activeAcademicYear } = useAcademicYear()
  const now = new Date()

  // Tab state
  const [activeTab, setActiveTab] = useState('structures')
  const [feeType, setFeeType] = useState('MONTHLY')
  const [structureMode, setStructureMode] = useState('class')
  const [studentClassId, setStudentClassId] = useState('')

  // Generate state
  const [generateFeeType, setGenerateFeeType] = useState('MONTHLY')
  const [genMonth, setGenMonth] = useState(now.getMonth() + 1)
  const [genYear, setGenYear] = useState(now.getFullYear())
  const [genClassFilter, setGenClassFilter] = useState('')
  const [onetimeClass, setOnetimeClass] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [showGenConfirm, setShowGenConfirm] = useState(false)
  const [showStudentList, setShowStudentList] = useState(false)

  // Fee structure state
  const [feesByType, setFeesByType] = useState({ MONTHLY: {}, ANNUAL: {}, ADMISSION: {}, BOOKS: {}, FINE: {} })
  const [showConfirm, setShowConfirm] = useState(false)
  const [studentFees, setStudentFees] = useState([])
  const [studentShowConfirm, setStudentShowConfirm] = useState(false)
  const [localEdits, setLocalEdits] = useState({})

  const data = useFeeSetup({
    academicYearId: activeAcademicYear?.id,
    feeType,
    studentClassId,
    structureMode,
    month: genMonth,
    year: genYear,
  })

  // Populate per-type fees when structures load
  useEffect(() => {
    if (data.allStructuresList.length > 0) {
      const grouped = { MONTHLY: {}, ANNUAL: {}, ADMISSION: {}, BOOKS: {}, FINE: {} }
      data.allStructuresList.forEach(fs => {
        if (fs.class_obj && !fs.student && fs.is_active) {
          const ft = fs.fee_type || 'MONTHLY'
          if (grouped[ft]) grouped[ft][fs.class_obj] = String(fs.monthly_amount)
        }
      })
      setFeesByType(grouped)
    }
  }, [data.allStructuresList])

  // Build student fee grid
  useEffect(() => {
    if (structureMode !== 'student' || !studentClassId) return
    if (data.classStudents.length === 0) { setStudentFees([]); return }

    const classDefault = data.classStructures.find(fs => fs.class_obj && !fs.student && fs.is_active)
    const defaultAmount = classDefault ? String(classDefault.monthly_amount) : ''
    const overrideMap = {}
    data.classStructures.forEach(fs => {
      if (fs.student && fs.is_active) overrideMap[fs.student] = String(fs.monthly_amount)
    })
    const edits = localEdits[feeType] || {}
    const grid = data.classStudents
      .slice()
      .sort((a, b) => (parseInt(a.roll_number) || 9999) - (parseInt(b.roll_number) || 9999))
      .map(s => {
        const localEdit = edits[s.id]
        const serverAmount = overrideMap[s.id] || defaultAmount
        const amount = localEdit !== undefined ? localEdit : serverAmount
        return {
          student_id: s.id, student_name: s.name,
          roll_number: s.roll_number || '', amount,
          isOverride: amount !== defaultAmount, classDefault: defaultAmount,
        }
      })
    setStudentFees(grid)
  }, [data.classStudents, data.classStructures, structureMode, studentClassId, feeType, localEdits])

  // Generate preview queries
  const isGenMonthly = generateFeeType === 'MONTHLY'
  const { data: monthlyPreview, isFetching: monthlyPreviewLoading } = useQuery({
    queryKey: ['generate-preview', 'MONTHLY', genClassFilter, genMonth, genYear, activeAcademicYear?.id],
    queryFn: () => financeApi.previewGeneration({
      fee_type: 'MONTHLY', year: genYear, month: genMonth,
      ...(genClassFilter && { class_id: genClassFilter }),
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: activeTab === 'generate' && isGenMonthly,
    staleTime: 30_000,
  })

  const { data: onetimePreview, isFetching: onetimePreviewLoading } = useQuery({
    queryKey: ['generate-preview', generateFeeType, onetimeClass, genYear, activeAcademicYear?.id],
    queryFn: () => financeApi.previewGeneration({
      fee_type: generateFeeType, class_id: onetimeClass, year: genYear, month: 0,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: activeTab === 'generate' && !isGenMonthly && !!onetimeClass,
    staleTime: 30_000,
  })

  const mPreview = monthlyPreview?.data
  const oPreview = onetimePreview?.data
  const feeLabel = FEE_TYPE_TABS.find(t => t.value === feeType)?.label || 'Monthly'
  const genFeeLabel = FEE_TYPE_TABS.find(t => t.value === generateFeeType)?.label || 'Fee'

  // Fee structure handlers
  const currentFees = feesByType[feeType] || {}
  const feesWithValues = data.classList.filter(c => currentFees[c.id] && Number(currentFees[c.id]) > 0)
  const overrideCount = studentFees.filter(s => s.isOverride).length

  const handleFeeChange = (classId, value) => {
    setFeesByType(prev => ({
      ...prev, [feeType]: { ...prev[feeType], [classId]: value },
    }))
  }

  const handleStudentFeeChange = (idx, value) => {
    const s = studentFees[idx]
    if (!s) return
    setLocalEdits(prev => ({
      ...prev, [feeType]: { ...(prev[feeType] || {}), [s.student_id]: value },
    }))
  }

  const handleClassSubmit = (e) => {
    e.preventDefault()
    const structures = Object.entries(currentFees)
      .filter(([_, amount]) => amount && parseFloat(amount) > 0)
      .map(([classId, amount]) => ({ class_obj: parseInt(classId), monthly_amount: amount, fee_type: feeType }))
    if (structures.length === 0) return
    data.bulkFeeMutation.mutate({ structures, effective_from: data.bulkEffectiveFrom }, {
      onSuccess: () => setShowConfirm(false),
    })
  }

  const handleStudentFeeSave = () => {
    const toSend = studentFees
      .filter(s => s.amount !== '')
      .map(s => ({ student_id: s.student_id, monthly_amount: s.amount }))
    if (toSend.length === 0) return
    data.bulkStudentFeeMutation.mutate({
      class_id: parseInt(studentClassId), fee_type: feeType,
      effective_from: data.bulkEffectiveFrom, students: toSend,
    }, {
      onSuccess: () => {
        setLocalEdits(prev => { const next = { ...prev }; delete next[feeType]; return next })
        setStudentShowConfirm(false)
      },
    })
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Fee Setup</h1>
        <p className="text-sm text-gray-600">Configure fee structures and generate fee records</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setActiveTab('structures')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'structures' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Fee Structures
        </button>
        <button
          onClick={() => setActiveTab('generate')}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'generate' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Generate Records
        </button>
      </div>

      {/* === FEE STRUCTURES TAB === */}
      {activeTab === 'structures' && (
        <div className="card">
          {/* Mode + Fee type controls */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="flex gap-2">
              <button type="button" onClick={() => { setStructureMode('class'); setStudentShowConfirm(false) }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${structureMode === 'class' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >By Class</button>
              <button type="button" onClick={() => { setStructureMode('student'); setShowConfirm(false) }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${structureMode === 'student' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >By Student</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FEE_TYPE_TABS.map(ft => (
                <button key={ft.value} type="button"
                  onClick={() => { setFeeType(ft.value); setStudentShowConfirm(false); setShowConfirm(false) }}
                  className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                    feeType === ft.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >{ft.label}</button>
              ))}
            </div>
          </div>

          {/* BY CLASS MODE */}
          {structureMode === 'class' && (
            <>
              <p className="text-sm text-gray-600 mb-4">{FEE_TYPE_DESCRIPTIONS[feeType]}</p>
              {!showConfirm && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Effective From</label>
                  <input type="date" value={data.bulkEffectiveFrom} onChange={(e) => data.setBulkEffectiveFrom(e.target.value)} className="input-field w-48" />
                </div>
              )}

              {showConfirm ? (
                <>
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                    <p className="text-sm font-medium text-blue-900 mb-2">Please confirm fee structure changes:</p>
                    <p className="text-xs text-blue-700 mb-3">Effective from: {data.bulkEffectiveFrom}</p>
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
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setShowConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
                    <button onClick={handleClassSubmit} disabled={data.bulkFeeMutation.isPending || feesWithValues.length === 0}
                      className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                    >{data.bulkFeeMutation.isPending ? 'Saving...' : 'Confirm & Save'}</button>
                  </div>
                  {data.bulkFeeMutation.isError && <p className="mt-3 text-sm text-red-600">{getErrorMessage(data.bulkFeeMutation.error, 'Failed to save fee structures')}</p>}
                  {data.bulkFeeMutation.isSuccess && <p className="mt-3 text-sm text-green-600">Fee structures saved for {data.bulkFeeMutation.data?.data?.created} classes!</p>}
                </>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); setShowConfirm(true) }}>
                  <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                          <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">{feeLabel} Fee</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {data.classList.map(c => (
                          <tr key={c.id}>
                            <td className="px-3 py-2 text-sm text-gray-900">{c.name}{c.section ? ` - ${c.section}` : ''}</td>
                            <td className="px-3 py-2">
                              <input type="number" step="0.01" placeholder="0.00"
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
                  <div className="flex gap-3 mt-4">
                    <button type="submit" className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
                      Review Changes
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {/* BY STUDENT MODE */}
          {structureMode === 'student' && (
            <>
              <div className="flex flex-wrap items-end gap-3 mb-4 pb-3 border-b border-gray-100">
                <div className="flex-1 min-w-[140px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Class <span className="text-red-500">*</span></label>
                  <ClassSelector
                    value={studentClassId}
                    onChange={(e) => { setStudentClassId(e.target.value); setStudentFees([]); setStudentShowConfirm(false); setLocalEdits({}); data.bulkStudentFeeMutation?.reset?.() }}
                    className="input-field text-sm"
                    classes={data.classList}
                  />
                </div>
                <div className="min-w-[140px]">
                  <label className="block text-xs font-medium text-gray-500 mb-1">Effective From</label>
                  <input type="date" value={data.bulkEffectiveFrom} onChange={(e) => data.setBulkEffectiveFrom(e.target.value)} className="input-field text-sm" />
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
              ) : data.studentsLoading || data.structuresLoading ? (
                <div className="text-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
                </div>
              ) : studentShowConfirm ? (
                <>
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                    <p className="text-sm font-medium text-blue-900 mb-2">Confirm fee structures for {studentFees.filter(s => s.amount !== '').length} students:</p>
                    <p className="text-xs text-blue-700 mb-3">Fee type: {feeLabel} | Effective from: {data.bulkEffectiveFrom}</p>
                    <div className="space-y-1 max-h-60 overflow-y-auto">
                      {studentFees.filter(s => s.amount !== '').map(s => (
                        <p key={s.student_id} className="text-sm text-blue-800">
                          <span className="font-medium">{s.student_name}</span>
                          {s.roll_number && <span className="text-blue-600"> (#{s.roll_number})</span>}: {Number(s.amount).toLocaleString()}
                        </p>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStudentShowConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
                    <button onClick={handleStudentFeeSave} disabled={data.bulkStudentFeeMutation?.isPending}
                      className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                    >{data.bulkStudentFeeMutation?.isPending ? 'Saving...' : 'Confirm & Save'}</button>
                  </div>
                  {data.bulkStudentFeeMutation?.isError && <p className="mt-3 text-sm text-red-600">{getErrorMessage(data.bulkStudentFeeMutation.error, 'Failed to save student fees')}</p>}
                  {data.bulkStudentFeeMutation?.isSuccess && <p className="mt-3 text-sm text-green-600">Student fees saved! {data.bulkStudentFeeMutation.data?.data?.created} fee structure(s) set.</p>}
                </>
              ) : (
                <>
                  {studentFees.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 text-sm">No enrolled students found in this class</div>
                  ) : (
                    <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
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
                                <input type="number" step="0.01" placeholder="0.00"
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
                  <div className="flex gap-3 mt-4">
                    <button type="button" onClick={() => setStudentShowConfirm(true)}
                      disabled={studentFees.length === 0 || studentFees.every(s => s.amount === '')}
                      className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                    >Review & Save</button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* === GENERATE RECORDS TAB === */}
      {activeTab === 'generate' && (
        <div className="card">
          {/* Fee type tabs */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {FEE_TYPE_TABS.map(ft => (
              <button key={ft.value} type="button"
                onClick={() => { setGenerateFeeType(ft.value); setShowGenConfirm(false); setShowStudentList(false); setConfirmed(false) }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
                  generateFeeType === ft.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >{ft.label}</button>
            ))}
          </div>

          {/* MONTHLY generation */}
          {isGenMonthly && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Month</label>
                  <select value={genMonth} onChange={(e) => setGenMonth(parseInt(e.target.value))} className="input-field text-sm">
                    {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Year</label>
                  <select value={genYear} onChange={(e) => setGenYear(parseInt(e.target.value))} className="input-field text-sm">
                    {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Create monthly fee records for all enrolled students for <strong>{MONTHS[genMonth - 1]} {genYear}</strong>.
              </p>
              <p className="text-sm text-gray-500 mb-4">
                Unpaid balances from the previous month will be automatically carried forward.
              </p>

              {monthlyPreviewLoading && <p className="text-sm text-gray-400 mb-4">Calculating preview...</p>}
              {mPreview && !monthlyPreviewLoading && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1">
                  <p className="text-sm text-blue-800">
                    <span className="font-medium">{mPreview.will_create}</span> new records will be created
                    {mPreview.will_create > 0 && <> (total: <span className="font-medium">{Number(mPreview.total_amount).toLocaleString()}</span>)</>}
                  </p>
                  {mPreview.already_exist > 0 && <p className="text-xs text-blue-600">{mPreview.already_exist} already exist (will skip)</p>}
                  {mPreview.no_fee_structure > 0 && <p className="text-xs text-amber-600">{mPreview.no_fee_structure} students have no fee structure (will skip)</p>}
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
                <ClassSelector value={genClassFilter} onChange={(e) => setGenClassFilter(e.target.value)} className="input-field" showAllOption classes={data.classList} />
              </div>

              <button
                onClick={() => {
                  const payload = { month: genMonth, year: genYear, ...(genClassFilter && { class_id: parseInt(genClassFilter) }), ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }) }
                  if (data.generateMutation.trigger) data.generateMutation.trigger(payload)
                  else data.generateMutation.mutate(payload)
                }}
                disabled={(data.generateMutation.isSubmitting ?? data.generateMutation.isPending) || (mPreview?.already_exist > 0 && !confirmed) || mPreview?.will_create === 0}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
              >
                {(data.generateMutation.isSubmitting ?? data.generateMutation.isPending) ? 'Starting...' : 'Generate Monthly Fees'}
              </button>
              {data.generateMutation.isSuccess && (
                <div className="mt-3 text-sm text-green-700 bg-green-50 p-3 rounded">
                  Created {data.generateMutation.data?.data?.created || data.generateMutation.data?.data?.result?.created} records.
                  {(data.generateMutation.data?.data?.skipped || data.generateMutation.data?.data?.result?.skipped) > 0 && ` Skipped ${data.generateMutation.data.data.skipped || data.generateMutation.data.data.result?.skipped} (already exist).`}
                </div>
              )}
            </>
          )}

          {/* Non-MONTHLY generation */}
          {!isGenMonthly && !showGenConfirm && (
            <>
              <p className="text-sm text-gray-600 mb-4">
                Generate <strong>{genFeeLabel}</strong> fee records for all enrolled students in the selected class for <strong>{genYear}</strong>.
              </p>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Class <span className="text-red-500">*</span></label>
                <ClassSelector value={onetimeClass} onChange={(e) => { setOnetimeClass(e.target.value); setShowStudentList(false) }} className="input-field" classes={data.classList} />
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <select value={genYear} onChange={(e) => setGenYear(parseInt(e.target.value))} className="input-field">
                  {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {onetimePreviewLoading && onetimeClass && <p className="text-sm text-gray-400 mb-4">Calculating preview...</p>}
              {oPreview && !onetimePreviewLoading && (
                <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1">
                  <p className="text-sm text-blue-800">
                    <span className="font-medium">{oPreview.will_create}</span> new {genFeeLabel.toLowerCase()} records
                    {oPreview.will_create > 0 && <> (total: <span className="font-medium">{Number(oPreview.total_amount).toLocaleString()}</span>)</>}
                  </p>
                  {oPreview.already_exist > 0 && <p className="text-xs text-blue-600">{oPreview.already_exist} already exist (will skip)</p>}
                  {oPreview.no_fee_structure > 0 && <p className="text-xs text-amber-600">{oPreview.no_fee_structure} students have no fee structure (will skip)</p>}
                  {oPreview.will_create > 0 && (
                    <button type="button" onClick={() => setShowStudentList(!showStudentList)} className="text-xs text-blue-700 hover:text-blue-900 underline mt-1">
                      {showStudentList ? 'Hide' : 'Show'} student details{oPreview.has_more ? ' (first 50)' : ''}
                    </button>
                  )}
                </div>
              )}

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

              <button onClick={() => setShowGenConfirm(true)} disabled={!onetimeClass || !oPreview || oPreview.will_create === 0}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
              >Review & Generate</button>
            </>
          )}

          {/* Non-MONTHLY confirmation step */}
          {!isGenMonthly && showGenConfirm && (
            <>
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2 mb-4">
                <p className="text-sm font-medium text-blue-900">Please confirm {genFeeLabel.toLowerCase()} fee generation:</p>
                <div className="text-sm text-blue-800 space-y-1">
                  <p><span className="font-medium">Class:</span> {data.classList.find(c => String(c.id) === String(onetimeClass))?.name}</p>
                  <p><span className="font-medium">Fee Type:</span> {genFeeLabel}</p>
                  <p><span className="font-medium">Year:</span> {genYear}</p>
                  <p><span className="font-medium">Records:</span> {oPreview?.will_create} new</p>
                  <p><span className="font-medium">Total Amount:</span> {Number(oPreview?.total_amount || 0).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowGenConfirm(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Back</button>
                <button
                  onClick={() => {
                    data.generateOnetimeMutation.mutate({
                      student_ids: oPreview.students.map(s => s.student_id),
                      fee_types: [generateFeeType], year: genYear, month: 0,
                      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
                    })
                  }}
                  disabled={data.generateOnetimeMutation?.isPending}
                  className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
                >{data.generateOnetimeMutation?.isPending ? 'Generating...' : 'Confirm & Generate'}</button>
              </div>
              {data.generateOnetimeMutation?.isSuccess && (
                <div className="mt-3 text-sm text-green-700 bg-green-50 p-3 rounded">
                  Created {data.generateOnetimeMutation.data?.data?.created} records.
                  {data.generateOnetimeMutation.data?.data?.skipped > 0 && ` Skipped ${data.generateOnetimeMutation.data.data.skipped} (already exist).`}
                </div>
              )}
              {data.generateOnetimeMutation?.isError && (
                <p className="mt-3 text-sm text-red-600">{getErrorMessage(data.generateOnetimeMutation.error, 'Failed to generate fees')}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
