import { useEffect, useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import { useFeeSetup } from './useFeeSetup'
import ClassSelector from '../../components/ClassSelector'
import { financeApi, discountApi, studentsApi } from '../../services/api'
import { getErrorMessage } from '../../utils/errorUtils'
import {
  buildSessionClassOptions,
  buildStudentClassFilterParams,
  resolveClassIdToMasterClassId,
} from '../../utils/classScope'
import AnnualChargesTab from './AnnualChargesTab'
import FeeGenerationSurface from './FeeGenerationSurface'
import MonthlyChargesTab from './MonthlyChargesTab'

function calcDiscountOff(discount, scholarship, baseFee) {
  const base = Number(baseFee) || 0
  if (!base) return 0
  if (discount) {
    if (discount.discount_type === 'PERCENTAGE') return Math.round((base * Number(discount.value) / 100) * 100) / 100
    return Math.min(Number(discount.value), base)
  }
  if (scholarship) {
    if (scholarship.coverage === 'FULL') return base
    if (scholarship.coverage === 'PERCENTAGE') return Math.round((base * Number(scholarship.value) / 100) * 100) / 100
    return Math.min(Number(scholarship.value), base)
  }
  return 0
}

function formatDiscountLabel(discount, scholarship) {
  if (discount) {
    return discount.discount_type === 'PERCENTAGE' ? `${discount.name} (${discount.value}%)` : `${discount.name} (Rs. ${Number(discount.value).toLocaleString()})`
  }
  if (scholarship) {
    if (scholarship.coverage === 'FULL') return `${scholarship.name} (Full)`
    if (scholarship.coverage === 'PERCENTAGE') return `${scholarship.name} (${scholarship.value}%)`
    return `${scholarship.name} (Rs. ${Number(scholarship.value).toLocaleString()})`
  }
  return null
}

export default function FeeSetupPage() {
  const { activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const queryClient = useQueryClient()
  const now = new Date()

  // Tab state
  const [activeTab, setActiveTab] = useState('monthly')
  const [feeType] = useState('MONTHLY')
  const [singleStructForm, setSingleStructForm] = useState({
    classId: '',
    studentId: '',
    feeType: 'MONTHLY',
    amount: '',
    effectiveFrom: new Date().toISOString().split('T')[0],
    annualCategoryId: '',
    monthlyCategoryId: '',
  })

  // Student Discounts tab state
  const [discClassId, setDiscClassId] = useState('')
  const [assignModal, setAssignModal] = useState(null) // { studentId, studentName } or null
  const [assignType, setAssignType] = useState('discount') // 'discount' | 'scholarship'
  const [assignSelectedId, setAssignSelectedId] = useState('')
  const [assignNotes, setAssignNotes] = useState('')
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkType, setBulkType] = useState('discount')
  const [bulkSelectedId, setBulkSelectedId] = useState('')
  const [removeConfirm, setRemoveConfirm] = useState(null) // studentDiscount id

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const resolvedSingleStructClassId = resolveClassIdToMasterClassId(singleStructForm.classId, activeAcademicYear?.id, sessionClasses)
  const resolvedDiscClassId = resolveClassIdToMasterClassId(discClassId, activeAcademicYear?.id, sessionClasses)
  const discStudentClassFilterParams = useMemo(() => buildStudentClassFilterParams({
    classId: discClassId,
    activeAcademicYearId: activeAcademicYear?.id,
    sessionClasses,
  }), [discClassId, activeAcademicYear?.id, sessionClasses])
  const singleStructClassFilterParams = useMemo(() => buildStudentClassFilterParams({
    classId: singleStructForm.classId,
    activeAcademicYearId: activeAcademicYear?.id,
    sessionClasses,
  }), [singleStructForm.classId, activeAcademicYear?.id, sessionClasses])

  const data = useFeeSetup({
    academicYearId: activeAcademicYear?.id,
    feeType,
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  })

  const feeSetupClassOptions = useMemo(() => {
    if (!activeAcademicYear?.id) return data.classList
    return buildSessionClassOptions(sessionClasses)
  }, [activeAcademicYear?.id, sessionClasses, data.classList])

  // === Student Discounts tab queries ===
  const { data: discStudentsData, isLoading: discStudentsLoading } = useQuery({
    queryKey: ['disc-tab-students', discStudentClassFilterParams.class_id, discStudentClassFilterParams.session_class_id, discStudentClassFilterParams.academic_year],
    queryFn: () => studentsApi.getStudents({
      ...discStudentClassFilterParams,
      is_active: true,
      page_size: 9999,
    }),
    enabled: activeTab === 'discounts' && !!resolvedDiscClassId,
    staleTime: 2 * 60_000,
  })

  const { data: discStructuresData } = useQuery({
    queryKey: ['disc-tab-structures', resolvedDiscClassId, activeAcademicYear?.id],
    queryFn: () => financeApi.getFeeStructures({
      class_id: resolvedDiscClassId, fee_type: 'MONTHLY', page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: activeTab === 'discounts' && !!resolvedDiscClassId,
    staleTime: 2 * 60_000,
  })

  const { data: studentDiscountsData, isLoading: studentDiscountsLoading } = useQuery({
    queryKey: ['disc-tab-assignments', activeAcademicYear?.id],
    queryFn: () => discountApi.getStudentDiscounts({
      is_active: true, page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: activeTab === 'discounts',
    staleTime: 60_000,
  })

  const { data: discountsListData } = useQuery({
    queryKey: ['disc-tab-discounts-list'],
    queryFn: () => discountApi.getDiscounts({ is_active: true, page_size: 9999 }),
    enabled: activeTab === 'discounts',
    staleTime: 5 * 60_000,
  })

  const { data: scholarshipsListData } = useQuery({
    queryKey: ['disc-tab-scholarships-list'],
    queryFn: () => discountApi.getScholarships({ is_active: true, page_size: 9999 }),
    enabled: activeTab === 'discounts',
    staleTime: 5 * 60_000,
  })

  const discStudents = discStudentsData?.data?.results || discStudentsData?.data || []
  const discStructures = discStructuresData?.data?.results || discStructuresData?.data || []
  const allStudentDiscounts = studentDiscountsData?.data?.results || studentDiscountsData?.data || []
  const discountsList = discountsListData?.data?.results || discountsListData?.data || []
  const scholarshipsList = scholarshipsListData?.data?.results || scholarshipsListData?.data || []

  // Build assignment map: studentId → { assignment, discount, scholarship }
  const assignmentMap = useMemo(() => {
    const map = {}
    allStudentDiscounts.forEach(sd => {
      if (!map[sd.student]) map[sd.student] = []
      map[sd.student].push(sd)
    })
    return map
  }, [allStudentDiscounts])

  // Build fee map for discount tab: studentId → base monthly fee
  const discFeeMap = useMemo(() => {
    const structures = discStructures
    const classDefault = structures.find(fs => fs.class_obj && !fs.student && fs.is_active)
    const defaultAmt = classDefault ? Number(classDefault.monthly_amount) : 0
    const overrides = {}
    structures.forEach(fs => {
      if (fs.student && fs.is_active) overrides[fs.student] = Number(fs.monthly_amount)
    })
    const map = {}
    discStudents.forEach(s => {
      map[s.id] = overrides[s.id] ?? defaultAmt
    })
    return map
  }, [discStudents, discStructures])

  // Build the discount grid rows
  const discGrid = useMemo(() => {
    return discStudents
      .slice()
      .sort((a, b) => (parseInt(a.roll_number) || 9999) - (parseInt(b.roll_number) || 9999))
      .map(s => {
        const baseFee = discFeeMap[s.id] || 0
        const assignments = assignmentMap[s.id] || []
        // take first active assignment for display (most schools assign one per student)
        const primary = assignments[0] || null
        const disc = primary ? discountsList.find(d => d.id === primary.discount) : null
        const schol = primary ? scholarshipsList.find(sc => sc.id === primary.scholarship) : null
        const discountOff = calcDiscountOff(disc, schol, baseFee)
        const effective = Math.max(0, baseFee - discountOff)
        return {
          student_id: s.id,
          student_name: s.name,
          roll_number: s.roll_number || '',
          baseFee,
          assignment: primary,
          allAssignments: assignments,
          discount: disc,
          scholarship: schol,
          discountOff,
          effective,
          label: formatDiscountLabel(disc, schol),
        }
      })
  }, [discStudents, discFeeMap, assignmentMap, discountsList, scholarshipsList])

  // Mutations for student discount tab
  const assignMutation = useMutation({
    mutationFn: (payload) => discountApi.assignDiscount(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disc-tab-assignments'] })
      setAssignModal(null)
      setAssignSelectedId('')
      setAssignNotes('')
    },
  })

  const bulkAssignMutation = useMutation({
    mutationFn: (payload) => discountApi.bulkAssign(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disc-tab-assignments'] })
      setBulkModal(false)
      setBulkSelectedId('')
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id) => discountApi.removeStudentDiscount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['disc-tab-assignments'] })
      setRemoveConfirm(null)
    },
  })

  // Fetch annual fee categories
  const { data: annualCategoriesData } = useQuery({
    queryKey: ['annual-categories', activeSchool?.id],
    queryFn: () => financeApi.getAnnualCategories({}),
    enabled: activeTab === 'generate',
    staleTime: 5 * 60_000,
  })
  const annualCategories = annualCategoriesData?.data?.results || annualCategoriesData?.data || []

  // Fetch monthly fee categories
  const { data: monthlyCatData } = useQuery({
    queryKey: ['monthly-categories', activeSchool?.id],
    queryFn: () => financeApi.getMonthlyCategories({}),
    enabled: activeTab === 'generate',
    staleTime: 5 * 60_000,
  })
  const monthlyCategories = monthlyCatData?.data?.results || monthlyCatData?.data || []

  const { data: singleStructStudentsData, isLoading: singleStructStudentsLoading } = useQuery({
    queryKey: ['single-struct-students', singleStructClassFilterParams.class_id, singleStructClassFilterParams.session_class_id, singleStructClassFilterParams.academic_year],
    queryFn: () => studentsApi.getStudents({
      ...singleStructClassFilterParams,
      is_active: true,
      page_size: 9999,
    }),
    enabled: activeTab === 'generate' && !!resolvedSingleStructClassId,
    staleTime: 2 * 60_000,
  })
  const singleStructStudents = (singleStructStudentsData?.data?.results || singleStructStudentsData?.data || [])
    .slice()
    .sort((a, b) => (parseInt(a.roll_number) || 9999) - (parseInt(b.roll_number) || 9999))

  const { data: singleStructStructuresData } = useQuery({
    queryKey: ['single-struct-structures', resolvedSingleStructClassId, singleStructForm.feeType, activeAcademicYear?.id],
    queryFn: () => financeApi.getFeeStructures({
      class_id: resolvedSingleStructClassId,
      fee_type: singleStructForm.feeType,
      page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: activeTab === 'generate' && !!resolvedSingleStructClassId && !!singleStructForm.feeType,
    staleTime: 60_000,
  })
  const singleStructStructures = singleStructStructuresData?.data?.results || singleStructStructuresData?.data || []

  const createSingleStructureMutation = useMutation({
    mutationFn: (payload) => financeApi.createFeeStructure(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feeStructures'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-all'] })
      queryClient.invalidateQueries({ queryKey: ['feeStructures-class'] })
      queryClient.invalidateQueries({ queryKey: ['annual-fee-structures-all'] })
      queryClient.invalidateQueries({ queryKey: ['annual-fee-structures-class'] })
      queryClient.invalidateQueries({ queryKey: ['monthly-fee-structures-all'] })
      queryClient.invalidateQueries({ queryKey: ['generate-preview'] })
      setSingleStructForm(prev => ({
        ...prev,
        studentId: '',
        amount: '',
      }))
    },
  })

  const selectedSingleStructCategoryId = singleStructForm.feeType === 'ANNUAL'
    ? singleStructForm.annualCategoryId
    : singleStructForm.monthlyCategoryId

  const matchingSingleStructClassStructure = useMemo(() => {
    if (!resolvedSingleStructClassId || !selectedSingleStructCategoryId) return null

    return singleStructStructures.find((fs) => {
      if (!fs.class_obj || fs.student) return false
      if (singleStructForm.feeType === 'ANNUAL') {
        return String(fs.annual_category || '') === String(selectedSingleStructCategoryId)
      }
      return String(fs.monthly_category || '') === String(selectedSingleStructCategoryId)
    }) || null
  }, [resolvedSingleStructClassId, selectedSingleStructCategoryId, singleStructForm.feeType, singleStructStructures])

  return (
    <div>
      <div className="mb-6 flex flex-wrap gap-2 rounded-lg bg-gray-100 p-1">
        {[
          { key: 'monthly', label: 'Monthly Structure' },
          { key: 'annual', label: 'Annual Charges' },
          { key: 'generate', label: 'Generate Records' },
          { key: 'discounts', label: 'Student Discounts' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* === ANNUAL CHARGES TAB === */}
      {activeTab === 'annual' && (
        <div className="card">
          <AnnualChargesTab />
        </div>
      )}

      {/* === MONTHLY STRUCTURE TAB === */}
      {activeTab === 'monthly' && (
        <MonthlyChargesTab />
      )}

      {/* === GENERATE RECORDS TAB === */}
      {activeTab === 'generate' && (
        <div className="card">
          <p className="mb-4 text-sm text-gray-500">Generate fee payment records for students. <strong>Monthly fees</strong> are recurring; <strong>annual fees</strong> use categories defined in the <strong>Annual Charges</strong> tab.</p>
          <FeeGenerationSurface
            mode="inline"
            month={now.getMonth() + 1}
            year={now.getFullYear()}
            classList={feeSetupClassOptions}
            monthlyMutation={data.generateMutation}
            annualMutation={data.generateAnnualMutation}
            academicYearId={activeAcademicYear?.id}
            annualCategories={annualCategories}
            monthlyCategories={monthlyCategories}
          />

          {/* === SINGLE STUDENT FEE STRUCTURE === */}
          <div className="border-t border-gray-200 pt-6 mt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Create Single Student Fee Structure</h3>
            <p className="text-sm text-gray-600 mb-4">
              Add a one-off student-level fee structure override for a specific student.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Class <span className="text-red-500">*</span></label>
                <ClassSelector
                  value={singleStructForm.classId}
                  onChange={(e) => setSingleStructForm(prev => ({
                    ...prev,
                    classId: e.target.value,
                    studentId: '',
                    amount: '',
                  }))}
                  className="input-field"
                  classes={feeSetupClassOptions}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Student <span className="text-red-500">*</span></label>
                <select
                  value={singleStructForm.studentId}
                  onChange={(e) => setSingleStructForm(prev => ({ ...prev, studentId: e.target.value }))}
                  disabled={!singleStructForm.classId || singleStructStudentsLoading}
                  className="input-field text-sm"
                >
                  <option value="">{!singleStructForm.classId ? 'Select class first' : (singleStructStudentsLoading ? 'Loading students...' : 'Select student')}</option>
                  {singleStructStudents.map(s => (
                    <option key={s.id} value={s.id}>{s.name}{s.roll_number ? ` (Roll #${s.roll_number})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fee Type <span className="text-red-500">*</span></label>
                <select
                  value={singleStructForm.feeType}
                  onChange={(e) => setSingleStructForm(prev => ({
                    ...prev,
                    feeType: e.target.value,
                    annualCategoryId: '',
                    monthlyCategoryId: '',
                    amount: '',
                  }))}
                  className="input-field text-sm"
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="ANNUAL">Annual</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Category <span className="text-red-500">*</span></label>
                <select
                  value={selectedSingleStructCategoryId}
                  onChange={(e) => setSingleStructForm(prev => ({
                    ...prev,
                    amount: '',
                    annualCategoryId: prev.feeType === 'ANNUAL' ? e.target.value : '',
                    monthlyCategoryId: prev.feeType === 'MONTHLY' ? e.target.value : '',
                  }))}
                  className="input-field text-sm"
                >
                  <option value="">Select category</option>
                  {(singleStructForm.feeType === 'ANNUAL' ? annualCategories : monthlyCategories).map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount <span className="text-red-500">*</span></label>
                <input
                  type="number"
                  step="0.01"
                  value={singleStructForm.amount}
                  onChange={(e) => setSingleStructForm(prev => ({ ...prev, amount: e.target.value }))}
                  className="input-field text-sm"
                  placeholder="0.00"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Effective From <span className="text-red-500">*</span></label>
                <input
                  type="date"
                  value={singleStructForm.effectiveFrom}
                  onChange={(e) => setSingleStructForm(prev => ({ ...prev, effectiveFrom: e.target.value }))}
                  className="input-field text-sm"
                />
              </div>
            </div>

            {resolvedSingleStructClassId && singleStructForm.studentId && selectedSingleStructCategoryId && !matchingSingleStructClassStructure && (
              <p className="mb-3 text-xs text-amber-600 bg-amber-50 p-2 rounded">
                No matching class structure amount was found for the selected type and category. Enter the amount manually.
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                const payload = {
                  student: parseInt(singleStructForm.studentId),
                  fee_type: singleStructForm.feeType,
                  monthly_amount: parseFloat(singleStructForm.amount),
                  effective_from: singleStructForm.effectiveFrom,
                  ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
                  ...(singleStructForm.feeType === 'ANNUAL' && singleStructForm.annualCategoryId && { annual_category: parseInt(singleStructForm.annualCategoryId) }),
                  ...(singleStructForm.feeType === 'MONTHLY' && singleStructForm.monthlyCategoryId && { monthly_category: parseInt(singleStructForm.monthlyCategoryId) }),
                }
                createSingleStructureMutation.mutate(payload)
              }}
              disabled={
                createSingleStructureMutation.isPending
                || !resolvedSingleStructClassId
                || !singleStructForm.studentId
                || !selectedSingleStructCategoryId
                || !singleStructForm.amount
                || !singleStructForm.effectiveFrom
              }
              className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
            >
              {createSingleStructureMutation.isPending ? 'Creating...' : 'Create Student Fee Structure'}
            </button>

            {createSingleStructureMutation.isSuccess && (
              <p className="mt-3 text-sm text-green-700 bg-green-50 p-3 rounded">Student fee structure created successfully.</p>
            )}
            {createSingleStructureMutation.isError && (
              <p className="mt-3 text-sm text-red-600">{getErrorMessage(createSingleStructureMutation.error, 'Failed to create student fee structure')}</p>
            )}
          </div>
        </div>
      )}

      {/* === STUDENT DISCOUNTS TAB === */}
      {activeTab === 'discounts' && (
        <div className="card">
          <p className="text-sm text-gray-600 mb-4">Assign discounts or scholarships to students. Shows base monthly fee, discount applied, and effective fee.</p>

          {/* Controls */}
          <div className="flex flex-wrap items-end gap-3 mb-4 pb-3 border-b border-gray-100">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">Class <span className="text-red-500">*</span></label>
              <ClassSelector
                value={discClassId}
                onChange={(e) => setDiscClassId(e.target.value)}
                className="input-field text-sm"
                classes={feeSetupClassOptions}
              />
            </div>
            {discClassId && discGrid.length > 0 && (
              <div className="flex items-center gap-3 text-xs text-gray-500 pb-2">
                <span>{discGrid.length} students</span>
                {discWithAssignments > 0 && <span className="text-green-600 font-medium">{discWithAssignments} with discounts</span>}
              </div>
            )}
            {discClassId && (
              <button
                type="button"
                onClick={() => { setBulkModal(true); setBulkType('discount'); setBulkSelectedId(''); bulkAssignMutation.reset() }}
                className="px-3 py-1.5 text-xs rounded-lg font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors"
              >Bulk Assign</button>
            )}
          </div>

          {/* Table */}
          {!discClassId ? (
            <div className="text-center py-12 text-gray-400 text-sm">Select a class to view and manage student discounts</div>
          ) : discStudentsLoading || studentDiscountsLoading ? (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          ) : discGrid.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No enrolled students found in this class</div>
          ) : (
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50 sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-10">#</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase w-16">Roll</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">Base Fee</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Discount / Scholarship</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase w-24">Effective</th>
                    <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase w-20">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {discGrid.map((s, idx) => (
                    <tr key={s.student_id} className={s.assignment ? 'bg-green-50/40' : ''}>
                      <td className="px-3 py-2 text-sm text-gray-400">{idx + 1}</td>
                      <td className="px-3 py-2 text-sm font-mono text-gray-600">{s.roll_number}</td>
                      <td className="px-3 py-2 text-sm text-gray-900">{s.student_name}</td>
                      <td className="px-3 py-2 text-sm text-right text-gray-700">
                        {s.baseFee ? Number(s.baseFee).toLocaleString() : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-3 py-2">
                        {s.label ? (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${s.discount ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                            {s.label}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">None</span>
                        )}
                        {s.allAssignments.length > 1 && (
                          <span className="ml-1 text-xs text-gray-400">+{s.allAssignments.length - 1} more</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-right font-medium text-gray-900">
                        {s.baseFee ? Number(s.effective).toLocaleString() : <span className="text-gray-400">-</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {s.assignment ? (
                          <button
                            type="button"
                            onClick={() => setRemoveConfirm(s.assignment.id)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >Remove</button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setAssignModal({ studentId: s.student_id, studentName: s.student_name }); setAssignType('discount'); setAssignSelectedId(''); setAssignNotes(''); assignMutation.reset() }}
                            className="text-xs text-primary-600 hover:text-primary-800 font-medium"
                          >Assign</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* === ASSIGN MODAL === */}
      {assignModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setAssignModal(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Assign Discount</h3>
            <p className="text-sm text-gray-600 mb-4">Student: <span className="font-medium">{assignModal.studentName}</span></p>

            {/* Type toggle */}
            <div className="flex gap-2 mb-4">
              <button type="button" onClick={() => { setAssignType('discount'); setAssignSelectedId('') }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${assignType === 'discount' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >Discount</button>
              <button type="button" onClick={() => { setAssignType('scholarship'); setAssignSelectedId('') }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${assignType === 'scholarship' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >Scholarship</button>
            </div>

            {/* Selection */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {assignType === 'discount' ? 'Select Discount' : 'Select Scholarship'} <span className="text-red-500">*</span>
              </label>
              <select
                value={assignSelectedId}
                onChange={e => setAssignSelectedId(e.target.value)}
                className="input-field text-sm w-full"
              >
                <option value="">-- Choose --</option>
                {(assignType === 'discount' ? discountsList : scholarshipsList).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({assignType === 'discount'
                      ? (item.discount_type === 'PERCENTAGE' ? `${item.value}%` : `Rs. ${Number(item.value).toLocaleString()}`)
                      : (item.coverage === 'FULL' ? 'Full' : item.coverage === 'PERCENTAGE' ? `${item.value}%` : `Rs. ${Number(item.value).toLocaleString()}`)
                    })
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
              <input type="text" value={assignNotes} onChange={e => setAssignNotes(e.target.value)} className="input-field text-sm w-full" placeholder="e.g. Sibling discount" />
            </div>

            {assignMutation.isError && <p className="mb-3 text-sm text-red-600">{getErrorMessage(assignMutation.error, 'Failed to assign')}</p>}

            <div className="flex gap-3">
              <button type="button" onClick={() => setAssignModal(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="button" onClick={handleAssignSubmit} disabled={!assignSelectedId || assignMutation.isPending}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
              >{assignMutation.isPending ? 'Assigning...' : 'Assign'}</button>
            </div>
          </div>
        </div>
      )}

      {/* === BULK ASSIGN MODAL === */}
      {bulkModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setBulkModal(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">Bulk Assign to Class</h3>
            <p className="text-sm text-gray-600 mb-4">
              Assign to all {discGrid.length} students in <span className="font-medium">{selectedDiscountClassLabel}</span>
            </p>

            {/* Type toggle */}
            <div className="flex gap-2 mb-4">
              <button type="button" onClick={() => { setBulkType('discount'); setBulkSelectedId('') }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${bulkType === 'discount' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >Discount</button>
              <button type="button" onClick={() => { setBulkType('scholarship'); setBulkSelectedId('') }}
                className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${bulkType === 'scholarship' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              >Scholarship</button>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                {bulkType === 'discount' ? 'Select Discount' : 'Select Scholarship'} <span className="text-red-500">*</span>
              </label>
              <select
                value={bulkSelectedId}
                onChange={e => setBulkSelectedId(e.target.value)}
                className="input-field text-sm w-full"
              >
                <option value="">-- Choose --</option>
                {(bulkType === 'discount' ? discountsList : scholarshipsList).map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({bulkType === 'discount'
                      ? (item.discount_type === 'PERCENTAGE' ? `${item.value}%` : `Rs. ${Number(item.value).toLocaleString()}`)
                      : (item.coverage === 'FULL' ? 'Full' : item.coverage === 'PERCENTAGE' ? `${item.value}%` : `Rs. ${Number(item.value).toLocaleString()}`)
                    })
                  </option>
                ))}
              </select>
            </div>

            {bulkAssignMutation.isError && <p className="mb-3 text-sm text-red-600">{getErrorMessage(bulkAssignMutation.error, 'Failed to bulk assign')}</p>}
            {bulkAssignMutation.isSuccess && (
              <p className="mb-3 text-sm text-green-600">
                Assigned to {bulkAssignMutation.data?.data?.created} students. {bulkAssignMutation.data?.data?.skipped > 0 && `${bulkAssignMutation.data.data.skipped} skipped (already assigned).`}
              </p>
            )}

            <div className="flex gap-3">
              <button type="button" onClick={() => setBulkModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="button" onClick={handleBulkAssignSubmit} disabled={!bulkSelectedId || bulkAssignMutation.isPending}
                className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
              >{bulkAssignMutation.isPending ? 'Assigning...' : 'Assign to All'}</button>
            </div>
          </div>
        </div>
      )}

      {/* === REMOVE CONFIRMATION === */}
      {removeConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setRemoveConfirm(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Remove Discount?</h3>
            <p className="text-sm text-gray-600 mb-4">This will remove the discount/scholarship assignment from this student.</p>
            {removeMutation.isError && <p className="mb-3 text-sm text-red-600">{getErrorMessage(removeMutation.error, 'Failed to remove')}</p>}
            <div className="flex gap-3">
              <button type="button" onClick={() => setRemoveConfirm(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm">Cancel</button>
              <button type="button" onClick={() => removeMutation.mutate(removeConfirm)} disabled={removeMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
              >{removeMutation.isPending ? 'Removing...' : 'Remove'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
