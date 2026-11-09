import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'

vi.mock('../../../services/assistantApi', () => ({
  assistantApi: {
    capabilities: vi.fn(), listConversations: vi.fn(), createConversation: vi.fn(), getMessages: vi.fn(),
    approveAction: vi.fn(), rejectAction: vi.fn(), editAction: vi.fn(), transcribe: vi.fn(), spokenVersion: vi.fn(),
  },
  streamMessage: vi.fn(),
}))

import { assistantApi, streamMessage } from '../../../services/assistantApi'
import AssistantOrb from '../AssistantOrb'
import TalkOrb, { orbLabel } from '../TalkOrb'
import { AGENT_THEME } from '../agentTheme'

const CAPS = (voice = { enabled: true, max_seconds: 60 }) => ({
  agents: [{ name: 'attendance', label: 'Attendance', tools: 4, can_write: true }],
  suggestions: ['Class 5A ki hazri lagao'], memory_limit: 10, voice,
})

class FakeRecorder {
  static isTypeSupported = () => true
  constructor(stream, opts) { this.state = 'inactive'; this.mimeType = opts?.mimeType || 'audio/webm'; FakeRecorder.last = this }
  start() { this.state = 'recording' }
  stop() {
    if (this.state !== 'recording') return
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)], { type: this.mimeType }) })
    this.onstop?.()
  }
}

// An audio context whose loudness the test controls: window.__amp 0 = quiet, 0.2 = someone speaking.
class FakeAudioContext {
  createAnalyser() {
    return {
      fftSize: 256,
      getByteTimeDomainData(buf) { for (let i = 0; i < buf.length; i += 1) buf[i] = 128 + Math.round((i % 2 ? 1 : -1) * window.__amp * 128) },
    }
  }
  createMediaStreamSource() { return { connect() {} } }
  close() { return Promise.resolve() }
}

const URDU_VOICE = { lang: 'ur-PK', name: 'Urdu Voice' }
let synth
let trackStop
let user

function installSpeech(voices) {
  synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => voices, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  window.localStorage.setItem('assistant_beta', '1')
  window.__amp = 0
  trackStop = vi.fn()
  window.MediaRecorder = FakeRecorder
  window.AudioContext = FakeAudioContext
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) },
  })
  installSpeech([URDU_VOICE])
  assistantApi.capabilities.mockResolvedValue({ data: CAPS() })
  assistantApi.listConversations.mockResolvedValue({ data: [] })
  assistantApi.createConversation.mockResolvedValue({ data: { id: 3 } })
  assistantApi.transcribe.mockResolvedValue({ data: { text: 'class 5A ki hazri lagao', language: 'urdu', duration: 3 } })
  assistantApi.spokenVersion.mockResolvedValue({ data: { spoken: 'کلاس 5 اے کی حاضری تیار ہے' } })
  streamMessage.mockImplementation(async (_i, _m, onEvent) => { onEvent(finalWith('Register ready.')) })
})
afterEach(() => {
  vi.useRealTimers()
  window.localStorage.clear()
  delete window.MediaRecorder
  delete window.AudioContext
  delete window.__amp
  vi.clearAllMocks()
})

const finalWith = (content, extra = {}) => ({
  type: 'final', content, memory: { used: 2, limit: 10 }, sub_agents: [], tool_calls: [],
  message: { id: 50 + (extra.n || 0), role: 'assistant', content, sub_agents: [], tool_calls: [], actions: extra.actions || [] },
})
const card = (over = {}) => ({
  id: 9, status: 'pending', can_act: true,
  preview: { kind: 'attendance', title: 'Mark attendance', summary: 'Class 5A', columns: ['Student'], rows: [], warnings: [] }, ...over,
})

const tick = (ms) => act(async () => { vi.advanceTimersByTime(ms) })

async function openTalk() {
  renderWithProviders(<AssistantOrb />)
  await user.click(await screen.findByRole('button', { name: 'Open Aura' }))
  await user.click(screen.getByRole('button', { name: 'Switch to Talk mode' }))
  return screen.findByTestId('talk-mode')
}

/** Tap the orb, "speak" for a moment, tap again to finish. */
async function speakOnce({ seconds = 2 } = {}) {
  await user.click(screen.getByRole('button', { name: 'Start talking' }))
  await screen.findByText('Listening')
  await tick(seconds * 1000)
  await user.click(screen.getByRole('button', { name: 'Stop listening' }))
}

