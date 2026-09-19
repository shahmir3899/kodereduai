import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { examinationsApi, sessionsApi, schoolsApi } from '../../services/api'
import { useAcademicYear } from '../../contexts/AcademicYearContext'
import { useAuth } from '../../contexts/AuthContext'
import { DEFAULT_SIGNATURE_LABELS, formatIssueDate } from './reportCardData'
import BulkReportCardModal from './BulkReportCardModal'
import MarksTable from './ReportCardMarksTable'
import { ExamPicker, StudentPicker } from './ReportCardFilters'
import { MONTH_NAMES } from './reportCardTemplates/stars'
import { exportReportCardPDF } from './reportCardExport'
import ClassSelector from '../../components/ClassSelector'
import { useSessionClasses } from '../../hooks/useSessionClasses'
import useTeacherScopedClasses from '../../hooks/useTeacherScopedClasses'
import { buildSessionOrMasterClassParams, getClassSelectorScope, resolveClassIdToMasterClassId } from '../../utils/classScope'
import Spinner from '../../components/ui/Spinner'

const PROMOTION_OPTIONS = [
  { value: 'NOT_APPLICABLE', label: 'Not Applicable' },
  { value: 'PROMOTED', label: 'Promoted' },
  { value: 'NOT_PROMOTED', label: 'Not Promoted' },
]

const PODIUM = {
  1: { label: 'First Position', cls: 'bg-amber-50 border-amber-400 text-amber-800', icon: '\u{1F3C6}' },
  2: { label: 'Second Position', cls: 'bg-slate-50 border-slate-400 text-slate-700', icon: '\u{1F948}' },
  3: { label: 'Third Position', cls: 'bg-orange-50 border-orange-400 text-orange-800', icon: '\u{1F949}' },
}

// One inline-editable text block; saves on an explicit Save so a stray keystroke never fires a request.
function EditableText({ value, onSave, saving, multiline = false, placeholder, maxLength = 800 }) {
  const [draft, setDraft] = useState(value || '')
  useEffect(() => { setDraft(value || '') }, [value])
  const dirty = draft.trim() !== (value || '').trim()
  const Field = multiline ? 'textarea' : 'input'
  return (
    <div className="flex items-start gap-2">
      <Field
        value={draft}
        onChange={e => setDraft(e.target.value)}
        maxLength={maxLength}
        rows={multiline ? 3 : undefined}
        placeholder={placeholder}
        className="input w-full text-sm"
      />
      {dirty && (
        <button
          onClick={() => onSave(draft.trim())}
          disabled={saving}
          className="px-2.5 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? '...' : 'Save'}
        </button>
      )}
    </div>
  )
}

