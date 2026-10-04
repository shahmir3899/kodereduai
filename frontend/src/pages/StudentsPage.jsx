import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { studentsApi, schoolsApi } from '../services/api'
import { useToast } from '../components/Toast'
import { useSessionClasses } from '../hooks/useSessionClasses'
import { useClasses } from '../hooks/useClasses'
import { getClassSelectorScope, getResolvedMasterClassId } from '../utils/classScope'
import { canManageStudentLifecycle } from '../utils/accessPolicies'
import { exportStudentsPDF, exportStudentsPNG } from './studentExport'
import { useDebounce } from '../hooks/useDebounce'
import PhotoCropModal from '../components/PhotoCropModal'
import { downloadInstantReport } from '../utils/downloadReport'
import { useEscapeKey } from '../hooks/useEscapeKey'
import { useViewPreference } from '../hooks/useViewPreference'
import { useStudentSelection } from '../hooks/useStudentSelection'
import { useUpdateStudent } from '../hooks/useUpdateStudent'
import { downloadStudentsExcel, readStudentsFile } from './students/studentExcel'
import {
  buildClassChipData,
  buildClassFilterOptions,
  computeStats,
  filterStudents,
  sortStudents,
  summarizeByGender,
} from './students/studentListUtils'
import StudentsHeader from './students/components/StudentsHeader'
import StudentFormModal from './students/components/StudentFormModal'
import StudentPhotoControl from './students/components/StudentPhotoControl'
import ReclassifyStudentModal from './students/components/ReclassifyStudentModal'
import StudentStats from './students/components/StudentStats'
import StudentFilters from './students/components/StudentFilters'
import StudentsList from './students/components/StudentsList'
import SelectionBar from './students/components/SelectionBar'
import DeleteStudentModal from './students/components/DeleteStudentModal'
import BulkUploadModal from './students/components/BulkUploadModal'
import ConvertAccountModal from './students/components/ConvertAccountModal'
import BulkConvertModal from './students/components/BulkConvertModal'

