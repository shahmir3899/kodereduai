import { useEffect, useRef, useState } from 'react'

// 210 mm at 96 px per inch: the width the print page is laid out at.
export const A4_WIDTH_PX = 794

/** How much an A4-wide page must shrink to fit ``width`` (never enlarged). */
export function a4Scale(width) {
  if (!width || width <= 0) return 1
  return Math.min(1, width / A4_WIDTH_PX)
}

/**
 * The paper laid out at A4 width and shrunk to fit its column, so the preview wraps lines exactly like the
 * print. A preview frame as wide as its column re-flowed the paper (the school name wrapped onto two lines in a
 * 400 px column, demo findings A4).
 * Sandboxed: scripts may run (the maths library) but the page cannot reach this app.
 */
export default function A4Preview({ html, title, height = '78vh', show = '', onPick }) {
  const boxRef = useRef(null)
  const frameRef = useRef(null)
  const onPickRef = useRef(onPick)
  onPickRef.current = onPick
  const [scale, setScale] = useState(1)
  const [boxHeight, setBoxHeight] = useState(0)
  const [boxWidth, setBoxWidth] = useState(0)

  useEffect(() => {
    const box = boxRef.current
    if (!box) return undefined
    const measure = () => {
      setScale(a4Scale(box.clientWidth))
      setBoxHeight(box.clientHeight)
      setBoxWidth(box.clientWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [])

  // The page (server preview script) scrolls to the question being edited and says which one was clicked. It is
  // sandboxed, so only messages pass; a message is trusted only from this frame.
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage({ paperShow: show || '' }, '*')
  }, [show])
  useEffect(() => {
    const listen = (event) => {
      if (event.source !== frameRef.current?.contentWindow) return
      const picked = event.data?.paperBlock
      if (typeof picked === 'string' && picked) onPickRef.current?.(picked)
    }
    window.addEventListener('message', listen)
    return () => window.removeEventListener('message', listen)
  }, [])

  // A box wider than the page (the "Full size" window) left all its grey on the right; centre the page instead.
  const left = boxWidth ? Math.max(0, (boxWidth - A4_WIDTH_PX * scale) / 2) : 0

  return (
    <div ref={boxRef} className="w-full overflow-hidden bg-gray-100" style={{ height }}>
      <iframe
        ref={frameRef}
        title={title}
        sandbox="allow-scripts"
        srcDoc={html}
        style={{
          width: `${A4_WIDTH_PX}px`,
          height: boxHeight ? `${boxHeight / scale}px` : '100%',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          marginLeft: `${left}px`,
          border: 0,
          background: 'white',
        }}
      />
    </div>
  )
}