export default function ReportCardPage() {
  const { activeAcademicYear } = useAcademicYear()
  const { isSchoolAdmin, isManager, isTeacher } = useAuth()
  const queryClient = useQueryClient()
  // The server is the real gate (teachers only for classes they are class teacher of); this just hides the toggle.
  const canEdit = isSchoolAdmin || isManager || isTeacher
  const [editMode, setEditMode] = useState(false)
  const [editError, setEditError] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [classId, setClassId] = useState('')
  const [studentId, setStudentId] = useState('')
  const [enrollmentId, setEnrollmentId] = useState('')
  const [yearId, setYearId] = useState('')
  // Exams on the card, oldest first as the picker lists them; the newest is the main exam.
  const [examIds, setExamIds] = useState([])
  const [downloading, setDownloading] = useState(false)
  const [pdfFormat, setPdfFormat] = useState(() => {
    try {
      return localStorage.getItem('reportCardFormat') || 'enhanced'
    } catch {
      return 'enhanced'
    }
  })

  const handleFormatChange = (value) => {
    setPdfFormat(value)
    try {
      localStorage.setItem('reportCardFormat', value)
    } catch {
      // Private browsing / storage disabled - the choice just won't persist.
    }
  }

  const { sessionClasses } = useSessionClasses(yearId)
  const classSelectorScope = getClassSelectorScope(yearId)
  const {
    showAllOption,
    classOptions: teacherClassOptions,
  } = useTeacherScopedClasses({
    academicYearId: yearId || undefined,
    selectedClass: classId,
    setSelectedClass: setClassId,
    autoSelectFirst: true,
    queryKey: 'myReportCardClasses',
  })
  const enrollmentClassParams = buildSessionOrMasterClassParams({
    classId,
    activeAcademicYearId: yearId,
    sessionClasses,
    masterKey: 'class_id',
  })

  // Default the session to the global academic-year selector; any other year is a historical pick.
  useEffect(() => {
    if (!yearId && activeAcademicYear?.id) setYearId(String(activeAcademicYear.id))
  }, [activeAcademicYear?.id, yearId])

  // Queries
  const { data: yearsRes } = useQuery({
    queryKey: ['academicYears'],
    queryFn: () => sessionsApi.getAcademicYears({ page_size: 9999 }),
  })

  const masterClassId = resolveClassIdToMasterClassId(classId, yearId, sessionClasses)
  const { data: examsRes } = useQuery({
    queryKey: ['reportCardExams', masterClassId, yearId],
    queryFn: () => examinationsApi.getExams({ class_obj: masterClassId, academic_year: yearId, page_size: 9999 }),
    enabled: !!masterClassId && !!yearId,
  })
  const exams = useMemo(() => {
    const list = examsRes?.data?.results || examsRes?.data || []
    const when = (e) => e.end_date || e.start_date || ''
    return [...list].sort((a, b) => when(a).localeCompare(when(b)) || a.id - b.id)
  }, [examsRes])

  // Default to the latest exam (the common single-exam card) and drop ticks that no longer apply.
  useEffect(() => {
    if (!exams.length) {
      if (examIds.length) setExamIds([])
      return
    }
    const valid = examIds.filter(id => exams.some(e => String(e.id) === id))
    if (valid.length !== examIds.length || valid.length === 0) {
      setExamIds(valid.length ? valid : [String(exams[exams.length - 1].id)])
    }
  }, [exams, examIds])

  const { data: enrollmentsRes } = useQuery({
    queryKey: ['reportCardEnrollmentsByClass', classId, yearId, enrollmentClassParams.session_class_id],
    queryFn: () => sessionsApi.getEnrollments({
      ...enrollmentClassParams,
      academic_year: yearId,
      page_size: 9999,
    }),
    enabled: !!classId && !!yearId,
  })

  const { data: reportRes, isLoading: reportLoading } = useQuery({
    queryKey: ['reportCard', studentId, enrollmentId, yearId, examIds.join(',')],
    queryFn: () => examinationsApi.getReportCard({
      student_id: studentId,
      enrollment_id: enrollmentId || undefined,
      academic_year_id: yearId,
      exam_ids: examIds.join(','),
    }),
    enabled: !!studentId && !!yearId && examIds.length > 0,
  })

  const { data: schoolRes } = useQuery({
    queryKey: ['currentSchool'],
    queryFn: () => schoolsApi.getMySchool(),
  })


  const years = yearsRes?.data?.results || yearsRes?.data || []
  const enrollments = enrollmentsRes?.data?.results || enrollmentsRes?.data || []
  const students = [...enrollments]
    .sort((a, b) => String(a.roll_number || '').localeCompare(String(b.roll_number || ''), undefined, { numeric: true, sensitivity: 'base' }))
  const report = reportRes?.data || null
  const schoolData = schoolRes?.data

  const handleYearChange = (value) => {
    setYearId(value)
    setClassId('')
    setStudentId('')
    setEnrollmentId('')
    setExamIds([])
  }

  const handleStudentChange = (value) => {
    setEnrollmentId(value)
    const selectedEnrollment = enrollments.find(e => String(e.id) === String(value))
    setStudentId(selectedEnrollment ? String(selectedEnrollment.student) : '')
  }

  const refreshReport = () => queryClient.invalidateQueries({ queryKey: ['reportCard'] })
  const onEditError = (err) => setEditError(
    err.response?.data?.detail
    || Object.values(err.response?.data || {}).flat().join(' ')
    || 'Could not save.',
  )

  const metaMut = useMutation({
    mutationFn: (fields) => examinationsApi.saveReportCardMeta({
      student_id: studentId,
      academic_year_id: yearId,
      exam_ids: examIds,
      ...fields,
    }),
    onSuccess: () => { setEditError(''); refreshReport() },
    onError: onEditError,
  })

  const commentMut = useMutation({
    mutationFn: ({ examId, subjectId, comment }) => examinationsApi.editComment(examId, {
      studentId: Number(studentId), subjectId, comment,
    }),
    onSuccess: () => { setEditError(''); refreshReport() },
    onError: onEditError,
  })

  const handleDownloadPDF = async () => {
    if (!report) return
    setDownloading(true)
    try {
      await exportReportCardPDF({ report, schoolData, format: pdfFormat })
    } catch (err) {
      console.error('PDF export failed:', err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Report Cards</h1>
        <p className="text-sm text-gray-600">View individual student report cards</p>
      </div>

      {canEdit && classId && yearId && students.length > 0 && (
        <div className="flex justify-end mb-2">
          <button
            onClick={() => setShowBulk(true)}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Class bulk edit ({students.length})
          </button>
        </div>
      )}

      {/* Selection: session + class + exams + student */}
      <div className="card mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Session *</label>
            <select value={yearId} onChange={e => handleYearChange(e.target.value)} className="input w-full text-sm">
              <option value="">Select session...</option>
              {years.map(y => (
                <option key={y.id} value={y.id}>
                  {y.name}{String(y.id) === String(activeAcademicYear?.id) ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Class</label>
            <ClassSelector
              value={classId}
              onChange={e => {
                setClassId(e.target.value)
                setStudentId('')
                setEnrollmentId('')
                setExamIds([])
              }}
              className="input w-full text-sm"
              placeholder="Select class..."
              showAllOption={showAllOption}
              scope={classSelectorScope}
              academicYearId={yearId || undefined}
              classes={teacherClassOptions || undefined}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Exams</label>
            <ExamPicker exams={exams} selected={examIds} onChange={setExamIds} disabled={!classId || !yearId} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Student</label>
            <StudentPicker
              students={students}
              value={enrollmentId}
              onChange={handleStudentChange}
              disabled={!classId || !yearId}
            />
          </div>
        </div>
      </div>

      {/* Report Card */}
      {!studentId ? (
        <div className="card text-center py-12 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l9-5-9-5-9 5 9 5z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
          </svg>
          Select a student to view their report card
        </div>
      ) : reportLoading ? (
        <div className="text-center py-12">
          <Spinner size="md" className="mx-auto" />
        </div>
      ) : !report ? (
        <div className="card text-center py-8 text-gray-500">No report card data available.</div>
      ) : (
        <div className="card max-w-3xl mx-auto">
          {/* Actions */}
          <div className="flex justify-end items-center gap-2 mb-3">
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-sm">
              {[
                { value: 'enhanced', label: 'Enhanced' },
                { value: 'traditional', label: 'Traditional' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => handleFormatChange(opt.value)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    pdfFormat === opt.value
                      ? 'bg-white shadow-sm text-primary-700 font-medium'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {canEdit && (
              <button
                onClick={() => { setEditMode(v => !v); setEditError('') }}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  editMode ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
              >
                {editMode ? 'Done editing' : 'Edit details'}
              </button>
            )}
            <button
              onClick={handleDownloadPDF}
              disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              {downloading ? 'Generating...' : 'Download PDF'}
            </button>
          </div>

          {report.is_draft && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              <span className="font-semibold">Draft</span> — results have not been announced yet. Only staff can see this preview.
            </div>
          )}

          {editError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{editError}</div>
          )}

          {/* Header */}
          <div className="text-center border-b border-gray-200 pb-4 mb-4">
            <h2 className="text-lg font-bold text-gray-900">{report.school_name || 'Report Card'}</h2>
            <p className="text-sm text-gray-600 mt-1">
              {report.academic_year_name && `Academic Year: ${report.academic_year_name}`}
              {report.exam_display && ` | ${report.exam_display}`}
            </p>
            {report.earlier_exam_names?.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {report.weighted
                  ? `Weighted result across: ${[...report.earlier_exam_names, report.main_exam?.name].filter(Boolean).join(', ')}`
                  : `Result is from ${report.main_exam?.name}. Earlier exams shown for reference: ${report.earlier_exam_names.join(', ')}`}
              </p>
            )}
          </div>

          {/* Student Info */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 pb-4 border-b border-gray-200">
            <div>
              <p className="text-xs text-gray-500">Student Name</p>
              <p className="text-sm font-medium text-gray-900">{report.student_name}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Roll Number</p>
              <p className="text-sm font-medium text-gray-900">{report.roll_number}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Class</p>
              <p className="text-sm font-medium text-gray-900">{report.class_name}</p>
            </div>
            {report.enrollment_info?.current_class && report.enrollment_info.current_class !== report.class_name && (
              <div>
                <p className="text-xs text-gray-500">Current Class</p>
                <p className="text-sm font-medium text-gray-900">{report.enrollment_info.current_class}</p>
              </div>
            )}
          </div>

          {/* Podium (top 3) */}
          {PODIUM[report.summary?.rank] && (
            <div className={`mb-4 p-4 border-2 rounded-xl flex items-center gap-4 ${PODIUM[report.summary.rank].cls}`}>
              <span className="text-4xl" aria-hidden="true">{PODIUM[report.summary.rank].icon}</span>
              <div>
                <p className="text-lg font-bold tracking-wide uppercase">{PODIUM[report.summary.rank].label}</p>
                <p className="text-sm opacity-80">
                  Congratulations! {report.class_name}
                  {report.summary.percentage != null && ` \u00b7 ${Number(report.summary.percentage).toFixed(1)}%`}
                </p>
              </div>
            </div>
          )}

          {/* Attendance (computed with OFF days excluded, so there is deliberately no manual override) */}
          {report.attendance?.working_days > 0 && (() => {
            const a = report.attendance
            const pct = (n) => `${(n / a.working_days) * 100}%`
            return (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Attendance</p>
                    <p className="text-lg font-bold text-green-700">
                      {a.present} / {a.working_days} days
                      {a.percentage != null && <span className="text-sm font-medium"> ({a.percentage}%)</span>}
                    </p>
                  </div>
                  {a.from && a.to && (
                    <p className="text-xs text-gray-500">{formatIssueDate(a.from)} – {formatIssueDate(a.to)}</p>
                  )}
                </div>
                <div className="flex h-2 rounded-full overflow-hidden bg-gray-200 my-2">
                  <div className="bg-green-500" style={{ width: pct(a.present) }} />
                  <div className="bg-red-500" style={{ width: pct(a.absent) }} />
                  <div className="bg-amber-400" style={{ width: pct(a.leave) }} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                  <span><span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1" />Present: {a.present}</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />Absent: {a.absent}</span>
                  <span><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />Leave: {a.leave}</span>
                  {a.not_marked > 0 && (
                    <span><span className="inline-block w-2 h-2 rounded-full bg-gray-400 mr-1" />Not marked: {a.not_marked}</span>
                  )}
                </div>
                {a.not_marked > 0 && (
                  <p className={`text-xs mt-2 ${a.suspect ? 'text-amber-700' : 'text-gray-500'}`}>
                    {a.suspect
                      ? `Attendance was not recorded on ${a.not_marked} of ${a.working_days} working days. Check the attendance register before issuing this card.`
                      : `Percentage hidden: ${a.not_marked} working ${a.not_marked === 1 ? 'day has' : 'days have'} no attendance recorded.`}
                  </p>
                )}
              </div>
            )
          })()}

          {/* Marks Table */}
          <MarksTable report={report} />

          {/* Skills & behaviour from the monthly assessment (read-only here; rated on the Assessments page) */}
          {report.conduct_assessment && (
            <div className="mb-4 p-3 border border-gray-100 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase">
                  Skills &amp; Behaviour
                  {report.conduct_assessment.month ? ` — ${MONTH_NAMES[report.conduct_assessment.month - 1]}` : ''}
                </p>
                <Link to="/assessments" className="text-xs text-primary-600 hover:underline">Edit on Assessments page</Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                {[...(report.conduct_assessment.skills || []), ...(report.conduct_assessment.behaviour || [])].map(item => (
                  <div key={item.field} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{item.label}</span>
                    <span className="text-amber-500 tracking-tight" aria-label={`${item.rating || 0} of 5`}>
                      {'★'.repeat(item.rating || 0)}<span className="text-gray-300">{'★'.repeat(5 - (item.rating || 0))}</span>
                    </span>
                  </div>
                ))}
              </div>
              {(report.conduct_assessment.teacher_remark || report.conduct_assessment.principal_remark) && (
                <div className="mt-3 pt-2 border-t border-gray-100 space-y-1 text-sm text-gray-700">
                  {report.conduct_assessment.teacher_remark && (
                    <p><span className="text-[10px] font-semibold text-indigo-600 uppercase mr-2">Class teacher</span><span className="italic">{report.conduct_assessment.teacher_remark}</span></p>
                  )}
                  {report.conduct_assessment.principal_remark && (
                    <p><span className="text-[10px] font-semibold text-indigo-600 uppercase mr-2">Principal</span><span className="italic">{report.conduct_assessment.principal_remark}</span></p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Promotion (final exam only) */}
          {report.promotion_applicable && (editMode || report.promotion_status !== 'NOT_APPLICABLE') && (
            <div className={`mb-4 p-3 rounded-lg border flex items-center justify-between gap-3 ${
              report.promotion_status === 'PROMOTED' ? 'bg-green-50 border-green-200'
                : report.promotion_status === 'NOT_PROMOTED' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'
            }`}>
              <span className="text-xs font-semibold text-gray-500 uppercase">Promotion status</span>
              {editMode ? (
                <select
                  value={report.promotion_status}
                  onChange={e => metaMut.mutate({ promotion_status: e.target.value })}
                  disabled={metaMut.isPending}
                  className="input text-sm"
                >
                  {PROMOTION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <span className={`text-sm font-bold uppercase ${report.promotion_status === 'PROMOTED' ? 'text-green-700' : 'text-red-700'}`}>
                  {report.promotion_status === 'PROMOTED' ? 'Promoted' : 'Not Promoted'}
                </span>
              )}
            </div>
          )}

          {/* Comments: read-only for viewers, inline-editable in edit mode (same store as the Results page) */}
          {editMode ? (
            <div className="mb-4 p-3 bg-indigo-50/60 border border-indigo-100 rounded-lg space-y-3">
              <div>
                <p className="text-[10px] font-semibold text-indigo-600 uppercase mb-1">Overall comment</p>
                {report.overall_comment_exam_id ? (
                  <EditableText
                    multiline
                    value={report.overall_comment}
                    saving={commentMut.isPending}
                    placeholder="Overall performance comment"
                    onSave={(comment) => commentMut.mutate({ examId: report.overall_comment_exam_id, subjectId: null, comment })}
                  />
                ) : <p className="text-xs text-gray-400">No exam to attach a comment to yet.</p>}
              </div>
              {report.subjects?.filter(s => s.comment_exam_id).map(s => (
                <div key={s.subject_id}>
                  <p className="text-[10px] font-semibold text-gray-600 uppercase mb-1">{s.subject_name}</p>
                  <EditableText
                    multiline
                    value={s.comment}
                    saving={commentMut.isPending}
                    placeholder={`Comment for ${s.subject_name}`}
                    onSave={(comment) => commentMut.mutate({ examId: s.comment_exam_id, subjectId: s.subject_id, comment })}
                  />
                </div>
              ))}
            </div>
          ) : (report.overall_comment || report.subjects?.some(s => s.comment)) && (
            <div className="mb-4 p-3 bg-indigo-50/60 border border-indigo-100 rounded-lg space-y-1.5">
              {report.overall_comment && (
                <p className="text-sm text-gray-700">
                  <span className="text-[10px] font-semibold text-indigo-600 uppercase mr-2">Overall</span>
                  <span className="italic">{report.overall_comment}</span>
                </p>
              )}
              {report.subjects?.filter(s => s.comment).map((s, i) => (
                <p key={i} className="text-xs text-gray-600">
                  <span className="font-medium text-gray-700">{s.subject_name}:</span>{' '}
                  <span className="italic">{s.comment}</span>
                </p>
              ))}
            </div>
          )}

          {/* Position */}
          {report.summary?.rank && (
            <div className="flex items-center gap-6 pt-4 border-t border-gray-200">
              <div>
                <p className="text-xs text-gray-500">Position in Class</p>
                <p className="text-lg font-bold text-primary-700">
                  {report.summary.rank}{report.class_size ? ` of ${report.class_size}` : ''}
                </p>
              </div>
            </div>
          )}

          {/* Issue date + signature captions (the same fields the PDF prints) */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2 mb-4 text-sm text-gray-600">
              <span>Date of issue:</span>
              {editMode ? (
                <input
                  type="date"
                  value={report.issue_date || new Date().toISOString().slice(0, 10)}
                  onChange={e => e.target.value && metaMut.mutate({ issue_date: e.target.value })}
                  className="input text-sm"
                />
              ) : (
                <span className="font-medium text-gray-800">
                  {formatIssueDate(report.issue_date || new Date().toISOString().slice(0, 10))}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              {['class_teacher', 'principal', 'parent'].map(key => {
                const label = report.signature_labels?.[key] || DEFAULT_SIGNATURE_LABELS[key]
                return (
                  <div key={key}>
                    <div className="border-b border-gray-300 h-8 mb-1" />
                    {editMode ? (
                      <EditableText
                        value={label}
                        maxLength={40}
                        saving={metaMut.isPending}
                        onSave={(text) => metaMut.mutate({
                          signature_labels: { ...(report.signature_labels || {}), [key]: text },
                        })}
                      />
                    ) : (
                      <p className="text-[11px] uppercase text-gray-500">{label}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
      {showBulk && (
        <BulkReportCardModal
          students={students.map(e => ({ studentId: e.student, name: e.student_name, roll: e.roll_number }))}
          yearId={yearId}
          examIds={examIds}
          onClose={() => setShowBulk(false)}
        />
      )}
    </div>
  )
}
