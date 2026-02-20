import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import '../utils/leafletSetup'

const DEFAULT_CENTER = [31.5204, 74.3587] // Lahore, Pakistan
const DEFAULT_ZOOM = 12

function ClickHandler({ onChange }) {
  useMapEvents({
    click(e) {
      onChange(parseFloat(e.latlng.lat.toFixed(6)), parseFloat(e.latlng.lng.toFixed(6)))
    },
  })
  return null
}

function RecenterMap({ lat, lng }) {
  const map = useMap()
  const hasCentered = useRef(false)
  useEffect(() => {
    if (lat && lng && !hasCentered.current) {
      map.setView([lat, lng], Math.max(map.getZoom(), 14))
      hasCentered.current = true
    }
  }, []) // only on mount
  return null
}

function FlyToLocation({ lat, lng, trigger }) {
  const map = useMap()
  useEffect(() => {
    if (lat && lng && trigger > 0) {
      map.flyTo([lat, lng], 16, { duration: 1 })
    }
  }, [trigger])
  return null
}

export default function LocationPickerMap({ latitude, longitude, onChange, height = '200px' }) {
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState(null)
  const [flyTrigger, setFlyTrigger] = useState(0)

  const hasCoords = latitude != null && longitude != null
  const center = hasCoords ? [parseFloat(latitude), parseFloat(longitude)] : DEFAULT_CENTER
  const zoom = hasCoords ? 15 : DEFAULT_ZOOM

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocError('Geolocation is not supported by your browser.')
      return
    }

    setLocating(true)
    setLocError(null)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = parseFloat(position.coords.latitude.toFixed(6))
        const lng = parseFloat(position.coords.longitude.toFixed(6))
        onChange(lat, lng)
        setFlyTrigger((prev) => prev + 1)
        setLocating(false)
      },
      (error) => {
        setLocating(false)
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setLocError('Location permission denied. Please allow location access in your browser settings.')
            break
          case error.POSITION_UNAVAILABLE:
            setLocError('Location information unavailable.')
            break
          case error.TIMEOUT:
            setLocError('Location request timed out. Please try again.')
            break
          default:
            setLocError('An unknown error occurred while getting your location.')
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <button
          type="button"
          onClick={handleUseMyLocation}
          disabled={locating}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 rounded-md border border-primary-200 transition-colors disabled:opacity-50"
        >
          {locating ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Locating...
            </>
          ) : (
            <>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Use My Location
            </>
          )}
        </button>
        {locError && <span className="text-xs text-red-500">{locError}</span>}
      </div>
      <div style={{ height }} className="rounded-lg overflow-hidden border border-gray-300">
        <MapContainer center={center} zoom={zoom} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickHandler onChange={onChange} />
          {hasCoords && <RecenterMap lat={latitude} lng={longitude} />}
          <FlyToLocation lat={latitude} lng={longitude} trigger={flyTrigger} />
          {hasCoords && (
            <Marker
              position={[parseFloat(latitude), parseFloat(longitude)]}
              draggable
              eventHandlers={{
                dragend: (e) => {
                  const pos = e.target.getLatLng()
                  onChange(parseFloat(pos.lat.toFixed(6)), parseFloat(pos.lng.toFixed(6)))
                },
              }}
            />
          )}
        </MapContainer>
      </div>
    </div>
  )
}
