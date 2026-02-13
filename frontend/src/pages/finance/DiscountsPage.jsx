import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../contexts/AuthContext'
import { discountApi, gradesApi, classesApi, studentsApi, sessionsApi } from '../../services/api'
import { useToast } from '../../components/Toast'

// ── Badge color maps ──────────────────────────────────────────────────────────

const discountTypeBadge = {
  PERCENTAGE: 'bg-blue-100 text-blue-800',
  FIXED: 'bg-green-100 text-green-800',
}

const scholarshipTypeBadge = {
  MERIT: 'bg-purple-100 text-purple-800',
  NEED: 'bg-orange-100 text-orange-800',
  SPORTS: 'bg-teal-100 text-teal-800',
  STAFF_CHILD: 'bg-indigo-100 text-indigo-800',
  OTHER: 'bg-gray-100 text-gray-800',
}

const coverageBadge = {
  FULL: 'bg-emerald-100 text-emerald-800',
  PERCENTAGE: 'bg-blue-100 text-blue-800',
  FIXED: 'bg-green-100 text-green-800',
}

// ── Empty form states ─────────────────────────────────────────────────────────

const EMPTY_DISCOUNT = {
  name: '',
  type: 'PERCENTAGE',
  value: '',
  applies_to: 'ALL',
  target_grade: '',
  target_class: '',
  start_date: '',
  end_date: '',
  stackable: false,
  is_active: true,
}

const EMPTY_SCHOLARSHIP = {
  name: '',
  type: 'MERIT',
  coverage: 'PERCENTAGE',
  value: '',
  description: '',
  max_recipients: '',
  is_active: true,
}

const EMPTY_ASSIGNMENT = {
  student: '',
  discount: '',
  scholarship: '',
  academic_year: '',
  notes: '',
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function PlusIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  )
}

function PencilIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
    </svg>
  )
}

function TrashIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
    </svg>
  )
}

function SearchIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  )
}

function UsersIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  )
}

function TagIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  )
}

function AcademicCapIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15v-3.75m0 0h10.5" />
    </svg>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DiscountsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const [tab, setTab] = useState('discounts')
  const [search, setSearch] = useState('')

  // ── Discount state ──
  const [showDiscountModal, setShowDiscountModal] = useState(false)
  const [editingDiscount, setEditingDiscount] = useState(null)
  const [discountForm, setDiscountForm] = useState(EMPTY_DISCOUNT)
  const [deleteDiscountConfirm, setDeleteDiscountConfirm] = useState(null)

  // ── Scholarship state ──
  const [showScholarshipModal, setShowScholarshipModal] = useState(false)
  const [editingScholarship, setEditingScholarship] = useState(null)
  const [scholarshipForm, setScholarshipForm] = useState(EMPTY_SCHOLARSHIP)
  const [deleteScholarshipConfirm, setDeleteScholarshipConfirm] = useState(null)

  // ── Student Assignment state ──
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assignForm, setAssignForm] = useState(EMPTY_ASSIGNMENT)
  const [removeAssignConfirm, setRemoveAssignConfirm] = useState(null)
  const [showBulkAssignModal, setShowBulkAssignModal] = useState(false)
  const [bulkAssignForm, setBulkAssignForm] = useState({
    discount_id: '',
    scholarship_id: '',
    class_id: '',
    grade_id: '',
    academic_year_id: '',
  })
  const [studentSearch, setStudentSearch] = useState('')

  // ══════════════════════════════════════════════════════════════════════════
  // QUERIES
  // ══════════════════════════════════════════════════════════════════════════

  const { data: discountsData, isLoading: discountsLoading } = useQuery({
    queryKey: ['discounts'],
    queryFn: () => discountApi.getDiscounts(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: scholarshipsData, isLoading: scholarshipsLoading } = useQuery({
    queryKey: ['scholarships'],
    queryFn: () => discountApi.getScholarships(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: studentDiscountsData, isLoading: assignmentsLoading } = useQuery({
    queryKey: ['studentDiscounts'],
    queryFn: () => discountApi.getStudentDiscounts(),
    staleTime: 2 * 60 * 1000,
  })

  const { data: gradesData } = useQuery({
    queryKey: ['grades'],
    queryFn: () => gradesApi.getGrades(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: classesData } = useQuery({
    queryKey: ['classes'],
    queryFn: () => classesApi.getClasses(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: studentsData } = useQuery({
    queryKey: ['students'],
    queryFn: () => studentsApi.getStudents(),
    staleTime: 5 * 60 * 1000,
  })

  const { data: sessionsData } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears(),
    staleTime: 5 * 60 * 1000,
  })

  // ── Normalize data arrays ──
  const allDiscounts = discountsData?.data?.results || discountsData?.data || []
  const allScholarships = scholarshipsData?.data?.results || scholarshipsData?.data || []
  const allAssignments = studentDiscountsData?.data?.results || studentDiscountsData?.data || []
  const allGrades = gradesData?.data?.results || gradesData?.data || []
  const allClasses = classesData?.data?.results || classesData?.data || []
  const allStudents = studentsData?.data?.results || studentsData?.data || []
  const allSessions = sessionsData?.data?.results || sessionsData?.data || []

  // ── Filtered data ──
  const filteredDiscounts = useMemo(() => {
    if (!search) return allDiscounts
    const s = search.toLowerCase()
    return allDiscounts.filter(
      (d) => d.name?.toLowerCase().includes(s) || d.type?.toLowerCase().includes(s)
    )
  }, [allDiscounts, search])

  const filteredScholarships = useMemo(() => {
    if (!search) return allScholarships
    const s = search.toLowerCase()
    return allScholarships.filter(
      (sc) =>
        sc.name?.toLowerCase().includes(s) ||
        sc.type?.toLowerCase().includes(s) ||
        sc.description?.toLowerCase().includes(s)
    )
  }, [allScholarships, search])

  const filteredAssignments = useMemo(() => {
    if (!search) return allAssignments
    const s = search.toLowerCase()
    return allAssignments.filter(
      (a) =>
        a.student_name?.toLowerCase().includes(s) ||
        a.discount_name?.toLowerCase().includes(s) ||
        a.scholarship_name?.toLowerCase().includes(s) ||
        a.class_name?.toLowerCase().includes(s)
    )
  }, [allAssignments, search])

  // Filtered student list for assignment modal search
  const filteredStudents = useMemo(() => {
    if (!studentSearch) return allStudents.slice(0, 20)
    const s = studentSearch.toLowerCase()
    return allStudents
      .filter((st) => st.name?.toLowerCase().includes(s) || st.roll_number?.toLowerCase().includes(s))
      .slice(0, 20)
  }, [allStudents, studentSearch])

  // ══════════════════════════════════════════════════════════════════════════
  // DISCOUNT MUTATIONS
  // ══════════════════════════════════════════════════════════════════════════

  const createDiscountMutation = useMutation({
    mutationFn: (data) => discountApi.createDiscount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] })
      closeDiscountModal()
      showSuccess('Discount created successfully!')
    },
    onError: (err) => {
      showError(err.response?.data?.name?.[0] || err.response?.data?.detail || 'Failed to create discount')
    },
  })

  const updateDiscountMutation = useMutation({
    mutationFn: ({ id, data }) => discountApi.updateDiscount(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] })
      closeDiscountModal()
      showSuccess('Discount updated successfully!')
    },
    onError: (err) => {
      showError(err.response?.data?.name?.[0] || err.response?.data?.detail || 'Failed to update discount')
    },
  })

  const deleteDiscountMutation = useMutation({
    mutationFn: (id) => discountApi.deleteDiscount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['discounts'] })
      queryClient.invalidateQueries({ queryKey: ['studentDiscounts'] })
      setDeleteDiscountConfirm(null)
      showSuccess('Discount deleted successfully!')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to delete discount')
    },
  })

  // ══════════════════════════════════════════════════════════════════════════
  // SCHOLARSHIP MUTATIONS
  // ══════════════════════════════════════════════════════════════════════════

  const createScholarshipMutation = useMutation({
    mutationFn: (data) => discountApi.createScholarship(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scholarships'] })
      closeScholarshipModal()
      showSuccess('Scholarship created successfully!')
    },
    onError: (err) => {
      showError(err.response?.data?.name?.[0] || err.response?.data?.detail || 'Failed to create scholarship')
    },
  })

  const updateScholarshipMutation = useMutation({
    mutationFn: ({ id, data }) => discountApi.updateScholarship(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scholarships'] })
      closeScholarshipModal()
      showSuccess('Scholarship updated successfully!')
    },
    onError: (err) => {
      showError(err.response?.data?.name?.[0] || err.response?.data?.detail || 'Failed to update scholarship')
    },
  })

  const deleteScholarshipMutation = useMutation({
    mutationFn: (id) => discountApi.deleteScholarship(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scholarships'] })
      queryClient.invalidateQueries({ queryKey: ['studentDiscounts'] })
      setDeleteScholarshipConfirm(null)
      showSuccess('Scholarship deleted successfully!')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to delete scholarship')
    },
  })

  // ══════════════════════════════════════════════════════════════════════════
  // STUDENT ASSIGNMENT MUTATIONS
  // ══════════════════════════════════════════════════════════════════════════

  const assignMutation = useMutation({
    mutationFn: (data) => discountApi.assignDiscount(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studentDiscounts'] })
      closeAssignModal()
      showSuccess('Discount/Scholarship assigned to student!')
    },
    onError: (err) => {
      const d = err.response?.data
      showError(d?.non_field_errors?.[0] || d?.detail || d?.student?.[0] || 'Failed to assign discount')
    },
  })

  const bulkAssignMutation = useMutation({
    mutationFn: (data) => discountApi.bulkAssign(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['studentDiscounts'] })
      closeBulkAssignModal()
      const count = res?.data?.assigned_count || res?.data?.count || 0
      showSuccess(`Bulk assignment complete! ${count} students assigned.`)
    },
    onError: (err) => {
      showError(err.response?.data?.detail || err.response?.data?.error || 'Bulk assignment failed')
    },
  })

  const removeAssignMutation = useMutation({
    mutationFn: (id) => discountApi.removeStudentDiscount(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studentDiscounts'] })
      setRemoveAssignConfirm(null)
      showSuccess('Assignment removed successfully!')
    },
    onError: (err) => {
      showError(err.response?.data?.detail || 'Failed to remove assignment')
    },
  })

  // ══════════════════════════════════════════════════════════════════════════
  // DISCOUNT HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const openAddDiscount = () => {
    setEditingDiscount(null)
    setDiscountForm(EMPTY_DISCOUNT)
    setShowDiscountModal(true)
  }

  const openEditDiscount = (discount) => {
    setEditingDiscount(discount)
    setDiscountForm({
      name: discount.name || '',
      type: discount.type || 'PERCENTAGE',
      value: discount.value || '',
      applies_to: discount.applies_to || 'ALL',
      target_grade: discount.target_grade || '',
      target_class: discount.target_class || '',
      start_date: discount.start_date || '',
      end_date: discount.end_date || '',
      stackable: discount.stackable || false,
      is_active: discount.is_active !== undefined ? discount.is_active : true,
    })
    setShowDiscountModal(true)
  }

  const closeDiscountModal = () => {
    setShowDiscountModal(false)
    setEditingDiscount(null)
    setDiscountForm(EMPTY_DISCOUNT)
  }

  const handleDiscountSubmit = (e) => {
    e.preventDefault()
    if (!discountForm.name.trim()) {
      showError('Discount name is required')
      return
    }
    if (!discountForm.value || parseFloat(discountForm.value) <= 0) {
      showError('Please enter a valid discount value')
      return
    }
    if (discountForm.type === 'PERCENTAGE' && parseFloat(discountForm.value) > 100) {
      showError('Percentage discount cannot exceed 100%')
      return
    }

    const payload = {
      name: discountForm.name.trim(),
      type: discountForm.type,
      value: parseFloat(discountForm.value),
      applies_to: discountForm.applies_to,
      stackable: discountForm.stackable,
      is_active: discountForm.is_active,
    }

    if (discountForm.applies_to === 'GRADE' && discountForm.target_grade) {
      payload.target_grade = parseInt(discountForm.target_grade)
    }
    if (discountForm.applies_to === 'CLASS' && discountForm.target_class) {
      payload.target_class = parseInt(discountForm.target_class)
    }
    if (discountForm.start_date) payload.start_date = discountForm.start_date
    if (discountForm.end_date) payload.end_date = discountForm.end_date

    if (editingDiscount) {
      updateDiscountMutation.mutate({ id: editingDiscount.id, data: payload })
    } else {
      createDiscountMutation.mutate(payload)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCHOLARSHIP HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const openAddScholarship = () => {
    setEditingScholarship(null)
    setScholarshipForm(EMPTY_SCHOLARSHIP)
    setShowScholarshipModal(true)
  }

  const openEditScholarship = (scholarship) => {
    setEditingScholarship(scholarship)
    setScholarshipForm({
      name: scholarship.name || '',
      type: scholarship.type || 'MERIT',
      coverage: scholarship.coverage || 'PERCENTAGE',
      value: scholarship.value || '',
      description: scholarship.description || '',
      max_recipients: scholarship.max_recipients || '',
      is_active: scholarship.is_active !== undefined ? scholarship.is_active : true,
    })
    setShowScholarshipModal(true)
  }

  const closeScholarshipModal = () => {
    setShowScholarshipModal(false)
    setEditingScholarship(null)
    setScholarshipForm(EMPTY_SCHOLARSHIP)
  }

  const handleScholarshipSubmit = (e) => {
    e.preventDefault()
    if (!scholarshipForm.name.trim()) {
      showError('Scholarship name is required')
      return
    }
    if (scholarshipForm.coverage !== 'FULL' && (!scholarshipForm.value || parseFloat(scholarshipForm.value) <= 0)) {
      showError('Please enter a valid scholarship value')
      return
    }
    if (scholarshipForm.coverage === 'PERCENTAGE' && parseFloat(scholarshipForm.value) > 100) {
      showError('Percentage coverage cannot exceed 100%')
      return
    }

    const payload = {
      name: scholarshipForm.name.trim(),
      type: scholarshipForm.type,
      coverage: scholarshipForm.coverage,
      description: scholarshipForm.description,
      is_active: scholarshipForm.is_active,
    }

    if (scholarshipForm.coverage === 'FULL') {
      payload.value = 100
    } else {
      payload.value = parseFloat(scholarshipForm.value)
    }

    if (scholarshipForm.max_recipients) {
      payload.max_recipients = parseInt(scholarshipForm.max_recipients)
    }

    if (editingScholarship) {
      updateScholarshipMutation.mutate({ id: editingScholarship.id, data: payload })
    } else {
      createScholarshipMutation.mutate(payload)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ASSIGNMENT HANDLERS
  // ══════════════════════════════════════════════════════════════════════════

  const openAssignModal = () => {
    setAssignForm(EMPTY_ASSIGNMENT)
    setStudentSearch('')
    setShowAssignModal(true)
  }

  const closeAssignModal = () => {
    setShowAssignModal(false)
    setAssignForm(EMPTY_ASSIGNMENT)
    setStudentSearch('')
  }

  const handleAssignSubmit = (e) => {
    e.preventDefault()
    if (!assignForm.student) {
      showError('Please select a student')
      return
    }
    if (!assignForm.discount && !assignForm.scholarship) {
      showError('Please select a discount or scholarship')
      return
    }
    if (assignForm.discount && assignForm.scholarship) {
      showError('Please select either a discount or a scholarship, not both')
      return
    }
    if (!assignForm.academic_year) {
      showError('Please select an academic year')
      return
    }

    const payload = {
      student: parseInt(assignForm.student),
      academic_year: parseInt(assignForm.academic_year),
    }
    if (assignForm.discount) payload.discount = parseInt(assignForm.discount)
    if (assignForm.scholarship) payload.scholarship = parseInt(assignForm.scholarship)
    if (assignForm.notes) payload.notes = assignForm.notes

    assignMutation.mutate(payload)
  }

  const openBulkAssignModal = () => {
    setBulkAssignForm({
      discount_id: '',
      scholarship_id: '',
      class_id: '',
      grade_id: '',
      academic_year_id: '',
    })
    setShowBulkAssignModal(true)
  }

  const closeBulkAssignModal = () => {
    setShowBulkAssignModal(false)
    setBulkAssignForm({
      discount_id: '',
      scholarship_id: '',
      class_id: '',
      grade_id: '',
      academic_year_id: '',
    })
  }

  const handleBulkAssignSubmit = (e) => {
    e.preventDefault()
    if (!bulkAssignForm.discount_id && !bulkAssignForm.scholarship_id) {
      showError('Please select a discount or scholarship')
      return
    }
    if (!bulkAssignForm.class_id && !bulkAssignForm.grade_id) {
      showError('Please select a class or grade to target')
      return
    }
    if (!bulkAssignForm.academic_year_id) {
      showError('Please select an academic year')
      return
    }

    const payload = {
      academic_year_id: parseInt(bulkAssignForm.academic_year_id),
    }
    if (bulkAssignForm.discount_id) payload.discount_id = parseInt(bulkAssignForm.discount_id)
    if (bulkAssignForm.scholarship_id) payload.scholarship_id = parseInt(bulkAssignForm.scholarship_id)
    if (bulkAssignForm.class_id) payload.class_id = parseInt(bulkAssignForm.class_id)
    if (bulkAssignForm.grade_id) payload.grade_id = parseInt(bulkAssignForm.grade_id)

    bulkAssignMutation.mutate(payload)
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATS
  // ══════════════════════════════════════════════════════════════════════════

  const stats = useMemo(() => {
    const activeDiscounts = allDiscounts.filter((d) => d.is_active).length
    const activeScholarships = allScholarships.filter((s) => s.is_active).length
    const totalAssignments = allAssignments.length
    return { activeDiscounts, activeScholarships, totalAssignments }
  }, [allDiscounts, allScholarships, allAssignments])

  // ══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  const formatAppliesToLabel = (discount) => {
    if (discount.applies_to === 'ALL') return 'All Students'
    if (discount.applies_to === 'GRADE') return `Grade: ${discount.target_grade_name || discount.target_grade || '--'}`
    if (discount.applies_to === 'CLASS') return `Class: ${discount.target_class_name || discount.target_class || '--'}`
    if (discount.applies_to === 'SIBLING') return 'Siblings'
    return discount.applies_to || '--'
  }

  const formatValue = (type, value) => {
    if (type === 'PERCENTAGE') return `${value}%`
    return `Rs. ${Number(value).toLocaleString()}`
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Discounts & Scholarships</h1>
          <p className="text-sm text-gray-600">Manage discount rules, scholarship programs, and student assignments</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="card !p-4 flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <TagIcon className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Active Discounts</p>
            <p className="text-2xl font-bold text-gray-900">{stats.activeDiscounts}</p>
          </div>
        </div>
        <div className="card !p-4 flex items-center gap-3">
          <div className="p-2 bg-purple-50 rounded-lg">
            <AcademicCapIcon className="w-6 h-6 text-purple-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Active Scholarships</p>
            <p className="text-2xl font-bold text-gray-900">{stats.activeScholarships}</p>
          </div>
        </div>
        <div className="card !p-4 flex items-center gap-3">
          <div className="p-2 bg-green-50 rounded-lg">
            <UsersIcon className="w-6 h-6 text-green-600" />
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase">Student Assignments</p>
            <p className="text-2xl font-bold text-gray-900">{stats.totalAssignments}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'discounts', label: 'Discounts' },
          { key: 'scholarships', label: 'Scholarships' },
          { key: 'assignments', label: 'Student Assignments' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setSearch('') }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          DISCOUNTS TAB
          ═══════════════════════════════════════════════════════════════════════ */}
      {tab === 'discounts' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                className="input pl-9"
                placeholder="Search discounts..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button onClick={openAddDiscount} className="btn btn-primary flex items-center gap-1">
              <PlusIcon className="w-4 h-4" />
              Add Discount
            </button>
          </div>

          <div className="card">
            {discountsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading discounts...</p>
              </div>
            ) : filteredDiscounts.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {allDiscounts.length === 0
                  ? 'No discounts created yet. Click "Add Discount" to get started.'
                  : 'No discounts match your search.'}
              </div>
            ) : (
              <>
                {/* Mobile view */}
                <div className="sm:hidden space-y-2">
                  {filteredDiscounts.map((discount) => (
                    <div key={discount.id} className="p-3 border border-gray-200 rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm text-gray-900 truncate">{discount.name}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${discountTypeBadge[discount.type] || 'bg-gray-100 text-gray-800'}`}>
                              {discount.type}
                            </span>
                            <span className="text-xs text-gray-600 font-medium">
                              {formatValue(discount.type, discount.value)}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs flex-shrink-0 ml-2 ${
                          discount.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {discount.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">{formatAppliesToLabel(discount)}</p>
                      {(discount.start_date || discount.end_date) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {discount.start_date || '--'} to {discount.end_date || '--'}
                        </p>
                      )}
                      <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                        <button onClick={() => openEditDiscount(discount)} className="text-xs text-blue-600 font-medium">Edit</button>
                        <button onClick={() => setDeleteDiscountConfirm(discount)} className="text-xs text-red-600 font-medium">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Applies To</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dates</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredDiscounts.map((discount) => (
                        <tr key={discount.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            <div className="flex items-center gap-2">
                              {discount.name}
                              {discount.stackable && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700">
                                  Stackable
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${discountTypeBadge[discount.type] || 'bg-gray-100 text-gray-800'}`}>
                              {discount.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                            {formatValue(discount.type, discount.value)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatAppliesToLabel(discount)}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              discount.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {discount.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {discount.start_date || discount.end_date
                              ? `${discount.start_date || '--'} to ${discount.end_date || '--'}`
                              : <span className="text-gray-400 italic">No dates</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => openEditDiscount(discount)}
                              className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleteDiscountConfirm(discount)}
                              className="text-sm text-red-600 hover:text-red-800 font-medium"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SCHOLARSHIPS TAB
          ═══════════════════════════════════════════════════════════════════════ */}
      {tab === 'scholarships' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                className="input pl-9"
                placeholder="Search scholarships..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button onClick={openAddScholarship} className="btn btn-primary flex items-center gap-1">
              <PlusIcon className="w-4 h-4" />
              Add Scholarship
            </button>
          </div>

          <div className="card">
            {scholarshipsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading scholarships...</p>
              </div>
            ) : filteredScholarships.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {allScholarships.length === 0
                  ? 'No scholarships created yet. Click "Add Scholarship" to get started.'
                  : 'No scholarships match your search.'}
              </div>
            ) : (
              <>
                {/* Mobile view */}
                <div className="sm:hidden space-y-2">
                  {filteredScholarships.map((sc) => (
                    <div key={sc.id} className="p-3 border border-gray-200 rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm text-gray-900 truncate">{sc.name}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${scholarshipTypeBadge[sc.type] || 'bg-gray-100 text-gray-800'}`}>
                              {sc.type}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${coverageBadge[sc.coverage] || 'bg-gray-100 text-gray-800'}`}>
                              {sc.coverage === 'FULL' ? 'Full Coverage' : formatValue(sc.coverage, sc.value)}
                            </span>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs flex-shrink-0 ml-2 ${
                          sc.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {sc.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      {sc.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{sc.description}</p>
                      )}
                      {sc.max_recipients && (
                        <p className="text-xs text-gray-400 mt-0.5">Max recipients: {sc.max_recipients}</p>
                      )}
                      <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                        <button onClick={() => openEditScholarship(sc)} className="text-xs text-blue-600 font-medium">Edit</button>
                        <button onClick={() => setDeleteScholarshipConfirm(sc)} className="text-xs text-red-600 font-medium">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Coverage</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Value</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Max Recipients</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredScholarships.map((sc) => (
                        <tr key={sc.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <div>
                              <p className="text-sm font-medium text-gray-900">{sc.name}</p>
                              {sc.description && (
                                <p className="text-xs text-gray-500 truncate max-w-xs">{sc.description}</p>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${scholarshipTypeBadge[sc.type] || 'bg-gray-100 text-gray-800'}`}>
                              {sc.type?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${coverageBadge[sc.coverage] || 'bg-gray-100 text-gray-800'}`}>
                              {sc.coverage}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 font-medium">
                            {sc.coverage === 'FULL' ? '100%' : formatValue(sc.coverage, sc.value)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {sc.max_recipients || <span className="text-gray-400 italic">Unlimited</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              sc.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {sc.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => openEditScholarship(sc)}
                              className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleteScholarshipConfirm(sc)}
                              className="text-sm text-red-600 hover:text-red-800 font-medium"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          STUDENT ASSIGNMENTS TAB
          ═══════════════════════════════════════════════════════════════════════ */}
      {tab === 'assignments' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                className="input pl-9"
                placeholder="Search by student, class, or discount..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <button onClick={openBulkAssignModal} className="btn btn-secondary flex items-center gap-1">
                <UsersIcon className="w-4 h-4" />
                Bulk Assign
              </button>
              <button onClick={openAssignModal} className="btn btn-primary flex items-center gap-1">
                <PlusIcon className="w-4 h-4" />
                Assign to Student
              </button>
            </div>
          </div>

          <div className="card">
            {assignmentsLoading ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
                <p className="text-gray-500 mt-2">Loading assignments...</p>
              </div>
            ) : filteredAssignments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {allAssignments.length === 0
                  ? 'No discount/scholarship assignments yet. Assign one to a student or use bulk assign.'
                  : 'No assignments match your search.'}
              </div>
            ) : (
              <>
                <div className="mb-3 text-sm text-gray-500">
                  Showing {filteredAssignments.length} of {allAssignments.length} assignments
                  {search && ' (filtered)'}
                </div>

                {/* Mobile view */}
                <div className="sm:hidden space-y-2">
                  {filteredAssignments.map((a) => (
                    <div key={a.id} className="p-3 border border-gray-200 rounded-lg">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm text-gray-900 truncate">{a.student_name || '--'}</p>
                          <p className="text-xs text-gray-500">{a.class_name || '--'}</p>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-xs flex-shrink-0 ml-2 ${
                          a.is_active !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {a.is_active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                        {a.discount_name && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                            {a.discount_name}
                          </span>
                        )}
                        {a.scholarship_name && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                            {a.scholarship_name}
                          </span>
                        )}
                      </div>
                      {a.academic_year_name && (
                        <p className="text-xs text-gray-400 mt-0.5">Year: {a.academic_year_name}</p>
                      )}
                      <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                        <button onClick={() => setRemoveAssignConfirm(a)} className="text-xs text-red-600 font-medium">Remove</button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop table */}
                <div className="hidden sm:block overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Discount / Scholarship</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Academic Year</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredAssignments.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {a.student_name || '--'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {a.class_name || '--'}
                          </td>
                          <td className="px-4 py-3">
                            {a.discount_name && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {a.discount_name}
                              </span>
                            )}
                            {a.scholarship_name && (
                              <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                                {a.scholarship_name}
                              </span>
                            )}
                            {!a.discount_name && !a.scholarship_name && (
                              <span className="text-gray-400 italic text-sm">--</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {a.academic_year_name || '--'}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              a.is_active !== false ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {a.is_active !== false ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => setRemoveAssignConfirm(a)}
                              className="text-sm text-red-600 hover:text-red-800 font-medium"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          DISCOUNT MODAL
          ═══════════════════════════════════════════════════════════════════════ */}
      {showDiscountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingDiscount ? 'Edit Discount' : 'Create Discount'}
            </h2>

            <form onSubmit={handleDiscountSubmit} className="space-y-4">
              <div>
                <label className="label">Discount Name *</label>
                <input
                  type="text"
                  className="input"
                  value={discountForm.name}
                  onChange={(e) => setDiscountForm({ ...discountForm, name: e.target.value })}
                  placeholder="e.g., Early Bird Discount, Sibling Discount"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Type *</label>
                  <select
                    className="input"
                    value={discountForm.type}
                    onChange={(e) => setDiscountForm({ ...discountForm, type: e.target.value })}
                  >
                    <option value="PERCENTAGE">Percentage (%)</option>
                    <option value="FIXED">Fixed Amount (Rs.)</option>
                  </select>
                </div>
                <div>
                  <label className="label">Value *</label>
                  <input
                    type="number"
                    className="input"
                    value={discountForm.value}
                    onChange={(e) => setDiscountForm({ ...discountForm, value: e.target.value })}
                    placeholder={discountForm.type === 'PERCENTAGE' ? 'e.g., 10' : 'e.g., 500'}
                    min="0"
                    max={discountForm.type === 'PERCENTAGE' ? '100' : undefined}
                    step="any"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="label">Applies To</label>
                <select
                  className="input"
                  value={discountForm.applies_to}
                  onChange={(e) => setDiscountForm({ ...discountForm, applies_to: e.target.value, target_grade: '', target_class: '' })}
                >
                  <option value="ALL">All Students</option>
                  <option value="GRADE">Specific Grade</option>
                  <option value="CLASS">Specific Class</option>
                  <option value="SIBLING">Siblings</option>
                </select>
              </div>

              {discountForm.applies_to === 'GRADE' && (
                <div>
                  <label className="label">Target Grade</label>
                  <select
                    className="input"
                    value={discountForm.target_grade}
                    onChange={(e) => setDiscountForm({ ...discountForm, target_grade: e.target.value })}
                  >
                    <option value="">Select Grade</option>
                    {allGrades.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {discountForm.applies_to === 'CLASS' && (
                <div>
                  <label className="label">Target Class</label>
                  <select
                    className="input"
                    value={discountForm.target_class}
                    onChange={(e) => setDiscountForm({ ...discountForm, target_class: e.target.value })}
                  >
                    <option value="">Select Class</option>
                    {allClasses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Start Date</label>
                  <input
                    type="date"
                    className="input"
                    value={discountForm.start_date}
                    onChange={(e) => setDiscountForm({ ...discountForm, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">End Date</label>
                  <input
                    type="date"
                    className="input"
                    value={discountForm.end_date}
                    onChange={(e) => setDiscountForm({ ...discountForm, end_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={discountForm.stackable}
                    onChange={(e) => setDiscountForm({ ...discountForm, stackable: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">Stackable (can combine with other discounts)</span>
                </label>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={discountForm.is_active}
                    onChange={(e) => setDiscountForm({ ...discountForm, is_active: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">Active</span>
                </label>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={closeDiscountModal} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createDiscountMutation.isPending || updateDiscountMutation.isPending}
                  className="btn btn-primary"
                >
                  {(createDiscountMutation.isPending || updateDiscountMutation.isPending)
                    ? 'Saving...'
                    : editingDiscount ? 'Save Changes' : 'Create Discount'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          SCHOLARSHIP MODAL
          ═══════════════════════════════════════════════════════════════════════ */}
      {showScholarshipModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingScholarship ? 'Edit Scholarship' : 'Create Scholarship'}
            </h2>

            <form onSubmit={handleScholarshipSubmit} className="space-y-4">
              <div>
                <label className="label">Scholarship Name *</label>
                <input
                  type="text"
                  className="input"
                  value={scholarshipForm.name}
                  onChange={(e) => setScholarshipForm({ ...scholarshipForm, name: e.target.value })}
                  placeholder="e.g., Academic Excellence Scholarship"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Scholarship Type *</label>
                  <select
                    className="input"
                    value={scholarshipForm.type}
                    onChange={(e) => setScholarshipForm({ ...scholarshipForm, type: e.target.value })}
                  >
                    <option value="MERIT">Merit</option>
                    <option value="NEED">Need-Based</option>
                    <option value="SPORTS">Sports</option>
                    <option value="STAFF_CHILD">Staff Child</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label">Coverage *</label>
                  <select
                    className="input"
                    value={scholarshipForm.coverage}
                    onChange={(e) => setScholarshipForm({ ...scholarshipForm, coverage: e.target.value, value: e.target.value === 'FULL' ? '100' : scholarshipForm.value })}
                  >
                    <option value="FULL">Full (100%)</option>
                    <option value="PERCENTAGE">Percentage</option>
                    <option value="FIXED">Fixed Amount</option>
                  </select>
                </div>
              </div>

              {scholarshipForm.coverage !== 'FULL' && (
                <div>
                  <label className="label">Value *</label>
                  <input
                    type="number"
                    className="input"
                    value={scholarshipForm.value}
                    onChange={(e) => setScholarshipForm({ ...scholarshipForm, value: e.target.value })}
                    placeholder={scholarshipForm.coverage === 'PERCENTAGE' ? 'e.g., 50' : 'e.g., 5000'}
                    min="0"
                    max={scholarshipForm.coverage === 'PERCENTAGE' ? '100' : undefined}
                    step="any"
                    required
                  />
                </div>
              )}

              <div>
                <label className="label">Description</label>
                <textarea
                  className="input"
                  rows={3}
                  value={scholarshipForm.description}
                  onChange={(e) => setScholarshipForm({ ...scholarshipForm, description: e.target.value })}
                  placeholder="Describe the scholarship criteria and conditions..."
                />
              </div>

              <div>
                <label className="label">Max Recipients</label>
                <input
                  type="number"
                  className="input"
                  value={scholarshipForm.max_recipients}
                  onChange={(e) => setScholarshipForm({ ...scholarshipForm, max_recipients: e.target.value })}
                  placeholder="Leave empty for unlimited"
                  min="1"
                />
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scholarshipForm.is_active}
                    onChange={(e) => setScholarshipForm({ ...scholarshipForm, is_active: e.target.checked })}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">Active</span>
                </label>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={closeScholarshipModal} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createScholarshipMutation.isPending || updateScholarshipMutation.isPending}
                  className="btn btn-primary"
                >
                  {(createScholarshipMutation.isPending || updateScholarshipMutation.isPending)
                    ? 'Saving...'
                    : editingScholarship ? 'Save Changes' : 'Create Scholarship'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          ASSIGN MODAL (Single Student)
          ═══════════════════════════════════════════════════════════════════════ */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Assign Discount / Scholarship</h2>

            <form onSubmit={handleAssignSubmit} className="space-y-4">
              {/* Student search */}
              <div>
                <label className="label">Student *</label>
                <div className="relative">
                  <input
                    type="text"
                    className="input"
                    placeholder="Type to search students..."
                    value={studentSearch}
                    onChange={(e) => {
                      setStudentSearch(e.target.value)
                      if (assignForm.student) {
                        setAssignForm({ ...assignForm, student: '' })
                      }
                    }}
                  />
                  {assignForm.student && (
                    <div className="mt-1 px-2 py-1 bg-blue-50 text-blue-800 text-xs rounded inline-flex items-center gap-1">
                      Selected: {allStudents.find((s) => String(s.id) === String(assignForm.student))?.name || `ID ${assignForm.student}`}
                      <button type="button" onClick={() => { setAssignForm({ ...assignForm, student: '' }); setStudentSearch('') }} className="ml-1 text-blue-600 hover:text-blue-800">
                        x
                      </button>
                    </div>
                  )}
                </div>
                {studentSearch && !assignForm.student && (
                  <div className="mt-1 border border-gray-200 rounded-lg max-h-40 overflow-y-auto bg-white shadow-sm">
                    {filteredStudents.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-400">No students found</div>
                    ) : (
                      filteredStudents.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0"
                          onClick={() => {
                            setAssignForm({ ...assignForm, student: st.id })
                            setStudentSearch(st.name)
                          }}
                        >
                          <span className="font-medium text-gray-900">{st.name}</span>
                          <span className="text-gray-500 ml-2">Roll #{st.roll_number}</span>
                          {st.class_name && <span className="text-gray-400 ml-2">({st.class_name})</span>}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Discount selection */}
              <div>
                <label className="label">Discount</label>
                <select
                  className="input"
                  value={assignForm.discount}
                  onChange={(e) => setAssignForm({ ...assignForm, discount: e.target.value, scholarship: '' })}
                  disabled={!!assignForm.scholarship}
                >
                  <option value="">-- Select Discount --</option>
                  {allDiscounts.filter((d) => d.is_active).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({formatValue(d.type, d.value)})
                    </option>
                  ))}
                </select>
              </div>

              {/* OR divider */}
              <div className="flex items-center gap-3">
                <hr className="flex-1 border-gray-200" />
                <span className="text-xs font-medium text-gray-400 uppercase">or</span>
                <hr className="flex-1 border-gray-200" />
              </div>

              {/* Scholarship selection */}
              <div>
                <label className="label">Scholarship</label>
                <select
                  className="input"
                  value={assignForm.scholarship}
                  onChange={(e) => setAssignForm({ ...assignForm, scholarship: e.target.value, discount: '' })}
                  disabled={!!assignForm.discount}
                >
                  <option value="">-- Select Scholarship --</option>
                  {allScholarships.filter((s) => s.is_active).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.coverage === 'FULL' ? '100%' : formatValue(s.coverage, s.value)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Academic Year */}
              <div>
                <label className="label">Academic Year *</label>
                <select
                  className="input"
                  value={assignForm.academic_year}
                  onChange={(e) => setAssignForm({ ...assignForm, academic_year: e.target.value })}
                  required
                >
                  <option value="">-- Select Academic Year --</option>
                  {allSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.is_current ? ' (Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input"
                  rows={2}
                  value={assignForm.notes}
                  onChange={(e) => setAssignForm({ ...assignForm, notes: e.target.value })}
                  placeholder="Optional notes about this assignment..."
                />
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={closeAssignModal} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assignMutation.isPending}
                  className="btn btn-primary"
                >
                  {assignMutation.isPending ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          BULK ASSIGN MODAL
          ═══════════════════════════════════════════════════════════════════════ */}
      {showBulkAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Bulk Assign</h2>
            <p className="text-sm text-gray-500 mb-4">
              Assign a discount or scholarship to all students in a class or grade at once.
            </p>

            <form onSubmit={handleBulkAssignSubmit} className="space-y-4">
              {/* Discount selection */}
              <div>
                <label className="label">Discount</label>
                <select
                  className="input"
                  value={bulkAssignForm.discount_id}
                  onChange={(e) => setBulkAssignForm({ ...bulkAssignForm, discount_id: e.target.value, scholarship_id: '' })}
                  disabled={!!bulkAssignForm.scholarship_id}
                >
                  <option value="">-- Select Discount --</option>
                  {allDiscounts.filter((d) => d.is_active).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({formatValue(d.type, d.value)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <hr className="flex-1 border-gray-200" />
                <span className="text-xs font-medium text-gray-400 uppercase">or</span>
                <hr className="flex-1 border-gray-200" />
              </div>

              {/* Scholarship selection */}
              <div>
                <label className="label">Scholarship</label>
                <select
                  className="input"
                  value={bulkAssignForm.scholarship_id}
                  onChange={(e) => setBulkAssignForm({ ...bulkAssignForm, scholarship_id: e.target.value, discount_id: '' })}
                  disabled={!!bulkAssignForm.discount_id}
                >
                  <option value="">-- Select Scholarship --</option>
                  {allScholarships.filter((s) => s.is_active).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.coverage === 'FULL' ? '100%' : formatValue(s.coverage, s.value)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Target: Grade or Class */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Grade</label>
                  <select
                    className="input"
                    value={bulkAssignForm.grade_id}
                    onChange={(e) => setBulkAssignForm({ ...bulkAssignForm, grade_id: e.target.value, class_id: '' })}
                    disabled={!!bulkAssignForm.class_id}
                  >
                    <option value="">-- Select Grade --</option>
                    {allGrades.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Class</label>
                  <select
                    className="input"
                    value={bulkAssignForm.class_id}
                    onChange={(e) => setBulkAssignForm({ ...bulkAssignForm, class_id: e.target.value, grade_id: '' })}
                    disabled={!!bulkAssignForm.grade_id}
                  >
                    <option value="">-- Select Class --</option>
                    {allClasses.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-400 -mt-2">Choose either a grade or a specific class, not both.</p>

              {/* Academic Year */}
              <div>
                <label className="label">Academic Year *</label>
                <select
                  className="input"
                  value={bulkAssignForm.academic_year_id}
                  onChange={(e) => setBulkAssignForm({ ...bulkAssignForm, academic_year_id: e.target.value })}
                  required
                >
                  <option value="">-- Select Academic Year --</option>
                  {allSessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.is_current ? ' (Current)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Warning */}
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-xs text-yellow-800">
                  This will assign the selected discount/scholarship to every student in the chosen class/grade.
                  Students who already have this assignment will be skipped.
                </p>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button type="button" onClick={closeBulkAssignModal} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={bulkAssignMutation.isPending}
                  className="btn btn-primary"
                >
                  {bulkAssignMutation.isPending ? 'Assigning...' : 'Bulk Assign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          DELETE DISCOUNT CONFIRMATION
          ═══════════════════════════════════════════════════════════════════════ */}
      {deleteDiscountConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Discount</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteDiscountConfirm.name}</strong>?
              This will also remove all student assignments for this discount.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteDiscountConfirm(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteDiscountMutation.mutate(deleteDiscountConfirm.id)}
                disabled={deleteDiscountMutation.isPending}
                className="btn btn-danger"
              >
                {deleteDiscountMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          DELETE SCHOLARSHIP CONFIRMATION
          ═══════════════════════════════════════════════════════════════════════ */}
      {deleteScholarshipConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Scholarship</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteScholarshipConfirm.name}</strong>?
              This will also remove all student assignments for this scholarship.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteScholarshipConfirm(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => deleteScholarshipMutation.mutate(deleteScholarshipConfirm.id)}
                disabled={deleteScholarshipMutation.isPending}
                className="btn btn-danger"
              >
                {deleteScholarshipMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          REMOVE ASSIGNMENT CONFIRMATION
          ═══════════════════════════════════════════════════════════════════════ */}
      {removeAssignConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Remove Assignment</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to remove the{' '}
              <strong>{removeAssignConfirm.discount_name || removeAssignConfirm.scholarship_name}</strong>{' '}
              assignment from <strong>{removeAssignConfirm.student_name}</strong>?
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setRemoveAssignConfirm(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => removeAssignMutation.mutate(removeAssignConfirm.id)}
                disabled={removeAssignMutation.isPending}
                className="btn btn-danger"
              >
                {removeAssignMutation.isPending ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
