import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import {
  buildSessionLabeledMasterClassOptions,
} from '../../utils/classScope'
import MonthlyChargesGrid from './MonthlyChargesGrid'
import MonthlyCategoryManagerModal from './MonthlyCategoryManagerModal'

/**
 * MonthlyChargesCardView — Card-based layout showing all classes with their monthly charges.
 *
 * Each card represents one class and contains:
 * - Grid of existing monthly charges (category + amount per month)
 * - "Add Charge" button
 * - "Save Changes" button
 *
 * Mirrors AnnualChargesCardView but for monthly categories.
 */
export default function MonthlyChargesCardView() {
  const { activeAcademicYear } = useAcademicYear()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const now = new Date()
  const [effectiveFrom, setEffectiveFrom] = useState(now.toISOString().split('T')[0])
  const [showCategoryModal, setShowCategoryModal] = useState(false)

  // State per class: { [classId]: rows[] }
  const [classRows, setClassRows] = useState({})
  const [classShowConfirm, setClassShowConfirm] = useState({})
  const [classEditMode, setClassEditMode] = useState({})

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id)

  // Fetch all classes
  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses({ page_size: 9999 }),
    staleTime: 5 * 60_000,
  })
  const classList = classesData?.data?.results ?? classesData?.data ?? []

  // Build session-labeled class options
  const classOptions = useMemo(() => {
    if (!activeAcademicYear?.id) return classList
    if (!sessionClasses?.length) return []
    return buildSessionLabeledMasterClassOptions({
      sessionClasses,
      masterClasses: classList,
      sessionScopedOnly: true,
    })
  }, [activeAcademicYear?.id, classList, sessionClasses])

  // Fetch monthly categories for this school
  const { data: catData } = useQuery({
    queryKey: ['monthly-categories'],
    queryFn: () => financeApi.getMonthlyCategories(),
  })
  const categories = catData?.data?.results ?? catData?.data ?? []

  // Fetch monthly fee structures for all classes at once
  const { data: allStructuresData, isLoading: structuresLoading } = useQuery({
    queryKey: ['monthly-fee-structures-all', activeAcademicYear?.id],
    queryFn: () => financeApi.getFeeStructures({
      fee_type: 'MONTHLY',
      page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!activeAcademicYear?.id,
    staleTime: 60_000,
  })

  const allStructures = allStructuresData?.data?.results ?? allStructuresData?.data ?? []

  // Initialize rows for each class when structures or classes change
  useEffect(() => {
    if (classOptions.length === 0) return

    const newClassRows = {}
    classOptions.forEach((cls) => {
      if (!structuresLoading && allStructures.length > 0) {
        const classStructures = allStructures.filter((s) => String(s.class_obj) === String(cls.id))
        const prefilled = classStructures
          .filter((s) => s.monthly_category && s.is_active !== false)
          .map((s) => ({
            category_id: String(s.monthly_category),
            monthly_category_name: s.monthly_category_name || '',
            amount: String(s.monthly_amount),
            _structureId: s.id,
          }))
        newClassRows[cls.id] = prefilled.length > 0 ? prefilled : [{ category_id: '', monthly_category_name: '', amount: '' }]
      } else {
        newClassRows[cls.id] = [{ category_id: '', monthly_category_name: '', amount: '' }]
      }
    })
    setClassRows(newClassRows)
  }, [structuresLoading, allStructures, classOptions])

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (payload) => financeApi.bulkSetFeeStructures(payload),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['monthly-fee-structures-all'] })
      showToast('Monthly charges saved successfully', 'success')
      // Auto-exit edit mode for the saved class
      const savedClassId = variables.structures?.[0]?.class_obj
      if (savedClassId) setClassEditMode((prev) => ({ ...prev, [savedClassId]: false }))
      setClassShowConfirm({})
    },
    onError: (err) => showToast(getErrorMessage(err, 'Failed to save monthly charges'), 'error'),
  })

  function handleSaveClass(classId) {
    const rows = classRows[classId] || []
    const validRows = rows.filter((r) => r.category_id && r.amount !== '' && parseFloat(r.amount) > 0)
    if (validRows.length === 0) {
      showToast('Add at least one charge with a category and amount', 'error')
      return
    }

    const structures = validRows.map((r) => ({
      class_obj: classId,
      fee_type: 'MONTHLY',
      monthly_category: parseInt(r.category_id),
      monthly_amount: parseFloat(r.amount),
    }))

    saveMutation.mutate({ structures, effective_from: effectiveFrom, academic_year: activeAcademicYear?.id })
  }

  function handleAddRow(classId) {
    setClassRows((prev) => ({
      ...prev,
      [classId]: [...(prev[classId] || []), { category_id: '', monthly_category_name: '', amount: '' }],
    }))
  }

  function handleRowsChange(classId, newRows) {
    setClassRows((prev) => ({
      ...prev,
      [classId]: newRows,
    }))
  }

  function handleCancelEdit(classId) {
    const classStructures = allStructures.filter((s) => String(s.class_obj) === String(classId))
    const prefilled = classStructures
      .filter((s) => s.monthly_category && s.is_active !== false)
      .map((s) => ({
        category_id: String(s.monthly_category),
        monthly_category_name: s.monthly_category_name || '',
        amount: String(s.monthly_amount),
        _structureId: s.id,
      }))
    setClassRows((prev) => ({
      ...prev,
      [classId]: prefilled.length > 0 ? prefilled : [{ category_id: '', monthly_category_name: '', amount: '' }],
    }))
    setClassEditMode((prev) => ({ ...prev, [classId]: false }))
    setClassShowConfirm((prev) => ({ ...prev, [classId]: false }))
  }

  if (structuresLoading && classOptions.length > 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-400">Loading monthly charges for all classes...</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Category Manager Modal */}
      {showCategoryModal && (
        <MonthlyCategoryManagerModal onClose={() => setShowCategoryModal(false)} />
      )}

      {/* Header with manage categories button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900">Monthly Charges</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Define monthly charge categories and amounts for each class.
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

      {/* Effective From Date */}
      <div className="flex gap-2 items-end max-w-xs">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-700 mb-0.5">Effective From</label>
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="input-field w-full"
          />
        </div>
      </div>

      {/* No categories warning */}
      {categories.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-center">
          <p className="text-sm text-amber-800 font-medium mb-2">No monthly categories defined yet.</p>
          <p className="text-xs text-amber-700 mb-3">Click "Manage Categories" to add categories for your school.</p>
          <button
            type="button"
            onClick={() => setShowCategoryModal(true)}
            className="px-4 py-2 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700"
          >
            + Add Categories
          </button>
        </div>
      )}

      {/* Class cards */}
      {categories.length > 0 && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {classOptions.length === 0 ? (
            <div className="p-6 bg-gray-50 border border-gray-200 rounded-lg text-center">
              <p className="text-sm text-gray-500">No classes found for the selected academic year.</p>
            </div>
          ) : (
            classOptions.map((cls) => {
              const rows = classRows[cls.id] || [{ category_id: '', monthly_category_name: '', amount: '' }]
              const validRows = rows.filter((r) => r.category_id && parseFloat(r.amount) > 0)
              const total = validRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)
              const hasData = validRows.length > 0
              const isEditing = classEditMode[cls.id]

              return (
                <div key={cls.id} className="card p-3">
                  {/* Card header */}
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200">
                    <div>
                      <h3 className="font-semibold text-sm text-gray-900">{cls.label || `${cls.name}${cls.section ? ` - ${cls.section}` : ''}`}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {validRows.length > 0 ? `${validRows.length} charge(s) • Rs. ${total.toLocaleString()} / month` : 'No charges added'}
                      </p>
                    </div>
                    {!isEditing && !classShowConfirm[cls.id] && (
                      <button
                        type="button"
                        onClick={() => setClassEditMode((prev) => ({ ...prev, [cls.id]: true }))}
                        className="px-3 py-1 text-xs font-medium text-primary-700 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
                      >
                        {hasData ? '✏ Edit' : '+ Set Up'}
                      </button>
                    )}
                  </div>

                  {/* Grid or confirmation view */}
                  {classShowConfirm[cls.id] ? (
                    <div className="space-y-2">
                      <div className="p-2 bg-blue-50 border border-blue-200 rounded text-sm">
                        <p className="text-blue-900 font-medium">Review before saving:</p>
                        <div className="mt-1 space-y-0.5">
                          {validRows.map((r, idx) => (
                            <p key={idx} className="text-blue-800">
                              {r.monthly_category_name}: <span className="font-semibold">Rs. {parseFloat(r.amount).toLocaleString()}</span>
                            </p>
                          ))}
                        </div>
                        <p className="text-blue-800 mt-1 font-semibold">
                          Total: Rs. {total.toLocaleString()} / month
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setClassShowConfirm({...classShowConfirm, [cls.id]: false})}
                          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-xs"
                        >Back</button>
                        <button onClick={() => handleSaveClass(cls.id)} disabled={saveMutation.isPending}
                          className="flex-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-xs disabled:opacity-50"
                        >{saveMutation.isPending ? 'Saving...' : 'Confirm & Save'}</button>
                      </div>
                      {saveMutation.isError && <p className="text-xs text-red-600">{getErrorMessage(saveMutation.error, 'Failed to save')}</p>}
                    </div>
                  ) : isEditing ? (
                    <div className="space-y-2">
                      <MonthlyChargesGrid
                        categories={categories}
                        rows={rows}
                        onChange={(newRows) => handleRowsChange(cls.id, newRows)}
                        onAddRow={() => handleAddRow(cls.id)}
                      />
                      <div className="flex gap-2">
                        <button type="button" onClick={() => handleCancelEdit(cls.id)}
                          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-xs"
                        >Cancel</button>
                        <button onClick={() => setClassShowConfirm({...classShowConfirm, [cls.id]: true})} disabled={validRows.length === 0}
                          className="flex-1 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                        >Review & Save</button>
                      </div>
                    </div>
                  ) : (
                    <MonthlyChargesGrid
                      categories={categories}
                      rows={hasData ? validRows : []}
                      readOnly
                      onChange={() => {}}
                      onAddRow={() => {}}
                    />
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
