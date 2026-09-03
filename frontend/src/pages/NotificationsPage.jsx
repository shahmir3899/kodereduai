import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useAcademicYear } from '../contexts/AcademicYearContext'
import { useToast } from '../components/Toast'
import { formatDistanceToNow } from 'date-fns'
import { useSessionClasses } from '../hooks/useSessionClasses'

// === CONSTANTS (mirrored from backend model choices) ===

const EVENT_TYPES = [
  { value: 'ABSENCE', label: 'Absence Alert' },
  { value: 'FEE_DUE', label: 'Fee Due Reminder' },
  { value: 'FEE_OVERDUE', label: 'Fee Overdue Alert' },
  { value: 'EXAM_RESULT', label: 'Exam Result' },
  { value: 'GENERAL', label: 'General Announcement' },
  { value: 'CUSTOM', label: 'Custom Message' },
  { value: 'TRANSPORT_UPDATE', label: 'Transport Update' },
  { value: 'LIBRARY_OVERDUE', label: 'Library Overdue' },
  { value: 'ASSIGNMENT_DUE', label: 'Assignment Due' },
]

const EVENT_TYPE_LABEL = Object.fromEntries(
  EVENT_TYPES.map(({ value, label }) => [value, label])
)

const CHANNELS = [
  { value: 'IN_APP', label: 'In-App' },
  // { value: 'WHATSAPP', label: 'WhatsApp' },  // DEPRECATED 2026-05-13
  { value: 'EMAIL', label: 'Email' },
  { value: 'PUSH', label: 'Push Notification' },
]
const SEND_CHANNELS = CHANNELS.filter((c) => c.value !== 'PUSH')

const CHANNEL_LABEL = Object.fromEntries(
  CHANNELS.map(({ value, label }) => [value, label])
)

const RECIPIENT_TYPES = [
  { value: 'PARENT', label: 'All Parents' },
  { value: 'TEACHER', label: 'All Teachers' },
  { value: 'STAFF', label: 'All Staff' },
  { value: 'SCHOOL_ADMIN', label: 'All Admins' },
  { value: 'PRINCIPAL', label: 'Principals' },
  { value: 'HR_MANAGER', label: 'HR Managers' },
  { value: 'ACCOUNTANT', label: 'Accountants' },
  { value: 'STUDENT', label: 'All Students' },
]

// const WHATSAPP_CHAR_LIMIT = 4096  // DEPRECATED 2026-05-13
const TEMPLATE_PREVIEW_CONTEXT = {
  student_name: 'Ayaan Khan',
  class_name: 'Class 5A',
  date: '2026-05-05',
  amount: '7890',
  exam_name: 'Mid Term',
  school_name: 'Your School',
  month: 'May 2026',
  due_date: '2026-05-08',
  attendance_rate: '92%',
  roll_number: '23',
  section_name: 'A',
}
const SUPPORTED_PLACEHOLDERS = Object.keys(TEMPLATE_PREVIEW_CONTEXT)
const PLACEHOLDER_PATTERN = /\{\{\s*([^}]+)\s*\}\}/g

const TABS = ['Inbox', 'Templates', 'Send', 'Analytics', 'Settings']

const Spinner = () => (
  <div className="flex justify-center py-10">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
  </div>
)

// === MAIN COMPONENT ===

