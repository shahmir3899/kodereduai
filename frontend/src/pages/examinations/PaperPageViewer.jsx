import { useState } from 'react'

const ZOOM_STEPS = [1, 1.5, 2, 3]

/**
 * The scanned page photo shown beside the extracted questions, so a teacher can check
 * what was read against the handwriting. `box` is the selected question's area on its
 * page as 0-1 fractions of the image ({x0, y0, x1, y1}); it is drawn over the photo when
 * the layout reader supplied one. The overlay lives inside the same rotated, zoomed
 * wrapper as the image so it always stays on the right spot.
 */
export default function PaperPageViewer({ pages, activePage, onPageChange, box = null }) {
  const [zoomIndex, setZoomIndex] = useState(0)
  const [rotation, setRotation] = useState(0)

  const page = pages.find((p) => p.page_number === activePage) || pages[0]
  if (!page) return null
  const zoom = ZOOM_STEPS[zoomIndex]
  const showBox = box && page.page_number === (box.page_number ?? page.page_number)

  return (
    <div className="border border-gray-200 rounded-lg bg-white flex flex-col h-full min-h-[320px]">
      <div className="flex flex-wrap items-center gap-1 p-2 border-b border-gray-200">
        {pages.map((p) => (
          <button
            key={p.page_number}
            type="button"
            onClick={() => onPageChange(p.page_number)}
            className={`px-2.5 py-1 rounded text-xs border ${p.page_number === page.page_number ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300'}`}
          >
            Page {p.page_number}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1">
          <button type="button" aria-label="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))} className="px-2 py-1 text-sm border border-gray-300 rounded disabled:opacity-40">−</button>
          <span className="text-xs text-gray-600 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" disabled={zoomIndex === ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))} className="px-2 py-1 text-sm border border-gray-300 rounded disabled:opacity-40">+</button>
          <button type="button" aria-label="Rotate page" onClick={() => setRotation((r) => (r + 90) % 360)} className="px-2 py-1 text-sm border border-gray-300 rounded">⟳</button>
        </span>
      </div>
      <div className="flex-1 overflow-auto bg-gray-100 p-2">
        <div
          className="relative mx-auto origin-top-left"
          style={{ width: `${zoom * 100}%`, transform: rotation ? `rotate(${rotation}deg)` : undefined, transformOrigin: 'center' }}
        >
          <img src={page.image_url} alt={`Page ${page.page_number} of the paper`} className="w-full block select-none" draggable={false} />
          {showBox && (
            <div
              data-testid="question-highlight"
              className="absolute border-2 border-amber-500 bg-amber-300/25 pointer-events-none rounded-sm"
              style={{
                left: `${box.x0 * 100}%`,
                top: `${box.y0 * 100}%`,
                width: `${(box.x1 - box.x0) * 100}%`,
                height: `${(box.y1 - box.y0) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
