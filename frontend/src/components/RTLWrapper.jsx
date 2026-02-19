/**
 * Wraps content with RTL direction when the language requires it.
 * Used for Urdu, Arabic, Sindhi, Pashto book content.
 */

const RTL_LANGUAGES = new Set(['ur', 'ar', 'sd', 'ps'])

export function isRTLLanguage(langCode) {
  return RTL_LANGUAGES.has(langCode)
}

export default function RTLWrapper({ language, children, className = '' }) {
  const rtl = isRTLLanguage(language)
  return (
    <div
      dir={rtl ? 'rtl' : 'ltr'}
      className={`${rtl ? 'font-rtl' : ''} ${className}`}
    >
      {children}
    </div>
  )
}
