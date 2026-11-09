import { useCallback, useEffect, useRef, useState } from 'react'
import { assistantApi } from '../../services/assistantApi'
import ActionCard from './ActionCard'
import StepTrail from './StepTrail'
import TalkMode from './TalkMode'
import VoiceBar from './VoiceBar'
import { themeFor } from './agentTheme'
import { isAssistantEnabled } from './flag'
import { KeyboardIcon, MicIcon } from './icons'
import useAssistant from './useAssistant'
import HistoryList from './HistoryList'
import PreferencesSheet from './PreferencesSheet'
import RichText from './RichText'
import FeedbackThumbs from './FeedbackThumbs'
import useSpeech, { scriptOf } from './useSpeech'
import useWelcome from './useWelcome'
import useDraggableFab from './useDraggableFab'
import { panelRect } from './fabPosition'
import AssistantWelcome from './AssistantWelcome'
import useVoiceInput from './useVoiceInput'

const CLOSE_MS = 180
const PAUSE_STOPS_MS = 1500                   // Talk mode ends a recording after this much quiet
const PREF_SPEAK = 'assistant_speak'          // "0" turns spoken replies off
const PREF_AUTOSEND = 'assistant_autosend'    // "1" sends a typed-mode transcript without waiting for a look
const PREF_INSTANT = 'assistant_talk_instant' // "1" skips the 3-second check in Talk mode
const PREF_MODE = 'assistant_mode'            // "talk" or "text"

const readPref = (key, fallback) => {
  try { const v = window.localStorage.getItem(key); return v === null ? fallback : v === '1' } catch { return fallback }
}
const writePref = (key, on) => { try { window.localStorage.setItem(key, on ? '1' : '0') } catch { /* private mode */ } }
const readMode = () => { try { return window.localStorage.getItem(PREF_MODE) === 'talk' ? 'talk' : 'text' } catch { return 'text' } }

const BAR_SHAPE = [0.38, 0.62, 0.9, 0.62, 0.38] // the same five bars as the Talk orb and the phone button

/**
 * The floating button. Drag it anywhere (mouse, finger, pen) and it settles on the nearer side edge; a click
 * still opens Aura. Alt+arrow keys move it too. The slow pulse rests while it is open, working or being dragged.
 */
function Orb({ working, agent, pending, onClick, open, voice, level, fab }) {
  const recording = voice === 'recording'
  const busy = working || voice === 'transcribing'
  const ring = recording ? 'border-red-300' : busy ? themeFor(agent).ring : 'border-violet-300'
  const calm = open || busy || recording || fab.dragging
  return (
    <div
      {...fab.handlers}
      className="fixed z-40 flex w-14 select-none flex-col items-center gap-0.5"
      style={{
        left: fab.pos.x, top: fab.pos.y, touchAction: 'none', cursor: fab.dragging ? 'grabbing' : 'grab',
        transition: fab.dragging ? 'none' : 'left 180ms ease-out, top 180ms ease-out',
      }}
      data-testid="aura-fab"
    >
      <button
        type="button"
        onClick={() => { if (!fab.consumeDrag()) onClick() }}
        aria-label={open ? 'Minimise Aura' : 'Open Aura'}
        aria-expanded={open}
        title="Drag to move (or hold Alt and use the arrow keys)"
        className={`relative flex h-14 w-14 items-center justify-center rounded-full bg-violet-600 text-white ring-2 ring-violet-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-violet-400 ${fab.dragging ? 'shadow-2xl' : 'shadow-lg'}`}
      >
        {!calm && <span className="assistant-fab-pulse absolute inset-0 rounded-full bg-violet-600" aria-hidden="true" />}
        <span
          className={`absolute inset-0 rounded-full border-2 ${ring} ${busy ? 'assistant-ring-spin border-dashed' : recording ? '' : 'assistant-orb-idle'}`}
          style={recording ? { transform: `scale(${1 + Math.min(level, 1) * 0.3})`, transition: 'transform 80ms linear' } : undefined}
          aria-hidden="true"
        />
        <span className="relative flex items-center gap-[3px]" aria-hidden="true">
          {BAR_SHAPE.map((share, i) => (
            <span
              key={i}
              className={`w-[3.5px] rounded-full bg-white ${voice === 'speaking' ? 'assistant-bar-speaking' : ''}`}
              style={{
                height: recording ? Math.max(5, Math.round(22 * share * (0.35 + level * 1.4))) : Math.round(22 * share),
                animationDelay: `${i * 110}ms`, transformOrigin: 'center',
              }}
            />
          ))}
        </span>
        {pending > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-amber-500 px-1 text-[11px] font-medium text-white" aria-label={`${pending} waiting for approval`}>
            {pending}
          </span>
        )}
      </button>
      <span className="pointer-events-none text-[11px] font-bold text-violet-700" aria-hidden="true">Aura</span>
    </div>
  )
}

