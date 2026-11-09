/** The welcome words, always visible (sound may be off), with replay, skip and a language switch. */
export default function AssistantWelcome({ welcome }) {
  if (!welcome || !welcome.text) return null
  const { text, lang, setLang, playing, play, skip, canSpeak } = welcome
  return (
    <div className="space-y-2" data-testid="assistant-welcome">
      <p dir="auto" lang={lang} className="text-sm text-slate-700">{text}</p>
      <div className="flex flex-wrap items-center gap-2">
        {canSpeak && (playing ? (
          <button type="button" onClick={skip} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white">Skip</button>
        ) : (
          <button type="button" onClick={play} className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-800 hover:bg-slate-50">
            Hear what Aura can do
          </button>
        ))}
        <button
          type="button"
          onClick={() => setLang(lang === 'ur' ? 'en' : 'ur')}
          aria-label={lang === 'ur' ? 'Switch the welcome to English' : 'Switch the welcome to Urdu'}
          className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          {lang === 'ur' ? 'English' : 'اردو'}
        </button>
      </div>
    </div>
  )
}
