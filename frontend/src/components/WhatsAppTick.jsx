import React from 'react'

function normalizePhone(phone) {
  if (!phone) return ''
  const trimmed = String(phone).trim()
  if (!trimmed) return ''

  // Keep a leading +, strip all other non-digits.
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''

  return hasPlus ? `+${digits}` : digits
}

export default function WhatsAppTick({ phone, className = '' }) {
  const normalized = normalizePhone(phone)
  if (!normalized) return null

  const waDigits = normalized.replace(/^\+/, '')
  const href = `https://wa.me/${waDigits}`

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title="Open WhatsApp chat"
      className={`inline-flex items-center justify-center ml-1 text-[10px] font-semibold text-green-700 bg-green-100 border border-green-200 rounded px-1.5 py-0.5 ${className}`}
      aria-label="Open WhatsApp chat"
    >
      WA
    </a>
  )
}