function Message({ message, notes, onApprove, onReject, onEdit, onListen, onChoose }) {
  const mine = message.role === 'user'
  const agents = (message.sub_agents || []).filter(Boolean)
  return (
    <div className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      {!mine && <StepTrail steps={message.tool_calls || []} />}
      <div
        dir="auto"
        className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-md bg-blue-800 text-white' : 'rounded-bl-md border border-slate-200 bg-white text-slate-900 shadow-sm'}`}
      >
        <RichText text={message.content} />
      </div>
      {!mine && (agents.length > 0 || onListen) && (
        <div className="mt-1 flex items-center gap-1">
          {agents.map((a) => (
            <span key={a} className={`rounded-full border px-2 py-0.5 text-[10px] ${themeFor(a).pill}`}>{themeFor(a).label}</span>
          ))}
          {onListen && (
            <button type="button" onClick={() => onListen(message.content)} className="rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100" aria-label="Listen to this reply">
              Listen
            </button>
          )}
        </div>
      )}
      {!mine && message.ask_feedback && <FeedbackThumbs messageId={message.id} />}
      {onChoose && (message.choices || []).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Pick one">
          {message.choices.map((c) => (
            <button key={c.send} type="button" dir="auto" onClick={() => onChoose(c.send)}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-800 hover:bg-slate-50">
              {c.label}
            </button>
          ))}
        </div>
      )}
      {(message.actions || []).map((a) => (
        <ActionCard key={a.id} action={a} note={notes[a.id]} onApprove={onApprove} onReject={onReject} onEdit={onEdit} />
      ))}
    </div>
  )
}

/** Cards to show in Talk mode: this turn's, the latest answer's (so a result stays visible), and anything older still waiting. */
function talkCards(state) {
  const last = [...state.messages].reverse().find((m) => m.role === 'assistant')
  const shown = [...(last?.actions || []), ...(state.live?.cards || [])]
  const older = state.messages.flatMap((m) => (m === last ? [] : m.actions || [])).filter((a) => a.can_act)
  const seen = new Set()
  return [...older, ...shown].filter((a) => !seen.has(a.id) && seen.add(a.id))
}

