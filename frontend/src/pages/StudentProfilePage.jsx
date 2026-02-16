import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentsApi, reportsApi } from '../services/api'
import { useToast } from '../components/Toast'
import { useBackgroundTask } from '../hooks/useBackgroundTask'

const TABS = ['Overview', 'Attendance', 'Fees', 'Academics', 'History', 'Documents']

const riskColors = {
  HIGH: 'bg-red-100 text-red-800 border-red-200',
  MEDIUM: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  LOW: 'bg-green-100 text-green-800 border-green-200',
}

export default function StudentProfilePage() {
  const { id } = useParams()
  const [tab, setTab] = useState('Overview')
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  // Report download (background task)
  const reportTask = useBackgroundTask({
    mutationFn: (data) => reportsApi.generate(data),
    taskType: 'REPORT_GENERATION',
    title: 'Generating Student Report',
    onSuccess: (resultData) => {
      if (resultData?.download_url) {
        const baseUrl = import.meta.env.VITE_API_URL || ''
        window.open(`${baseUrl}${resultData.download_url}`, '_blank')
      }
    },
  })

  // Core data
  const { data: studentData, isLoading } = useQuery({
    queryKey: ['student', id],
    queryFn: () => studentsApi.getStudent(id),
  })

  const { data: summaryData } = useQuery({
    queryKey: ['studentProfileSummary', id],
    queryFn: () => studentsApi.getProfileSummary(id),
  })

  // AI Profile
  const { data: aiData, isLoading: aiLoading } = useQuery({
    queryKey: ['studentAIProfile', id],
    queryFn: () => studentsApi.getAIProfile(id),
  })

  // Tab-specific data
  const { data: attendanceData } = useQuery({
    queryKey: ['studentAttendance', id],
    queryFn: () => studentsApi.getAttendanceHistory(id),
    enabled: tab === 'Attendance',
  })

  const { data: feeData } = useQuery({
    queryKey: ['studentFees', id],
    queryFn: () => studentsApi.getFeeLedger(id),
    enabled: tab === 'Fees',
  })

  const { data: examData } = useQuery({
    queryKey: ['studentExams', id],
    queryFn: () => studentsApi.getExamResults(id),
    enabled: tab === 'Academics',
  })

  const { data: historyData } = useQuery({
    queryKey: ['studentHistory', id],
    queryFn: () => studentsApi.getEnrollmentHistory(id),
    enabled: tab === 'History',
  })

  const { data: docsData, refetch: refetchDocs } = useQuery({
    queryKey: ['studentDocuments', id],
    queryFn: () => studentsApi.getDocuments(id),
    enabled: tab === 'Documents',
  })

  const student = studentData?.data
  const summary = summaryData?.data
  const ai = aiData?.data

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
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

      {/* Header Card */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
            <span className="text-2xl font-bold text-primary-700">
              {student.name?.charAt(0)?.toUpperCase()}
            </span>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{student.name}</h1>
              {ai?.overall_risk && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${riskColors[ai.overall_risk]}`}>
                  {ai.overall_risk} Risk
                </span>
              )}
              {student.status && student.status !== 'ACTIVE' && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  {student.status}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm text-gray-500">
              <span>Roll #{student.roll_number}</span>
              <span>{student.class_name}</span>
              {student.admission_number && <span>Adm #{student.admission_number}</span>}
              {student.gender && <span>{student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : 'Other'}</span>}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm text-gray-500">
              {student.parent_phone && <span>Parent: {student.parent_phone}</span>}
              {student.guardian_phone && <span>Guardian: {student.guardian_phone}</span>}
              {student.parent_name && <span>{student.parent_name}</span>}
            </div>
          </div>
          {/* Quick download */}
          <button
            onClick={() => reportTask.trigger({
              report_type: 'STUDENT_COMPREHENSIVE',
              format: 'PDF',
              parameters: { student_id: parseInt(id) },
            })}
            disabled={reportTask.isSubmitting}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm flex-shrink-0 disabled:opacity-50"
          >
            {reportTask.isSubmitting ? 'Starting...' : 'Download Report'}
          </button>
        </div>
      </div>

      {/* AI Summary */}
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
      {tab === 'Overview' && <OverviewTab summary={summary} ai={ai} />}
      {tab === 'Attendance' && <AttendanceTab data={attendanceData?.data} />}
      {tab === 'Fees' && <FeesTab data={feeData?.data} />}
      {tab === 'Academics' && <AcademicsTab data={examData?.data} />}
      {tab === 'History' && <HistoryTab data={historyData?.data} />}
      {tab === 'Documents' && <DocumentsTab studentId={id} data={docsData?.data} refetch={refetchDocs} />}
    </div>
  )
}

function StatCard({ label, value, sub, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary-50 text-primary-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    yellow: 'bg-yellow-50 text-yellow-700',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${colors[color]?.split(' ')[1] || 'text-gray-900'}`}>{value ?? '-'}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function OverviewTab({ summary, ai }) {
  if (!summary) return <div className="text-center py-10 text-gray-500">Loading summary...</div>

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard
        label="Attendance"
        value={summary.attendance_rate != null ? `${summary.attendance_rate}%` : 'N/A'}
        sub={`${summary.present_days || 0} / ${summary.total_days || 0} days`}
        color={summary.attendance_rate >= 75 ? 'green' : summary.attendance_rate >= 60 ? 'yellow' : 'red'}
      />
      <StatCard
        label="Fee Paid"
        value={summary.total_due ? `${Math.round((summary.total_paid || 0) / summary.total_due * 100)}%` : 'N/A'}
        sub={`PKR ${(summary.total_paid || 0).toLocaleString()} / ${(summary.total_due || 0).toLocaleString()}`}
        color={summary.total_paid >= summary.total_due ? 'green' : 'yellow'}
      />
      <StatCard
        label="Outstanding"
        value={`PKR ${(summary.outstanding || 0).toLocaleString()}`}
        color={summary.outstanding > 0 ? 'red' : 'green'}
      />
      <StatCard
        label="Exam Average"
        value={summary.exam_average != null ? `${summary.exam_average}` : 'N/A'}
        color={summary.exam_average >= 60 ? 'green' : summary.exam_average >= 40 ? 'yellow' : 'red'}
      />
      {ai?.attendance && (
        <>
          <StatCard label="Attendance Risk" value={ai.attendance.risk} color={ai.attendance.risk === 'LOW' ? 'green' : ai.attendance.risk === 'MEDIUM' ? 'yellow' : 'red'} sub={`Trend: ${ai.attendance.trend}`} />
          <StatCard label="Academic Risk" value={ai.academic?.risk || 'N/A'} color={ai.academic?.risk === 'LOW' ? 'green' : ai.academic?.risk === 'MEDIUM' ? 'yellow' : 'red'} sub={ai.academic?.weakest ? `Weakest: ${ai.academic.weakest}` : null} />
          <StatCard label="Financial Risk" value={ai.financial?.risk || 'N/A'} color={ai.financial?.risk === 'LOW' ? 'green' : ai.financial?.risk === 'MEDIUM' ? 'yellow' : 'red'} sub={`${ai.financial?.months_overdue || 0} months overdue`} />
          <StatCard label="Overall Risk Score" value={ai.risk_score != null ? `${ai.risk_score}%` : 'N/A'} color={ai.overall_risk === 'LOW' ? 'green' : ai.overall_risk === 'MEDIUM' ? 'yellow' : 'red'} />
        </>
      )}
    </div>
  )
}

function AttendanceTab({ data }) {
  const months = data?.months || []
  if (months.length === 0) return <div className="text-center py-10 text-gray-500">No attendance records found</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Present</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Absent</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Late</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {months.map((m, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm font-medium text-gray-900">{m.month}</td>
              <td className="px-4 py-3 text-sm text-green-600">{m.present}</td>
              <td className="px-4 py-3 text-sm text-red-600">{m.absent}</td>
              <td className="px-4 py-3 text-sm text-yellow-600">{m.late || 0}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{m.total}</td>
              <td className="px-4 py-3 text-sm">
                <span className={`font-medium ${m.rate >= 75 ? 'text-green-600' : m.rate >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {m.rate}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FeesTab({ data }) {
  const payments = data?.payments || data || []
  if (payments.length === 0) return <div className="text-center py-10 text-gray-500">No fee records found</div>

  const statusColors = {
    PAID: 'bg-green-100 text-green-800',
    PARTIAL: 'bg-yellow-100 text-yellow-800',
    PENDING: 'bg-red-100 text-red-800',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Fee Type</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Due</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Paid</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {payments.map((p, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm text-gray-900">
                {p.month_name || `${p.month}/${p.year}`}
              </td>
              <td className="px-4 py-3 text-sm text-gray-600">{p.fee_type_name || p.fee_type || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-900 text-right">PKR {parseFloat(p.amount_due || 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-sm text-gray-900 text-right">PKR {parseFloat(p.amount_paid || 0).toLocaleString()}</td>
              <td className="px-4 py-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[p.status] || 'bg-gray-100 text-gray-800'}`}>
                  {p.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AcademicsTab({ data }) {
  const exams = data?.exams || data || []
  if (exams.length === 0) return <div className="text-center py-10 text-gray-500">No exam results found</div>

  return (
    <div className="space-y-4">
      {(Array.isArray(exams) ? exams : Object.entries(exams).map(([name, marks]) => ({ exam_name: name, marks }))).map((exam, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">{exam.exam_name || exam.name || `Exam ${i + 1}`}</h3>
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Subject</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Obtained</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Total</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">%</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(exam.marks || exam.subjects || []).map((m, j) => {
                const pct = m.total_marks ? Math.round(m.marks_obtained / m.total_marks * 100) : 0
                return (
                  <tr key={j}>
                    <td className="px-4 py-2 text-sm text-gray-900">{m.subject_name || m.subject}</td>
                    <td className="px-4 py-2 text-sm text-gray-900 text-right">{m.marks_obtained}</td>
                    <td className="px-4 py-2 text-sm text-gray-500 text-right">{m.total_marks}</td>
                    <td className="px-4 py-2 text-sm text-right">
                      <span className={pct >= 60 ? 'text-green-600' : pct >= 40 ? 'text-yellow-600' : 'text-red-600'}>
                        {pct}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600">{m.grade || '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}

function HistoryTab({ data }) {
  const history = data?.enrollments || data || []
  if (history.length === 0) return <div className="text-center py-10 text-gray-500">No enrollment history found</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Academic Year</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Class</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Section</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Roll #</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {history.map((e, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-4 py-3 text-sm text-gray-900">{e.academic_year_name || e.academic_year}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{e.class_name}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{e.section || '-'}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{e.roll_number || '-'}</td>
              <td className="px-4 py-3 text-sm">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  e.status === 'ACTIVE' ? 'bg-green-100 text-green-800' :
                  e.status === 'PROMOTED' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {e.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DocumentsTab({ studentId, data, refetch }) {
  const [uploading, setUploading] = useState(false)
  const { showError, showSuccess } = useToast()
  const docs = data?.documents || data || []

  const typeLabels = {
    PHOTO: 'Photo',
    BIRTH_CERT: 'Birth Certificate',
    PREV_REPORT: 'Previous Report',
    TC: 'Transfer Certificate',
    MEDICAL: 'Medical Record',
    OTHER: 'Other',
  }

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await studentsApi.uploadDocument(studentId, {
        title: file.name,
        document_type: 'OTHER',
        file_url: `uploads/${file.name}`, // Placeholder - real upload would use Supabase
      })
      showSuccess('Document record created')
      refetch()
    } catch {
      showError('Failed to upload document')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <label className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm cursor-pointer">
          {uploading ? 'Uploading...' : 'Upload Document'}
          <input type="file" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No documents uploaded</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-900">{doc.title}</p>
                <p className="text-xs text-gray-500">
                  {typeLabels[doc.document_type] || doc.document_type} - {new Date(doc.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {doc.file_url && (
                  <a href={doc.file_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 hover:text-primary-800">
                    View
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
