import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { studentsApi, examinationsApi } from '../services/api'
import { useToast } from '../components/Toast'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { useAuth } from '../contexts/AuthContext'
import { useUpdateStudent } from '../hooks/useUpdateStudent'
import { useStudentExit } from '../hooks/useStudentExit'
import { downloadInstantReport } from '../utils/downloadReport'
import { canManageStudentLifecycle } from '../utils/accessPolicies'
import Spinner from '../components/ui/Spinner'
import StudentProfileHeader from './students/profile/StudentProfileHeader'
import ProfileSections from './students/profile/ProfileSections'
import StatusUpdateModal from './students/profile/StatusUpdateModal'
import ParentInviteModal from './students/profile/ParentInviteModal'
import StudentExitWizard from './students/profile/StudentExitWizard'
import ReadmitStudentModal from './students/profile/ReadmitStudentModal'
import ReclassifyStudentModal from './students/components/ReclassifyStudentModal'
import {
  OverviewTab,
  AttendanceTab,
  FeesTab,
  AcademicsTab,
  AssessmentTab,
  HistoryTab,
  DocumentsTab,
} from './students/profile/ProfileTabs'

const TABS = ['Overview', 'Attendance', 'Fees', 'Academics', 'Assessment', 'History', 'Documents']

export default function StudentProfilePage() {
  const { id } = useParams()
  const [tab, setTab] = useState('Overview')
  const [assessmentMonth, setAssessmentMonth] = useState(String(new Date().getMonth() + 1))
  const [showStatusModal, setShowStatusModal] = useState(false)
  const [showReclassifyModal, setShowReclassifyModal] = useState(false)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [exitPrefill, setExitPrefill] = useState(null) // non-null while the exit wizard is open
  const [readmitPrefill, setReadmitPrefill] = useState(null) // non-null while the re-admit dialog is open
  const { showError, showSuccess } = useToast()
  const { user } = useAuth()
  const canManageLifecycle = canManageStudentLifecycle(user?.role)
  const { activeAcademicYear } = useAcademicYear()
  const { exitCase: openExit } = useStudentExit(id, { enabled: canManageLifecycle })

  // Report download — generated synchronously and streamed straight back, nothing saved server-side.
  const [isDownloadingReport, setIsDownloadingReport] = useState(false)

  const handleGenerateReport = async (periodParams) => {
    setIsDownloadingReport(true)
    try {
      await downloadInstantReport(
        { report_type: 'STUDENT_COMPREHENSIVE', parameters: { student_id: parseInt(id), ...periodParams } },
        `${student?.name || 'student'}-report.pdf`,
      )
    } catch {
      showError('Failed to generate report')
    } finally {
      setIsDownloadingReport(false)
    }
  }

  // Core data
  const { data: studentData, isLoading, isError: studentIsError, error: studentError } = useQuery({
    queryKey: ['student', id, activeAcademicYear?.id],
    queryFn: () => studentsApi.getStudent(
      id,
      activeAcademicYear?.id ? { academic_year: activeAcademicYear.id } : undefined,
    ),
  })

  const { data: summaryData, isLoading: summaryLoading, isError: summaryIsError, error: summaryError } = useQuery({
    queryKey: ['studentProfileSummary', id],
    queryFn: () => studentsApi.getProfileSummary(id),
  })

  // AI Profile
  const { data: aiData, isLoading: aiLoading, isError: aiIsError, error: aiError } = useQuery({
    queryKey: ['studentAIProfile', id],
    queryFn: () => studentsApi.getAIProfile(id),
  })

  // Tab-specific data — staleTime keeps cached results across tab switches;
  // gcTime holds data in memory for 10 min so re-visits within the session are instant.
  const { data: attendanceData, isLoading: attendanceLoading, isError: attendanceIsError, error: attendanceError } = useQuery({
    queryKey: ['studentAttendance', id],
    queryFn: () => studentsApi.getAttendanceHistory(id),
    enabled: tab === 'Attendance',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const { data: feeData, isLoading: feeLoading, isError: feeIsError, error: feeError } = useQuery({
    queryKey: ['studentFees', id],
    queryFn: () => studentsApi.getFeeLedger(id),
    enabled: tab === 'Fees',
    staleTime: 0,
    gcTime: 10 * 60_000,
  })

  const { data: examData, isLoading: examLoading, isError: examIsError, error: examError } = useQuery({
    queryKey: ['studentExams', id],
    queryFn: () => studentsApi.getExamResults(id),
    enabled: tab === 'Academics',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const {
    data: assessmentData, isLoading: assessmentLoading,
    isError: assessmentIsError, error: assessmentError, refetch: refetchAssessment,
  } = useQuery({
    queryKey: ['studentTermAssessment', id, activeAcademicYear?.id, assessmentMonth],
    queryFn: () => examinationsApi.getStudentTermAssessment({
      student_id: id,
      academic_year: activeAcademicYear?.id,
      month: assessmentMonth,
    }),
    enabled: tab === 'Assessment' && !!activeAcademicYear?.id && !!assessmentMonth,
    staleTime: 60_000,
  })

  const { data: historyData, isLoading: historyLoading, isError: historyIsError, error: historyError } = useQuery({
    queryKey: ['studentHistory', id],
    queryFn: () => studentsApi.getEnrollmentHistory(id),
    enabled: tab === 'History',
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  })

  const { data: docsData, isLoading: docsLoading, isError: docsIsError, error: docsError, refetch: refetchDocs } = useQuery({
    queryKey: ['studentDocuments', id],
    queryFn: () => studentsApi.getDocuments(id),
    enabled: tab === 'Documents',
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
  })

  // Profile edits come from the section cards, which show a rejected save beside
  // the field, so there is no error toast here. Optimistic: the header and cards
  // show the new values at once and roll back if the server refuses.
  const updateStudent = useUpdateStudent({
    onSuccess: () => showSuccess('Student profile updated successfully'),
  })

  const student = studentData?.data
  const summary = summaryData?.data

  // Skills/behaviour ratings and remarks from earlier branches (transferred students only).
  const { data: earlierAssessmentsData } = useQuery({
    queryKey: ['studentEarlierAssessments', id],
    queryFn: () => studentsApi.getEarlierAssessments(id),
    enabled: !!summary?.has_earlier_branch_data && tab === 'Assessment',
  })
  const ai = aiData?.data

  const handleOpenReclassifyModal = () => {
    if (!activeAcademicYear?.id) {
      showError('Select an academic year from the top switcher first')
      return
    }
    setShowReclassifyModal(true)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    )
  }

  if (studentIsError) {
    return (
      <div className="text-center py-20 text-red-600">
        Failed to load student profile: {studentError?.message || 'Unknown error'}
      </div>
    )
  }

  if (!student) {
    return <div className="text-center py-20 text-gray-500">Student not found</div>
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link to="/students" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Students
      </Link>

      <StudentProfileHeader
        student={student}
        ai={ai}
        canManageLifecycle={canManageLifecycle}
        isDownloadingReport={isDownloadingReport}
        onGenerateReport={handleGenerateReport}
        onUpdateStatus={() => setShowStatusModal(true)}
        onReclassify={handleOpenReclassifyModal}
        onInvite={() => setShowInviteModal(true)}
        summary={summary}
        openExit={openExit}
        onContinueExit={() => setExitPrefill({})}
        onReadmit={() => setReadmitPrefill({})}
        onOpenFees={() => setTab('Fees')}
      />

      <ProfileSections
        student={student}
        canEdit
        canManageLifecycle={canManageLifecycle}
        onSave={(payload) => updateStudent.mutateAsync({ id, payload })}
        onChangeClass={handleOpenReclassifyModal}
      />

      {/* AI Summary */}
      {aiLoading && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 text-sm text-gray-500">
          Loading AI assessment...
        </div>
      )}
      {aiIsError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          AI assessment unavailable: {aiError?.message || 'Unable to fetch profile insights'}
        </div>
      )}
      {ai?.ai_summary && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-start gap-2">
            <svg className="w-5 h-5 text-indigo-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-indigo-900">AI Assessment</p>
              <p className="text-sm text-indigo-800 mt-0.5">{ai.ai_summary}</p>
              {ai.recommendations?.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {ai.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-indigo-700 flex items-start gap-1">
                      <span className="mt-0.5">-</span> {r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {tab === 'Overview' && <OverviewTab summary={summary} ai={ai} isLoading={summaryLoading} error={summaryIsError ? summaryError : null} />}
      {tab === 'Attendance' && <AttendanceTab awayPeriods={student.away_periods} data={attendanceData?.data} isLoading={attendanceLoading} error={attendanceIsError ? attendanceError : null} />}
      {tab === 'Fees' && <FeesTab data={feeData?.data} isLoading={feeLoading} error={feeIsError ? feeError : null} />}
      {tab === 'Academics' && <AcademicsTab data={examData?.data} isLoading={examLoading} error={examIsError ? examError : null} />}
      {tab === 'Assessment' && (
        activeAcademicYear?.id
          ? (
            <AssessmentTab
              studentId={id}
              academicYearId={activeAcademicYear.id}
              month={assessmentMonth}
              onMonthChange={setAssessmentMonth}
              data={assessmentData?.data}
              earlier={earlierAssessmentsData?.data}
              refetch={refetchAssessment}
              isLoading={assessmentLoading}
              error={assessmentIsError ? assessmentError : null}
            />
          )
          : <div className="text-center py-10 text-gray-500">Select an academic year to record an assessment.</div>
      )}
      {tab === 'History' && <HistoryTab awayPeriods={student.away_periods} data={historyData?.data} isLoading={historyLoading} error={historyIsError ? historyError : null} />}
      {tab === 'Documents' && <DocumentsTab studentId={id} data={docsData?.data} refetch={refetchDocs} isLoading={docsLoading} error={docsIsError ? docsError : null} />}

      {showStatusModal && (
        <StatusUpdateModal
          student={student}
          onClose={() => setShowStatusModal(false)}
          onStartExit={(prefill) => {
            setShowStatusModal(false)
            setExitPrefill(prefill)
          }}
          onStartReadmit={(prefill) => {
            setShowStatusModal(false)
            setReadmitPrefill(prefill)
          }}
        />
      )}
      {exitPrefill && <StudentExitWizard student={student} prefill={exitPrefill} onClose={() => setExitPrefill(null)} />}
      {readmitPrefill && <ReadmitStudentModal student={student} prefill={readmitPrefill} onClose={() => setReadmitPrefill(null)} />}
      {showReclassifyModal && <ReclassifyStudentModal student={student} onClose={() => setShowReclassifyModal(false)} />}
      {showInviteModal && <ParentInviteModal student={student} onClose={() => setShowInviteModal(false)} />}
    </div>
  )
}