describe('switching to Talk mode', () => {
  it('is offered when the device can record, and remembered', async () => {
    const view = await openTalk()
    expect(view).toHaveAttribute('data-phase', 'ready')
    expect(screen.getByRole('button', { name: 'Start talking' })).toBeEnabled()
    expect(screen.getByText('Tap the orb and speak')).toBeInTheDocument()
    expect(window.localStorage.getItem('assistant_mode')).toBe('talk')
    await user.click(screen.getByRole('button', { name: 'Switch to text chat' }))
    expect(window.localStorage.getItem('assistant_mode')).toBe('text')
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
  })

  it('opens straight in Talk mode the next time', async () => {
    window.localStorage.setItem('assistant_mode', 'talk')
    renderWithProviders(<AssistantOrb />)
    await user.click(await screen.findByRole('button', { name: 'Open Aura' }))
    expect(await screen.findByTestId('talk-mode')).toBeInTheDocument()
    expect(screen.queryByLabelText('Message')).toBeNull()
  })

  it('is not offered without a microphone, and a saved Talk setting falls back to text', async () => {
    delete window.MediaRecorder
    window.localStorage.setItem('assistant_mode', 'talk')
    renderWithProviders(<AssistantOrb />)
    await user.click(await screen.findByRole('button', { name: 'Open Aura' }))
    expect(screen.queryByRole('button', { name: /Talk mode/ })).toBeNull()
    expect(screen.queryByTestId('talk-mode')).toBeNull()
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })

  it('is not offered when the server has voice switched off', async () => {
    assistantApi.capabilities.mockResolvedValue({ data: CAPS({ enabled: false, max_seconds: 60 }) })
    renderWithProviders(<AssistantOrb />)
    await user.click(await screen.findByRole('button', { name: 'Open Aura' }))
    expect(screen.queryByRole('button', { name: /Talk mode/ })).toBeNull()
  })

  it('switching away while recording throws the recording away and frees the microphone', async () => {
    await openTalk()
    await user.click(screen.getByRole('button', { name: 'Start talking' }))
    await screen.findByText('Listening')
    await user.click(screen.getByRole('button', { name: 'Switch to text chat' }))
    expect(assistantApi.transcribe).not.toHaveBeenCalled()
    expect(trackStop).toHaveBeenCalled()
  })
})

