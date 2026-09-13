import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { parentsApi } from '../../services/api'
import Spinner from '../../components/ui/Spinner'

const transportTypeLabel = {
  PICKUP: 'Pickup Only',
  DROP: 'Drop Only',
  BOTH: 'Pickup & Drop',
}

export default function ChildTransport() {
  const { studentId } = useParams()

  const { data, isLoading } = useQuery({
    queryKey: ['childTransport', studentId],
    queryFn: () => parentsApi.getChildTransport(studentId),
    enabled: !!studentId,
  })

  const assignment = data?.data || null

  return (
    <div className="space-y-6">
      <Link to={`/parent/children/${studentId}`} className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Overview
      </Link>

      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Transport</h1>
        <p className="text-sm text-gray-500 mt-1">Bus route, stop, and vehicle details</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="md" />
        </div>
      ) : !assignment ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          No transport assignment on record.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Route — {assignment.route.name}</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">From</span>
                <span className="font-medium text-gray-900">{assignment.route.start_location || '—'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">To</span>
                <span className="font-medium text-gray-900">{assignment.route.end_location || '—'}</span>
              </div>
              {assignment.route.distance_km && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Distance</span>
                  <span className="font-medium text-gray-900">{assignment.route.distance_km} km</span>
                </div>
              )}
              {assignment.route.estimated_duration_minutes && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Est. Duration</span>
                  <span className="font-medium text-gray-900">{assignment.route.estimated_duration_minutes} min</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Service</span>
                <span className="font-medium text-gray-900">{transportTypeLabel[assignment.transport_type] || assignment.transport_type}</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Stop — {assignment.stop.name}</h2>
            <div className="space-y-2 text-sm">
              {assignment.stop.address && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Address</span>
                  <span className="font-medium text-gray-900 text-right">{assignment.stop.address}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Pickup Time</span>
                <span className="font-medium text-gray-900">{assignment.stop.pickup_time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Drop Time</span>
                <span className="font-medium text-gray-900">{assignment.stop.drop_time}</span>
              </div>
            </div>
          </div>

          {assignment.vehicle && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 sm:col-span-2">
              <h2 className="text-sm font-semibold text-gray-900 mb-3">Vehicle</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Number</p>
                  <p className="font-medium text-gray-900">{assignment.vehicle.vehicle_number}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Type</p>
                  <p className="font-medium text-gray-900">{assignment.vehicle.vehicle_type}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Driver</p>
                  <p className="font-medium text-gray-900">{assignment.vehicle.driver_name}</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Driver Phone</p>
                  <p className="font-medium text-gray-900">{assignment.vehicle.driver_phone}</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
