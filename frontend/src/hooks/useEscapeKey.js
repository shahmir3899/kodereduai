import { useEffect } from 'react'

/**
 * Calls onClose when Escape is pressed while `active` is true.
 * Usage: useEscapeKey(onClose) or useEscapeKey(onClose, isModalOpen)
 */
export function useEscapeKey(onClose, active = true) {
  useEffect(() => {
    if (!active || !onClose) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, active])
}
