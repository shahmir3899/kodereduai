import { useState } from 'react'

// Colour per outcome. Unmatched faces are red so an unknown face stands out at a glance.
export function getDetectionTone(det, displayed) {
  if (!displayed) return { border: 'border-red-500', bg: 'bg-red-500', text: 'Unknown' }
  if (det.match_status === 'FLAGGED') return { border: 'border-yellow-500', bg: 'bg-yellow-500', text: 'Needs review' }
  if (det.match_status === 'IGNORED' || det.match_status === 'REMOVED') {
    return { border: 'border-gray-400', bg: 'bg-gray-500', text: 'Ignored' }
  }
  return { border: 'border-green-500', bg: 'bg-green-600', text: 'Matched' } // AUTO_MATCHED / MANUALLY_MATCHED
}

const LEGEND = [
  { bg: 'bg-green-600', label: 'Matched' },
  { bg: 'bg-yellow-500', label: 'Needs review' },
  { bg: 'bg-red-500', label: 'Unknown' },
  { bg: 'bg-gray-500', label: 'Ignored' },
]

const shortName = (name) => (name && name.length > 16 ? `${name.slice(0, 15)}…` : name)

/**
 * The group photo with a box on every detected face. Every face is labelled
 * at all times — number, name, confidence — and shows whether that student is
 * currently marked present, so nobody has to hover to find out who was matched.
 *
 * Presentation only: the page owns the detections, overrides and present set.
 *
 * @param imageUrl        the captured group photo
 * @param detections      session detections (already minus removed ones)
 * @param overrideMatches detectionId -> { id, name, confidence } reassigned by the operator
 * @param presentIds      Set of student ids currently marked present (null = unknown yet)
 * @param activeId        detection whose "other candidates" picker is open
 * @param onSelect        (detectionId | null) => void — tap a face to open/close its picker
 * @param onPickAlternative (detection, alternative) => void — omit for a read-only view
 */
export default function GroupPhotoOverlay({
  imageUrl, detections, overrideMatches = {}, presentIds = null,
  activeId = null, onSelect, onPickAlternative,
}) {
  const [naturalSize, setNaturalSize] = useState(null) // { width, height } of the photo
  const [showNames, setShowNames] = useState(true)
  const interactive = typeof onPickAlternative === 'function'

  return (
    <div data-testid="group-photo-overlay">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600">
          {LEGEND.map((item) => (
            <span key={item.label} className="inline-flex items-center gap-1">
              <span className={`inline-block w-2.5 h-2.5 rounded-sm ${item.bg}`} />
              {item.label}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="font-bold text-green-700">✓</span> marked present
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowNames((v) => !v)}
          className="text-[11px] px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
        >
          {showNames ? 'Show numbers only' : 'Show names'}
        </button>
      </div>

      <div className="flex justify-center bg-gray-100 rounded-lg p-2 overflow-auto">
        <div className="relative inline-block">
          <img
            src={imageUrl}
            alt="Captured"
            className="block max-w-full max-h-[34rem] rounded"
            onLoad={(e) => setNaturalSize({ width: e.target.naturalWidth, height: e.target.naturalHeight })}
          />
          {naturalSize && detections.map((det) => {
            if (!det.bounding_box) return null
            const { top, left, right, bottom } = det.bounding_box
            const override = overrideMatches[det.id]
            const displayed = override || det.matched_student
            const confidence = override?.confidence ?? det.confidence
            const tone = getDetectionTone(det, displayed)
            const isPresent = Boolean(displayed?.id && presentIds?.has(displayed.id))
            const isActive = activeId === det.id
            const number = (det.face_index ?? 0) + 1
            const labelInside = top / naturalSize.height < 0.07 // too close to the top edge for a label above
            const label = displayed
              ? `${showNames ? shortName(displayed.name) : ''}${confidence > 0 ? `${showNames ? ' · ' : ''}${Math.round(confidence)}%` : ''}`
              : 'Unknown'

            return (
              <div
                key={det.id || det.face_index}
                data-testid={`face-box-${number}`}
                className="absolute cursor-pointer"
                style={{
                  left: `${(left / naturalSize.width) * 100}%`,
                  top: `${(top / naturalSize.height) * 100}%`,
                  width: `${((right - left) / naturalSize.width) * 100}%`,
                  height: `${((bottom - top) / naturalSize.height) * 100}%`,
                }}
                onClick={() => onSelect?.(isActive ? null : det.id)}
              >
                <div className={`w-full h-full border-2 rounded-sm ${tone.border} ${isActive ? 'ring-2 ring-white' : ''}`} />
                <div
                  className={`absolute left-0 flex items-center gap-1 whitespace-nowrap px-1 py-0.5 rounded text-[10px] leading-none font-semibold text-white pointer-events-none ${tone.bg} ${
                    labelInside ? 'top-0' : '-top-5'
                  }`}
                  title={displayed ? `${displayed.name}${confidence > 0 ? ` — ${confidence.toFixed(1)}% confidence` : ''}` : 'No match'}
                >
                  <span className="bg-black/30 rounded px-1">{number}</span>
                  <span>{label}</span>
                  {isPresent && <span aria-label="marked present" className="font-bold">✓</span>}
                </div>

                {interactive && isActive && (det.alternative_matches || []).length > 0 && (
                  <div
                    className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1.5 z-10 w-48"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-[10px] text-gray-400 px-1 pb-1">Other candidates</div>
                    {det.alternative_matches.map((alt) => (
                      <button
                        key={alt.student_id}
                        type="button"
                        onClick={() => onPickAlternative(det, alt)}
                        className="w-full text-left text-xs px-1.5 py-1 rounded hover:bg-gray-100 flex justify-between gap-2"
                      >
                        <span className="truncate">{alt.name}</span>
                        <span className="text-gray-400 flex-shrink-0">{alt.confidence?.toFixed(0)}%</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
