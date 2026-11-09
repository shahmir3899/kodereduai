import { useEffect, useRef, useState } from 'react'
import ActionCard from './ActionCard'
import StepTrail from './StepTrail'
import TalkOrb from './TalkOrb'
import { themeFor } from './agentTheme'
import { StopIcon, XIcon } from './icons'

const SEND_AFTER = 3          // seconds the words stay on screen before they are sent
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** The words just heard, held for a few seconds so a wrong word can be fixed before anything is sent. */
function HeardBox({ text, onSend, onCancel }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(text)
  const [left, setLeft] = useState(SEND_AFTER)
  // The parent re-renders often (levels, voices); the countdown must not restart each time, so the
  // callbacks live in refs and the timer depends only on what really changes it.
  const sendRef = useRef(onSend)
  sendRef.current = onSend
  const sent = useRef(false)
  const send = (text) => { if (!sent.current) { sent.current = true; sendRef.current(text) } }

  useEffect(() => {
    if (editing || sent.current) return undefined
    if (left <= 0) { send(value); return undefined }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, left, value])

  return (
    <div className="w-full space-y-2" data-testid="heard-box">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5">Check your words</span>
        {!editing && <span role="status">Sending in {left}</span>}
      </div>
      {editing ? (
        <textarea
          autoFocus
          dir="auto"
          rows={2}
          value={value}
          aria-label="Edit what I heard"
          onChange={(e) => setValue(e.target.value)}
          className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      ) : (
        <p dir="auto" className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900">{value}</p>
      )}
      <div className="flex gap-2">
        {editing ? (
          <button type="button" onClick={() => value.trim() && send(value)} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white">Send</button>
        ) : (
          <>
            <button type="button" onClick={() => send(value)} className="rounded-lg bg-slate-900 px-3 py-1 text-xs font-medium text-white">Send now</button>
            <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">Edit</button>
          </>
        )}
        <button type="button" onClick={onCancel} className="rounded-lg border border-slate-300 px-3 py-1 text-xs">Cancel</button>
      </div>
    </div>
  )
}

/**
 * Voice-first view of the assistant: one large orb, one line of status, the words, and any change
 * waiting for approval. Everything it shows comes from the same state as the text chat.
 * A change card stays on screen until a person taps Approve, Edit or Reject: voice never approves.
 */
export default function TalkMode({
  phase, level, seconds, maxSeconds, agent, steps, agents,
  heard, onHeardSend, onHeardCancel,
  onOrbTap, onCancelListening, onStopSpeaking,
  caption, lastReply, onListen, canListen, choices = [], onChoose,
  cards, cardNotes, onApprove, onReject, onEdit,
  errors,
}) {
  const heading = {
    ready: 'Tap the orb and speak',
    listening: 'Listening',
    transcribing: 'Turning your voice into text…',
    heard: '',
    thinking: `${themeFor(agent).label === 'Assistant' ? 'Working on it' : `${themeFor(agent).label} agent`}`,
    speaking: 'Speaking',
  }[phase]

  return (
    <div className="flex flex-1 flex-col overflow-y-auto" data-testid="talk-mode" data-phase={phase}>
      <div className="flex flex-col items-center gap-2 px-4 pt-5">
        {/* A smaller orb while a change waits, so its Approve / Edit / Reject buttons stay within reach. */}
        <TalkOrb phase={phase} level={level} agent={agent} onClick={onOrbTap} size={cards.length > 0 ? 120 : 168} />
        <div aria-live="polite" className="min-h-[1.5rem] text-center">
          {heading && <p className="text-sm font-medium text-slate-900">{heading}</p>}
          {phase === 'ready' && <p className="text-xs text-slate-500">English, Urdu or Roman Urdu</p>}
          {phase === 'listening' && (
            <>
              <p className="text-xs tabular-nums text-slate-600">{clock(seconds)} / {clock(maxSeconds)}</p>
              <p className="text-xs text-slate-500">It stops by itself when you pause, or tap the orb</p>
            </>
          )}
        </div>

        {phase === 'listening' && (
          <button type="button" onClick={onCancelListening} className="flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700">
            <XIcon width={14} height={14} /> Cancel
          </button>
        )}
        {phase === 'heard' && heard && <HeardBox key={heard.id} text={heard.text} onSend={onHeardSend} onCancel={onHeardCancel} />}
        {phase === 'thinking' && (
          <div className="w-full"><StepTrail live steps={steps} agents={agents} /></div>
        )}
        {phase === 'speaking' && (
          <div className="w-full space-y-2" role="status">
            <p dir="auto" data-testid="talk-caption" className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{caption}</p>
            <button type="button" onClick={onStopSpeaking} className="flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-1 text-xs text-white">
              <StopIcon width={14} height={14} /> Stop
            </button>
          </div>
        )}
        {phase === 'ready' && lastReply && (
          <div className="w-full rounded-lg border border-slate-200 p-3">
            <p className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">Last reply</p>
            <p dir="auto" className="whitespace-pre-wrap text-sm text-slate-800">{lastReply}</p>
            {canListen && (
              <button type="button" onClick={() => onListen(lastReply)} className="mt-1 rounded px-1.5 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100" aria-label="Listen to the last reply">
                Listen
              </button>
            )}
          </div>
        )}
        {phase === 'ready' && choices.length > 0 && (
          <div className="flex w-full flex-wrap gap-1" role="group" aria-label="Pick one">
            {choices.map((c) => (
              <button key={c.send} type="button" dir="auto" onClick={() => onChoose(c.send)}
                className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-800 hover:bg-slate-50">{c.label}</button>
            ))}
          </div>
        )}
        {errors.map((e) => (
          <p key={e.text} role="alert" className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700" dir="auto">
            {e.text} {e.dismiss && <button type="button" className="underline" onClick={e.dismiss}>Dismiss</button>}
          </p>
        ))}
      </div>

      {cards.length > 0 && (
        <div className="assistant-rise mt-3 border-t border-slate-200 bg-white px-3 pb-3" aria-label="Changes waiting for you">
          {cards.map((a) => (
            <ActionCard key={a.id} action={a} note={cardNotes[a.id]} onApprove={onApprove} onReject={onReject} onEdit={onEdit} />
          ))}
        </div>
      )}
    </div>
  )
}
