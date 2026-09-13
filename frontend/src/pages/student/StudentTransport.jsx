import { useQuery } from '@tanstack/react-query'
import { studentPortalApi } from '../../services/api'
import Spinner from '../../components/ui/Spinner'

const transportTypeLabel = {
  PICKUP: 'Pickup Only',
  DROP: 'Drop Only',
  BOTH: 'Pickup & Drop',
}

export default function StudentTransport() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['studentTransport'],
    queryFn: () => studentPortalApi.getTransport(),
  })

  const assignment = data?.data || null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
        <h3 className="text-base font-medium text-red-900 mb-1">Failed to load transport details</h3>
        <p className="text-sm text-red-600">{error.message || 'Please try again later.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">My Transport</h1>
        <p className="text-sm text-gray-500 mt-1">Bus route, stop, and vehicle details</p>
      </div>

      {!assignment ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <svg className="w-12 h-12 mx-auto text-gray-300 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17a2 2 0 11-4 0 2 2 0 014 0zM20 17a2 2 0 11-4 0 2 2 0 014 0zM4 17h1m14 0h1M6 17V9a1 1 0 011-1h10a1 1 0 011 1v8M6 13h12" />
          </svg>
          <h3 className="text-base font-medium text-gray-900 mb-1">No transport assignment on record</h3>
          <p className="text-sm text-gray-500">Your bus route details will appear here once assigned.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
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

          <div className="bg-white rounded-xl border border-gray-200 p-5">
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
            <div className="bg-white rounded-xl border border-gray-200 p-5 sm:col-span-2">
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
