/**
 * Check if a phone number is valid for WhatsApp (E.164 format).
 * Must start with '+' and have 10-15 digits total.
 */
export function isWhatsAppReady(phone) {
  if (!phone) return false
  const cleaned = String(phone).replace(/[^\d+]/g, '')
  if (!cleaned.startsWith('+')) return false
  const digits = cleaned.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}
