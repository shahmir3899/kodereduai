import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi, studentsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import AnnualChargesGrid from './AnnualChargesGrid'
import CategoryManagerModal from './CategoryManagerModal'

/**
 * AnnualChargesTab — configure annual fee structures per class and generate annual fee records.
 *
 * Flow:
 *  1. Pick a class.
 *  2. Define annual charge rows (category + amount) using the grid.
 *  3. Save — creates/updates class-level ANNUAL FeeStructure records.
 *  4. Generate — creates FeePayment records for all enrolled students.
 */
export default function AnnualChargesTab() {
  const { activeAcademicYear } = useAcademicYear()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const now = new Date()
  const [selectedClassId, setSelectedClassId] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(now.toISOString().split('T')[0])
  const [genYear, setGenYear] = useState(now.getFullYear())
  const [rows, setRows] = useState([]) // { category_id, annual_category_name, amount }
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showGenConfirm, setShowGenConfirm] = useState(false)
  const [genPreview, setGenPreview] = useState(null)
  const [genLoading, setGenLoading] = useState(false)

  // Fetch classes
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })
  const classList = classesData?.data?.results ?? classesData?.data ?? []

  // Fetch annual categories for this school
  const { data: catData, isLoading: catsLoading } = useQuery({
    queryKey: ['annual-categories'],
    queryFn: () => financeApi.getAnnualCategories(),
  })
  const categories = catData?.data?.results ?? catData?.data ?? []

  // Fetch existing annual fee structures for selected class
  const { data: existingData } = useQuery({
    queryKey: ['annual-fee-structures', selectedClassId, activeAcademicYear?.id],
    queryFn: () => financeApi.getFeeStructures({
      class_id: selectedClassId,
      fee_type: 'ANNUAL',
      page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!selectedClassId,
    staleTime: 60_000,
  })

  // Pre-fill grid when existing structures load
  useEffect(() => {
    if (!selectedClassId) return
    const existing = existingData?.data?.results ?? existingData?.data ?? []
    const prefilled = existing
      .filter((s) => s.annual_category)
      .map((s) => ({
        category_id: String(s.annual_category),
        annual_category_name: s.annual_category_name || '',
        amount: String(s.monthly_amount),
        _structureId: s.id,
      }))
    if (prefilled.length > 0) {
      setRows(prefilled)
    } else {
      setRows([{ category_id: '', annual_category_name: '', amount: '' }])
    }
  }, [existingData, selectedClassId])

  // Save annual structures mutation
  const saveMutation = useMutation({
    mutationFn: (payload) => financeApi.bulkSetFeeStructures(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annual-fee-structures'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures'] })
      showToast('Annual charges saved', 'success')
    },
    onError: (err) => showToast(getErrorMessage(err, 'Failed to save annual charges'), 'error'),
  })

  // Generate annual fee records mutation
  const generateMutation = useMutation({
    mutationFn: (payload) => financeApi.generateOnetimeFees(payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['feePayments'] })
      setShowGenConfirm(false)
      setGenPreview(null)
      const d = res?.data
      showToast(
        `Generated ${d?.created ?? 0} annual fee record(s). ${d?.skipped ? `${d.skipped} skipped.` : ''}`,
        'success',
      )
    },
    onError: (err) => showToast(getErrorMessage(err, 'Failed to generate annual fees'), 'error'),
  })

  function handleAddRow() {
    setRows((prev) => [...prev, { category_id: '', annual_category_name: '', amount: '' }])
  }

  function handleSave() {
    const validRows = rows.filter((r) => r.category_id && r.amount !== '' && parseFloat(r.amount) > 0)
    if (!selectedClassId) {
      showToast('Please select a class first', 'error')
      return
    }
    if (validRows.length === 0) {
      showToast('Add at least one charge with a category and amount', 'error')
      return
    }

    const structures = validRows.map((r) => ({
      class_obj: parseInt(selectedClassId),
      fee_type: 'ANNUAL',
      annual_category: parseInt(r.category_id),
      monthly_amount: parseFloat(r.amount),
    }))

    saveMutation.mutate({ structures, effective_from: effectiveFrom })
  }

  async function handlePreviewGenerate() {
    if (!selectedClassId) {
      showToast('Please select a class first', 'error')
      return
    }
    setGenLoading(true)
    try {
      const res = await financeApi.previewGeneration({
        fee_type: 'ANNUAL',
        class_id: selectedClassId,
        year: genYear,
        month: 0,
        ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
      })
      setGenPreview(res?.data)
      setShowGenConfirm(true)
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to preview'), 'error')
    } finally {
      setGenLoading(false)
    }
  }

  async function handleGenerate() {
    if (!selectedClassId) return

    // Get student ids from the class
    const studentsRes = await studentsApi.getStudents({
      class_id: selectedClassId, is_active: true, page_size: 9999,
    })
    const students = studentsRes?.data?.results ?? studentsRes?.data ?? []
    const studentIds = students.map((s) => s.id)

    if (studentIds.length === 0) {
      showToast('No active students in this class', 'error')
      return
    }

    generateMutation.mutate({
      student_ids: studentIds,
      fee_types: ['ANNUAL'],
      year: genYear,
      month: 0,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    })
  }

  const validRows = rows.filter((r) => r.category_id && parseFloat(r.amount) > 0)
  const total = validRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
  const selectedClass = classList.find((c) => String(c.id) === String(selectedClassId))

  return (
    <div className="space-y-6">
      {/* Category Manager Modal */}
      {showCategoryModal && (
        <CategoryManagerModal onClose={() => setShowCategoryModal(false)} />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-gray-900">Annual Charges Configuration</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Define yearly charge categories and amounts per class. Each school can customise its own categories.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCategoryModal(true)}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2 whitespace-nowrap"
        >
          ⚙ Manage Categories
        </button>
      </div>

      {/* Class selector + Effective From */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
          <select
            value={selectedClassId}
            onChange={(e) => { setSelectedClassId(e.target.value); setRows([{ category_id: '', annual_category_name: '', amount: '' }]) }}
            className="input-field w-full"
          >
            <option value="">— Select class —</option>
            {classList.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}{c.section ? ` - ${c.section}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Effective From</label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="input-field w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Academic Year</label>
          <input
            type="number"
            value={genYear}
            onChange={(e) => setGenYear(parseInt(e.target.value))}
            className="input-field w-full"
            min={2020}
            max={2050}
          />
        </div>
      </div>

      {/* Grid */}
      {catsLoading ? (
        <p className="text-sm text-gray-400">Loading categories…</p>
      ) : categories.length === 0 ? (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-center">
          <p className="text-sm text-amber-800 font-medium mb-2">No annual categories defined yet.</p>
          <p className="text-xs text-amber-700 mb-3">Click "Manage Categories" to add categories for your school.</p>
          <button
            type="button"
            onClick={() => setShowCategoryModal(true)}
            className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700"
          >
            + Add Categories
          </button>
        </div>
      ) : (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            Annual Charges
            {selectedClass && <span className="text-gray-400 font-normal"> — {selectedClass.name}{selectedClass.section ? ` - ${selectedClass.section}` : ''}</span>}
          </h3>
          <AnnualChargesGrid
            categories={categories}
            rows={rows}
            onChange={setRows}
            onAddRow={handleAddRow}
          />
        </div>
      )}

      {/* Summary */}
      {validRows.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Summary</h4>
          <div className="space-y-1">
            {validRows.map((r, i) => (
              <div key={i} className="flex justify-between text-sm text-blue-800">
                <span>{r.annual_category_name || categories.find((c) => String(c.id) === r.category_id)?.name || 'Unknown'}</span>
                <span className="font-medium">{parseFloat(r.amount).toLocaleString()}</span>
              </div>
            ))}
            <div className="border-t border-blue-300 mt-2 pt-2 flex justify-between text-sm font-bold text-blue-900">
              <span>Total per student / year</span>
              <span className="text-base text-green-700">{total.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveMutation.isPending || !selectedClassId || validRows.length === 0}
          className="px-5 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
        >
          {saveMutation.isPending ? 'Saving…' : '✓ Save Annual Charges'}
        </button>

        <button
          type="button"
          onClick={handlePreviewGenerate}
          disabled={genLoading || !selectedClassId}
          className="px-5 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 text-sm font-medium"
        >
          {genLoading ? 'Checking…' : '📋 Generate Annual Fee Records'}
        </button>
      </div>

      {/* Generate Confirmation */}
      {showGenConfirm && genPreview && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm font-medium text-blue-900 mb-2">Confirm Generation</p>
          <p className="text-sm text-blue-800 mb-1">
            Class: <strong>{selectedClass?.name}{selectedClass?.section ? ` - ${selectedClass.section}` : ''}</strong> | Year: <strong>{genYear}</strong>
          </p>
          <p className="text-sm text-blue-800 mb-1">
            <strong>{genPreview.will_create}</strong> new annual fee records will be created
            {genPreview.will_create > 0 && <> (total amount: <strong>{Number(genPreview.total_amount).toLocaleString()}</strong>)</>}
          </p>
          {genPreview.already_exist > 0 && (
            <p className="text-xs text-blue-600">{genPreview.already_exist} already exist and will be skipped.</p>
          )}
          {genPreview.no_fee_structure > 0 && (
            <p className="text-xs text-amber-600">{genPreview.no_fee_structure} students have no annual fee structure (will skip).</p>
          )}
          <div className="flex gap-3 mt-3">
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generateMutation.isPending || genPreview.will_create === 0}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700 disabled:opacity-50"
            >
              {generateMutation.isPending ? 'Generating…' : 'Confirm & Generate'}
            </button>
            <button
              type="button"
              onClick={() => { setShowGenConfirm(false); setGenPreview(null) }}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg text-sm hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
