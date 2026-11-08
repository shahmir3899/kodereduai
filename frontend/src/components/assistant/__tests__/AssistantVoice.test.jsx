import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, screen, waitFor } from '@testing-library/react'
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

const CAPS = (voice = { enabled: true, max_seconds: 60 }) => ({
  agents: [{ name: 'attendance', label: 'Attendance', tools: 4, can_write: true }],
  suggestions: ['Class 5A ki hazri lagao'], memory_limit: 10, voice,
})

class FakeRecorder {
  static isTypeSupported = () => true
  constructor(stream, opts) { this.state = 'inactive'; this.mimeType = opts?.mimeType || 'audio/webm'; FakeRecorder.last = this }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob([new Uint8Array(2000)], { type: this.mimeType }) })
    this.onstop?.()
  }
}

let now
let trackStop
const URDU_VOICE = { lang: 'ur-PK', name: 'Urdu Voice' }
const EN_VOICE = { lang: 'en-US', name: 'English Voice' }
let synth

function installSpeech(voices) {
  synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => voices, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
}

beforeEach(() => {
  window.localStorage.setItem('assistant_beta', '1')
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  trackStop = vi.fn()
  window.MediaRecorder = FakeRecorder
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) },
  })
  installSpeech([URDU_VOICE, EN_VOICE])
  assistantApi.capabilities.mockResolvedValue({ data: CAPS() })
  assistantApi.listConversations.mockResolvedValue({ data: [] })
  assistantApi.createConversation.mockResolvedValue({ data: { id: 3 } })
  assistantApi.transcribe.mockResolvedValue({ data: { text: 'class 5A ki hazri lagao', language: 'urdu', duration: 3 } })
  assistantApi.spokenVersion.mockResolvedValue({ data: { spoken: 'کلاس 5 اے کی حاضری تیار ہے' } })
})
afterEach(() => {
  window.localStorage.clear()
  delete window.MediaRecorder
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

const finalWith = (content, id = 50) => ({
  type: 'final', content, memory: { used: 2, limit: 10 }, sub_agents: [], tool_calls: [],
  message: { id, role: 'assistant', content, sub_agents: [], tool_calls: [], actions: [] },
})
const script = (events) => streamMessage.mockImplementation(async (_i, _m, onEvent) => { events.forEach((e) => onEvent(e)) })

async function open() {
  renderWithProviders(<AssistantOrb />)
  await userEvent.click(await screen.findByRole('button', { name: 'Open assistant' }))
}

async function speak(seconds = 2) {
  await userEvent.click(screen.getByRole('button', { name: 'Speak your message' }))
  await screen.findByText('Listening')
  now += seconds * 1000
  await userEvent.click(screen.getByRole('button', { name: 'Done' }))
}

describe('microphone availability', () => {
  it('shows the mic only when the server allows voice and the browser can record', async () => {
    await open()
    expect(screen.getByRole('button', { name: 'Speak your message' })).toBeInTheDocument()
  })

  it('hides it when the server has voice switched off', async () => {
    assistantApi.capabilities.mockResolvedValue({ data: CAPS({ enabled: false, max_seconds: 60 }) })
    await open()
    expect(screen.queryByRole('button', { name: 'Speak your message' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Aloud/ })).toBeNull()
  })

  it('hides it in a browser that cannot record, and typing still works', async () => {
    delete window.MediaRecorder
    await open()
    expect(screen.queryByRole('button', { name: 'Speak your message' })).toBeNull()
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })
})

describe('speaking a request', () => {
  it('records, shows the live bar, then puts the words in the box for you to check - it does not send', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Speak your message' }))
    expect(await screen.findByText('Listening')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel recording' })).toBeInTheDocument()
    now += 2000
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('class 5A ki hazri lagao'))
    expect(streamMessage).not.toHaveBeenCalled()
    expect(assistantApi.transcribe).toHaveBeenCalledTimes(1)
    const [blob, language] = assistantApi.transcribe.mock.calls[0]
    expect(blob).toBeInstanceOf(Blob) && expect(language).toBe('auto')
    expect(trackStop).toHaveBeenCalled()                       // the microphone is released
  })

  it('words spoken after text already in the box are added to it', async () => {
    await open()
    await userEvent.type(screen.getByLabelText('Message'), 'please')
    await speak()
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('please class 5A ki hazri lagao'))
  })

  it('cancel throws the recording away without sending anything', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Speak your message' }))
    await screen.findByText('Listening')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel recording' }))
    expect(assistantApi.transcribe).not.toHaveBeenCalled()
    expect(screen.queryByText('Listening')).toBeNull()
    expect(trackStop).toHaveBeenCalled()
  })

  it('a tap that is too short is not a request', async () => {
    await open()
    await speak(0.1)
    expect(await screen.findByRole('alert')).toHaveTextContent(/too short/i)
    expect(assistantApi.transcribe).not.toHaveBeenCalled()
  })

  it('silence comes back empty and says so', async () => {
    assistantApi.transcribe.mockResolvedValue({ data: { text: '', language: '', duration: 3 } })
    await open()
    await speak()
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not hear/i)
    expect(screen.getByLabelText('Message')).toHaveValue('')
  })

  it('a refused microphone explains how to allow it', async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Speak your message' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/permission was denied/i)
    expect(screen.queryByText('Listening')).toBeNull()
  })

  it('shows the server reason when transcription fails and keeps typing available', async () => {
    assistantApi.transcribe.mockRejectedValue({ response: { data: { error: 'Voice is busy right now. Please try again in a minute or type your message.' } } })
    await open()
    await speak()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Voice is busy/)
    expect(screen.getByLabelText('Message')).toBeEnabled()
  })

  it('stops by itself at the maximum length', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    assistantApi.capabilities.mockResolvedValue({ data: CAPS({ enabled: true, max_seconds: 2 }) })
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Speak your message' }))
    await screen.findByText('Listening')
    await act(async () => { vi.advanceTimersByTime(3000) })      // fake timers also drive Date.now here
    await waitFor(() => expect(assistantApi.transcribe).toHaveBeenCalled())
    vi.useRealTimers()
  })

  it('"send automatically" sends the words straight away, and remembers the choice', async () => {
    script([finalWith('Done.')])
    await open()
    await userEvent.click(screen.getByLabelText(/Send automatically/))
    expect(window.localStorage.getItem('assistant_autosend')).toBe('1')
    await speak()
    await waitFor(() => expect(streamMessage).toHaveBeenCalledWith(3, 'class 5A ki hazri lagao', expect.any(Function), expect.anything()))
  })
})

