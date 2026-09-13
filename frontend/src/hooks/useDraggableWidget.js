import { useCallback, useEffect, useRef, useState } from 'react'

const MARGIN = 12

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/**
 * Makes a fixed-position floating panel (chat widgets, etc.) draggable by its
 * header, and remembers where the user left it (per `storageKey`) across
 * reloads. Panels default to bottom-right (their existing CSS) until the
 * user drags them at least once — only then do we switch to explicit
 * top/left positioning, so nothing changes for users who never touch it.
 *
 * Added because the fixed bottom-right chat widgets were covering page
 * controls (e.g. pagination "Next") on shorter pages — see Notifications
 * page feedback.
 */
export function useDraggableWidget(storageKey, { width = 384, height = 500 } = {}) {
  const [position, setPosition] = useState(null) // null = default bottom-right CSS position
  const dragState = useRef(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) setPosition(JSON.parse(saved))
    } catch { /* ignore malformed/inaccessible storage */ }
  }, [storageKey])

  const persist = useCallback((pos) => {
    try { localStorage.setItem(storageKey, JSON.stringify(pos)) } catch { /* private mode, etc. */ }
  }, [storageKey])

  const handleMouseMove = useCallback((e) => {
    const drag = dragState.current
    if (!drag) return
    const maxLeft = window.innerWidth - width - MARGIN
    const maxTop = window.innerHeight - height - MARGIN
    const left = clamp(e.clientX - drag.offsetX, MARGIN, Math.max(MARGIN, maxLeft))
    const top = clamp(e.clientY - drag.offsetY, MARGIN, Math.max(MARGIN, maxTop))
    setPosition({ left, top })
  }, [width, height])

  const handleMouseUp = useCallback(() => {
    if (dragState.current) {
      dragState.current = null
      setPosition((pos) => { if (pos) persist(pos); return pos })
    }
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove, persist])

  const onDragHandleMouseDown = useCallback((e) => {
    // Ignore drags started on the header's own buttons (close, clear, etc.)
    if (e.target.closest('button')) return
    const rect = e.currentTarget.closest('[data-draggable-panel]').getBoundingClientRect()
    dragState.current = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    e.preventDefault()
  }, [handleMouseMove, handleMouseUp])

  useEffect(() => () => {
    window.removeEventListener('mousemove', handleMouseMove)
    window.removeEventListener('mouseup', handleMouseUp)
  }, [handleMouseMove, handleMouseUp])

  // When dragged at least once, pin with left/top and clear the bottom/right
  // Tailwind classes' effect by overriding via inline style.
  const panelStyle = position ? { left: position.left, top: position.top, right: 'auto', bottom: 'auto' } : undefined

  return { panelStyle, onDragHandleMouseDown }
}
