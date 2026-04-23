import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'
import { formatDistanceToNow } from 'date-fns'

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
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'SMS', label: 'SMS' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'PUSH', label: 'Push Notification' },
]

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

const SMS_CHAR_LIMIT = 160
const WHATSAPP_CHAR_LIMIT = 4096

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
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [confirmMarkAll, setConfirmMarkAll] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['myNotifications', filter, page],
    queryFn: () => notificationsApi.getMyNotifications({
      event_type: filter || undefined,
      page,
      page_size: 20,
    }),
  })

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
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
      <div className="flex items-center justify-between">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
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

  if (isLoading) return <Spinner />

  return (
    <div className="space-y-4">
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
            placeholder="Message body (use {{student_name}}, {{class_name}}, {{date}} placeholders)"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
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
    </div>
  )
}

// === SEND TAB ===

function SendTab() {
  const { showError, showSuccess } = useToast()
  const [mode, setMode] = useState('broadcast')
  const [selectedTemplate, setSelectedTemplate] = useState(null)
  const [form, setForm] = useState({
    event_type: 'GENERAL', channel: 'IN_APP', title: '', body: '',
    recipient_type: 'PARENT', recipient_identifier: '',
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

  const sendMutation = useMutation({
    mutationFn: (d) => notificationsApi.send(d),
    onSuccess: () => {
      showSuccess('Notification sent')
      resetForm()
    },
    onError: (err) => showError(err.response?.data?.detail || err.response?.data?.recipient_identifier?.[0] || 'Failed to send notification'),
  })

  const resetForm = () => {
    setForm({
      event_type: 'GENERAL', channel: 'IN_APP', title: '', body: '',
      recipient_type: 'PARENT', recipient_identifier: '',
    })
    setSelectedTemplate(null)
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

  const handleSend = () => {
    if (mode === 'broadcast') {
      broadcastMutation.mutate({
        event_type: form.event_type,
        channel: form.channel,
        recipient_type: form.recipient_type,
        title: form.title,
        body: form.body,
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

  const isPending = broadcastMutation.isPending || sendMutation.isPending
  const canSend = form.title && form.body && (mode === 'broadcast' || form.recipient_identifier)

  const charLimit = form.channel === 'SMS' ? SMS_CHAR_LIMIT
    : form.channel === 'WHATSAPP' ? WHATSAPP_CHAR_LIMIT : null

  return (
    <div className="max-w-xl space-y-4">
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
            {CHANNELS.map(({ value, label }) => (
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
          onClick={handleSend}
          disabled={isPending || !canSend}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
        >
          {isPending ? 'Sending...' : mode === 'broadcast' ? 'Send Broadcast' : 'Send Notification'}
        </button>
      </div>
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
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">WhatsApp Notifications</span>
            <ToggleSwitch checked={config.whatsapp_enabled || false} onChange={(v) => updateConfig({ whatsapp_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">SMS Notifications</span>
            <ToggleSwitch checked={config.sms_enabled || false} onChange={(v) => updateConfig({ sms_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Email Notifications</span>
            <ToggleSwitch checked={config.email_enabled || false} onChange={(v) => updateConfig({ email_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">In-App Notifications</span>
            <ToggleSwitch checked={config.in_app_enabled !== false} onChange={(v) => updateConfig({ in_app_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">Push Notifications</span>
            <ToggleSwitch checked={config.push_enabled || false} onChange={(v) => updateConfig({ push_enabled: v })} />
          </div>
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
                  Sends WhatsApp to parents when a student is marked absent. Also notifies admins in-app.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Sent each time attendance is confirmed with absent students
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
                <p className="text-sm font-medium text-gray-800">Fee Reminders</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sends WhatsApp reminders to parents of students with pending or partially paid fees.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Sent monthly on day {config.fee_reminder_day || 5} of each month
                </p>
              </div>
              <ToggleSwitch
                checked={config.fee_reminder_enabled !== false}
                onChange={(v) => updateConfig({ fee_reminder_enabled: v })}
              />
            </div>
          )}

          {/* Fee Overdue — requires finance module */}
          {isModuleEnabled('finance') && (
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">Fee Overdue Alerts</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sends WhatsApp alerts to parents whose fees are completely unpaid for the previous month.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Checked weekly (automated)
                </p>
              </div>
              <ToggleSwitch
                checked={config.fee_overdue_enabled !== false}
                onChange={(v) => updateConfig({ fee_overdue_enabled: v })}
              />
            </div>
          )}

          {/* Exam Results — requires examinations module */}
          {isModuleEnabled('examinations') && (
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">Exam Result Notifications</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sends WhatsApp notification to parents when exam results are published for their child.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Sent when results are published
                </p>
              </div>
              <ToggleSwitch
                checked={config.exam_result_enabled !== false}
                onChange={(v) => updateConfig({ exam_result_enabled: v })}
              />
            </div>
          )}

          {/* Daily Absence Summary — requires attendance module */}
          {isModuleEnabled('attendance') && (
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">Daily Absence Summary</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Sends a summary of the day's absent/present counts to school admins via in-app notification.
                </p>
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-0.5 mt-1.5 inline-block">
                  Sent daily{config.daily_absence_summary_time ? ` at ${config.daily_absence_summary_time}` : ' at configured time'}
                </p>
              </div>
              <ToggleSwitch
                checked={config.daily_report_enabled !== false}
                onChange={(v) => updateConfig({ daily_report_enabled: v })}
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

      {/* Scheduling & Timing */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Scheduling & Timing</h3>

        <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-gray-100">
          <div>
            <p className="text-sm font-medium text-gray-800">Smart Notification Scheduling</p>
            <p className="text-xs text-gray-500 mt-0.5 max-w-sm">
              AI analyzes when parents are most likely to read messages and schedules non-urgent notifications
              for optimal delivery times. In-app notifications are always immediate.
            </p>
            {config.smart_scheduling_enabled && (
              <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1 mt-2 inline-block">
                Learning from read patterns. Best results after 2-4 weeks of data.
              </p>
            )}
          </div>
          <ToggleSwitch
            checked={config.smart_scheduling_enabled || false}
            onChange={(v) => updateConfig({ smart_scheduling_enabled: v })}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Fee Reminder Day</label>
            <input
              type="number"
              min={1}
              max={28}
              value={config.fee_reminder_day || 5}
              onChange={(e) => updateConfig({ fee_reminder_day: parseInt(e.target.value) || 5 })}
              className="w-full text-sm border-gray-300 rounded-lg mt-1"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">Day of month (1-28)</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Quiet Hours Start</label>
            <input
              type="time"
              value={config.quiet_hours_start || ''}
              onChange={(e) => updateConfig({ quiet_hours_start: e.target.value || null })}
              className="w-full text-sm border-gray-300 rounded-lg mt-1"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">No notifications after this time</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Quiet Hours End</label>
            <input
              type="time"
              value={config.quiet_hours_end || ''}
              onChange={(e) => updateConfig({ quiet_hours_end: e.target.value || null })}
              className="w-full text-sm border-gray-300 rounded-lg mt-1"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">Resume notifications after this time</p>
          </div>
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