export default function AssistantOrb({ userId }) {
  const enabled = isAssistantEnabled()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState(readMode)
  const [heard, setHeard] = useState(null)        // Talk mode: words waiting for their 3-second check
  const [speakReplies, setSpeakReplies] = useState(() => readPref(PREF_SPEAK, true))
  const [autoSend, setAutoSend] = useState(() => readPref(PREF_AUTOSEND, false))
  const [instant, setInstant] = useState(() => readPref(PREF_INSTANT, false))
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const draftIsVoice = useRef(false)          // the words in the box came from the microphone
  const speakNext = useRef(false)             // the next reply answers a spoken question
  const spokenId = useRef(null)
  const { state, capabilities, cardNotes, send, approve, reject, edit, newChat, pending, conversationId, history, openConversation, pinConversation, renameConversation, removeConversation } = useAssistant({ enabled, open })
  const [showHistory, setShowHistory] = useState(false)
  const [showPrefs, setShowPrefs] = useState(false)
  const speech = useSpeech()
  const fab = useDraggableFab()
  // Only an untouched conversation gets the welcome by itself; opening the panel is the tap that lets sound play.
  const welcome = useWelcome({
    agents: capabilities?.agents, speech, userId,
    autoplay: open && !closing && state.messages.length === 0 && !state.live,
  })

  const sendMessage = useCallback((text, viaVoice) => {
    speakNext.current = Boolean(viaVoice)
    draftIsVoice.current = false
    send(text)
  }, [send])

  const voiceReady = Boolean(capabilities?.voice?.enabled)
  const talking = mode === 'talk'

  const onTranscript = useCallback((text) => {
    if (talking) {
      if (instant) sendMessage(text, true)
      else setHeard({ id: `${Date.now()}`, text })
      return
    }
    if (autoSend) { setDraft(''); sendMessage(text, true); return }
    draftIsVoice.current = true
    setDraft((prev) => (prev ? `${prev} ${text}` : text))
    setTimeout(() => inputRef.current?.focus?.(), 0)
  }, [talking, instant, autoSend, sendMessage])

  const voice = useVoiceInput({
    enabled: voiceReady,
    maxSeconds: capabilities?.voice?.max_seconds || 60,
    onTranscript,
    silenceStopMs: talking ? PAUSE_STOPS_MS : 0,
  })
  const talkAvailable = voice.supported

  const speakReply = useCallback(async (text) => {
    if (!speech.supported || !text) return
    let spoken = ''
    try {
      spoken = (await assistantApi.spokenVersion(text)).data.spoken
    } catch {
      // The short version is a nicety: for English, read the start of the reply as it is.
      if (scriptOf(text) === 'en') spoken = text.split(/\n/)[0].slice(0, 300)
    }
    if (spoken) speech.speak(spoken)
  }, [speech])

  // Read the answer to a spoken question once it arrives. A typed question is never read out loud unprompted.
  useEffect(() => {
    const last = state.messages[state.messages.length - 1]
    if (!last || last.role !== 'assistant' || last.id === spokenId.current) return
    spokenId.current = last.id
    if (speakNext.current && speakReplies) speakReply(last.content)
    speakNext.current = false
  }, [state.messages, speakReplies, speakReply])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [open, state.messages, state.live, state.status])

  const minimise = useCallback(() => {
    setClosing(true)
    setTimeout(() => { setOpen(false); setClosing(false) }, CLOSE_MS)
  }, [])

  // Escape closes the panel wherever focus is (it starts on the orb, not inside the panel),
  // and opening it puts the cursor in the message box.
  useEffect(() => {
    if (!open) return undefined
    if (!talking) inputRef.current?.focus?.()
    const onKey = (e) => { if (e.key === 'Escape') minimise() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, minimise, talking])

  const submit = (text) => {
    const value = (text ?? draft).trim()
    if (!value) return
    const viaVoice = text === undefined && draftIsVoice.current
    setDraft('')
    speech.stop()
    sendMessage(value, viaVoice)
  }

  const sendHeard = useCallback((text) => {
    setHeard(null)
    speech.stop()
    sendMessage(text, true)
  }, [speech, sendMessage])

  const switchMode = () => {
    const next = talking ? 'text' : 'talk'
    voice.cancel()
    speech.stop()
    setHeard(null)
    setMode(next)
    try { window.localStorage.setItem(PREF_MODE, next) } catch { /* private mode */ }
  }

  const toggleSpeak = () => {
    const next = !speakReplies
    setSpeakReplies(next)
    writePref(PREF_SPEAK, next)
    if (!next) speech.stop()
  }
  const toggleAutoSend = (on) => { setAutoSend(on); writePref(PREF_AUTOSEND, on) }
  const toggleInstant = (on) => { setInstant(on); writePref(PREF_INSTANT, on) }
  const startNewChat = () => { speech.stop(); setHeard(null); setShowHistory(false); newChat() }
  const openPast = (id) => { speech.stop(); setHeard(null); setShowHistory(false); openConversation(id) }

  // Nothing until we know this user has something to ask: no orb for roles without tools.
  if (!enabled || !capabilities || capabilities.agents.length === 0) return null

  const working = state.status === 'working'
  const liveAgent = state.live?.agents?.[0]
  const empty = state.messages.length === 0 && !state.live
  const orbVoice = voice.state === 'recording' ? 'recording' : voice.state === 'transcribing' ? 'transcribing' : speech.speaking ? 'speaking' : null
  const recording = voice.state === 'recording'
  const transcribing = voice.state === 'transcribing'
  const talkMode = talking && talkAvailable
  const phase = recording ? 'listening' : transcribing ? 'transcribing' : heard ? 'heard' : working ? 'thinking' : speech.speaking ? 'speaking' : 'ready'
  const lastReply = [...state.messages].reverse().find((m) => m.role === 'assistant')?.content
  // The panel opens beside the button (on the side with room), and is a full-width sheet on a narrow screen.
  const rect = panelRect(fab.pos, fab.bounds)
  const pill = 'whitespace-nowrap rounded-full px-2 py-1 text-xs text-slate-600 hover:bg-slate-100'

  const onOrbTap = () => {
    if (phase === 'listening') voice.stop()
    else if (phase === 'ready' || phase === 'speaking') { speech.stop(); voice.start() }
  }
  const talkErrors = [
    voice.error && { text: voice.error, dismiss: voice.clearError },
    speech.notice && { text: speech.notice, dismiss: speech.clearNotice },
    state.status === 'error' && { text: state.error },
  ].filter(Boolean)

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="Aura"
          className={`fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl ${closing ? 'assistant-sink' : 'assistant-rise'}`}
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
        >
          <header className="border-b border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${working ? themeFor(liveAgent).dot : 'bg-violet-500'}`} aria-hidden="true" />
                <h2 className="text-base font-semibold text-slate-900">Aura</h2>
                <span
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                  title={`Aura remembers the last ${state.memory.limit} messages`}
                  aria-label={`Memory ${state.memory.used} of ${state.memory.limit} messages`}
                >
                  {state.memory.used}/{state.memory.limit}
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-0.5">
                {speech.supported && voiceReady && (
                  <button
                    type="button"
                    onClick={toggleSpeak}
                    aria-pressed={speakReplies}
                    title="Read replies aloud when you ask by voice"
                    className={pill}
                  >
                    Aloud: {speakReplies ? 'on' : 'off'}
                  </button>
                )}
                <button type="button" onClick={() => setShowHistory((v) => !v)} aria-pressed={showHistory} className={`${pill} ${showHistory ? 'bg-slate-100' : ''}`}>History</button>
                <button type="button" onClick={() => { setShowHistory(false); setShowPrefs((v) => !v) }} aria-pressed={showPrefs} className={`${pill} ${showPrefs ? 'bg-slate-100' : ''}`}>Settings</button>
                <button type="button" onClick={startNewChat} className={pill}>New chat</button>
                <button type="button" onClick={minimise} aria-label="Minimise" className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200">▾</button>
              </div>
            </div>
            {talkAvailable && (
              <div role="group" aria-label="Mode" className="mx-3 mb-2 flex rounded-full bg-slate-100 p-0.5">
                {[['text', 'Text', KeyboardIcon, 'Switch to text chat'], ['talk', 'Talk', MicIcon, 'Switch to Talk mode']].map(([key, label, Icon, aria]) => {
                  const active = (key === 'talk') === talkMode
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { if (!active) switchMode() }}
                      aria-label={aria}
                      aria-pressed={active}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-1.5 text-xs font-medium transition-colors ${active ? 'bg-white text-blue-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      <Icon width={16} height={16} />
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </header>

          {showPrefs ? (
            <PreferencesSheet onClose={() => setShowPrefs(false)} />
          ) : showHistory ? (
            <HistoryList query={history} currentId={conversationId} onOpen={openPast} onPin={pinConversation} onRename={renameConversation} onDelete={removeConversation} onClose={() => setShowHistory(false)} />
          ) : talkMode ? (
            <>
              <TalkMode
                phase={phase}
                level={voice.level}
                seconds={voice.seconds}
                maxSeconds={capabilities.voice?.max_seconds || 60}
                agent={liveAgent}
                agents={state.live?.agents || []}
                steps={state.live?.steps || []}
                heard={heard}
                onHeardSend={sendHeard}
                onHeardCancel={() => setHeard(null)}
                onOrbTap={onOrbTap}
                onCancelListening={voice.cancel}
                onStopSpeaking={speech.stop}
                caption={speech.caption}
                lastReply={lastReply}
                canListen={speech.supported}
                onListen={speakReply}
                choices={[...state.messages].reverse().find((m) => m.role === 'assistant')?.choices || []}
                onChoose={submit}
                cards={talkCards(state)}
                cardNotes={cardNotes}
                onApprove={approve}
                onReject={reject}
                onEdit={edit}
                errors={talkErrors}
                welcome={welcome}
              />
              <label className="flex items-center gap-2 border-t border-slate-100 px-3 py-1 text-[11px] text-slate-500">
                <input type="checkbox" checked={instant} onChange={(e) => toggleInstant(e.target.checked)} />
                Send instantly (skip the 3-second check of my words)
              </label>
            </>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3">
                {empty && (
                  <div className="space-y-3">
                    <AssistantWelcome welcome={welcome} />
                    <p className="text-xs text-slate-500">Ask in English, Urdu or Roman Urdu{voice.supported ? ', by typing or by voice' : ''}.</p>
                    <div className="flex flex-wrap gap-1">
                      {capabilities.agents.map((a) => (
                        <span key={a.name} className={`rounded-full border px-2 py-0.5 text-[11px] ${themeFor(a.name).pill}`}>{a.label}</span>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {capabilities.suggestions.map((s) => (
                        <button key={s} type="button" dir="auto" onClick={() => submit(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-blue-800 shadow-sm hover:bg-slate-50">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {state.messages.map((m, i) => (
                  <Message
                    key={m.id}
                    // Buttons only on the newest reply and only while Aura is idle: an old question has moved on.
                    onChoose={i === state.messages.length - 1 && !working ? submit : null}
                    message={m}
                    notes={cardNotes}
                    onApprove={approve}
                    onReject={reject}
                    onEdit={edit}
                    onListen={speech.supported && voiceReady ? speakReply : null}
                  />
                ))}

                {state.live && (
                  <div>
                    <StepTrail live steps={state.live.steps} agents={state.live.agents} />
                    {state.live.cards.map((a) => (
                      <ActionCard key={a.id} action={a} note={cardNotes[a.id]} onApprove={approve} onReject={reject} onEdit={edit} />
                    ))}
                  </div>
                )}

                {state.status === 'error' && (
                  <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{state.error}</p>
                )}
                <div ref={bottomRef} />
              </div>

              {speech.speaking && (
                <div role="status" className="flex items-start gap-2 border-t border-blue-100 bg-blue-50 px-3 py-2">
                  <p dir="auto" className="flex-1 text-sm text-blue-900" data-testid="caption">{speech.caption}</p>
                  <button type="button" onClick={speech.stop} className="shrink-0 rounded bg-blue-700 px-2 py-1 text-xs text-white">Stop</button>
                </div>
              )}
              {speech.notice && (
                <p className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {speech.notice} <button type="button" className="underline" onClick={speech.clearNotice}>Dismiss</button>
                </p>
              )}
              {voice.error && (
                <p role="alert" className="border-t border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {voice.error} <button type="button" className="underline" onClick={voice.clearError}>Dismiss</button>
                </p>
              )}

              <form
                className="flex items-end gap-2 border-t border-slate-200 p-2"
                onSubmit={(e) => { e.preventDefault(); submit() }}
              >
                {recording ? (
                  <VoiceBar level={voice.level} seconds={voice.seconds} maxSeconds={capabilities.voice?.max_seconds || 60} onDone={voice.stop} onCancel={voice.cancel} />
                ) : (
                  <>
                    {voice.supported && (
                      <button
                        type="button"
                        onClick={voice.start}
                        disabled={transcribing || working}
                        aria-label="Speak your message"
                        title="Speak your message"
                        className="shrink-0 rounded-full bg-slate-100 px-3 py-2 text-slate-700 hover:bg-slate-200 disabled:opacity-40"
                      >
                        <MicIcon />
                      </button>
                    )}
                    <textarea
                      ref={inputRef}
                      rows={1}
                      dir="auto"
                      value={draft}
                      disabled={transcribing}
                      onChange={(e) => { setDraft(e.target.value); if (!e.target.value) draftIsVoice.current = false }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                      placeholder={transcribing ? 'Turning your voice into text…' : 'Type or paste a request'}
                      aria-label="Message"
                      maxLength={2000}
                      className="max-h-28 flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                    <button type="submit" disabled={working || transcribing || !draft.trim()} className="rounded-full bg-blue-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
                      Send
                    </button>
                  </>
                )}
              </form>
              {voice.supported && !recording && (
                <label className="flex items-center gap-2 border-t border-slate-100 px-3 py-1 text-[11px] text-slate-500">
                  <input type="checkbox" checked={autoSend} onChange={(e) => toggleAutoSend(e.target.checked)} />
                  Send automatically after I speak (otherwise I show the words first)
                </label>
              )}
            </>
          )}
        </section>
      )}
      {/* On a narrow screen the open panel is a full sheet with its own Minimise, so the button steps aside. */}
      {!(open && rect.sheet) && (
        <Orb working={working} agent={liveAgent} pending={pending} open={open} voice={orbVoice} level={voice.level} fab={fab}
          onClick={() => (open ? minimise() : setOpen(true))} />
      )}
    </>
  )
}
