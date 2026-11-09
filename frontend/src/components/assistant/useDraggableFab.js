import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clampDrag, isTap, parseSpot, positionFor, spotFromDrop, DEFAULT_SPOT } from './fabPosition'

const SPOT_KEY = 'assistant_fab_spot' // side + height, remembered per browser
export const BOX_W = 56
export const BOX_H = 74               // the round button plus its label
const NUDGE = 24

const readWindow = () => ({ width: window.innerWidth || 1024, height: window.innerHeight || 768 })
const readSpot = () => { try { return parseSpot(window.localStorage.getItem(SPOT_KEY)) || DEFAULT_SPOT } catch { return DEFAULT_SPOT } }

/**
 * Makes the Aura button movable by mouse, finger or pen (and Alt+arrow keys). A small movement is still a click.
 * On release the button settles against the nearer side edge at the height where it was dropped, and the spot is
 * remembered. `consumeDrag()` tells the click handler to ignore the click that follows a drag.
 */
export default function useDraggableFab() {
  const [win, setWin] = useState(readWindow)
  const [spot, setSpot] = useState(readSpot)
  const [live, setLive] = useState(null)          // top-left while dragging
  const swallow = useRef(false)
  const stopRef = useRef(null)                    // removes the window listeners of a drag in progress

  useEffect(() => {
    const onResize = () => setWin(readWindow())
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); stopRef.current?.() }
  }, [])

  const bounds = useMemo(() => ({ width: win.width, height: win.height, boxW: BOX_W, boxH: BOX_H, margin: 16, top: 16, bottomReserve: 16 }), [win])
  const home = positionFor(spot, bounds)
  const pos = live || home

  const save = useCallback((next) => {
    setSpot(next)
    try { window.localStorage.setItem(SPOT_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }, [])

  // The move and release are heard on the window, not on the button: a quick flick leaves the button before its
  // first move event, and capturing the pointer on press would steal the click from the button inside.
  const onPointerDown = useCallback((e) => {
    if (e.button !== undefined && e.button !== 0) return
    stopRef.current?.()
    const s = { px: e.clientX, py: e.clientY, x: home.x, y: home.y }
    let moved = false

    const onMove = (m) => {
      const dx = m.clientX - s.px
      const dy = m.clientY - s.py
      if (!moved && isTap(dx, dy)) return
      moved = true
      setLive(clampDrag(s.x + dx, s.y + dy, bounds))
    }
    const finish = (u, cancelled) => {
      stopRef.current?.()
      if (!moved) { setLive(null); return }
      swallow.current = true                     // the click that follows this release is not a tap
      setTimeout(() => { swallow.current = false }, 0)
      if (cancelled) { setLive(null); return }
      const c = clampDrag(s.x + (u.clientX - s.px), s.y + (u.clientY - s.py), bounds)
      save(spotFromDrop(c.x, c.y, bounds))
      setLive(null)
    }
    const onUp = (u) => finish(u, false)
    const onCancel = (u) => finish(u, true)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    stopRef.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      stopRef.current = null
    }
  }, [home.x, home.y, bounds, save])

  const onKeyDown = useCallback((e) => {
    if (!e.altKey) return
    const d = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, -NUDGE], ArrowDown: [0, NUDGE] }[e.key]
    if (!d) return
    e.preventDefault()
    const c = clampDrag(home.x + d[0], home.y + d[1], bounds)
    save(spotFromDrop(c.x, c.y, bounds))
  }, [home.x, home.y, bounds, save])

  const consumeDrag = useCallback(() => {
    if (!swallow.current) return false
    swallow.current = false
    return true
  }, [])

  return { pos, bounds, dragging: Boolean(live), consumeDrag, handlers: { onPointerDown, onKeyDown } }
}
