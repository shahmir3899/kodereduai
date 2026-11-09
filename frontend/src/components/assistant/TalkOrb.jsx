import { themeFor } from './agentTheme'

const BLUE = { ring: '#378ADD', fill: '#E6F1FB', ink: '#185FA5' }
const RED = { ring: '#E24B4A', fill: '#FCEBEB', ink: '#A32D2D' }
const SLATE = { ring: '#94A3B8', fill: '#F1F5F9', ink: '#334155' }

const LABELS = {
  ready: 'Start talking',
  listening: 'Stop listening',
  transcribing: 'Turning your voice into text',
  heard: 'Waiting to send',
  thinking: 'Working on your request',
  speaking: 'Stop speaking and talk',
}

// How tall each of the five bars is, as a share of the core, per phase.
const SHAPE = [0.38, 0.62, 0.9, 0.62, 0.38]

export function orbLabel(phase) {
  return LABELS[phase] || LABELS.ready
}

/**
 * The big orb of Talk mode. One drawing, six states:
 * ready (calm blue), listening (red, rings swell with the voice), transcribing (grey, turning),
 * heard (small, waiting to send), thinking (the working agent's colour, turning, three dots),
 * speaking (blue, bars moving). It is a button only when tapping it means something.
 */
export default function TalkOrb({ phase, level = 0, agent, onClick, size = 168, paused = false }) {
  const palette = phase === 'listening' ? RED : phase === 'thinking' ? (themeFor(agent).hex || SLATE) : phase === 'transcribing' ? SLATE : BLUE
  const tappable = phase === 'ready' || phase === 'listening' || phase === 'speaking'
  const turning = phase === 'thinking' || phase === 'transcribing'
  const swell = phase === 'listening' ? 1 + Math.min(level, 1) * 0.14 : 1
  const small = phase === 'heard'
  const px = small ? Math.round(size * 0.55) : size
  const centre = { transformBox: 'fill-box', transformOrigin: 'center' }

  return (
    <button
      type="button"
      onClick={tappable ? onClick : undefined}
      disabled={!tappable}
      aria-label={orbLabel(phase)}
      data-phase={phase}
      className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-default"
      style={{ width: px, height: px, transition: 'width 200ms ease, height 200ms ease' }}
    >
      <svg viewBox="0 0 160 160" width="100%" height="100%" aria-hidden="true">
        {(phase === 'ready' || phase === 'thinking') && (
          <circle cx="80" cy="80" r="70" fill={palette.ring} className="talk-glow" />
        )}
        {(phase === 'listening' || phase === 'speaking') && [0, 1100].map((d) => (
          <circle key={d} cx="80" cy="80" r="62" fill="none" stroke={palette.ring} strokeWidth="2" className="talk-ripple" style={{ animationDelay: `${d}ms` }} />
        ))}
        {phase === 'speaking' && <circle cx="80" cy="80" r="56" fill={palette.ring} className="talk-burst" />}
        {phase === 'heard' && (
          <circle cx="80" cy="80" r="64" fill="none" stroke={palette.ring} strokeWidth="4" strokeLinecap="round"
            strokeDasharray="402" className="talk-count" style={{ animationPlayState: paused ? 'paused' : 'running' }} />
        )}
        {phase === 'thinking' && (
          <g className="talk-orbit">
            {[0, 120, 240].map((a) => (
              <circle key={a} cx="80" cy="10" r="5" fill={palette.ring} transform={`rotate(${a} 80 80)`} />
            ))}
          </g>
        )}
        <circle cx="80" cy="80" r="76" fill="none" stroke={palette.ring} strokeWidth="1" opacity="0.3"
          style={{ ...centre, transform: `scale(${swell})`, transition: 'transform 80ms linear' }} />
        <circle cx="80" cy="80" r="64" fill="none" stroke={palette.ring} strokeWidth="2" opacity={turning ? 1 : 0.55}
          strokeDasharray={turning ? '26 14' : undefined}
          className={turning ? 'talk-spin' : phase === 'ready' ? 'assistant-orb-idle' : undefined}
          style={{ ...centre, ...(phase === 'listening' ? { transform: `scale(${1 + Math.min(level, 1) * 0.08})`, transition: 'transform 80ms linear' } : {}) }} />
        <circle cx="80" cy="80" r="50" fill={palette.fill} stroke={palette.ink} strokeWidth="1.8" />
        {phase === 'thinking' || phase === 'transcribing' ? (
          [58, 80, 102].map((x, i) => (
            <circle key={x} cx={x} cy="80" r="5" fill={palette.ink} className="animate-pulse" style={{ animationDelay: `${i * 180}ms` }} />
          ))
        ) : (
          SHAPE.map((share, i) => {
            const live = phase === 'listening' ? Math.max(0.14, Math.min(1, share * (0.35 + level * 1.4))) : share
            const h = Math.round(56 * live)
            return (
              <rect key={i} x={52 + i * 14} y={80 - h / 2} width="8" height={h} rx="4" fill={palette.ink}
                className={phase === 'speaking' ? 'assistant-bar-speaking' : undefined}
                style={{ ...centre, animationDelay: `${i * 110}ms`, transition: phase === 'listening' ? 'height 80ms linear, y 80ms linear' : undefined }} />
            )
          })
        )}
      </svg>
    </button>
  )
}
