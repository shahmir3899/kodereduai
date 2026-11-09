import { useState } from 'react'
import { assistantApi } from '../../services/assistantApi'

/**
 * Thumbs up/down. Rendered only when Aura could not help or declined, or after an approval card was
 * approved or rejected - never on every reply, so it stays a signal and not noise.
 */
export default function FeedbackThumbs({ messageId, label = 'Was this helpful?' }) {
  const [sent, setSent] = useState(null)
  const [failed, setFailed] = useState(false)
  if (!messageId) return null

  const send = async (rating) => {
    setFailed(false)
    try {
      await assistantApi.sendFeedback({ message_id: messageId, rating })
      setSent(rating)
    } catch {
      setFailed(true)
    }
  }

  if (sent) return <p className="mt-1 text-[11px] text-slate-500">Thanks for the feedback.</p>
  return (
    <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500" role="group" aria-label={label}>
      <span>{label}</span>
      <button type="button" onClick={() => send(1)} className="rounded px-1.5 py-0.5 hover:bg-slate-100" aria-label="Helpful">👍</button>
      <button type="button" onClick={() => send(-1)} className="rounded px-1.5 py-0.5 hover:bg-slate-100" aria-label="Not helpful">👎</button>
      {failed && <span role="alert" className="text-red-700">Could not send.</span>}
    </div>
  )
}
