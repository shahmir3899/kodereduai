import { useState, useCallback, createContext, useContext } from 'react'

/**
 * Reusable confirmation modal with icon, title, message, and action buttons.
 *
 * Usage (hook-based — recommended):
 *   const { confirm, ConfirmModalRoot } = useConfirmModal()
 *   // In handler:
 *   const ok = await confirm({ title: 'Delete?', message: 'Cannot be undone.' })
 *   if (ok) doDelete()
 *   // In JSX:
 *   <ConfirmModalRoot />
 *
 * Usage (context-based — for deep component trees):
 *   Wrap with <ConfirmModalProvider> at layout level,
 *   then call const confirm = useConfirm() anywhere.
 */

const VARIANTS = {
  danger: {
    icon: (
      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
    ),
    iconBg: 'bg-red-100',
    confirmBtn: 'bg-red-600 text-white hover:bg-red-700',
    confirmLabel: 'Delete',
    pendingLabel: 'Deleting...',
  },
  warning: {
    icon: (
      <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    ),
    iconBg: 'bg-yellow-100',
    confirmBtn: 'bg-yellow-600 text-white hover:bg-yellow-700',
    confirmLabel: 'Confirm',
    pendingLabel: 'Processing...',
  },
}

function ConfirmModalUI({ show, title, message, variant = 'danger', confirmLabel, pendingLabel, isPending, onConfirm, onCancel }) {
  if (!show) return null
  const v = VARIANTS[variant] || VARIANTS.danger
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in fade-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div className={`w-10 h-10 rounded-full ${v.iconBg} flex items-center justify-center shrink-0`}>
            {v.icon}
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">{title || 'Confirm'}</h3>
            <p className="text-sm text-gray-500">This action cannot be undone.</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-5">{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 ${v.confirmBtn}`}
          >
            {isPending ? (pendingLabel || v.pendingLabel) : (confirmLabel || v.confirmLabel)}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Hook for local confirm modal (single component).
 * Returns { confirm, ConfirmModalRoot }
 */
export function useConfirmModal() {
  const [state, setState] = useState(null) // { title, message, variant, confirmLabel, pendingLabel, resolve }
  const [pending, setPending] = useState(false)

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      setState({ ...opts, resolve })
      setPending(false)
    })
  }, [])

  const handleConfirm = useCallback(() => {
    state?.resolve(true)
    setState(null)
    setPending(false)
  }, [state])

  const handleCancel = useCallback(() => {
    state?.resolve(false)
    setState(null)
    setPending(false)
  }, [state])

  const setConfirmPending = useCallback((val) => setPending(val), [])

  const ConfirmModalRoot = useCallback(() => (
    <ConfirmModalUI
      show={!!state}
      title={state?.title}
      message={state?.message}
      variant={state?.variant}
      confirmLabel={state?.confirmLabel}
      pendingLabel={state?.pendingLabel}
      isPending={pending}
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    />
  ), [state, pending, handleConfirm, handleCancel])

  return { confirm, ConfirmModalRoot, setConfirmPending }
}

// Context-based version for deep trees
const ConfirmContext = createContext(null)

export function ConfirmModalProvider({ children }) {
  const value = useConfirmModal()
  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <value.ConfirmModalRoot />
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmModalProvider')
  return ctx.confirm
}

export default ConfirmModalUI
