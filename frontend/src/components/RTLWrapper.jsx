/**
 * Wraps content with RTL direction when the language requires it.
 * Used for Urdu, Arabic, Sindhi, Pashto book content.
 */

// One definition shared with the question-text editor (richEditorCore.js), which the mobile app also runs.
import { isRTLLanguage } from './richEditorCore'

export { isRTLLanguage }

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
