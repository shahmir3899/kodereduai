import { schoolToday } from '../../utils/schoolTime'
import { useState, useEffect, useMemo } from 'react'
import Button from '../../components/ui/Button'
import EmptyState from '../../components/ui/EmptyState'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../components/Toast'
import { useClasses } from '../../hooks/useClasses'
import { financeApi, studentsApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'
import {
  buildSessionClassOptions,
  buildStudentClassFilterParams,
  resolveClassIdToMasterClassId,
} from '../../utils/classScope'
import ClassSelector from '../../components/ClassSelector'
import Spinner from '../../components/ui/Spinner'
import {
  buildStudentChargesPayload,
  buildStudentRows,
  changeCounts,
  changedCells,
  isOverride,
  rowTotal,
  validateStudentCharges,
} from './studentCharges'

const money = (v) => (v === '' || v == null ? 'Not set' : `Rs. ${Number(v).toLocaleString()}`)

/**
 * Fee Setup "By Student" for monthly and annual fees: what each student of a class pays when it
 * differs from the class charge, one column per chosen fee category. Only edited boxes are saved,
 * each with its own category (see studentCharges.js for why monthly needs one too).
 */
export default function StudentChargesGrid({ feeType }) {
  const isMonthly = feeType === 'MONTHLY'
  const { activeAcademicYear } = useAcademicYear()
  const { activeSchool } = useAuth()
  const { addToast } = useToast()
  const queryClient = useQueryClient()

  const [studentClassId, setStudentClassId] = useState('')
  const [categoryIds, setCategoryIds] = useState([])
  const [edits, setEdits] = useState({})
  const [editMode, setEditMode] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [effectiveFrom, setEffectiveFrom] = useState(schoolToday())

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const resolvedClassId = resolveClassIdToMasterClassId(studentClassId, activeAcademicYear?.id, sessionClasses)
  const studentClassFilterParams = useMemo(() => buildStudentClassFilterParams({
    classId: studentClassId,
    activeAcademicYearId: activeAcademicYear?.id,
    sessionClasses,
  }), [studentClassId, activeAcademicYear?.id, sessionClasses])

  const { classes: classList } = useClasses(activeSchool?.id)
  const classOptions = useMemo(() => {
    if (!activeAcademicYear?.id) return classList
    if (!sessionClasses?.length) return []
    return buildSessionClassOptions(sessionClasses)
  }, [activeAcademicYear?.id, classList, sessionClasses])

  const { data: catData, isLoading: categoriesLoading } = useQuery({
    queryKey: [isMonthly ? 'monthly-categories' : 'annual-categories'],
    queryFn: () => (isMonthly ? financeApi.getMonthlyCategories({}) : financeApi.getAnnualCategories({})),
    staleTime: 5 * 60_000,
  })
  const categories = useMemo(
    () => (catData?.data?.results ?? catData?.data ?? []).filter((c) => c.is_active !== false),
    [catData],
  )

  useEffect(() => {
    if (categoryIds.length === 0 && categories.length > 0) setCategoryIds([categories[0].id])
  }, [categories, categoryIds.length])

  const { data: studentsData, isLoading: studentsLoading } = useQuery({
    queryKey: ['students-for-fee-struct', activeSchool?.id, studentClassFilterParams.class_id, studentClassFilterParams.session_class_id, studentClassFilterParams.academic_year],
    queryFn: () => studentsApi.getStudents({ ...studentClassFilterParams, is_active: true, page_size: 9999 }),
    enabled: !!activeSchool?.id && !!resolvedClassId,
    staleTime: 2 * 60_000,
  })
  const classStudents = studentsData?.data?.results ?? studentsData?.data ?? []

  const { data: structsData, isLoading: structuresLoading } = useQuery({
    queryKey: ['feeStructures-class', activeSchool?.id, resolvedClassId, feeType, activeAcademicYear?.id],
    queryFn: () => financeApi.getFeeStructures({
      class_id: resolvedClassId, fee_type: feeType, page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!activeSchool?.id && !!resolvedClassId,
    staleTime: 0,
  })
  const classStructures = structsData?.data?.results ?? structsData?.data ?? []

  const chosen = useMemo(() => categories.filter((c) => categoryIds.includes(c.id)), [categories, categoryIds])
  const rows = useMemo(
    () => (resolvedClassId ? buildStudentRows(classStudents, classStructures, resolvedClassId, feeType, chosen, edits) : []),
    [resolvedClassId, classStudents, classStructures, feeType, chosen, edits],
  )
  const changes = useMemo(() => changedCells(rows), [rows])
  const counts = changeCounts(changes, chosen)
  const many = chosen.length > 1
  const names = Object.fromEntries(chosen.map((c) => [c.id, c.name]))
  const overrideCount = rows.filter((r) => chosen.some((c) => r.cells[c.id] && isOverride(r.cells[c.id]))).length
  const legacyCount = rows.filter((r) => chosen.some((c) => r.cells[c.id]?.legacy)).length

  const saveMutation = useMutation({
    mutationFn: (payload) => financeApi.bulkSetStudentFeeStructures(payload),
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['feeStructures'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-all'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-class'] })
      queryClient.invalidateQueries({ queryKey: ['monthly-fee-structures-all'] })
      queryClient.invalidateQueries({ queryKey: ['annual-fee-structures-all'] })
      queryClient.invalidateQueries({ queryKey: ['annual-fee-structures-class'] })
      queryClient.invalidateQueries({ queryKey: ['disc-tab-structures'] })
      queryClient.invalidateQueries({ queryKey: ['generate-preview'] })
      const saved = res?.data?.created ?? variables?.students?.length ?? 0
      addToast(`Saved ${saved} student amount${saved === 1 ? '' : 's'}.`, 'success')
      setEdits({})
      setShowConfirm(false)
      setEditMode(false)
    },
    onError: (err) => addToast(getErrorMessage(err, 'Failed to save student fees'), 'error'),
  })

  const resetWork = () => { setEdits({}); setShowConfirm(false); setEditMode(false); saveMutation.reset() }

  // At least one fee stays chosen; unticking one drops what was typed for it.
  const toggleCategory = (id) => {
    if (categoryIds.includes(id)) {
      if (categoryIds.length === 1) return
      setCategoryIds(categoryIds.filter((x) => x !== id))
      setEdits((prev) => { const next = { ...prev }; delete next[id]; return next })
    } else {
      setCategoryIds([...categoryIds, id])
    }
  }

  const setCell = (categoryId, studentId, value) =>
    setEdits((prev) => ({ ...prev, [categoryId]: { ...(prev[categoryId] || {}), [studentId]: value } }))

  const reviewOrWarn = () => {
    const problem = validateStudentCharges(rows, effectiveFrom, categoryIds)
    if (problem) { addToast(problem, 'warning'); return }
    setShowConfirm(true)
  }

  const save = () => {
    const problem = validateStudentCharges(rows, effectiveFrom, categoryIds)
    if (problem) { addToast(problem, 'warning'); return }
    saveMutation.mutate(buildStudentChargesPayload(resolvedClassId, feeType, effectiveFrom, rows))
  }

  const countsText = counts.map((x) => `${x.category.name}: ${x.count}`).join(' · ')

  return (
    <>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Class <span className="text-red-500">*</span></label>
          <ClassSelector
            value={studentClassId}
            onChange={(e) => { setStudentClassId(e.target.value); resetWork() }}
            className="input-field text-sm"
            classes={classOptions}
          />
        </div>
        <div className="min-w-[140px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Effective From</label>
          <input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="input-field text-sm" />
        </div>
      </div>

      <div className="mb-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-xs font-medium text-gray-500">{isMonthly ? 'Monthly fees' : 'Annual fees'} <span className="font-normal text-gray-400">— pick one or more to set together</span></span>
          {rows.length > 0 && (
            <span className="text-xs text-gray-500">
              {rows.length} students
              {overrideCount > 0 && <span className="ml-2 text-blue-600 font-medium">{overrideCount} with own amount{overrideCount !== 1 ? 's' : ''}</span>}
            </span>
          )}
        </div>
        {categoriesLoading ? (
          <Spinner size="sm" />
        ) : categories.length === 0 ? (
          <p className="text-sm text-gray-500">No {isMonthly ? 'monthly' : 'annual'} fees yet. Add one in the By Class view first.</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Fees to show">
            {categories.map((c) => {
              const on = categoryIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleCategory(c.id)}
                  title={on && categoryIds.length === 1 ? 'At least one fee stays selected' : undefined}
                  className={`px-3 py-1 text-xs rounded-full border font-medium transition-colors ${on ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'}`}
                >
                  {on ? '✓ ' : ''}{c.name}{c.billing_mode === 'ENROLLED' ? ' (enrolled only)' : ''}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {legacyCount > 0 && !showConfirm && (
        <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          {legacyCount} student{legacyCount === 1 ? ' has' : 's have'} an old amount saved without a fee name (marked <span className="font-semibold">old</span>). It is charged on every monthly fee. Type the right amount in each fee column and save to replace it.
        </div>
      )}

      {!studentClassId ? (
        <div className="text-center py-12 text-gray-400 text-sm">Select a class to view and set student-level fees</div>
      ) : studentsLoading || structuresLoading ? (
        <div className="text-center py-12"><Spinner size="sm" className="mx-auto" /></div>
      ) : showConfirm ? (
        <>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg mb-4">
            <p className="text-sm font-medium text-blue-900 mb-1">Save {changes.length} change{changes.length === 1 ? '' : 's'}</p>
            <p className="text-xs text-blue-700 mb-3">{countsText} | Effective from: {effectiveFrom}</p>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {changes.map((c) => (
                <p key={`${c.studentId}-${c.categoryId}`} className="text-sm text-blue-800">
                  <span className="font-medium">{c.name}</span>
                  {c.roll && <span className="text-blue-600"> (#{c.roll})</span>}
                  {' · '}{names[c.categoryId]}: {money(c.original)} {' → '} {money(c.amount)}
                </p>
              ))}
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" type="button" onClick={() => setShowConfirm(false)} className="flex-1">Back</Button>
            <Button onClick={save} disabled={saveMutation.isPending} className="flex-1">{saveMutation.isPending ? 'Saving...' : 'Confirm & Save'}</Button>
          </div>
          {saveMutation.isError && <p className="mt-3 text-sm text-red-600">{getErrorMessage(saveMutation.error, 'Failed to save student fees')}</p>}
        </>
      ) : rows.length === 0 ? (
        <EmptyState title="No enrolled students found in this class" />
      ) : chosen.length === 0 ? null : (
        <>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs text-gray-500">
              Class charge: {chosen.map((c) => `${c.name} ${money(rows[0].cells[c.id]?.classDefault)}`).join(' · ')}
            </span>
            {!editMode && (
              <button type="button" onClick={() => setEditMode(true)}
                className="px-3 py-1 text-xs font-medium text-primary-700 border border-primary-300 rounded-lg hover:bg-primary-50 transition-colors"
              >✏ Edit</button>
            )}
          </div>
          <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
            <table className="min-w-full">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-10">#</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-16">Roll</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                  {chosen.map((c) => (
                    <th key={c.id} className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-36">
                      {c.name}
                      {c.billing_mode === 'ENROLLED' && <span className="block normal-case font-normal text-[10px] text-gray-400">charged only if enrolled</span>}
                    </th>
                  ))}
                  {many && <th className="px-3 py-2 text-right text-xs font-medium text-gray-700 uppercase w-28 sticky right-0 bg-gray-50">Total</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, idx) => (
                  <tr key={r.studentId}>
                    <td className="px-3 py-1.5 text-sm text-gray-400">{idx + 1}</td>
                    <td className="px-3 py-1.5 text-sm font-mono text-gray-600">{r.roll}</td>
                    <td className="px-3 py-1.5 text-sm text-gray-900">{r.name}</td>
                    {chosen.map((c) => {
                      const cell = r.cells[c.id]
                      const own = isOverride(cell)
                      const old = cell.legacy && !cell.edited
                      return (
                        <td key={c.id} className={`px-3 py-1.5 ${own ? 'bg-blue-50/50' : ''}`}>
                          {editMode ? (
                            <input type="number" step="0.01" min="0" placeholder="0.00"
                              aria-label={`${c.name} for ${r.name}`}
                              value={cell.amount}
                              onChange={(e) => setCell(c.id, r.studentId, e.target.value)}
                              className={`input-field text-sm text-right w-28 ml-auto ${old ? 'border-amber-300 bg-amber-50' : own ? 'border-blue-300 bg-blue-50' : ''}`}
                            />
                          ) : (
                            <span className={`block text-sm text-right ${own ? 'font-medium text-blue-700' : 'text-gray-900'}`}>
                              {old && <span className="mr-1 px-1 py-0.5 text-[10px] rounded bg-amber-100 text-amber-700" title="Saved without a fee name; charged on every monthly fee">old</span>}
                              {cell.amount ? `Rs. ${Number(cell.amount).toLocaleString()}` : '—'}
                            </span>
                          )}
                        </td>
                      )
                    })}
                    {many && (
                      <td className="px-3 py-1.5 text-sm text-right font-semibold text-gray-900 sticky right-0 bg-white">
                        Rs. {rowTotal(r).toLocaleString()}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {editMode && (
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <Button variant="secondary" type="button" onClick={() => { setEditMode(false); setEdits({}) }}>Cancel</Button>
              <button type="button" onClick={reviewOrWarn}
                disabled={changes.length === 0}
                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
              >Review & Save{changes.length ? ` (${changes.length})` : ''}</button>
              {countsText && <span className="text-xs text-gray-500">{countsText}</span>}
            </div>
          )}
        </>
      )}
    </>
  )
}
