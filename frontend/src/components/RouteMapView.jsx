import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { greenIcon, redIcon } from '../utils/leafletSetup'

const DEFAULT_CENTER = [31.5204, 74.3587]

function FitBounds({ bounds }) {
  const map = useMap()
  useEffect(() => {
    if (bounds && bounds.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40] })
    }
  }, [bounds, map])
  return null
}

export default function RouteMapView({ route, stops = [] }) {
  const { points, sortedStops, bounds, startCoord, endCoord } = useMemo(() => {
    const pts = []
    let startC = null
    let endC = null

    if (route.start_latitude && route.start_longitude) {
      startC = [parseFloat(route.start_latitude), parseFloat(route.start_longitude)]
      pts.push(startC)
    }

    const sorted = [...stops]
      .filter((s) => s.latitude && s.longitude)
      .sort((a, b) => (a.stop_order || 0) - (b.stop_order || 0))

    sorted.forEach((s) => {
      pts.push([parseFloat(s.latitude), parseFloat(s.longitude)])
    })

    if (route.end_latitude && route.end_longitude) {
      endC = [parseFloat(route.end_latitude), parseFloat(route.end_longitude)]
      pts.push(endC)
    }

    return {
      points: pts,
      sortedStops: sorted,
      bounds: pts.length > 0 ? L.latLngBounds(pts) : null,
      startCoord: startC,
      endCoord: endC,
    }
  }, [route, stops])

  if (points.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm border border-dashed border-gray-200 rounded-lg">
        No coordinates set. Edit the route or stops to add map locations.
      </div>
    )
  }

  return (
    <div style={{ height: '300px' }} className="rounded-lg overflow-hidden border border-gray-200 mb-3">
      <MapContainer center={DEFAULT_CENTER} zoom={12} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {bounds && <FitBounds bounds={bounds} />}

        {/* Start marker (green) */}
        {startCoord && (
          <Marker position={startCoord} icon={greenIcon}>
            <Popup>
              <strong>Start:</strong> {route.start_location || 'Start Point'}
            </Popup>
          </Marker>
        )}

        {/* Stop markers (default blue) */}
        {sortedStops.map((stop) => (
          <Marker key={stop.id} position={[parseFloat(stop.latitude), parseFloat(stop.longitude)]}>
            <Popup>
              <strong>#{stop.stop_order}</strong> {stop.name}
              {stop.pickup_time && <br />}
              {stop.pickup_time && <>Pickup: {stop.pickup_time}</>}
              {stop.drop_time && <> | Drop: {stop.drop_time}</>}
            </Popup>
          </Marker>
        ))}

        {/* End marker (red) */}
        {endCoord && (
          <Marker position={endCoord} icon={redIcon}>
            <Popup>
              <strong>End:</strong> {route.end_location || 'End Point'}
            </Popup>
          </Marker>
        )}

        {/* Connecting polyline */}
        {points.length >= 2 && (
          <Polyline positions={points} color="#3b82f6" weight={3} dashArray="8 6" opacity={0.8} />
        )}
      </MapContainer>
    </div>
  )
}
