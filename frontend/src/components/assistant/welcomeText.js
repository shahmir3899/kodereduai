// Spoken welcome text, built on the device from the capabilities list: no model call, no voice allowance.
const URDU_NAMES = {
  finance: 'فیس اور مالیات', academics: 'تعلیمی امور', attendance: 'حاضری', communication: 'والدین سے رابطہ',
  study: 'مطالعہ میں مدد', exams: 'امتحانات', operations: 'انتظامی امور', family: 'میرے بچے',
  hr: 'عملے کے امور', students: 'طلبہ اور داخلے',
}
// A long list takes too long to hear, so only the first few are named.
const MAX_NAMED = 4

function join(items, and, more) {
  if (more) return `${items.join(', ')} ${and} ${more}`
  if (items.length <= 1) return items[0] || ''
  return `${items.slice(0, -1).join(', ')} ${and} ${items[items.length - 1]}`
}

/** 'ur' when the saved choice or the browser says Urdu, otherwise 'en'. */
export function welcomeLanguage(saved) {
  if (saved === 'ur' || saved === 'en') return saved
  const nav = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
  return nav.toLowerCase().startsWith('ur') ? 'ur' : 'en'
}

/**
 * Text for one user. A role that can only read (parents, students) is never told it can prepare changes.
 * Returns '' when there is nothing to offer, so the caller shows no welcome at all.
 */
export function buildWelcome(agents, lang) {
  const list = (agents || []).filter(Boolean)
  if (list.length === 0) return ''
  const canWrite = list.some((a) => a.can_write)
  const named = list.slice(0, MAX_NAMED)
  const extra = list.length > MAX_NAMED
  if (lang === 'ur') {
    const names = named.map((a) => URDU_NAMES[a.name] || a.label)
    const topics = extra ? `${names.join('، ')} اور مزید` : join(names, 'اور').replace(/, /g, '، ')
    const base = `السلام علیکم! میں آورا ہوں، آپ کی اسکول اسسٹنٹ۔ آپ مجھ سے ${topics} کے بارے میں پوچھ سکتے ہیں۔ بس بولیں، یا مائیک دبائیں۔`
    return canWrite ? `${base} تبدیلیاں تیار بھی ہو سکتی ہیں، لیکن منظوری ہمیشہ آپ کی ہوتی ہے۔` : base
  }
  const names = named.map((a) => a.label)
  const topics = extra ? `${names.join(', ')} and more` : join(names, 'and')
  const base = canWrite
    ? `Hi, I'm Aura, your school assistant. I can help you with ${topics}. Just ask, or tap the orb and talk.`
    : `Hi, I'm Aura, your school assistant. You can ask me about ${topics}. Just ask, or tap the orb and talk.`
  return canWrite ? `${base} I can also prepare changes, but you always approve them first.` : base
}
