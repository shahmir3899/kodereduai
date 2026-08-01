import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { faceAttendanceApi } from '../../services/api'
import LoadingSpinner from '../../components/LoadingSpinner'

function matchStatusLabel(event) {
  if (event.matched_student) return event.matched_student.name
  if (event.match_status === 'FLAGGED') return 'Flagged (low confidence)'
  return 'No match'
}

function matchStatusClass(event) {
  if (event.matched_student) return 'text-gray-900'
  if (event.match_status === 'FLAGGED') return 'text-yellow-700'
  return 'text-gray-400'
}

export default function FaceLiveEventsPage() {
  const navigate = useNavigate()
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [deviceId, setDeviceId] = useState('')

  const { data: devicesData } = useQuery({
    queryKey: ['faceCaptureDevices'],
    queryFn: () => faceAttendanceApi.getDevices(),
  })
  const devices = devicesData?.data?.results || devicesData?.data || []

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['faceLiveEvents', date, deviceId],
    queryFn: () => faceAttendanceApi.getLiveEvents({
      ...(date && { date }),
      ...(deviceId && { device: deviceId }),
      page_size: 100,
    }),
  })
  const events = eventsData?.data?.results || eventsData?.data || []

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <button
          onClick={() => navigate('/face-attendance')}
          className="text-sm text-gray-500 hover:text-gray-700 mb-1 flex items-center gap-1"
        >
          <span>&larr;</span> Back
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Live Events</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every match attempt from Fixed Camera capture devices — use this to check a camera is detecting people and matching correctly.
        </p>
      </div>

      <div className="flex border-b border-gray-200 mb-6">
        <Link
          to="/face-attendance/devices"
          className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
        >
          Devices
        </Link>
        <span className="px-4 py-2 text-sm font-medium border-b-2 border-blue-500 text-blue-600 -mb-px">
          Live Events
        </span>
      </div>

      <div className="flex flex-wrap gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Device</label>
          <select
            value={deviceId}
            onChange={(e) => setDeviceId(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[160px]"
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        {date && (
          <button
            onClick={() => setDate('')}
            className="self-end text-xs text-gray-500 hover:text-gray-700 underline mb-2"
          >
            Clear date
          </button>
        )}
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto">
        {isLoading ? (
          <div className="p-8"><LoadingSpinner /></div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">No live events for this filter.</div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Timestamp</th>
                <th className="px-4 py-2 text-left">Device</th>
                <th className="px-4 py-2 text-left">Result</th>
                <th className="px-4 py-2 text-left">Confidence</th>
                <th className="px-4 py-2 text-left">Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {events.map((event) => (
                <tr key={event.id}>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                    {new Date(event.client_timestamp).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">{event.device_name || '—'}</td>
                  <td className={`px-4 py-2 font-medium ${matchStatusClass(event)}`}>
                    {matchStatusLabel(event)}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                    {event.confidence ? `${event.confidence.toFixed(1)}%` : '—'}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {event.resulted_in_attendance ? (
                      <span className="text-green-700 text-xs font-medium">Marked present</span>
                    ) : (
                      <span className="text-gray-400 text-xs">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
