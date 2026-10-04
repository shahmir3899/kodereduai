import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { studentsApi, examinationsApi } from '../../../services/api'
import { useToast } from '../../../components/Toast'
import Button from '../../../components/ui/Button'

// The profile page's tab panels, moved out of StudentProfilePage unchanged.

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

export function OverviewTab({ summary, ai, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading summary...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load summary</div>
  if (!summary) return <div className="text-center py-10 text-gray-500">No summary available</div>

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

export function AttendanceTab({ data, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading attendance...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load attendance</div>
  const months = data?.months || []
  if (months.length === 0) return <div className="text-center py-10 text-gray-500">No attendance records found</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
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
    </div>
  )
}

export function FeesTab({ data, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading fee records...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load fee records</div>
  const payments = data?.payments || data || []
  if (payments.length === 0) return <div className="text-center py-10 text-gray-500">No fee records found</div>

  const statusColors = {
    PAID: 'bg-green-100 text-green-800',
    PARTIAL: 'bg-yellow-100 text-yellow-800',
    PENDING: 'bg-red-100 text-red-800',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
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
    </div>
  )
}

export function AcademicsTab({ data, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading exam results...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load exam results</div>
  const exams = data?.exams || data || []
  if (exams.length === 0) return <div className="text-center py-10 text-gray-500">No exam results found</div>

  return (
    <div className="space-y-4">
      {(Array.isArray(exams) ? exams : Object.entries(exams).map(([name, marks]) => ({ exam_name: name, marks }))).map((exam, i) => (
        <div key={i} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900">{exam.exam_name || exam.name || `Exam ${i + 1}`}</h3>
          </div>
          <div className="overflow-x-auto">
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
        </div>
      ))}
    </div>
  )
}

export function HistoryTab({ data, isLoading, error }) {
  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading enrollment history...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load enrollment history</div>
  const history = data?.enrollments || data || []
  if (history.length === 0) return <div className="text-center py-10 text-gray-500">No enrollment history found</div>

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
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
    </div>
  )
}

const SKILL_FIELDS = [
  ['listening', 'Listening'], ['speaking', 'Speaking'], ['writing', 'Writing'], ['reading', 'Reading'],
  ['participation', 'Participation'], ['confidence', 'Confidence'], ['social_skills', 'Social Skills'],
]
const BEHAVIOUR_FIELDS = [
  ['discipline', 'Discipline'], ['respect', 'Respect'], ['teamwork', 'Teamwork'],
  ['class_participation', 'Class Participation'], ['responsibility', 'Responsibility'],
]
const RATING_OPTIONS = [
  [1, 'Needs Improvement'], [2, 'Fair'], [3, 'Good'], [4, 'Very Good'], [5, 'Excellent'],
]
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

export function AssessmentTab({ studentId, academicYearId, month, onMonthChange, data, refetch, isLoading, error }) {
  const { showError, showSuccess } = useToast()
  const [form, setForm] = useState(null)

  useEffect(() => {
    if (!data) return
    const next = { teacher_remark: data.teacher_remark || '', principal_remark: data.principal_remark || '' }
    for (const [field] of [...SKILL_FIELDS, ...BEHAVIOUR_FIELDS]) {
      next[field] = data[field] ?? ''
    }
    setForm(next)
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (payload) => examinationsApi.saveStudentTermAssessment(payload),
    onSuccess: () => {
      showSuccess('Assessment saved.')
      refetch()
    },
    onError: () => showError('Failed to save assessment'),
  })

  if (isLoading || !form) return <div className="text-center py-10 text-gray-500">Loading assessment...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load assessment</div>

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  const handleSave = () => {
    const payload = { student: studentId, academic_year: academicYearId, month: Number(month) }
    for (const [field] of [...SKILL_FIELDS, ...BEHAVIOUR_FIELDS]) {
      payload[field] = form[field] === '' ? null : Number(form[field])
    }
    payload.teacher_remark = form.teacher_remark
    payload.principal_remark = form.principal_remark
    saveMutation.mutate(payload)
  }

  const RatingSelect = ({ field, label }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <label className="text-sm text-gray-700">{label}</label>
      <select
        value={form[field]}
        onChange={(e) => setField(field, e.target.value)}
        className="border border-gray-300 rounded-lg px-2 py-1 text-sm"
      >
        <option value="">Not rated</option>
        {RATING_OPTIONS.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
        <select
          value={month}
          onChange={(e) => onMonthChange(e.target.value)}
          className="w-full sm:w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm"
        >
          {MONTH_NAMES.map((label, index) => (
            <option key={label} value={String(index + 1)}>{label}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">Ratings and remarks are saved as a monthly snapshot.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Skills Assessment</h3>
        {SKILL_FIELDS.map(([field, label]) => <RatingSelect key={field} field={field} label={label} />)}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Behaviour Evaluation</h3>
        {BEHAVIOUR_FIELDS.map(([field, label]) => <RatingSelect key={field} field={field} label={label} />)}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Teacher Remark</label>
          <textarea
            rows={3}
            value={form.teacher_remark}
            onChange={(e) => setField('teacher_remark', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            placeholder="e.g. Aly is an active student who participates enthusiastically..."
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Principal Remark</label>
          <textarea
            rows={3}
            value={form.principal_remark}
            onChange={(e) => setField('principal_remark', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving...' : 'Save Assessment'}
        </Button>
      </div>
    </div>
  )
}

export function DocumentsTab({ studentId, data, refetch, isLoading, error }) {
  const [uploading, setUploading] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
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

  const handleDelete = async (docId) => {
    setDeletingId(docId)
    try {
      await studentsApi.deleteDocument(studentId, docId)
      showSuccess('Document deleted')
      refetch()
    } catch {
      showError('Failed to delete document')
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading documents...</div>
  if (error) return <div className="text-center py-10 text-red-600">Failed to load documents</div>

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
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  disabled={deletingId === doc.id}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  {deletingId === doc.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
