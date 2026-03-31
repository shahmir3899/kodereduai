import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { financeApi, classesApi, studentsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useToast } from '../../components/Toast'
import { getErrorMessage } from '../../utils/errorUtils'
import {
  buildSessionLabeledMasterClassOptions,
  resolveClassIdToMasterClassId,
} from '../../utils/classScope'
import AnnualChargesGrid from './AnnualChargesGrid'
import CategoryManagerModal from './CategoryManagerModal'

/**
 * AnnualChargesCardView — Card-based layout showing all classes with their annual charges.
 * 
 * Each card represents one class and contains:
 * - Grid of existing annual charges (category + amount)
 * - "Add Charge" button
 * - "Save Changes" button
 * 
 * This replaces the old class-selector approach, allowing schools to see all classes at once.
 */
export default function AnnualChargesCardView() {
  const { activeAcademicYear } = useAcademicYear()
  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const now = new Date()
  const [effectiveFrom, setEffectiveFrom] = useState(now.toISOString().split('T')[0])
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  
  // State per class: { [classId]: { rows, loading, error } }
  const [classRows, setClassRows] = useState({})
  const [classShowConfirm, setClassShowConfirm] = useState({})

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

  // Fetch annual categories for this school
  const { data: catData } = useQuery({
    queryKey: ['annual-categories'],
    queryFn: () => financeApi.getAnnualCategories(),
  })
  const categories = catData?.data?.results ?? catData?.data ?? []

  // Fetch annual fee structures for all classes at once
  const { data: allStructuresData, isLoading: structuresLoading } = useQuery({
    queryKey: ['annual-fee-structures-all', activeAcademicYear?.id],
    queryFn: () => financeApi.getFeeStructures({
      fee_type: 'ANNUAL',
      page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!activeAcademicYear?.id,
    staleTime: 60_000,
  })

  const allStructures = allStructuresData?.data?.results ?? allStructuresData?.data ?? []

  // Initialize rows for each class when structures load
  useEffect(() => {
    if (!structuresLoading && allStructures.length > 0) {
      const newClassRows = {}
      classOptions.forEach((cls) => {
        const classStructures = allStructures.filter((s) => String(s.class_obj) === String(cls.id))
        const prefilled = classStructures
          .filter((s) => s.annual_category && s.is_active !== false)
          .map((s) => ({
            category_id: String(s.annual_category),
            annual_category_name: s.annual_category_name || '',
            amount: String(s.monthly_amount),
            _structureId: s.id,
          }))
        newClassRows[cls.id] = prefilled.length > 0 ? prefilled : [{ category_id: '', annual_category_name: '', amount: '' }]
      })
      setClassRows(newClassRows)
    }
  }, [structuresLoading, allStructures, classOptions])

  // Ensure classRows has all classes (even if loading)
  useEffect(() => {
    const updated = { ...classRows }
    classOptions.forEach((cls) => {
      if (!updated[cls.id]) {
        updated[cls.id] = [{ category_id: '', annual_category_name: '', amount: '' }]
      }
    })
    setClassRows(updated)
  }, [classOptions])

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (payload) => financeApi.bulkSetFeeStructures(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['annual-fee-structures-all'] })
      showToast('Annual charges saved successfully', 'success')
      setClassShowConfirm({})
    },
    onError: (err) => showToast(getErrorMessage(err, 'Failed to save annual charges'), 'error'),
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
      fee_type: 'ANNUAL',
      annual_category: parseInt(r.category_id),
      monthly_amount: parseFloat(r.amount),
    }))

    saveMutation.mutate({ structures, effective_from: effectiveFrom, academic_year: activeAcademicYear?.id })
  }

  function handleAddRow(classId) {
    setClassRows((prev) => ({
      ...prev,
      [classId]: [...(prev[classId] || []), { category_id: '', annual_category_name: '', amount: '' }],
    }))
  }

  function handleRowsChange(classId, newRows) {
    setClassRows((prev) => ({
      ...prev,
      [classId]: newRows,
    }))
  }

  const selectedClass = (classId) => classOptions.find((c) => c.id === classId)

  // Categories loading state
  if (structuresLoading && classOptions.length > 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-400">Loading annual charges for all classes...</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Category Manager Modal */}
      {showCategoryModal && (
        <CategoryManagerModal onClose={() => setShowCategoryModal(false)} />
      )}

      {/* Header with manage categories button */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-gray-900">Annual Charges</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Define annual charge categories and amounts for each class.
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

      {/* Categories validation */}
      {categories.length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-center">
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
              const rows = classRows[cls.id] || [{ category_id: '', annual_category_name: '', amount: '' }]
              const validRows = rows.filter((r) => r.category_id && parseFloat(r.amount) > 0)
              const total = validRows.reduce((sum, r) => sum + (parseFloat(r.amount) || 0), 0)

              return (
                <div key={cls.id} className="card p-3">
                  {/* Card header */}
                  <div className="flex items-center justify-between mb-2 pb-2 border-b border-gray-200">
                    <div>
                      <h3 className="font-semibold text-sm text-gray-900">{cls.label || `${cls.name}${cls.section ? ` - ${cls.section}` : ''}`}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {validRows.length > 0 ? `${validRows.length} charge(s) • Total: Rs. ${total.toLocaleString()}` : 'No charges added'}
                      </p>
                    </div>
                  </div>

                  {/* Grid or confirmation view */}
                  {classShowConfirm[cls.id] ? (
                    <div className="space-y-2">
                      <div className="p-2 bg-blue-50 border border-blue-200 rounded text-sm">
                        <p className="text-blue-900 font-medium">Review before saving:</p>
                        <div className="mt-1 space-y-0.5">
                          {validRows.map((r, idx) => (
                            <p key={idx} className="text-blue-800">
                              {r.annual_category_name}: <span className="font-semibold">Rs. {parseFloat(r.amount).toLocaleString()}</span>
                            </p>
                          ))}
                        </div>
                        <p className="text-blue-800 mt-1 font-semibold">
                          Total: Rs. {total.toLocaleString()}
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
                  ) : (
                    <div className="space-y-2">
                      <AnnualChargesGrid
                        categories={categories}
                        rows={rows}
                        onChange={(newRows) => handleRowsChange(cls.id, newRows)}
                        onAddRow={() => handleAddRow(cls.id)}
                      />
                      <button onClick={() => setClassShowConfirm({...classShowConfirm, [cls.id]: true})} disabled={validRows.length === 0}
                        className="w-full px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                      >Review & Save</button>
                    </div>
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