export default function StudentsPage() {
  const { user, activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const queryClient = useQueryClient()
  const { showError, showSuccess, showWarning } = useToast()
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'
  const canManageLifecycle = canManageStudentLifecycle(user?.role)
  const fileInputRef = useRef(null)

  // Report download progress (bulk "Download Reports" from the selection bar)
  const [isGeneratingReports, setIsGeneratingReports] = useState(false)
  const [reportDownloadProgress, setReportDownloadProgress] = useState({ current: 0, total: 0 })

  const [selectedSchoolId, setSelectedSchoolId] = useState(activeSchool?.id || null)
  const [selectedClassIds, setSelectedClassIds] = useState([])
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [showInactiveRecords, setShowInactiveRecords] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingStudent, setEditingStudent] = useState(null)
  const [reclassifyStudent, setReclassifyStudent] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkData, setBulkData] = useState({ class_id: '', students: [] })
  const [isUploading, setIsUploading] = useState(false)
  const [cropImageSrc, setCropImageSrc] = useState(null)

  const [view, setView] = useViewPreference('students')

  // Convert existing students to portal users (the modals own their form state)
  const [convertStudent, setConvertStudent] = useState(null)
  const [showBulkConvertModal, setShowBulkConvertModal] = useState(false)

  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, selectedSchoolId)
  const classSelectorScope = getClassSelectorScope(activeAcademicYear?.id)
  const resolvedSelectedClasses = useMemo(
    () => selectedClassIds
      .map((classId) => getResolvedMasterClassId(classId, activeAcademicYear?.id, sessionClasses))
      .filter(Boolean),
    [selectedClassIds, activeAcademicYear?.id, sessionClasses],
  )
  const resolveMasterClassId = (classId) => getResolvedMasterClassId(classId, activeAcademicYear?.id, sessionClasses)

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

  // Fetch classes
  const { classes: classesList } = useClasses(selectedSchoolId)

  // Fetch ALL students once for this school (client-side filtering)
  const { data: studentsData, isLoading } = useQuery({
    queryKey: ['students', selectedSchoolId, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudents({
      school_id: selectedSchoolId,
      page_size: 9999,
      ...(activeAcademicYear?.id && { academic_year: activeAcademicYear.id }),
    }),
    enabled: !!selectedSchoolId,
  })

  // Delete student mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => studentsApi.deleteStudent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
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

  // Photo upload/remove — only available once a student exists (edit mode)
  const uploadPhotoMutation = useMutation({
    mutationFn: ({ id, file }) => studentsApi.uploadPhoto(id, file),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      setEditingStudent((prev) => (prev ? { ...prev, photo_url: response.data.photo_url } : prev))
      showSuccess('Photo uploaded successfully.')
    },
    onError: (error) => {
      showError(error.response?.data?.error || error.response?.data?.detail || 'Failed to upload photo')
    },
  })

  const removePhotoMutation = useMutation({
    mutationFn: (id) => studentsApi.removePhoto(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['students'] })
      setEditingStudent((prev) => (prev ? { ...prev, photo_url: '' } : prev))
      showSuccess('Photo removed.')
    },
    onError: (error) => {
      showError(error.response?.data?.error || error.response?.data?.detail || 'Failed to remove photo')
    },
  })

  const handlePhotoSelected = (file) => setCropImageSrc(URL.createObjectURL(file))

  const closeCropModal = () => {
    if (cropImageSrc) URL.revokeObjectURL(cropImageSrc)
    setCropImageSrc(null)
  }

  const handleCropSave = (blob) => {
    const file = new File([blob], 'photo.jpg', { type: 'image/jpeg' })
    uploadPhotoMutation.mutate({ id: editingStudent.id, file })
    closeCropModal()
  }

  const openAddModal = () => {
    setEditingStudent(null)
    setShowModal(true)
  }

  const openEditModal = (student) => {
    setEditingStudent(student)
    setShowModal(true)
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingStudent(null)
  }

  // Hands the student over to the reclassify dialog and closes the edit form: a
  // reclassify can change the roll number too, and a form left open would still
  // hold the old one.
  const handleChangeClass = () => {
    if (!activeAcademicYear?.id) {
      showError('Select an academic year from the top switcher first')
      return
    }
    const student = editingStudent
    closeModal()
    setReclassifyStudent(student)
  }

  useEscapeKey(() => setDeleteConfirm(null), !!deleteConfirm)
  useEscapeKey(() => setShowBulkModal(false), showBulkModal)

  const updateStudent = useUpdateStudent()

  // Resolves on success (and closes the modal); rejects with the API error so the
  // form can show it beside the field instead of as a toast.
  const handleSaveStudent = async ({ payload, classId, account }) => {
    if (editingStudent) {
      await updateStudent.mutateAsync({ id: editingStudent.id, payload })
      closeModal()
      showSuccess('Student updated successfully!')
      return
    }

    // Create the student first, then optionally their portal login
    const response = await studentsApi.createStudent({
      school: selectedSchoolId,
      class_obj: parseInt(classId),
      ...payload,
    })
    const newStudent = response.data

    if (account && newStudent?.id) {
      try {
        await studentsApi.createStudentUserAccount(newStudent.id, {
          username: account.username,
          email: account.email,
          password: account.password,
          confirm_password: account.confirm_password,
        })
        showSuccess('Student and user account created successfully!')
      } catch (userErr) {
        const errMsg = userErr?.response?.data?.error || userErr?.response?.data?.detail || 'Failed to create user account'
        showWarning(`Student created but user account failed: ${errMsg}`)
      }
    } else {
      showSuccess('Student added successfully!')
    }

    queryClient.invalidateQueries({ queryKey: ['students'] })
    queryClient.invalidateQueries({ queryKey: ['classes'] })
    closeModal()
  }

  // Download Students Excel (or blank template if no students exist)
  const downloadExcelTemplate = async () => {
    const selectedSchool = schools.find((s) => s.id === selectedSchoolId)

    if (classesList.length === 0) {
      showError('Please add classes before downloading')
      return
    }

    const existingStudents = studentsData?.data?.results || studentsData?.data || []
    await downloadStudentsExcel({
      schoolName: selectedSchool?.name,
      classes: classesList,
      students: existingStudents,
    })

    showSuccess(existingStudents.length > 0
      ? `Downloaded ${existingStudents.length} students!`
      : 'Template downloaded!')
  }

  // Handle file upload (supports both XLSX and CSV)
  const handleFileUpload = async (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return

    try {
      const { error, studentsByClass, issues } = await readStudentsFile(file, classesList)
      if (error) {
        showError(error)
        return
      }

      if (issues.length > 0) {
        showWarning(`Found ${issues.length} issues. Check console for details.`)
        console.log('Upload Issues:', issues)
      }

      const totalStudents = Object.values(studentsByClass).flat().length
      if (totalStudents === 0) {
        showError('No valid students found in file')
        return
      }

      setBulkData({
        studentsByClass,
        totalStudents,
        classCount: Object.keys(studentsByClass).length,
      })
      setShowBulkModal(true)
    } catch (err) {
      showError('Failed to parse file. Make sure it is a valid Excel or CSV file.')
      console.error(err)
    }
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

      queryClient.invalidateQueries({ queryKey: ['students'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
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
  const classes = classesList

  // Create a map of class_id to grade_level for proper sorting
  const classGradeMap = useMemo(() => {
    const map = {}
    classes.forEach(cls => {
      map[cls.id] = cls.grade_level ?? 999
    })
    return map
  }, [classes])

  const classFilterOptions = useMemo(
    () => buildClassFilterOptions({ scope: classSelectorScope, sessionClasses, classes }),
    [classSelectorScope, sessionClasses, classes],
  )

  const students = useMemo(() => {
    const filtered = filterStudents({
      students: allStudents,
      selectedClassIds,
      resolvedSelectedClasses,
      scope: classSelectorScope,
      sessionClasses,
      search: debouncedSearch,
      showInactive: showInactiveRecords,
    })
    return sortStudents(filtered, { selectedClassIds, resolvedSelectedClasses, classGradeMap })
  }, [allStudents, resolvedSelectedClasses, debouncedSearch, classGradeMap, classSelectorScope, selectedClassIds, sessionClasses, showInactiveRecords])

  // Students without accounts are the ones bulk "Create Accounts" applies to
  const studentsWithoutAccounts = useMemo(() => students.filter((s) => !s.has_user_account), [students])
  const selection = useStudentSelection(studentsWithoutAccounts)
  const selectedIds = selection.selectedIds

  const stats = useMemo(() => computeStats(students), [students])

  const classChipData = useMemo(
    () => buildClassChipData({
      allStudents,
      search: debouncedSearch,
      classFilterOptions,
      scope: classSelectorScope,
      sessionClasses,
    }),
    [allStudents, debouncedSearch, classFilterOptions, classSelectorScope, sessionClasses],
  )

  const summaryByGender = useMemo(() => summarizeByGender(students), [students])

  const toggleClassSelection = useCallback((classId) => {
    setSelectedClassIds((prev) => (
      prev.includes(classId)
        ? prev.filter((id) => id !== classId)
        : [...prev, classId]
    ))
  }, [])

  const getExportInfo = () => {
    const schoolName = activeSchool?.name || schools.find(s => s.id === selectedSchoolId)?.name || ''
    const selectedClassNames = selectedClassIds.map((classId) => {
      if (classSelectorScope === 'session') {
        return sessionClasses.find(sc => String(sc.id) === String(classId))?.display_name || null
      }
      return classes.find(c => c.id === parseInt(classId))?.name || null
    }).filter(Boolean)
    const parts = []
    if (selectedClassNames.length > 0) parts.push(`Classes: ${selectedClassNames.join(', ')}`)
    if (search) parts.push(`Search: "${search}"`)
    return { schoolName, filterInfo: parts.join(' | ') || null }
  }

  const handleExportPDF = () => {
    const { schoolName, filterInfo } = getExportInfo()
    exportStudentsPDF({ students, schoolName, filterInfo })
    showSuccess('PDF downloaded!')
  }

  const handleExportPNG = async () => {
    const { schoolName, filterInfo } = getExportInfo()
    try {
      await exportStudentsPNG({ students, schoolName, filterInfo })
      showSuccess('PNG downloaded!')
    } catch {
      showError('Failed to export PNG')
    }
  }

  // Downloads one STUDENT_COMPREHENSIVE report per selected student, sequentially;
  // each is generated synchronously and streamed straight back (nothing saved
  // server-side), so this is a plain loop rather than a background-task dispatch.
  const handleDownloadSelectedReports = async (periodParams) => {
    const selected = allStudents.filter((s) => selectedIds.has(s.id))
    if (selected.length === 0) return

    setIsGeneratingReports(true)
    setReportDownloadProgress({ current: 0, total: selected.length })
    let succeeded = 0
    for (const student of selected) {
      setReportDownloadProgress((prev) => ({ ...prev, current: prev.current + 1 }))
      try {
        await downloadInstantReport(
          { report_type: 'STUDENT_COMPREHENSIVE', parameters: { student_id: student.id, ...periodParams } },
          `${student.name}-report.pdf`,
        )
        succeeded += 1
      } catch {
        // Continue downloading the remaining selected students even if one fails.
      }
    }
    setIsGeneratingReports(false)
    setReportDownloadProgress({ current: 0, total: 0 })
    if (succeeded > 0) {
      showSuccess(`Downloaded ${succeeded} report${succeeded === 1 ? '' : 's'}.`)
    } else {
      showError('Failed to generate reports.')
    }
  }

  return (
    <div>
      <StudentsHeader
        showTools={!!selectedSchoolId && classes.length > 0}
        hasStudents={students.length > 0}
        hasAcademicYear={!!activeAcademicYear}
        fileInputRef={fileInputRef}
        onExportPDF={handleExportPDF}
        onExportPNG={handleExportPNG}
        onDownloadExcel={downloadExcelTemplate}
        onUploadFile={handleFileUpload}
        onAdd={openAddModal}
      />

      {/* Warning: No academic year */}
      {!activeAcademicYear && selectedSchoolId && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-amber-50 border border-amber-200 rounded-lg">
          <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm text-amber-800">
            No academic year is active. Students cannot be added until an academic year is created and set as current.
            Go to <strong>Settings &gt; Academic Years</strong> to set one up.
          </span>
        </div>
      )}

      {selectedSchoolId && !isLoading && allStudents.length > 0 && <StudentStats stats={stats} />}

      <StudentFilters
        isSuperAdmin={isSuperAdmin}
        schools={schools}
        selectedSchoolId={selectedSchoolId}
        onSchoolChange={(schoolId) => {
          setSelectedSchoolId(schoolId)
          setSelectedClassIds([])
        }}
        search={search}
        onSearchChange={setSearch}
        showInactive={showInactiveRecords}
        onShowInactiveChange={setShowInactiveRecords}
        classChipData={classChipData}
        selectedClassIds={selectedClassIds}
        onClearClasses={() => setSelectedClassIds([])}
        onToggleClass={toggleClassSelection}
        shownCount={students.length}
        genderSummary={summaryByGender}
        isLoading={isLoading}
      />

      {!selectedSchoolId && (
        <div className="card text-center py-8 text-gray-500">
          {isSuperAdmin ? 'Please select a school to view students.' : 'No school assigned to your account.'}
        </div>
      )}

      {selectedSchoolId && (
        <StudentsList
          isLoading={isLoading}
          students={students}
          totalCount={allStudents.length}
          isFiltered={selectedClassIds.length > 0 || !!search}
          view={view}
          onViewChange={setView}
          selectedIds={selectedIds}
          allSelectableSelected={studentsWithoutAccounts.length > 0 && selectedIds.size === studentsWithoutAccounts.length}
          onToggleSelect={selection.toggle}
          onToggleSelectAll={selection.toggleAll}
          canManageLifecycle={canManageLifecycle}
          onEdit={openEditModal}
          onConvert={setConvertStudent}
          onDelete={setDeleteConfirm}
        />
      )}

      {showModal && (
        <StudentFormModal
          key={editingStudent?.id ?? 'new'}
          student={editingStudent}
          allStudents={allStudents}
          classSelector={{
            scope: classSelectorScope,
            academicYearId: activeAcademicYear?.id,
            schoolId: selectedSchoolId,
          }}
          resolveMasterClassId={resolveMasterClassId}
          initialClassId={selectedClassIds[0] || ''}
          photoSlot={editingStudent ? (
            <StudentPhotoControl
              student={editingStudent}
              isUploading={uploadPhotoMutation.isPending}
              isRemoving={removePhotoMutation.isPending}
              onFileSelected={handlePhotoSelected}
              onRemove={() => removePhotoMutation.mutate(editingStudent.id)}
            />
          ) : null}
          onChangeClass={editingStudent && canManageLifecycle ? handleChangeClass : null}
          onSubmit={handleSaveStudent}
          onClose={closeModal}
        />
      )}

      {reclassifyStudent && (
        <ReclassifyStudentModal student={reclassifyStudent} onClose={() => setReclassifyStudent(null)} />
      )}

      {deleteConfirm && (
        <DeleteStudentModal
          student={deleteConfirm}
          isPending={deleteMutation.isPending}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => deleteMutation.mutate(deleteConfirm.id)}
        />
      )}

      {showBulkModal && (
        <BulkUploadModal
          bulkData={bulkData}
          classes={classes}
          isUploading={isUploading}
          onCancel={() => {
            setShowBulkModal(false)
            setBulkData({ class_id: '', students: [] })
          }}
          onConfirm={handleBulkUpload}
        />
      )}

      {selectedIds.size > 0 && (
        <SelectionBar
          count={selectedIds.size}
          isGeneratingReports={isGeneratingReports}
          reportProgress={reportDownloadProgress}
          activeAcademicYearId={activeAcademicYear?.id}
          onCreateAccounts={() => setShowBulkConvertModal(true)}
          onDownloadReports={handleDownloadSelectedReports}
          onClear={selection.clear}
        />
      )}

      {convertStudent && (
        <ConvertAccountModal
          key={convertStudent.id}
          student={convertStudent}
          onClose={() => setConvertStudent(null)}
        />
      )}

      {showBulkConvertModal && (
        <BulkConvertModal
          studentIds={Array.from(selectedIds)}
          onConverted={selection.clear}
          onClose={() => setShowBulkConvertModal(false)}
        />
      )}

      {cropImageSrc && (
        <PhotoCropModal
          imageSrc={cropImageSrc}
          onCancel={closeCropModal}
          onSave={handleCropSave}
        />
      )}
    </div>
  )
}