export default function NotificationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(user?.role)

  const visibleTabs = isAdmin ? TABS : ['Inbox']
  const initialTab = searchParams.get('tab') || 'Inbox'
  const [tab, setTab] = useState(visibleTabs.includes(initialTab) ? initialTab : 'Inbox')

  const handleTabChange = (t) => {
    setTab(t)
    if (t !== 'Inbox') {
      setSearchParams({ tab: t })
    } else {
      setSearchParams({})
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="text-sm text-gray-500 mt-1">Manage notifications and communication templates</p>
      </div>

      <div className="border-b border-gray-200">
        <nav className="flex gap-6 overflow-x-auto">
          {visibleTabs.map((t) => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
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

      {tab === 'Inbox' && <InboxTab />}
      {tab === 'Templates' && <TemplatesTab />}
      {tab === 'Send' && <SendTab />}
      {tab === 'Analytics' && <AnalyticsTab />}
      {tab === 'Settings' && <SettingsTab />}
    </div>
  )
}

// === INBOX TAB ===

function InboxTab() {
  const queryClient = useQueryClient()
  const { showSuccess } = useToast()
  const { user, activeSchool } = useAuth()
  const [filter, setFilter] = useState('')
  const [schoolFilter, setSchoolFilter] = useState('')
  const [page, setPage] = useState(1)
  const [confirmMarkAll, setConfirmMarkAll] = useState(false)
  const schoolOptions = user?.schools || []

  const { data, isLoading } = useQuery({
    queryKey: ['myNotifications', filter, schoolFilter, page],
    queryFn: () => notificationsApi.getMyNotifications({
      event_type: filter || undefined,
      school_id: schoolFilter || undefined,
      page,
      page_size: 20,
    }),
  })

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead({
      school_id: schoolFilter || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myNotifications'] })
      queryClient.invalidateQueries({ queryKey: ['notificationUnreadCount'] })
      showSuccess('All notifications marked as read')
      setConfirmMarkAll(false)
    },
  })

  const markReadMutation = useMutation({
    mutationFn: (id) => notificationsApi.markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myNotifications'] })
      queryClient.invalidateQueries({ queryKey: ['notificationUnreadCount'] })
    },
  })

  const notifications = data?.data?.results || data?.data || []
  const totalCount = data?.data?.count || notifications.length
  const totalPages = Math.ceil(totalCount / 20) || 1

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <select
            value={schoolFilter}
            onChange={(e) => { setSchoolFilter(e.target.value); setPage(1) }}
            className="text-sm border-gray-300 rounded-lg"
          >
            <option value="">All Schools</option>
            {schoolOptions.map((school) => (
              <option key={school.id} value={school.id}>{school.name}</option>
            ))}
          </select>
          <select
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(1) }}
            className="text-sm border-gray-300 rounded-lg"
          >
            <option value="">All Types</option>
            {EVENT_TYPES.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setConfirmMarkAll(true)}
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          Mark all read
        </button>
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No notifications</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
          {notifications.map((n) => (
            <div
              key={n.id}
              className={`px-4 py-3 hover:bg-gray-50 cursor-pointer ${n.status !== 'READ' ? 'bg-primary-50/30' : ''}`}
              onClick={() => n.status !== 'READ' && markReadMutation.mutate(n.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {n.status !== 'READ' && (
                      <span className="inline-block w-2 h-2 rounded-full bg-primary-500 flex-shrink-0" />
                    )}
                    <p className="text-sm font-medium text-gray-900">{n.title}</p>
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                      {EVENT_TYPE_LABEL[n.event_type] || n.event_type}
                    </span>
                    {n.channel && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">
                        {CHANNEL_LABEL[n.channel] || n.channel}
                      </span>
                    )}
                    {n.school_name && (
                      <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-50 text-emerald-700">
                        {n.school_name}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">{n.body}</p>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap ml-4">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-500">{totalCount} notifications</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-xs border rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500 self-center">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-xs border rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Mark All Read confirmation */}
      {confirmMarkAll && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Mark All as Read</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to mark all notifications as read? This cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setConfirmMarkAll(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                onClick={() => markAllMutation.mutate()}
                disabled={markAllMutation.isPending}
                className="px-4 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
              >
                {markAllMutation.isPending ? 'Marking...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// === TEMPLATES TAB ===

function TemplatesTab() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [previewTemplate, setPreviewTemplate] = useState(null)
  const [form, setForm] = useState({
    name: '', event_type: 'GENERAL', channel: 'IN_APP', subject_template: '', body_template: '', is_active: true,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['notificationTemplates', page],
    queryFn: () => notificationsApi.getTemplates({ page, page_size: 20 }),
  })

  const saveMutation = useMutation({
    mutationFn: (d) => editingTemplate
      ? notificationsApi.updateTemplate(editingTemplate.id, d)
      : notificationsApi.createTemplate(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationTemplates'] })
      setShowForm(false)
      setEditingTemplate(null)
      showSuccess('Template saved')
    },
    onError: () => showError('Failed to save template'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => notificationsApi.deleteTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationTemplates'] })
      setDeleteConfirm(null)
      showSuccess('Template deleted')
    },
    onError: () => showError('Failed to delete template'),
  })

  const templates = data?.data?.results || data?.data || []
  const totalCount = data?.data?.count || templates.length
  const totalPages = Math.ceil(totalCount / 20) || 1

  const filteredTemplates = search
    ? templates.filter((t) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.body_template.toLowerCase().includes(search.toLowerCase())
      )
    : templates

  const resetForm = () => {
    setEditingTemplate(null)
    setForm({ name: '', event_type: 'GENERAL', channel: 'IN_APP', subject_template: '', body_template: '', is_active: true })
    setShowForm(true)
  }

  const openEdit = (t) => {
    setEditingTemplate(t)
    setForm({ name: t.name, event_type: t.event_type, channel: t.channel, subject_template: t.subject_template || '', body_template: t.body_template, is_active: t.is_active })
    setShowForm(true)
  }

  const renderTemplatePreview = (template) => {
    if (!template?.body_template) return ''
    return template.body_template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, key) => {
      const clean = String(key || '').trim()
      return TEMPLATE_PREVIEW_CONTEXT[clean] ?? match
    })
  }

  const duplicateTemplate = (template) => {
    setEditingTemplate(null)
    setForm({
      name: `${template.name} (Copy)`,
      event_type: template.event_type,
      channel: template.channel,
      subject_template: template.subject_template || '',
      body_template: template.body_template || '',
      is_active: template.is_active,
    })
    setShowForm(true)
  }

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
        Templates are reusable message drafts for manual sends and broadcast workflows.
        You can use placeholders like <code>{'{{student_name}}'}</code>, <code>{'{{class_name}}'}</code>, <code>{'{{date}}'}</code>, <code>{'{{amount}}'}</code>, <code>{'{{month}}'}</code>, <code>{'{{due_date}}'}</code>, <code>{'{{exam_name}}'}</code>, <code>{'{{school_name}}'}</code>, <code>{'{{roll_number}}'}</code>, <code>{'{{section_name}}'}</code>, and <code>{'{{attendance_rate}}'}</code>.
        Any <code>{'{{key}}'}</code> works when that key is provided by trigger/manual context.
      </div>
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="text-sm border-gray-300 rounded-lg w-64"
        />
        <button
          onClick={resetForm}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
        >
          New Template
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              placeholder="Template Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="text-sm border-gray-300 rounded-lg"
            />
            <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} className="text-sm border-gray-300 rounded-lg">
              {EVENT_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="text-sm border-gray-300 rounded-lg">
              {CHANNELS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <input
            placeholder="Subject (optional)"
            value={form.subject_template}
            onChange={(e) => setForm({ ...form, subject_template: e.target.value })}
            className="w-full text-sm border-gray-300 rounded-lg"
          />
          <textarea
            placeholder="Message body (for example: Hi {{student_name}}, {{amount}} is pending for {{class_name}} as of {{date}}.)"
            value={form.body_template}
            onChange={(e) => setForm({ ...form, body_template: e.target.value })}
            rows={3}
            className="w-full text-sm border-gray-300 rounded-lg"
          />
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
              Active
            </label>
            <div className="flex-1" />
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button
              onClick={() => saveMutation.mutate(form)}
              disabled={saveMutation.isPending || !form.name || !form.body_template}
              className="px-4 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {filteredTemplates.length === 0 ? (
        <div className="text-center py-10 text-gray-500">{search ? 'No templates match your search' : 'No templates yet'}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
          {filteredTemplates.map((t) => (
            <div key={t.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{t.name}</p>
                  <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">
                    {EVENT_TYPE_LABEL[t.event_type] || t.event_type}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">
                    {CHANNEL_LABEL[t.channel] || t.channel}
                  </span>
                  {!t.is_active && <span className="px-1.5 py-0.5 rounded text-xs bg-red-50 text-red-600">Inactive</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate max-w-lg">{t.body_template}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(t)} className="text-xs text-primary-600 hover:text-primary-800">Edit</button>
                <button onClick={() => duplicateTemplate(t)} className="text-xs text-indigo-600 hover:text-indigo-800">Duplicate</button>
                <button onClick={() => setPreviewTemplate(t)} className="text-xs text-emerald-600 hover:text-emerald-800">Preview</button>
                <button onClick={() => setDeleteConfirm(t)} className="text-xs text-red-600 hover:text-red-800">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-gray-500">{totalCount} templates</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1 text-xs border rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Previous
            </button>
            <span className="text-xs text-gray-500 self-center">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1 text-xs border rounded-lg disabled:opacity-50 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Delete Template</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete <strong>{deleteConfirm.name}</strong>? This cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="px-4 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewTemplate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-xl mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Template Preview</h2>
            <p className="text-xs text-gray-500 mb-4">
              Sample placeholder values are used for this preview.
            </p>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-medium text-gray-500">Template</p>
                <p className="text-gray-900">{previewTemplate.name}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Subject</p>
                <p className="text-gray-900">{previewTemplate.subject_template || '(No subject)'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Rendered Body</p>
                <p className="text-gray-900 whitespace-pre-wrap">{renderTemplatePreview(previewTemplate)}</p>
              </div>
            </div>
            <div className="flex justify-end mt-5">
              <button
                onClick={() => setPreviewTemplate(null)}
                className="px-4 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// === RUN JOBS PANEL (manual replacements for the old Celery Beat jobs) ===

function RunJobsPanel() {
  const { showError, showSuccess } = useToast()
  const now = new Date()
  const [feeMonth, setFeeMonth] = useState(now.getMonth() + 1)
  const [feeYear, setFeeYear] = useState(now.getFullYear())

  const runMutation = useMutation({
    mutationFn: (data) => notificationsApi.runJob(data),
    onSuccess: (res, variables) => {
      const { sent } = res.data || {}
      const labels = {
        fee_pending: 'Fee reminders',
        daily_report: 'Daily report',
        attendance_reminder: 'Attendance reminders',
      }
      showSuccess(`${labels[variables.job] || 'Job'} sent (${sent ?? 0}).`)
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to run job'),
  })

  const runningJob = runMutation.isPending ? runMutation.variables?.job : null

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">Run Now</p>
        <p className="text-xs text-gray-500">
          These used to run automatically on a schedule. Now they fire from the
          action that causes them (fee generation, attendance saved) — use these
          buttons to trigger this school's copy on demand.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={feeMonth}
          onChange={(e) => setFeeMonth(Number(e.target.value))}
          className="text-xs border-gray-300 rounded-lg"
        >
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <input
          type="number"
          value={feeYear}
          onChange={(e) => setFeeYear(Number(e.target.value))}
          className="text-xs border-gray-300 rounded-lg w-20"
        />
        <button
          onClick={() => runMutation.mutate({ job: 'fee_pending', month: feeMonth, year: feeYear })}
          disabled={runMutation.isPending}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 text-xs font-medium disabled:opacity-50"
        >
          {runningJob === 'fee_pending' ? 'Sending...' : 'Send Fee Reminders Now'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => runMutation.mutate({ job: 'daily_report' })}
          disabled={runMutation.isPending}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 text-xs font-medium disabled:opacity-50"
        >
          {runningJob === 'daily_report' ? 'Sending...' : 'Generate Daily Report Now'}
        </button>
        <button
          onClick={() => runMutation.mutate({ job: 'attendance_reminder' })}
          disabled={runMutation.isPending}
          className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg hover:bg-gray-100 text-xs font-medium disabled:opacity-50"
        >
          {runningJob === 'attendance_reminder' ? 'Sending...' : 'Remind Teachers to Mark Attendance'}
        </button>
      </div>
    </div>
  )
}

// === SEND TAB ===

function SendTab() {
  const { showError, showSuccess } = useToast()
  const { user, activeSchool } = useAuth()
  const { activeAcademicYear } = useAcademicYear()
  const { sessionClasses } = useSessionClasses(activeAcademicYear?.id, activeSchool?.id)
  const [mode, setMode] = useState('broadcast')
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [confirmSendOpen, setConfirmSendOpen] = useState(false)
  const [audiencePreview, setAudiencePreview] = useState(null)
  const [placeholderWarning, setPlaceholderWarning] = useState(null)
  const [form, setForm] = useState({
    event_type: 'GENERAL', channel: 'IN_APP', title: '', body: '',
    recipient_type: 'PARENT', recipient_identifier: '',
    session_class_id: '',
  })

  // Fetch templates for the template picker
  const { data: templatesData } = useQuery({
    queryKey: ['notificationTemplates'],
    queryFn: () => notificationsApi.getTemplates({ page_size: 100 }),
  })
  const templates = templatesData?.data?.results || templatesData?.data || []

  const broadcastMutation = useMutation({
    mutationFn: (d) => notificationsApi.broadcast(d),
    onSuccess: (res) => {
      const stats = res.data
      showSuccess(`Sent to ${stats.sent} recipients (${stats.skipped} skipped, ${stats.failed} failed)`)
      resetForm()
    },
    onError: (err) => showError(err.response?.data?.detail || 'Failed to send broadcast'),
  })

  const previewMutation = useMutation({
    mutationFn: (d) => notificationsApi.previewBroadcastRecipients(d),
    onSuccess: (res) => setAudiencePreview(res.data),
    onError: (err) => showError(err.response?.data?.detail || 'Failed to preview recipients'),
  })

  const sendMutation = useMutation({
    mutationFn: (d) => notificationsApi.send(d),
    onSuccess: () => {
      showSuccess('Notification sent')
      resetForm()
    },
    onError: (err) => showError(err.response?.data?.detail || err.response?.data?.recipient_identifier?.[0] || 'Failed to send notification'),
  })

  const testSendMutation = useMutation({
    mutationFn: () => notificationsApi.send({
      event_type: form.event_type,
      channel: 'IN_APP',
      recipient_identifier: String(user?.id || ''),
      recipient_type: 'STAFF',
      title: form.title || 'Test Notification',
      body: form.body || 'This is a test notification sent to your own inbox.',
    }),
    onSuccess: () => showSuccess('Test notification sent to your account'),
    onError: (err) => showError(err.response?.data?.detail || 'Test send failed'),
  })

  const resetForm = () => {
    setForm({
      event_type: 'GENERAL', channel: 'IN_APP', title: '', body: '',
      recipient_type: 'PARENT', recipient_identifier: '',
      session_class_id: '',
    })
    setSelectedTemplate(null)
    setAudiencePreview(null)
    setConfirmSendOpen(false)
  }

  const applyTemplate = (template) => {
    setSelectedTemplate(template)
    setForm({
      ...form,
      event_type: template.event_type,
      channel: template.channel,
      title: template.subject_template || form.title,
      body: template.body_template || form.body,
    })
  }

  const extractPlaceholders = (text) => {
    const keys = new Set()
    if (!text) return []
    let match = PLACEHOLDER_PATTERN.exec(text)
    while (match) {
      keys.add(String(match[1] || '').trim())
      match = PLACEHOLDER_PATTERN.exec(text)
    }
    PLACEHOLDER_PATTERN.lastIndex = 0
    return [...keys]
  }

  const buildPlaceholderWarning = () => {
    const found = [
      ...extractPlaceholders(form.title),
      ...extractPlaceholders(form.body),
    ]
    const uniqueFound = [...new Set(found)]
    if (!uniqueFound.length) return null

    const unknown = uniqueFound.filter((key) => !SUPPORTED_PLACEHOLDERS.includes(key))
    const unresolved = uniqueFound.filter((key) => SUPPORTED_PLACEHOLDERS.includes(key))
    return {
      found: uniqueFound,
      unknown,
      unresolved,
    }
  }

  const handleSend = () => {
    if (mode === 'broadcast') {
      broadcastMutation.mutate({
        event_type: form.event_type,
        channel: form.channel,
        recipient_type: form.recipient_type,
        title: form.title,
        body: form.body,
        session_class_id: form.session_class_id || undefined,
      })
    } else {
      sendMutation.mutate({
        event_type: form.event_type,
        channel: form.channel,
        recipient_identifier: form.recipient_identifier,
        recipient_type: form.recipient_type,
        title: form.title,
        body: form.body,
      })
    }
  }

  const runPreview = () => {
    previewMutation.mutate({
      channel: form.channel,
      recipient_type: form.recipient_type,
      session_class_id: form.session_class_id || undefined,
    })
  }

  const openConfirm = () => {
    const warning = buildPlaceholderWarning()
    if (warning) {
      setPlaceholderWarning(warning)
      return
    }
    if (mode === 'broadcast') {
      runPreview()
      setConfirmSendOpen(true)
      return
    }
    handleSend()
  }

  const isPending = broadcastMutation.isPending || sendMutation.isPending || previewMutation.isPending
  const canSend = form.title && form.body && (mode === 'broadcast' || form.recipient_identifier)

  const charLimit = null  // WhatsApp removed 2026-05-13

  return (
    <div className="max-w-xl space-y-4">
      <RunJobsPanel />
      <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
        <strong>In-App</strong> already includes mobile push fanout. Push is not a separate send channel here.
      </div>
      {/* Mode Switcher */}
      <div className="flex bg-gray-100 rounded-lg p-0.5">
        <button
          onClick={() => setMode('broadcast')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            mode === 'broadcast' ? 'bg-white shadow text-primary-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Broadcast to Group
        </button>
        <button
          onClick={() => setMode('single')}
          className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
            mode === 'single' ? 'bg-white shadow text-primary-600' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Single Recipient
        </button>
      </div>

      {/* Template Picker */}
      {templates.length > 0 && (
        <div>
          <label className="text-xs font-medium text-gray-600">Use Template (optional)</label>
          <select
            value={selectedTemplate?.id || ''}
            onChange={(e) => {
              const t = templates.find((t) => t.id === parseInt(e.target.value))
              if (t) applyTemplate(t)
              else setSelectedTemplate(null)
            }}
            className="w-full text-sm border-gray-300 rounded-lg mt-1"
          >
            <option value="">-- None --</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({EVENT_TYPE_LABEL[t.event_type] || t.event_type})
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">
          {mode === 'broadcast' ? 'Broadcast Notification' : 'Send to Single Recipient'}
        </h3>

        <div className="grid grid-cols-2 gap-3">
          <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="text-sm border-gray-300 rounded-lg">
            {SEND_CHANNELS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          {mode === 'broadcast' ? (
            <select value={form.recipient_type} onChange={(e) => setForm({ ...form, recipient_type: e.target.value })} className="text-sm border-gray-300 rounded-lg">
              {RECIPIENT_TYPES.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          ) : (
            <input
              placeholder="Phone, email, or user ID"
              value={form.recipient_identifier}
              onChange={(e) => setForm({ ...form, recipient_identifier: e.target.value })}
              className="text-sm border-gray-300 rounded-lg"
            />
          )}
        </div>
        {mode === 'broadcast' && (
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Session Class Filter (optional)</label>
            <select
              value={form.session_class_id}
              onChange={(e) => setForm({ ...form, session_class_id: e.target.value })}
              className="text-sm border-gray-300 rounded-lg w-full"
              disabled={!activeAcademicYear?.id}
            >
              <option value="">
                {activeAcademicYear?.id ? 'All Session Classes' : 'Select active academic year first'}
              </option>
              {sessionClasses.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.label || `${sc.display_name}${sc.section ? ` - ${sc.section}` : ''}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })} className="w-full text-sm border-gray-300 rounded-lg">
          {EVENT_TYPES.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <input
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full text-sm border-gray-300 rounded-lg"
        />

        <div>
          <textarea
            placeholder="Message body"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            rows={4}
            className="w-full text-sm border-gray-300 rounded-lg"
          />
          {charLimit && (
            <p className={`text-xs mt-1 ${form.body.length > charLimit ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
              {form.body.length} / {charLimit} characters
            </p>
          )}
        </div>

        <button
          onClick={openConfirm}
          disabled={isPending || !canSend}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
        >
          {isPending ? 'Sending...' : mode === 'broadcast' ? 'Review & Send Broadcast' : 'Send Notification'}
        </button>
        <button
          onClick={() => testSendMutation.mutate()}
          disabled={testSendMutation.isPending || !user?.id}
          className="ml-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm disabled:opacity-50"
        >
          {testSendMutation.isPending ? 'Sending Test...' : 'Test Send to Me'}
        </button>
      </div>

      {placeholderWarning && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-xl mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Placeholder Warning</h2>
            <p className="text-sm text-gray-600 mb-3">
              This send contains placeholders. Manual sends do not auto-populate student-specific values unless you replace them before sending.
            </p>
            <div className="text-sm space-y-2">
              <p><strong>Detected:</strong> {placeholderWarning.found.map((k) => `{{${k}}}`).join(', ')}</p>
              {placeholderWarning.unknown.length > 0 && (
                <p className="text-red-700">
                  <strong>Unknown placeholders:</strong> {placeholderWarning.unknown.map((k) => `{{${k}}}`).join(', ')}
                </p>
              )}
              {placeholderWarning.unresolved.length > 0 && (
                <p className="text-amber-700">
                  <strong>Missing values (will likely stay as-is):</strong> {placeholderWarning.unresolved.map((k) => `{{${k}}}`).join(', ')}
                </p>
              )}
              <p className="text-xs text-gray-500">
                Supported keys: {SUPPORTED_PLACEHOLDERS.map((k) => `{{${k}}}`).join(', ')}
              </p>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setPlaceholderWarning(null)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
              >
                Edit Message
              </button>
              <button
                onClick={() => {
                  setPlaceholderWarning(null)
                  if (mode === 'broadcast') {
                    runPreview()
                    setConfirmSendOpen(true)
                  } else {
                    handleSend()
                  }
                }}
                className="px-4 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm"
              >
                Send Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSendOpen && mode === 'broadcast' && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-lg mx-4">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Confirm Broadcast</h2>
            <p className="text-sm text-gray-600 mb-4">
              Review audience size before sending this broadcast.
            </p>
            <div className="rounded-lg border border-gray-200 p-3 text-sm space-y-1">
              <p><strong>Recipient group:</strong> {RECIPIENT_TYPES.find((x) => x.value === form.recipient_type)?.label || form.recipient_type}</p>
              <p><strong>Channel:</strong> {CHANNEL_LABEL[form.channel] || form.channel}</p>
              <p><strong>Estimated recipients:</strong> {previewMutation.isPending ? 'Checking...' : (audiencePreview?.count ?? 0)}</p>
            </div>
            {!previewMutation.isPending && audiencePreview?.count === 0 && (
              <p className="text-xs text-red-600 mt-3">No recipients match this filter. Update filters before sending.</p>
            )}
            {Array.isArray(audiencePreview?.samples) && audiencePreview.samples.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-gray-500 mb-1">Sample recipients</p>
                <div className="text-xs text-gray-700 space-y-1 max-h-24 overflow-auto">
                  {audiencePreview.samples.map((s) => (
                    <p key={s.id}>{s.name}{s.email ? ` - ${s.email}` : ''}</p>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setConfirmSendOpen(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button
                onClick={handleSend}
                disabled={previewMutation.isPending || (audiencePreview?.count ?? 0) === 0 || broadcastMutation.isPending}
                className="px-4 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
              >
                {broadcastMutation.isPending ? 'Sending...' : 'Confirm Send'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// === ANALYTICS TAB ===

function AnalyticsTab() {
  const [dateRange, setDateRange] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['notificationAnalytics', dateRange],
    queryFn: () => notificationsApi.getAnalytics({ range: dateRange !== 'all' ? dateRange : undefined }),
  })

  if (isLoading) return <Spinner />

  const analytics = data?.data || {}
  const channels = analytics.delivery_analytics?.channels || {}
  const eventTypes = analytics.event_type_analytics || {}
  const trend = analytics.trend || []
  const failures = analytics.top_failure_reasons || []
  const optimalTime = analytics.optimal_send_time || {}

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">Channel Performance</h3>
        <select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value)}
          className="text-sm border-gray-300 rounded-lg"
        >
          <option value="all">All Time</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
          <option value="90d">Last 90 Days</option>
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(channels).map(([channel, stats]) => (
          <div key={channel} className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase">{CHANNEL_LABEL[channel] || channel}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
            <div className="mt-2 space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Delivery Rate</span>
                <span className="font-medium text-green-600">{stats.delivery_rate}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Read Rate</span>
                <span className="font-medium text-blue-600">{stats.read_rate}%</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Failed</span>
                <span className="font-medium text-red-600">{stats.failed}</span>
              </div>
            </div>
          </div>
        ))}
        {Object.keys(channels).length === 0 && (
          <p className="text-sm text-gray-500 col-span-full">No notification data yet</p>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Event Type Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Object.entries(eventTypes).map(([eventType, stats]) => (
            <div key={eventType} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase">{EVENT_TYPE_LABEL[eventType] || eventType}</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{stats.total}</p>
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Delivery</span><span className="text-green-600 font-medium">{stats.delivery_rate}%</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Read</span><span className="text-blue-600 font-medium">{stats.read_rate}%</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Failed</span><span className="text-red-600 font-medium">{stats.failed}</span></div>
              </div>
            </div>
          ))}
          {Object.keys(eventTypes).length === 0 && (
            <p className="text-sm text-gray-500 col-span-full">No event-level data yet</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Delivery Trend</h3>
        {trend.length === 0 ? (
          <p className="text-sm text-gray-500">No trend data yet</p>
        ) : (
          <div className="space-y-2">
            {trend.slice(-10).map((row) => (
              <div key={row.day} className="grid grid-cols-4 text-xs border-b border-gray-100 pb-1">
                <span className="text-gray-600">{row.day}</span>
                <span className="text-gray-900">Total: {row.total}</span>
                <span className="text-green-600">Sent: {row.sent}</span>
                <span className="text-red-600">Failed: {row.failed}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Top Failure Reasons</h3>
        {failures.length === 0 ? (
          <p className="text-sm text-gray-500">No failure records in selected range</p>
        ) : (
          <div className="space-y-2">
            {failures.map((item, idx) => (
              <div key={`${item.channel}-${item.reason_code}-${idx}`} className="flex items-center justify-between text-xs border-b border-gray-100 pb-1">
                <span className="text-gray-700">{CHANNEL_LABEL[item.channel] || item.channel} - {item.reason_code}</span>
                <span className="font-medium text-red-600">{item.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Optimal Send Time */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Optimal Send Time</h3>
        <p className="text-lg font-bold text-primary-600">{optimalTime.best_window || 'N/A'}</p>
        {optimalTime.note && <p className="text-xs text-gray-500 mt-1">{optimalTime.note}</p>}
      </div>
    </div>
  )
}

// === SETTINGS TAB ===

function SettingsTab() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const { isModuleEnabled } = useAuth()
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['notificationConfig'],
    queryFn: () => notificationsApi.getConfig(),
  })

  const [config, setConfig] = useState(null)

  // Properly sync loaded data with useEffect
  const configData = data?.data
  useEffect(() => {
    if (configData && !config) {
      setConfig(configData)
    }
  }, [configData]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateConfig = (updates) => {
    setConfig((prev) => ({ ...prev, ...updates }))
    setHasUnsavedChanges(true)
  }

  // Warn on page close with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (hasUnsavedChanges) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasUnsavedChanges])

  const saveMutation = useMutation({
    mutationFn: (d) => notificationsApi.updateConfig(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationConfig'] })
      showSuccess('Settings saved')
      setHasUnsavedChanges(false)
    },
    onError: () => showError('Failed to save settings'),
  })

  if (isLoading || !config) return <Spinner />

  const ToggleSwitch = ({ checked, onChange }) => (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
        checked ? 'bg-primary-600' : 'bg-gray-200'
      }`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
        checked ? 'translate-x-4' : 'translate-x-0'
      }`} />
    </button>
  )

  return (
    <div className="max-w-2xl space-y-6">
      {/* Channels */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Notification Channels</h3>
        <div className="space-y-3">
          {/* WhatsApp Notifications toggle removed 2026-05-13 — see core/_deprecated_whatsapp/ */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Email Notifications</span>
            <ToggleSwitch checked={config.email_enabled || false} onChange={(v) => updateConfig({ email_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">In-App Notifications</span>
            <ToggleSwitch checked={config.in_app_enabled !== false} onChange={(v) => updateConfig({ in_app_enabled: v })} />
          </div>
          <p className="text-[11px] text-gray-500">In-App toggle also controls mobile push delivery.</p>
        </div>
      </div>

      {/* Automated Notifications */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Automated Notifications</h3>
        <p className="text-xs text-gray-500 mb-4">Control which automated notifications are sent by the system. Not every institution needs all of these.</p>

        <div className="space-y-4">
          {/* Absence — requires attendance module */}
          {isModuleEnabled('attendance') && (
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">Absence Alerts</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sends in-app absence summaries after each class register is complete for the day.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Sent the moment a class's register is saved complete — one message per class for admins/teachers; parents only if their child is absent
                </p>
              </div>
              <ToggleSwitch
                checked={config.absence_notification_enabled !== false}
                onChange={(v) => updateConfig({ absence_notification_enabled: v })}
              />
            </div>
          )}

          {/* Fee Reminders — requires finance module */}
          {isModuleEnabled('finance') && (
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">Fee Pending Notifications</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sends in-app fee pending alerts to admins/principal per class, class teachers for assigned classes, and parent/student self notifications.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Sent right after fees are generated for a month — or on demand from the Send tab
                </p>
              </div>
              <ToggleSwitch
                checked={config.fee_reminder_enabled !== false}
                onChange={(v) => updateConfig({ fee_reminder_enabled: v })}
              />
            </div>
          )}

          {/* Exam Results — requires examinations module */}
          {isModuleEnabled('examinations') && (
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">Exam Result Notifications</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sends in-app notifications to admins/principal, assigned class teachers, and parent/student when exam results are published.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Sent when an exam is published
                </p>
              </div>
              <ToggleSwitch
                checked={config.exam_result_enabled !== false}
                onChange={(v) => updateConfig({ exam_result_enabled: v })}
              />
            </div>
          )}

          {/* Transport Notifications — requires transport module */}
          {isModuleEnabled('transport') && (
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">Transport Notifications</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sends push notifications to parents when buses depart, approach stops, or complete journeys.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Sent automatically during active bus journeys
                </p>
              </div>
              <ToggleSwitch
                checked={config.transport_notification_enabled !== false}
                onChange={(v) => updateConfig({ transport_notification_enabled: v })}
              />
            </div>
          )}
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => saveMutation.mutate(config)}
          disabled={saveMutation.isPending}
          className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
        </button>
        {hasUnsavedChanges && (
          <span className="text-xs text-amber-600">You have unsaved changes</span>
        )}
      </div>
    </div>
  )
}
