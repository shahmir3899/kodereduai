import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { notificationsApi } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../components/Toast'

const TABS = ['Inbox', 'Templates', 'Send', 'Analytics', 'Settings']

export default function NotificationsPage() {
  const [tab, setTab] = useState('Inbox')
  const { user } = useAuth()
  const isAdmin = ['SUPER_ADMIN', 'SCHOOL_ADMIN', 'PRINCIPAL'].includes(user?.role)

  const visibleTabs = isAdmin ? TABS : ['Inbox']

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Notifications</h1>
        <p className="text-sm text-gray-500 mt-1">Manage notifications and communication templates</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6 overflow-x-auto">
          {visibleTabs.map((t) => (
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

      {tab === 'Inbox' && <InboxTab />}
      {tab === 'Templates' && <TemplatesTab />}
      {tab === 'Send' && <SendTab />}
      {tab === 'Analytics' && <AnalyticsTab />}
      {tab === 'Settings' && <SettingsTab />}
    </div>
  )
}

function InboxTab() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['myNotifications', filter],
    queryFn: () => notificationsApi.getMyNotifications({ event_type: filter || undefined, page_size: 9999 }),
  })

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['myNotifications'] })
      queryClient.invalidateQueries({ queryKey: ['notificationUnreadCount'] })
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-sm border-gray-300 rounded-lg"
        >
          <option value="">All Types</option>
          <option value="ABSENCE">Absence</option>
          <option value="FEE_DUE">Fee Due</option>
          <option value="FEE_OVERDUE">Fee Overdue</option>
          <option value="EXAM_RESULT">Exam Result</option>
          <option value="GENERAL">General</option>
        </select>
        <button
          onClick={() => markAllMutation.mutate()}
          className="text-sm text-primary-600 hover:text-primary-800"
        >
          Mark all read
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : notifications.length === 0 ? (
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
                    <p className="text-sm font-medium text-gray-900">{n.title}</p>
                    <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{n.event_type}</span>
                    {n.channel && <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{n.channel}</span>}
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5">{n.body}</p>
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap ml-4">
                  {new Date(n.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TemplatesTab() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()
  const [showForm, setShowForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [form, setForm] = useState({
    name: '', event_type: 'GENERAL', channel: 'IN_APP', subject_template: '', body_template: '', is_active: true,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['notificationTemplates'],
    queryFn: () => notificationsApi.getTemplates({ page_size: 9999 }),
  })

  const saveMutation = useMutation({
    mutationFn: (data) => editingTemplate
      ? notificationsApi.updateTemplate(editingTemplate.id, data)
      : notificationsApi.createTemplate(data),
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
      showSuccess('Template deleted')
    },
  })

  const templates = data?.data?.results || data?.data || []

  const openEdit = (t) => {
    setEditingTemplate(t)
    setForm({ name: t.name, event_type: t.event_type, channel: t.channel, subject_template: t.subject_template || '', body_template: t.body_template, is_active: t.is_active })
    setShowForm(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => { setEditingTemplate(null); setForm({ name: '', event_type: 'GENERAL', channel: 'IN_APP', subject_template: '', body_template: '', is_active: true }); setShowForm(true) }}
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
              {['ABSENCE', 'FEE_DUE', 'FEE_OVERDUE', 'EXAM_RESULT', 'GENERAL', 'CUSTOM'].map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="text-sm border-gray-300 rounded-lg">
              {['WHATSAPP', 'SMS', 'IN_APP', 'EMAIL'].map(c => (
                <option key={c} value={c}>{c}</option>
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

      {isLoading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-10 text-gray-500">No templates yet</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200">
          {templates.map((t) => (
            <div key={t.id} className="px-4 py-3 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{t.name}</p>
                  <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">{t.event_type}</span>
                  <span className="px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600">{t.channel}</span>
                  {!t.is_active && <span className="px-1.5 py-0.5 rounded text-xs bg-red-50 text-red-600">Inactive</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 truncate max-w-lg">{t.body_template}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => openEdit(t)} className="text-xs text-primary-600 hover:text-primary-800">Edit</button>
                <button onClick={() => deleteMutation.mutate(t.id)} className="text-xs text-red-600 hover:text-red-800">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SendTab() {
  const { showError, showSuccess } = useToast()
  const [form, setForm] = useState({
    event_type: 'GENERAL', channel: 'IN_APP', title: '', body: '', recipient_type: 'PARENT',
  })

  const sendMutation = useMutation({
    mutationFn: (data) => notificationsApi.send(data),
    onSuccess: () => {
      showSuccess('Notification sent')
      setForm({ ...form, title: '', body: '' })
    },
    onError: () => showError('Failed to send notification'),
  })

  return (
    <div className="max-w-xl space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-900">Send Notification</h3>
        <div className="grid grid-cols-2 gap-3">
          <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} className="text-sm border-gray-300 rounded-lg">
            <option value="IN_APP">In-App</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="SMS">SMS</option>
            <option value="EMAIL">Email</option>
          </select>
          <select value={form.recipient_type} onChange={(e) => setForm({ ...form, recipient_type: e.target.value })} className="text-sm border-gray-300 rounded-lg">
            <option value="PARENT">Parents</option>
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admins</option>
          </select>
        </div>
        <input
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="w-full text-sm border-gray-300 rounded-lg"
        />
        <textarea
          placeholder="Message body"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
          rows={4}
          className="w-full text-sm border-gray-300 rounded-lg"
        />
        <button
          onClick={() => sendMutation.mutate(form)}
          disabled={sendMutation.isPending || !form.title || !form.body}
          className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm disabled:opacity-50"
        >
          {sendMutation.isPending ? 'Sending...' : 'Send Notification'}
        </button>
      </div>
    </div>
  )
}

function AnalyticsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['notificationAnalytics'],
    queryFn: () => notificationsApi.getAnalytics(),
  })

  if (isLoading) return <div className="text-center py-10 text-gray-500">Loading analytics...</div>

  const analytics = data?.data || {}
  const channels = analytics.delivery_analytics?.channels || {}
  const optimalTime = analytics.optimal_send_time || {}

  return (
    <div className="space-y-6">
      {/* Channel Stats */}
      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Channel Performance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Object.entries(channels).map(([channel, stats]) => (
            <div key={channel} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 uppercase">{channel}</p>
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

function SettingsTab() {
  const queryClient = useQueryClient()
  const { showError, showSuccess } = useToast()

  const { data, isLoading } = useQuery({
    queryKey: ['notificationConfig'],
    queryFn: () => notificationsApi.getConfig(),
  })

  const [config, setConfig] = useState(null)

  // Sync loaded data
  const configData = data?.data
  if (configData && !config) {
    // Initial load
    setTimeout(() => setConfig(configData), 0)
  }

  const saveMutation = useMutation({
    mutationFn: (data) => notificationsApi.updateConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notificationConfig'] })
      showSuccess('Settings saved')
    },
    onError: () => showError('Failed to save settings'),
  })

  if (isLoading || !config) return <div className="text-center py-10 text-gray-500">Loading settings...</div>

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
            <ToggleSwitch checked={config.whatsapp_enabled || false} onChange={(v) => setConfig({ ...config, whatsapp_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">SMS Notifications</span>
            <ToggleSwitch checked={config.sms_enabled || false} onChange={(v) => setConfig({ ...config, sms_enabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-700">In-App Notifications</span>
            <ToggleSwitch checked={config.in_app_enabled !== false} onChange={(v) => setConfig({ ...config, in_app_enabled: v })} />
          </div>
        </div>
      </div>

      {/* Automated Notifications */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Automated Notifications</h3>
        <p className="text-xs text-gray-500 mb-4">Control which automated notifications are sent by the system. Not every institution needs all of these.</p>

        <div className="space-y-4">
          {/* Absence */}
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
              onChange={(v) => setConfig({ ...config, absence_notification_enabled: v })}
            />
          </div>

          {/* Fee Reminders */}
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
              onChange={(v) => setConfig({ ...config, fee_reminder_enabled: v })}
            />
          </div>

          {/* Fee Overdue */}
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
              onChange={(v) => setConfig({ ...config, fee_overdue_enabled: v })}
            />
          </div>

          {/* Exam Results */}
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
              onChange={(v) => setConfig({ ...config, exam_result_enabled: v })}
            />
          </div>

          {/* Daily Absence Summary */}
          <div className="flex items-start justify-between gap-4">
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
              checked={config.daily_absence_summary_enabled || false}
              onChange={(v) => setConfig({ ...config, daily_absence_summary_enabled: v })}
            />
          </div>
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
            onChange={(v) => setConfig({ ...config, smart_scheduling_enabled: v })}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Fee Reminder Day</label>
            <input
              type="number"
              min={1}
              max={28}
              value={config.fee_reminder_day || 5}
              onChange={(e) => setConfig({ ...config, fee_reminder_day: parseInt(e.target.value) || 5 })}
              className="w-full text-sm border-gray-300 rounded-lg mt-1"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">Day of month (1-28)</p>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Quiet Hours Start</label>
            <input
              type="time"
              value={config.quiet_hours_start || ''}
              onChange={(e) => setConfig({ ...config, quiet_hours_start: e.target.value || null })}
              className="w-full text-sm border-gray-300 rounded-lg mt-1"
            />
            <p className="text-[11px] text-gray-400 mt-0.5">No notifications before this time</p>
          </div>
        </div>
      </div>

      {/* Save */}
      <button
        onClick={() => saveMutation.mutate(config)}
        disabled={saveMutation.isPending}
        className="px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm font-medium disabled:opacity-50 transition-colors"
      >
        {saveMutation.isPending ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  )
}
