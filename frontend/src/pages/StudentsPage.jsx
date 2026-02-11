import { useState, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { studentsApi, classesApi, schoolsApi } from '../services/api'
import { useToast } from '../components/Toast'
import * as XLSX from 'xlsx'

// Phone format note: Use dashes (0300-1234567) to prevent Excel scientific notation

export default function StudentsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { showError, showSuccess, showWarning } = useToast()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const fileInputRef = useRef(null)

  const [selectedSchoolId, setSelectedSchoolId] = useState(user?.school_id || null)
  const [selectedClass, setSelectedClass] = useState('')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingStudent, setEditingStudent] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkData, setBulkData] = useState({ class_id: '', students: [] })
  const [isUploading, setIsUploading] = useState(false)
  const [studentForm, setStudentForm] = useState({
    name: '',
    roll_number: '',
    parent_phone: '',
    parent_name: '',
    class_id: '',
  })

  // Fetch schools for Super Admin
  const { data: schoolsData } = useQuery({
    queryKey: ['admin-schools'],
    queryFn: () => schoolsApi.getAdminSchools(),
    enabled: isSuperAdmin,
  })

  // Set first school as default for Super Admin
  useEffect(() => {
    if (isSuperAdmin && (schoolsData?.data?.results || schoolsData?.data)?.length > 0 && !selectedSchoolId) {
      setSelectedSchoolId(schoolsData.data.results[0].id)
    }
  }, [isSuperAdmin, schoolsData, selectedSchoolId])

  // Fetch classes (cached)
  const { data: classesData } = useQuery({
    queryKey: ['classes', selectedSchoolId],
    queryFn: () => classesApi.getClasses({ school_id: selectedSchoolId }),
    enabled: !!selectedSchoolId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Fetch ALL students once for this school (client-side filtering)
  const { data: studentsData, isLoading } = useQuery({
    queryKey: ['students', selectedSchoolId],
    queryFn: () => studentsApi.getStudents({
      school_id: selectedSchoolId,
    }),
    enabled: !!selectedSchoolId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  })

  // Add student mutation
  const addMutation = useMutation({
    mutationFn: (data) => studentsApi.createStudent(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['students'])
      queryClient.invalidateQueries(['classes'])
      closeModal()
      showSuccess('Student added successfully!')
    },
    onError: (error) => {
      const message = error.response?.data?.roll_number?.[0] ||
                      error.response?.data?.detail ||
                      error.message ||
                      'Failed to add student'
      showError(message)
    },
  })

  // Update student mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => studentsApi.updateStudent(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['students'])
      closeModal()
      showSuccess('Student updated successfully!')
    },
    onError: (error) => {
      const message = error.response?.data?.roll_number?.[0] ||
                      error.response?.data?.detail ||
                      error.message ||
                      'Failed to update student'
      showError(message)
    },
  })

  // Delete student mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => studentsApi.deleteStudent(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['students'])
      queryClient.invalidateQueries(['classes'])
      setDeleteConfirm(null)
      showSuccess('Student deleted successfully!')
    },
    onError: (error) => {
      const message = error.response?.data?.detail ||
                      error.message ||
                      'Failed to delete student'
      showError(message)
    },
  })

  // Modal handlers
  const openAddModal = () => {
    setEditingStudent(null)
    setStudentForm({
      name: '',
      roll_number: '',
      parent_phone: '',
      parent_name: '',
      class_id: selectedClass || '',
    })
    setShowModal(true)
  }

  const openEditModal = (student) => {
    setEditingStudent(student)
    setStudentForm({
      name: student.name,
      roll_number: student.roll_number,
      parent_phone: student.parent_phone || '',
      parent_name: student.parent_name || '',
      class_id: student.class_obj?.toString() || '',
    })
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingStudent(null)
    setStudentForm({
      name: '',
      roll_number: '',
      parent_phone: '',
      parent_name: '',
      class_id: '',
    })
  }

  const handleSubmit = () => {
    if (!studentForm.class_id) {
      showError('Please select a class')
      return
    }
    if (!studentForm.name || !studentForm.roll_number) {
      showError('Name and Roll Number are required')
      return
    }

    // Normalize phone number if provided
    const normalizedPhone = studentForm.parent_phone ? parsePhone(studentForm.parent_phone) : ''

    const data = {
      name: studentForm.name,
      roll_number: studentForm.roll_number,
      parent_phone: normalizedPhone,
      parent_name: studentForm.parent_name,
    }

    if (editingStudent) {
      updateMutation.mutate({ id: editingStudent.id, data })
    } else {
      addMutation.mutate({
        school: selectedSchoolId,
        class_obj: parseInt(studentForm.class_id),
        ...data,
      })
    }
  }

  // Download Students Excel (or blank template if no students exist)
  const downloadExcelTemplate = () => {
    const dlClasses = classesData?.data?.results || classesData?.data || []
    const selectedSchool = schools.find(s => s.id === selectedSchoolId)

    if (dlClasses.length === 0) {
      showError('Please add classes before downloading')
      return
    }

    const wb = XLSX.utils.book_new()

    // Instruction rows + header (same format the upload parser expects)
    const sheetData = [
      [`School: ${selectedSchool?.name || 'Unknown'}`],
      [`Classes: ${dlClasses.map(c => c.name).join(' | ')}`],
      ['Phone (optional): Use dashes like 0300-1234567 - can be added later'],
      [], // Empty row separator
      ['class_name', 'roll_number', 'student_name', 'parent_phone', 'parent_name'],
    ]

    const existingStudents = studentsData?.data?.results || studentsData?.data || []

    if (existingStudents.length > 0) {
      // Export real student data sorted by class then roll number
      const sorted = [...existingStudents].sort((a, b) => {
        if (a.class_name !== b.class_name) return (a.class_name || '').localeCompare(b.class_name || '')
        return (parseInt(a.roll_number) || 0) - (parseInt(b.roll_number) || 0)
      })
      sorted.forEach(s => {
        sheetData.push([
          s.class_name || '',
          s.roll_number || '',
          s.name || '',
          s.parent_phone || '',
          s.parent_name || '',
        ])
      })
    } else {
      // No students yet — generate blank template with sample rows
      const sampleClasses = dlClasses.slice(0, 2)
      sampleClasses.forEach(cls => {
        sheetData.push([cls.name, '1', 'Student Name', '0300-1234567', 'Parent Name'])
      })
      for (let i = 0; i < 10; i++) {
        sheetData.push(['', '', '', '', ''])
      }
    }

    const ws = XLSX.utils.aoa_to_sheet(sheetData)

    ws['!cols'] = [
      { wch: 15 },  // class_name
      { wch: 12 },  // roll_number
      { wch: 25 },  // student_name
      { wch: 22 },  // parent_phone
      { wch: 20 },  // parent_name
    ]

    XLSX.utils.book_append_sheet(wb, ws, 'Students')

    const fileName = `students_${selectedSchool?.name?.replace(/\s+/g, '_') || 'school'}.xlsx`
    XLSX.writeFile(wb, fileName)

    showSuccess(existingStudents.length > 0
      ? `Downloaded ${existingStudents.length} students!`
      : 'Template downloaded!')
  }

  // Parse phone number (remove dashes/formatting and normalize)
  const parsePhone = (rawPhone) => {
    if (!rawPhone) return ''

    let phone = String(rawPhone).trim()

    // Remove P: prefix if present (legacy support)
    if (phone.toUpperCase().startsWith('P:')) {
      phone = phone.substring(2).trim()
    }

    // Handle scientific notation BEFORE removing characters
    if (String(rawPhone).includes('E') || String(rawPhone).includes('e')) {
      try {
        phone = Number(rawPhone).toFixed(0)
      } catch {
        // Keep original if conversion fails
      }
    }

    // Remove dashes, spaces, and other formatting (keep + and digits)
    phone = phone.replace(/[^\d+]/g, '')

    // Auto-add Pakistan country code if missing
    if (phone.startsWith('03')) {
      phone = '+92' + phone.substring(1)
    } else if (phone.startsWith('3') && phone.length === 10) {
      phone = '+92' + phone
    } else if (phone.startsWith('92') && !phone.startsWith('+')) {
      phone = '+' + phone
    } else if (phone.match(/^9[0-9]{11}$/)) {
      phone = '+' + phone
    }

    return phone
  }

  // Handle file upload (supports both XLSX and CSV)
  const handleFileUpload = (event) => {
    const file = event.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })

        // Find Students sheet or use first sheet
        let sheetName = workbook.SheetNames.find(name =>
          name.toLowerCase().includes('student')
        ) || workbook.SheetNames[0]

        const worksheet = workbook.Sheets[sheetName]
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })

        if (jsonData.length < 2) {
          showError('File is empty or invalid')
          return
        }

        // Find header row (skip instruction rows)
        let headerRowIndex = jsonData.findIndex(row =>
          row.some(cell => String(cell).toLowerCase() === 'class_name')
        )

        if (headerRowIndex === -1) {
          showError('Could not find header row with "class_name" column')
          return
        }

        const headers = jsonData[headerRowIndex].map(h => String(h).toLowerCase().trim())
        const classNameIdx = headers.indexOf('class_name')
        const rollIdx = headers.indexOf('roll_number')
        const nameIdx = headers.indexOf('student_name')
        const phoneIdx = headers.indexOf('parent_phone')
        const parentNameIdx = headers.indexOf('parent_name')

        if (classNameIdx === -1 || rollIdx === -1 || nameIdx === -1) {
          showError('Missing required columns: class_name, roll_number, student_name')
          return
        }

        const uploadClasses = classesData?.data?.results || classesData?.data || []
        const classMap = {}
        const classMapNoSpace = {} // Fallback for matching without spaces
        uploadClasses.forEach(cls => {
          const normalized = cls.name.toLowerCase().trim().replace(/\s+/g, ' ')
          classMap[normalized] = cls.id
          classMapNoSpace[normalized.replace(/\s/g, '')] = cls.id
        })

        // Log available classes for debugging
        console.log('Available classes:', Object.keys(classMap))

        const studentsByClass = {}
        const errors = []

        for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
          const row = jsonData[i]
          if (!row || row.length === 0) continue

          const className = String(row[classNameIdx] || '').trim().replace(/\s+/g, ' ')
          const classNameLower = className.toLowerCase()

          // Try exact match first, then without spaces
          let classId = classMap[classNameLower] || classMapNoSpace[classNameLower.replace(/\s/g, '')]

          if (!classId) {
            if (className && !className.toLowerCase().includes('enter') && !className.toLowerCase().includes('student')) {
              errors.push(`Row ${i + 1}: Unknown class "${className}"`)
            }
            continue
          }

          const rollNumber = String(row[rollIdx] || '').trim()
          const studentName = String(row[nameIdx] || '').trim()
          const rawPhone = row[phoneIdx]

          // Skip sample/placeholder rows
          if (studentName.toLowerCase().includes('enter') ||
              studentName.toLowerCase().includes('here') ||
              !rollNumber || !studentName) {
            continue
          }

          // Phone is optional - parse if provided, otherwise empty string
          const phone = rawPhone ? parsePhone(rawPhone) : ''

          if (!studentsByClass[classId]) {
            studentsByClass[classId] = []
          }

          studentsByClass[classId].push({
            roll_number: rollNumber,
            name: studentName,
            parent_phone: phone,
            parent_name: String(row[parentNameIdx] || '').trim(),
          })
        }

        if (errors.length > 0) {
          showWarning(`Found ${errors.length} issues. Check console for details.`)
          console.log('Upload Issues:', errors)
        }

        const totalStudents = Object.values(studentsByClass).flat().length
        if (totalStudents === 0) {
          showError('No valid students found in file')
          return
        }

        setBulkData({
          studentsByClass,
          totalStudents,
          classCount: Object.keys(studentsByClass).length
        })
        setShowBulkModal(true)
      } catch (err) {
        showError('Failed to parse file. Make sure it is a valid Excel or CSV file.')
        console.error(err)
      }
    }
    reader.readAsArrayBuffer(file)

    // Reset file input
    event.target.value = ''
  }

  // Handle bulk upload confirm
  const handleBulkUpload = async () => {
    const { studentsByClass } = bulkData

    setIsUploading(true)
    try {
      let totalCreated = 0
      let totalUpdated = 0
      let totalErrors = []

      for (const [classId, students] of Object.entries(studentsByClass)) {
        const response = await studentsApi.bulkCreateStudents({
          school_id: selectedSchoolId,
          class_id: parseInt(classId),
          students,
        })
        totalCreated += response.data.created_count || 0
        totalUpdated += response.data.updated_count || 0
        if (response.data.errors?.length > 0) {
          totalErrors.push(...response.data.errors)
        }
      }

      queryClient.invalidateQueries(['students'])
      queryClient.invalidateQueries(['classes'])
      setShowBulkModal(false)
      setBulkData({ class_id: '', students: [] })

      if (totalErrors.length > 0) {
        showWarning(`Created ${totalCreated}, updated ${totalUpdated} students. ${totalErrors.length} failed.`)
        console.log('Upload errors:', totalErrors)
      } else {
        const parts = []
        if (totalCreated > 0) parts.push(`${totalCreated} created`)
        if (totalUpdated > 0) parts.push(`${totalUpdated} updated`)
        showSuccess(`Successfully ${parts.join(', ')}!`)
      }
    } catch (error) {
      console.error('Bulk upload error:', error)
      const message = error.response?.data?.detail ||
                      error.response?.data?.error ||
                      error.message ||
                      'Failed to upload students. Please try again.'
      showError(message)
    } finally {
      setIsUploading(false)
    }
  }

  const allStudents = studentsData?.data?.results || studentsData?.data || []
  const schools = schoolsData?.data?.results || schoolsData?.data || []
  const classes = classesData?.data?.results || classesData?.data || []

  // Create a map of class_id to grade_level for proper sorting
  const classGradeMap = useMemo(() => {
    const map = {}
    classes.forEach(cls => {
      map[cls.id] = cls.grade_level ?? 999
    })
    return map
  }, [classes])

  // Client-side filtering and sorting with useMemo for performance
  const students = useMemo(() => {
    // First filter
    const filtered = allStudents.filter(student => {
      // Filter by class
      if (selectedClass && student.class_obj?.toString() !== selectedClass) {
        return false
      }
      // Filter by search (name or roll number)
      if (search) {
        const searchLower = search.toLowerCase()
        const matchesName = student.name?.toLowerCase().includes(searchLower)
        const matchesRoll = student.roll_number?.toLowerCase().includes(searchLower)
        if (!matchesName && !matchesRoll) {
          return false
        }
      }
      return true
    })

    // Then sort by class grade level, then by roll number (numeric)
    return filtered.sort((a, b) => {
      // First sort by class grade level
      const gradeA = classGradeMap[a.class_obj] ?? 999
      const gradeB = classGradeMap[b.class_obj] ?? 999
      if (gradeA !== gradeB) return gradeA - gradeB

      // Then sort by roll number (handle numeric sorting)
      const rollA = parseInt(a.roll_number) || 0
      const rollB = parseInt(b.roll_number) || 0
      return rollA - rollB
    })
  }, [allStudents, selectedClass, search, classGradeMap])

  // Stats computation
  const stats = useMemo(() => {
    const active = allStudents.filter(s => s.is_active).length
    const inactive = allStudents.length - active
    const byClass = {}
    allStudents.forEach(s => {
      const className = s.class_name || 'Unassigned'
      if (!byClass[className]) byClass[className] = 0
      byClass[className]++
    })
    return { total: allStudents.length, active, inactive, byClass }
  }, [allStudents])

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Students</h1>
          <p className="text-sm sm:text-base text-gray-600">Manage students in your school</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {selectedSchoolId && classes.length > 0 && (
            <>
              <button
                onClick={downloadExcelTemplate}
                className="btn btn-secondary"
              >
                Download Students
              </button>
              <label className="btn btn-secondary cursor-pointer">
                Upload Excel
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </>
          )}
          <button
            onClick={openAddModal}
            className="btn btn-primary"
          >
            Add Student
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {selectedSchoolId && !isLoading && allStudents.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="card !p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Total Students</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
          </div>
          <div className="card !p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Active</p>
            <p className="text-2xl font-bold text-green-600 mt-1">{stats.active}</p>
          </div>
          <div className="card !p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Inactive</p>
            <p className="text-2xl font-bold text-gray-400 mt-1">{stats.inactive}</p>
          </div>
          <div className="card !p-4">
            <p className="text-xs font-medium text-gray-500 uppercase">Classes</p>
            <p className="text-2xl font-bold text-primary-600 mt-1">{Object.keys(stats.byClass).length}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
          {/* School Selector for Super Admin */}
          {isSuperAdmin && (
            <div>
              <label className="label">School</label>
              <select
                className="input"
                value={selectedSchoolId || ''}
                onChange={(e) => {
                  setSelectedSchoolId(e.target.value ? parseInt(e.target.value) : null)
                  setSelectedClass('')
                }}
              >
                <option value="">-- Select School --</option>
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="label">Class</label>
            <select
              className="input"
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
              disabled={!selectedSchoolId}
            >
              <option value="">All Classes</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>
          <div className={isSuperAdmin ? "md:col-span-2" : "md:col-span-2"}>
            <label className="label">Search</label>
            <input
              type="text"
              className="input"
              placeholder="Search by name or roll number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={!selectedSchoolId}
            />
          </div>
        </div>
      </div>

      {!selectedSchoolId && (
        <div className="card text-center py-8 text-gray-500">
          {isSuperAdmin ? 'Please select a school to view students.' : 'No school assigned to your account.'}
        </div>
      )}

      {/* Students Table */}
      {selectedSchoolId && (
      <div className="card">
        {/* Results count */}
        {!isLoading && allStudents.length > 0 && (
          <div className="mb-4 text-sm text-gray-500">
            Showing {students.length} of {allStudents.length} students
            {(selectedClass || search) && ' (filtered)'}
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto"></div>
            <p className="text-gray-500 mt-2">Loading students...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {allStudents.length === 0
              ? 'No students found. Add students individually or upload an Excel file.'
              : 'No students match your filter. Try adjusting the class or search criteria.'}
          </div>
        ) : (
          <>
          {/* Mobile card view */}
          <div className="sm:hidden space-y-2">
            {students.map((student) => (
              <div key={student.id} className="p-3 border border-gray-200 rounded-lg">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm text-gray-900 truncate">{student.name}</p>
                    <p className="text-xs text-gray-500">Roll #{student.roll_number} | {student.class_name}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs flex-shrink-0 ml-2 ${
                    student.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                  }`}>
                    {student.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {student.parent_phone && (
                  <p className="text-xs text-gray-500 mt-1">{student.parent_phone}</p>
                )}
                <div className="flex gap-3 mt-2 pt-2 border-t border-gray-100">
                  <button onClick={() => openEditModal(student)} className="text-xs text-blue-600 font-medium">Edit</button>
                  <button onClick={() => setDeleteConfirm(student)} className="text-xs text-red-600 font-medium">Delete</button>
                </div>
              </div>
            ))}
          </div>
          {/* Desktop table view */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Roll No</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Parent Phone</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {students.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">{student.roll_number}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{student.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{student.class_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {student.parent_phone || <span className="text-gray-400 italic">Not set</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        student.is_active
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {student.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => openEditModal(student)}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium mr-3"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(student)}
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
      )}

      {/* Add/Edit Student Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-4 sm:p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              {editingStudent ? 'Edit Student' : 'Add Student'}
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label">Class</label>
                <select
                  className="input"
                  value={studentForm.class_id}
                  onChange={(e) => setStudentForm({ ...studentForm, class_id: e.target.value })}
                  disabled={!!editingStudent}
                  required
                >
                  <option value="">Select a class</option>
                  {classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </select>
                {editingStudent && (
                  <p className="text-xs text-gray-500 mt-1">Class cannot be changed after creation</p>
                )}
              </div>

              <div>
                <label className="label">Roll Number</label>
                <input
                  type="text"
                  className="input"
                  value={studentForm.roll_number}
                  onChange={(e) => setStudentForm({ ...studentForm, roll_number: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Student Name</label>
                <input
                  type="text"
                  className="input"
                  value={studentForm.name}
                  onChange={(e) => setStudentForm({ ...studentForm, name: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Parent Phone (Optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder="0300-1234567"
                  value={studentForm.parent_phone}
                  onChange={(e) => setStudentForm({ ...studentForm, parent_phone: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">Format: 0300-1234567 or +92-300-1234567</p>
              </div>

              <div>
                <label className="label">Parent Name (Optional)</label>
                <input
                  type="text"
                  className="input"
                  value={studentForm.parent_name}
                  onChange={(e) => setStudentForm({ ...studentForm, parent_name: e.target.value })}
                />
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={closeModal}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={addMutation.isPending || updateMutation.isPending}
                className="btn btn-primary"
              >
                {(addMutation.isPending || updateMutation.isPending)
                  ? 'Saving...'
                  : (editingStudent ? 'Save Changes' : 'Add Student')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Delete Student</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong> (Roll #{deleteConfirm.roll_number})?
              This will also delete all their attendance records.
            </p>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="btn btn-danger"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Upload Confirmation Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Confirm Bulk Upload</h2>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <p className="text-blue-800">
                Ready to upload <strong>{bulkData.totalStudents}</strong> students
                across <strong>{bulkData.classCount}</strong> classes.
              </p>
            </div>

            <div className="space-y-2 mb-6 max-h-48 overflow-y-auto">
              {Object.entries(bulkData.studentsByClass || {}).map(([classId, students]) => {
                const cls = classes.find(c => c.id === parseInt(classId))
                return (
                  <div key={classId} className="flex justify-between text-sm">
                    <span className="text-gray-600">{cls?.name || `Class ${classId}`}</span>
                    <span className="font-medium">{students.length} students</span>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowBulkModal(false)
                  setBulkData({ class_id: '', students: [] })
                }}
                disabled={isUploading}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkUpload}
                disabled={isUploading}
                className="btn btn-primary"
              >
                {isUploading ? 'Uploading...' : 'Upload Students'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
