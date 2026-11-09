import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'

vi.mock('../../../services/assistantApi', () => ({
  assistantApi: {
    capabilities: vi.fn(), listConversations: vi.fn(), createConversation: vi.fn(), getMessages: vi.fn(),
    approveAction: vi.fn(), rejectAction: vi.fn(), editAction: vi.fn(), transcribe: vi.fn(), spokenVersion: vi.fn(),
  },
  streamMessage: vi.fn(),
}))

import { assistantApi } from '../../../services/assistantApi'
import AssistantOrb from '../AssistantOrb'
import { buildWelcome, welcomeLanguage } from '../welcomeText'

const STAFF = [
  { name: 'attendance', label: 'Attendance', can_write: true },
  { name: 'exams', label: 'Exams', can_write: true },
  { name: 'finance', label: 'Finance', can_write: false },
]
const PARENT = [{ name: 'family', label: 'My children', can_write: false }]
const caps = (agents) => ({ agents, suggestions: [], memory_limit: 10, voice: { enabled: false, max_seconds: 60 } })

let synth
function installSpeech(voices) {
  synth = { speak: vi.fn(), cancel: vi.fn(), getVoices: () => voices, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true })
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
}
const EN = { lang: 'en-US', name: 'English' }
const UR = { lang: 'ur-PK', name: 'Urdu' }

describe('buildWelcome', () => {
  it('tells a staff role it can prepare changes, in English', () => {
    const text = buildWelcome(STAFF, 'en')
    expect(text).toContain("I'm Aura")
    expect(text).toContain('Attendance, Exams and Finance')
    expect(text).toContain('you always approve them')
  })

  it('never mentions changes to a read-only role', () => {
    const text = buildWelcome(PARENT, 'en')
    expect(text).toContain('My children')
    expect(text).not.toMatch(/approve|changes/i)
  })

  it('writes Urdu in Urdu script, with the approval line only for staff', () => {
    const staff = buildWelcome(STAFF, 'ur')
    expect(staff).toMatch(/[؀-ۿ]/)
    expect(staff).not.toMatch(/Attendance/)
    expect(staff).toContain('منظوری')
    expect(buildWelcome(PARENT, 'ur')).not.toContain('منظوری')
  })

  it('names at most four areas, and nothing when there are none', () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ name: n, label: n.toUpperCase(), can_write: false }))
    expect(buildWelcome(many, 'en')).toContain('A, B, C, D and more')
    expect(buildWelcome([], 'en')).toBe('')
  })

  it('picks the language from the saved choice, else the browser', () => {
    expect(welcomeLanguage('ur')).toBe('ur')
    expect(welcomeLanguage(null)).toBe('en')
  })
})

describe('welcome in the orb', () => {
  let user
  beforeEach(() => {
    user = userEvent.setup()
    window.localStorage.setItem('assistant_beta', '1')
    installSpeech([EN, UR])
    assistantApi.capabilities.mockResolvedValue({ data: caps(STAFF) })
    assistantApi.listConversations.mockResolvedValue({ data: [] })
    assistantApi.createConversation.mockResolvedValue({ data: { id: 3 } })
  })
  afterEach(() => { window.localStorage.clear(); vi.clearAllMocks() })

  const open = async () => user.click(await screen.findByRole('button', { name: 'Open Aura' }))

  it('does not speak on page load', async () => {
    renderWithProviders(<AssistantOrb userId={7} />)
    await screen.findByRole('button', { name: 'Open Aura' })
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('speaks once when the panel is first opened, shows the same words, and not again', async () => {
    renderWithProviders(<AssistantOrb userId={7} />)
    await open()
    await screen.findByTestId('assistant-welcome')
    expect(synth.speak).toHaveBeenCalledTimes(1)
    expect(synth.speak.mock.calls[0][0].text).toContain("I'm Aura")
    expect(screen.getByTestId('assistant-welcome').textContent).toContain("I'm Aura")
    expect(window.localStorage.getItem('assistant_welcome_heard_7')).toBe('1')

    await user.click(screen.getByRole('button', { name: 'Minimise Aura' }))
    await user.click(await screen.findByRole('button', { name: 'Open Aura' }))
    expect(synth.speak).toHaveBeenCalledTimes(1)
  })

  it('does not auto-play for a user who has heard it, but the button replays it', async () => {
    window.localStorage.setItem('assistant_welcome_heard_7', '1')
    renderWithProviders(<AssistantOrb userId={7} />)
    await open()
    await user.click(await screen.findByRole('button', { name: 'Hear what Aura can do' }))
    expect(synth.speak).toHaveBeenCalledTimes(1)
  })

  it('speaks Urdu with the Urdu voice after the language switch', async () => {
    window.localStorage.setItem('assistant_welcome_heard_7', '1')
    renderWithProviders(<AssistantOrb userId={7} />)
    await open()
    await user.click(await screen.findByRole('button', { name: 'Switch the welcome to Urdu' }))
    await user.click(screen.getByRole('button', { name: 'Hear what Aura can do' }))
    const spoken = synth.speak.mock.calls[0][0]
    expect(spoken.text).toMatch(/[؀-ۿ]/)
    expect(spoken.voice.lang).toBe('ur-PK')
    expect(window.localStorage.getItem('assistant_welcome_lang')).toBe('ur')
  })

  it('Skip stops the speech', async () => {
    renderWithProviders(<AssistantOrb userId={7} />)
    await open()
    await user.click(await screen.findByRole('button', { name: 'Skip' }))
    expect(synth.cancel).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Hear what Aura can do' })).toBeTruthy()
  })

  it('shows text only, and no play button, when speech is not supported', async () => {
    delete window.speechSynthesis
    delete window.SpeechSynthesisUtterance
    renderWithProviders(<AssistantOrb userId={7} />)
    await open()
    expect((await screen.findByTestId('assistant-welcome')).textContent).toContain("I'm Aura")
    expect(screen.queryByRole('button', { name: 'Hear what Aura can do' })).toBeNull()
  })

  it('shows nothing when the assistant has nothing to offer', async () => {
    assistantApi.capabilities.mockResolvedValue({ data: caps([]) })
    renderWithProviders(<AssistantOrb userId={7} />)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Open Aura' })).toBeNull()
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('stays silent without a voice for the language, with no error banner', async () => {
    installSpeech([UR])
    renderWithProviders(<AssistantOrb userId={7} />)
    await open()
    await screen.findByTestId('assistant-welcome')
    expect(synth.speak).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