describe('listening', () => {
  it('shows Listening with a timer, a hint and a Cancel that discards everything', async () => {
    await openTalk()
    await user.click(screen.getByRole('button', { name: 'Start talking' }))
    expect(await screen.findByText('Listening')).toBeInTheDocument()
    expect(screen.getByText(/0:00 \/ 1:00/)).toBeInTheDocument()
    expect(screen.getByText(/stops by itself when you pause/i)).toBeInTheDocument()
    expect(screen.getByTestId('talk-mode')).toHaveAttribute('data-phase', 'listening')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(assistantApi.transcribe).not.toHaveBeenCalled()
    expect(screen.getByTestId('talk-mode')).toHaveAttribute('data-phase', 'ready')
  })

  it('stops by itself after a pause once someone has spoken', async () => {
    await openTalk()
    await user.click(screen.getByRole('button', { name: 'Start talking' }))
    await screen.findByText('Listening')
    window.__amp = 0.2
    await tick(600)                               // speaking
    window.__amp = 0
    await tick(1000)                              // a short pause is not the end
    expect(assistantApi.transcribe).not.toHaveBeenCalled()
    expect(FakeRecorder.last.state).toBe('recording')
    await tick(800)                               // the pause has now lasted 1.5 seconds
    await waitFor(() => expect(assistantApi.transcribe).toHaveBeenCalledTimes(1))
  })

  it('gives up if nobody speaks, without sending silence for transcription', async () => {
    await openTalk()
    await user.click(screen.getByRole('button', { name: 'Start talking' }))
    await screen.findByText('Listening')
    await tick(8500)
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not hear anything/i)
    expect(assistantApi.transcribe).not.toHaveBeenCalled()
    expect(screen.getByTestId('talk-mode')).toHaveAttribute('data-phase', 'ready')
  })

  it('a pause does NOT stop a recording in the ordinary text chat', async () => {
    renderWithProviders(<AssistantOrb />)
    await user.click(await screen.findByRole('button', { name: 'Open Aura' }))
    await user.click(screen.getByRole('button', { name: 'Speak your message' }))
    await screen.findByText('Listening')
    window.__amp = 0.2
    await tick(600)
    window.__amp = 0
    await tick(5000)
    expect(FakeRecorder.last.state).toBe('recording')
  })

  it('a refused microphone is explained on this screen', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    await openTalk()
    await user.click(screen.getByRole('button', { name: 'Start talking' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission was denied/i)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('checking the words before they are sent', () => {
  async function heard() {
    await openTalk()
    await speakOnce()
    return screen.findByTestId('heard-box')
  }

  it('shows what was heard with a 3-second countdown, then sends it', async () => {
    const box = await heard()
    expect(box).toHaveTextContent('class 5A ki hazri lagao')
    expect(screen.getByTestId('talk-mode')).toHaveAttribute('data-phase', 'heard')
    expect(box).toHaveTextContent('Sending in 3')
    expect(streamMessage).not.toHaveBeenCalled()
    for (let i = 0; i < 4; i += 1) await tick(1000)
    await waitFor(() => expect(streamMessage).toHaveBeenCalledWith(3, 'class 5A ki hazri lagao', expect.any(Function), expect.anything()))
    expect(streamMessage).toHaveBeenCalledTimes(1)
  })

  it('Send now does not wait', async () => {
    await heard()
    await user.click(screen.getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(streamMessage).toHaveBeenCalledTimes(1))
  })

  it('Cancel throws the words away and sends nothing, even after the countdown would have ended', async () => {
    await heard()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    for (let i = 0; i < 5; i += 1) await tick(1000)
    expect(streamMessage).not.toHaveBeenCalled()
    expect(screen.getByTestId('talk-mode')).toHaveAttribute('data-phase', 'ready')
  })

  it('Edit stops the countdown, and the corrected words are what get sent', async () => {
    await heard()
    await tick(1000)
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    for (let i = 0; i < 5; i += 1) await tick(1000)
    expect(streamMessage).not.toHaveBeenCalled()                       // still waiting for the person
    const box = screen.getByLabelText('Edit what I heard')
    await user.clear(box)
    await user.type(box, 'class 5B ki hazri lagao')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(streamMessage).toHaveBeenCalledWith(3, 'class 5B ki hazri lagao', expect.any(Function), expect.anything()))
  })

  it('an empty edit is not sent', async () => {
    await heard()
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('Edit what I heard'))
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(streamMessage).not.toHaveBeenCalled()
  })

  it('"Send instantly" skips the check, and remembers the choice', async () => {
    await openTalk()
    await user.click(screen.getByLabelText(/Send instantly/))
    expect(window.localStorage.getItem('assistant_talk_instant')).toBe('1')
    await speakOnce()
    await waitFor(() => expect(streamMessage).toHaveBeenCalledWith(3, 'class 5A ki hazri lagao', expect.any(Function), expect.anything()))
    expect(screen.queryByTestId('heard-box')).toBeNull()
  })
})

describe('thinking, speaking and what is waiting for you', () => {
  it('while the assistant works the orb shows the agent and its steps, and is not tappable', async () => {
    let release
    streamMessage.mockImplementation((_i, _m, onEvent) => new Promise((resolve) => {
      onEvent({ type: 'route', agents: ['attendance'] })
      onEvent({ type: 'step', phase: 'start', index: 0, name: 'get_class_attendance', sub_agent: 'attendance', kind: 'read', label: 'Class attendance' })
      release = () => { onEvent(finalWith('Register ready.')); resolve() }
    }))
    await openTalk()
    await user.click(screen.getByLabelText(/Send instantly/))
    await speakOnce()
    expect(await screen.findByText('Attendance agent')).toBeInTheDocument()
    expect(screen.getByText('Class attendance')).toBeInTheDocument()
    const orb = screen.getByRole('button', { name: 'Working on your request' })
    expect(orb).toBeDisabled()
    await act(async () => release())
  })

  it('a spoken question gets a spoken answer: Urdu voice, subtitles, and Stop', async () => {
    await openTalk()
    await user.click(screen.getByLabelText(/Send instantly/))
    await speakOnce()
    await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1))
    expect(synth.speak.mock.calls[0][0].voice).toBe(URDU_VOICE)
    expect(await screen.findByTestId('talk-caption')).toHaveTextContent('کلاس 5 اے کی حاضری تیار ہے')
    expect(screen.getByTestId('talk-mode')).toHaveAttribute('data-phase', 'speaking')
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(synth.cancel).toHaveBeenCalled()
    expect(screen.getByTestId('talk-mode')).toHaveAttribute('data-phase', 'ready')
  })

  it('tapping the orb while it speaks interrupts and starts listening again', async () => {
    await openTalk()
    await user.click(screen.getByLabelText(/Send instantly/))
    await speakOnce()
    await waitFor(() => expect(synth.speak).toHaveBeenCalled())
    navigator.mediaDevices.getUserMedia.mockClear()
    await user.click(screen.getByRole('button', { name: 'Stop speaking and talk' }))
    expect(synth.cancel).toHaveBeenCalled()
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Listening')).toBeInTheDocument()
  })

  it('with spoken replies off, the answer is shown as text instead', async () => {
    window.localStorage.setItem('assistant_speak', '0')
    await openTalk()
    await user.click(screen.getByLabelText(/Send instantly/))
    await speakOnce()
    expect(await screen.findByText('Last reply')).toBeInTheDocument()
    expect(screen.getByText('Register ready.')).toBeInTheDocument()
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('a device with no Urdu voice says so and still shows the reply', async () => {
    installSpeech([{ lang: 'en-US', name: 'English' }])
    await openTalk()
    await user.click(screen.getByLabelText(/Send instantly/))
    await speakOnce()
    expect(await screen.findByText(/no Urdu voice/i)).toBeInTheDocument()
    expect(screen.getByText('Register ready.')).toBeInTheDocument()
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('a change card slides up, stays until a person taps, and is never approved by voice', async () => {
    streamMessage.mockImplementation(async (_i, _m, onEvent) => { onEvent({ type: 'card', action: card() }); onEvent(finalWith('Review the card.', { actions: [card()] })) })
    assistantApi.approveAction.mockResolvedValue({ data: card({ status: 'executed', can_act: false, result: { saved: 2 } }) })
    await openTalk()
    await user.click(screen.getByLabelText(/Send instantly/))
    await speakOnce()
    await screen.findByLabelText('Changes waiting for you')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    for (let i = 0; i < 6; i += 1) await tick(1000)
    expect(assistantApi.approveAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()   // did not go away on its own
    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(assistantApi.approveAction).toHaveBeenCalledWith(9)
    expect(await screen.findByText(/saved 2/)).toBeInTheDocument()
  })
})

describe('room for the card', () => {
  it('the orb is smaller while a change is waiting, and full size again once nothing is', async () => {
    streamMessage.mockImplementation(async (_i, _m, onEvent) => { onEvent(finalWith('Review the card.', { actions: [card()] })) })
    await openTalk()
    const big = screen.getByRole('button', { name: 'Start talking' }).style.width
    await user.click(screen.getByLabelText(/Send instantly/))
    await speakOnce()
    await screen.findByLabelText('Changes waiting for you')
    await user.click(screen.getByRole('button', { name: 'Stop' }))     // end the spoken reply so the orb is idle again
    const small = screen.getByRole('button', { name: 'Start talking' }).style.width
    expect(parseInt(small, 10)).toBeLessThan(parseInt(big, 10))
  })
})

describe('TalkOrb', () => {
  const phases = ['ready', 'listening', 'transcribing', 'heard', 'thinking', 'speaking']

  it('has a label for every state', () => {
    phases.forEach((p) => expect(orbLabel(p)).toBeTruthy())
    expect(new Set(phases.map(orbLabel)).size).toBe(phases.length)
  })

  it.each([['ready', true], ['listening', true], ['speaking', true], ['transcribing', false], ['heard', false], ['thinking', false]])(
    '%s: tappable = %s', (phase, tappable) => {
      render(<TalkOrb phase={phase} onClick={() => {}} />)
      const orb = screen.getByRole('button', { name: orbLabel(phase) })
      expect(orb).toHaveAttribute('data-phase', phase)
      expect(orb.disabled).toBe(!tappable)
    },
  )

  it('thinking takes the colour of the agent that is working', () => {
    const { container } = render(<TalkOrb phase="thinking" agent="attendance" />)
    const strokes = [...container.querySelectorAll('circle')].map((c) => c.getAttribute('stroke'))
    expect(strokes).toContain(AGENT_THEME.attendance.hex.ring)
  })

  it('listening is red and the rings swell with the voice', () => {
    const quiet = render(<TalkOrb phase="listening" level={0} />).container.querySelector('circle')
    const loud = render(<TalkOrb phase="listening" level={1} />).container.querySelector('circle')
    expect(quiet.getAttribute('stroke')).toBe('#E24B4A')
    expect(loud.style.transform).not.toBe(quiet.style.transform)
  })

  it('every agent has SVG colours', () => {
    Object.values(AGENT_THEME).forEach((t) => expect(t.hex).toEqual({ ring: expect.any(String), fill: expect.any(String), ink: expect.any(String) }))
  })
})
