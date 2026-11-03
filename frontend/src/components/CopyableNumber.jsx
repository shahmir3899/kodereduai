import { useEffect, useRef, useState } from 'react'

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Plain-http pages (a school's LAN address) and older browsers have no clipboard API.
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

/**
 * A number the reader will quote elsewhere (a Kuickpay consumer number), with a one-click copy.
 * It sits inside table cells and cards that react to clicks (a cell starts an inline edit), so
 * the click never reaches them.
 */
export default function CopyableNumber({ value, className = '', textClassName = '' }) {
  const [state, setState] = useState('idle')   // idle | copied | failed
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  if (!value) return null

  const copy = async (e) => {
    e.stopPropagation()
    setState((await copyText(value)) ? 'copied' : 'failed')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1800)
  }

  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} onClick={(e) => e.stopPropagation()}>
      <span className={`font-mono tabular-nums select-all ${textClassName}`} data-testid="copyable-number">{value}</span>
      <button
        type="button"
        onClick={copy}
        className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        aria-label={`Copy ${value}`}
      >
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Select & copy' : 'Copy'}
      </button>
    </span>
  )
}
