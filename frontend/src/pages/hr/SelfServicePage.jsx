import { useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import LeaveManagementPage from './LeaveManagementPage'
import StaffAttendancePage from './StaffAttendancePage'

// Self Service hub (2026-09) — Staff's single entry point for their own HR
// data, replacing separate "My Leave"/"My Attendance" sidebar items. Just a
// tab shell: both tab bodies are the existing self-service-aware page
// components (they already render their own trimmed, read-only-where-
// appropriate view for TEACHER/STAFF), so there's no logic duplicated here.
const TABS = [
  { key: 'leave', label: 'Leave' },
  { key: 'attendance', label: 'Attendance' },
]

export default function SelfServicePage() {
  const [tab, setTab] = useState('leave')

  return (
    <div>
      <PageHeader title="Self Service" subtitle="Your own leave and attendance" className="mb-6" />

      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'leave' ? <LeaveManagementPage /> : <StaffAttendancePage />}
    </div>
  )
}
