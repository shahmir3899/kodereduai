import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { attendanceApi } from '../../services/api'
import { useToast } from '../../components/Toast'

const SEVERITY_STYLES = {
  HIGH: 'bg-red-100 text-red-800',
  MEDIUM: 'bg-amber-100 text-amber-800',
  LOW: 'bg-blue-100 text-blue-800',
}

const TYPE_LABELS = {
  CLASS_BULK: 'Bulk Class Absence',
  STUDENT_PATTERN: 'Student Pattern',
  UNUSUAL_DAY: 'Unusual Day',
}

export default function AnomaliesPage() {
  const queryClient = useQueryClient()
  const { showSuccess, showError } = useToast()
  const [filters, setFilters] = useState({ is_resolved: 'false' })
  const [resolveId, setResolveId] = useState(null)
  const [resolveNotes, setResolveNotes] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['anomalies', filters],
    queryFn: () => attendanceApi.getAnomalies({ ...filters, page_size: 50 }),
  })

  const resolveMutation = useMutation({
    mutationFn: ({ id, notes }) => attendanceApi.resolveAnomaly(id, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['anomalies'] })
      showSuccess('Anomaly resolved')
      setResolveId(null)
      setResolveNotes('')
    },
    onError: () => showError('Failed to resolve anomaly'),
  })

  const anomalies = data?.data?.results || data?.data || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Attendance Anomalies</h1>
        <p className="text-sm text-gray-500 mt-1">
          Automatically detected unusual patterns. Review and resolve flagged items.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filters.anomaly_type || ''}
          onChange={(e) => setFilters({ ...filters, anomaly_type: e.target.value || undefined })}
          className="text-sm border-gray-300 rounded-lg"
        >
          <option value="">All Types</option>
          <option value="CLASS_BULK">Bulk Class Absence</option>
          <option value="STUDENT_PATTERN">Student Pattern</option>
          <option value="UNUSUAL_DAY">Unusual Day</option>
        </select>
        <select
          value={filters.severity || ''}
          onChange={(e) => setFilters({ ...filters, severity: e.target.value || undefined })}
          className="text-sm border-gray-300 rounded-lg"
        >
          <option value="">All Severities</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
        <select
          value={filters.is_resolved || 'false'}
          onChange={(e) => setFilters({ ...filters, is_resolved: e.target.value })}
          className="text-sm border-gray-300 rounded-lg"
        >
          <option value="false">Unresolved</option>
          <option value="true">Resolved</option>
          <option value="">All</option>
        </select>
      </div>

      {/* Anomalies List */}
      {isLoading ? (
        <div className="text-center py-10 text-gray-500">Loading anomalies...</div>
      ) : anomalies.length === 0 ? (
        <div className="card text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="mt-4 text-gray-500 font-medium">No anomalies detected</p>
          <p className="text-sm text-gray-400 mt-1">Attendance patterns look normal.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {anomalies.map((a) => (
            <div key={a.id} className={`card border-l-4 ${
              a.severity === 'HIGH' ? 'border-l-red-500' :
              a.severity === 'MEDIUM' ? 'border-l-amber-500' : 'border-l-blue-500'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_STYLES[a.severity]}`}>
                      {a.severity}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                      {TYPE_LABELS[a.anomaly_type] || a.anomaly_type}
                    </span>
                    <span className="text-xs text-gray-400">{a.date}</span>
                    {a.class_name && <span className="text-xs text-gray-500">Class: {a.class_name}</span>}
                    {a.student_name && <span className="text-xs text-gray-500">Student: {a.student_name}</span>}
                  </div>
                  <p className="text-sm text-gray-800">{a.description}</p>
                  {a.is_resolved && (
                    <p className="text-xs text-green-700 mt-1">
                      Resolved by {a.resolved_by_name || 'admin'}{a.resolution_notes ? `: ${a.resolution_notes}` : ''}
                    </p>
                  )}
                </div>
                <div className="shrink-0">
                  {!a.is_resolved && (
                    resolveId === a.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          placeholder="Notes (optional)"
                          value={resolveNotes}
                          onChange={(e) => setResolveNotes(e.target.value)}
                          className="text-sm border-gray-300 rounded-lg w-48"
                        />
                        <button
                          onClick={() => resolveMutation.mutate({ id: a.id, notes: resolveNotes })}
                          disabled={resolveMutation.isPending}
                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 disabled:opacity-50"
                        >
                          {resolveMutation.isPending ? '...' : 'Confirm'}
                        </button>
                        <button onClick={() => setResolveId(null)} className="text-xs text-gray-500">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setResolveId(a.id); setResolveNotes('') }}
                        className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200"
                      >
                        Resolve
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