describe('spoken replies', () => {
  async function askByVoice() {
    await speak()
    await waitFor(() => expect(screen.getByLabelText('Message')).toHaveValue('class 5A ki hazri lagao'))
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
  }

  it('answers a spoken question aloud in Urdu, with subtitles and a stop button', async () => {
    script([finalWith('Register ready. Please review the card.')])
    await open()
    await askByVoice()
    await waitFor(() => expect(synth.speak).toHaveBeenCalledTimes(1))
    expect(assistantApi.spokenVersion).toHaveBeenCalledWith('Register ready. Please review the card.')
    const utterance = synth.speak.mock.calls[0][0]
    expect(utterance.text).toBe('کلاس 5 اے کی حاضری تیار ہے')
    expect(utterance.voice).toBe(URDU_VOICE)
    expect(utterance.lang).toBe('ur-PK')
    expect(await screen.findByTestId('caption')).toHaveTextContent('کلاس 5 اے کی حاضری تیار ہے')
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(synth.cancel).toHaveBeenCalled()
    expect(screen.queryByTestId('caption')).toBeNull()
  })

  it('subtitles go away when the voice finishes', async () => {
    script([finalWith('Done.')])
    await open()
    await askByVoice()
    await waitFor(() => expect(synth.speak).toHaveBeenCalled())
    expect(await screen.findByTestId('caption')).toBeInTheDocument()
    act(() => synth.speak.mock.calls[0][0].onend())
    await waitFor(() => expect(screen.queryByTestId('caption')).toBeNull())
  })

  it('a typed question is never read out loud', async () => {
    script([finalWith('Typed answer.')])
    await open()
    await userEvent.type(screen.getByLabelText('Message'), 'hello{Enter}')
    await screen.findByText('Typed answer.')
    expect(assistantApi.spokenVersion).not.toHaveBeenCalled()
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('the Aloud switch turns it off, and remembers', async () => {
    script([finalWith('Quiet please.')])
    await open()
    await userEvent.click(screen.getByRole('button', { name: /Aloud: on/ }))
    expect(screen.getByRole('button', { name: /Aloud: off/ })).toBeInTheDocument()
    expect(window.localStorage.getItem('assistant_speak')).toBe('0')
    await askByVoice()
    await screen.findByText('Quiet please.')
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('a device with no Urdu voice says so instead of reading Urdu badly', async () => {
    installSpeech([EN_VOICE])
    script([finalWith('Register ready.')])
    await open()
    await askByVoice()
    expect(await screen.findByText(/no Urdu voice/i)).toBeInTheDocument()
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('English replies use an English voice', async () => {
    assistantApi.spokenVersion.mockResolvedValue({ data: { spoken: 'The register is ready.' } })
    script([finalWith('The register is ready.')])
    await open()
    await askByVoice()
    await waitFor(() => expect(synth.speak).toHaveBeenCalled())
    expect(synth.speak.mock.calls[0][0].voice).toBe(EN_VOICE)
  })

  it('if the short version fails, an English reply is read from its first line', async () => {
    assistantApi.spokenVersion.mockRejectedValue(new Error('busy'))
    script([finalWith('First line.\nSecond line with a long table.')])
    await open()
    await askByVoice()
    await waitFor(() => expect(synth.speak).toHaveBeenCalled())
    expect(synth.speak.mock.calls[0][0].text).toBe('First line.')
  })

  it('if the short version fails for an Urdu-script reply, nothing is read (no guessing)', async () => {
    assistantApi.spokenVersion.mockRejectedValue(new Error('busy'))
    script([finalWith('رجسٹر تیار ہے')])
    await open()
    await askByVoice()
    await screen.findByText('رجسٹر تیار ہے')
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('Listen on a message reads that reply on request', async () => {
    script([finalWith('Hello there.')])
    await open()
    await userEvent.type(screen.getByLabelText('Message'), 'hi{Enter}')
    await screen.findByText('Hello there.')
    await userEvent.click(screen.getByRole('button', { name: 'Listen to this reply' }))
    await waitFor(() => expect(assistantApi.spokenVersion).toHaveBeenCalledWith('Hello there.'))
    await waitFor(() => expect(synth.speak).toHaveBeenCalled())
  })

  it('without speech support there is no Listen button or Aloud switch, but the mic still works', async () => {
    delete window.speechSynthesis
    script([finalWith('Hello there.')])
    await open()
    await userEvent.type(screen.getByLabelText('Message'), 'hi{Enter}')
    await screen.findByText('Hello there.')
    expect(screen.queryByRole('button', { name: 'Listen to this reply' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Aloud/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Speak your message' })).toBeInTheDocument()
  })

  it('sending a new message stops whatever is being read', async () => {
    script([finalWith('One.', 1)])
    await open()
    await askByVoice()
    await waitFor(() => expect(synth.speak).toHaveBeenCalled())
    synth.cancel.mockClear()
    await userEvent.type(screen.getByLabelText('Message'), 'next{Enter}')
    expect(synth.cancel).toHaveBeenCalled()
  })

  it('a card is never approved by voice: the only way to approve is the button', async () => {
    script([{ type: 'card', action: { id: 9, status: 'pending', can_act: true, preview: { kind: 'attendance', title: 'Mark attendance', summary: 's', columns: ['Student'], rows: [], warnings: [] } } },
      finalWith('Review the card.')])
    await open()
    await askByVoice()
    await screen.findByText('Review the card.')
    expect(assistantApi.approveAction).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()     // still waiting for a tap
  })
})
