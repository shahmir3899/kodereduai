import { useEffect, useRef } from 'react'

/**
 * Shared modal dialog. Replaces ~150 hand-built `fixed inset-0` overlays that
 * differed in backdrop opacity (/40 vs /50 vs bg-opacity-50), edge padding
 * (several had none, so panels touched the screen edge on phones), close
 * behaviour and keyboard handling.
 *
 * Gives every modal: one backdrop, p-4 gutter, max-h-[90vh] scrolling panel
 * (tall forms stay reachable on phones), Esc to close, click-outside to close,
 * body scroll lock, focus moved in on open and restored on close,
 * role="dialog" / aria-modal / aria-labelledby, and dark-mode colours.
 *
 * Usage (render conditionally or pass `open`):
 *   <Modal open={show} onClose={close} title="Add Subject" size="md">
 *     …form…
 *   </Modal>
 *   <Modal open onClose={close} title="Delete?" size="sm" footer={<><Button variant="secondary">Cancel</Button><Button variant="danger">Delete</Button></>}>
 *
 *   size:   sm | md (default) | lg | xl | 2xl | 3xl | 4xl | 5xl
 *   layer:  "base" (z-60) | "top" (z-70, for a confirm opened over another modal)
 *   title:  omit for a header-less panel (you render your own heading)
 *   closeOnBackdrop={false}: for forms where a stray click would lose input
 */
const SIZES = {
  sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-xl',
  '2xl': 'max-w-2xl', '3xl': 'max-w-3xl', '4xl': 'max-w-4xl', '5xl': 'max-w-5xl',
}
const LAYERS = { base: 'z-[60]', top: 'z-[70]' }

let openCount = 0 // nested modals share one body scroll lock
const stack = [] // open modals, top-most last: Esc must close only the top one (a confirm over a form)

export default function Modal({
  open = true,
  onClose,
  title,
  size = 'md',
  layer = 'base',
  footer,
  closeOnBackdrop = true,
  className = '',
  children,
}) {
  const panelRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose // latest handler without re-registering the key listener each render
  const titleId = useRef(`modal-title-${Math.random().toString(36).slice(2, 9)}`).current

  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement
    const token = {}
    stack.push(token)
    const onKey = (e) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === token) onCloseRef.current?.()
    }
    window.addEventListener('keydown', onKey)
    openCount += 1
    document.body.style.overflow = 'hidden'
    // Move focus into the dialog unless a child already took it (autoFocus).
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) panelRef.current.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      stack.splice(stack.indexOf(token), 1)
      openCount -= 1
      if (openCount <= 0) { openCount = 0; document.body.style.overflow = '' }
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus()
    }
  }, [open])

  if (!open) return null

  // Keep Tab inside the panel.
  const trapTab = (e) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const f = panelRef.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')
    if (!f.length) return
    const first = f[0]; const last = f[f.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <div
      className={`fixed inset-0 ${LAYERS[layer] || LAYERS.base} flex items-center justify-center bg-black/50 p-4`}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
        onClick={(e) => e.stopPropagation()}
        className={`bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full ${SIZES[size] || SIZES.md} max-h-[90vh] overflow-y-auto p-4 sm:p-6 outline-none ${className}`}
      >
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h2 id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none"
              >
                &times;
              </button>
            )}
          </div>
        )}
        {children}
        {footer && <div className="mt-5 flex gap-3 justify-end">{footer}</div>}
      </div>
    </div>
  )
}
