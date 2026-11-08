import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'

vi.mock('../../../services/assistantApi', () => ({
  assistantApi: {
    capabilities: vi.fn(),
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    getMessages: vi.fn(),
    approveAction: vi.fn(),
    rejectAction: vi.fn(),
    editAction: vi.fn(),
  },
  streamMessage: vi.fn(),
}))

import { assistantApi, streamMessage } from '../../../services/assistantApi'
import AssistantOrb from '../AssistantOrb'

const CAPS = {
  agents: [{ name: 'attendance', label: 'Attendance', tools: 4, can_write: true }, { name: 'finance', label: 'Finance', tools: 20, can_write: true }],
  suggestions: ['Which classes have not marked attendance today?', 'Class 5A ki hazri lagao'],
  memory_limit: 10,
}

const pendingCard = (over = {}) => ({
  id: 21, status: 'pending', can_act: true,
  preview: { kind: 'attendance', title: 'Mark attendance', summary: 'Class 5A: 1 absent', columns: ['Student', 'Now', 'Will be'],
    rows: [{ student_id: 5, student: 'Ali Raza', was: 'NOT MARKED', status: 'ABSENT' }], totals: { count: 1 }, warnings: [] },
  ...over,
})

const script = (events) => streamMessage.mockImplementation(async (_id, _msg, onEvent) => { events.forEach((e) => onEvent(e)) })

const finalWith = (content, extra = {}) => ({
  type: 'final', content, memory: { used: 2, limit: 10 }, sub_agents: ['attendance'], tool_calls: [],
  message: { id: 99, role: 'assistant', content, sub_agents: ['attendance'], tool_calls: extra.tool_calls || [], actions: extra.actions || [] },
})

async function openOrb() {
  renderWithProviders(<AssistantOrb />)
  await userEvent.click(await screen.findByRole('button', { name: 'Open assistant' }))
}

beforeEach(() => {
  window.localStorage.setItem('assistant_beta', '1')
  assistantApi.capabilities.mockResolvedValue({ data: CAPS })
  assistantApi.listConversations.mockResolvedValue({ data: [] })
  assistantApi.createConversation.mockResolvedValue({ data: { id: 3 } })
})
afterEach(() => { window.localStorage.clear(); vi.clearAllMocks() })

describe('AssistantOrb visibility', () => {
  it('is absent and silent when the assistant is switched off', async () => {
    window.localStorage.setItem('assistant_beta', '0')
    renderWithProviders(<AssistantOrb />)
    expect(screen.queryByRole('button', { name: /assistant/i })).toBeNull()
    expect(assistantApi.capabilities).not.toHaveBeenCalled()
  })

  it('is absent for a user whose role has no tools', async () => {
    assistantApi.capabilities.mockResolvedValue({ data: { agents: [], suggestions: [] } })
    renderWithProviders(<AssistantOrb />)
    await waitFor(() => expect(assistantApi.capabilities).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /assistant/i })).toBeNull()
  })

  it('appears for a user with tools', async () => {
    renderWithProviders(<AssistantOrb />)
    expect(await screen.findByRole('button', { name: 'Open assistant' })).toBeInTheDocument()
  })
})

describe('AssistantOrb panel', () => {
  it('opens with the agents, starter prompts and an empty memory counter', async () => {
    await openOrb()
    expect(screen.getByRole('dialog', { name: 'Assistant' })).toBeInTheDocument()
    expect(screen.getByLabelText('Memory 0 of 10 messages')).toHaveTextContent('0/10')
    expect(screen.getByText('Class 5A ki hazri lagao')).toBeInTheDocument()
    expect(screen.getByText('Finance')).toBeInTheDocument()
  })

  it('a starter prompt sends, shows the answer, and the trail folds into one line', async () => {
    script([
      { type: 'start', memory: { used: 1, limit: 10 } },
      { type: 'route', agents: ['attendance'] },
      { type: 'step', phase: 'start', index: 0, name: 'get_unmarked_attendance', sub_agent: 'attendance', kind: 'read', label: 'Unmarked attendance' },
      { type: 'step', phase: 'end', index: 0, ok: true },
      finalWith('All classes have marked attendance.', { tool_calls: [{ name: 'get_unmarked_attendance', sub_agent: 'attendance', ok: true }] }),
    ])
    await openOrb()
    await userEvent.click(screen.getByText('Which classes have not marked attendance today?'))
    expect(await screen.findByText('All classes have marked attendance.')).toBeInTheDocument()
    expect(streamMessage).toHaveBeenCalledWith(3, 'Which classes have not marked attendance today?', expect.any(Function), expect.anything())
    expect(screen.getByRole('button', { name: /1 step/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Memory 2 of 10 messages')).toHaveTextContent('2/10')
    expect(screen.getByText('Attendance', { selector: 'span.rounded-full' })).toBeInTheDocument()
  })

  it('Enter sends, Shift+Enter does not', async () => {
    script([finalWith('ok')])
    await openOrb()
    const box = screen.getByLabelText('Message')
    await userEvent.type(box, 'hello{Shift>}{Enter}{/Shift}')
    expect(streamMessage).not.toHaveBeenCalled()
    await userEvent.type(box, '{Enter}')
    await waitFor(() => expect(streamMessage).toHaveBeenCalledTimes(1))
    expect(box).toHaveValue('')
  })

  it('shows the live trail while the assistant is working', async () => {
    let release
    streamMessage.mockImplementation((_id, _m, onEvent) => new Promise((resolve) => {
      onEvent({ type: 'route', agents: ['finance'] })
      onEvent({ type: 'step', phase: 'start', index: 0, name: 'get_balance', sub_agent: 'finance', kind: 'read', label: 'Balance' })
      release = () => { onEvent(finalWith('Done')); resolve() }
    }))
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'balance{Enter}')
    expect(await screen.findByTestId('live-trail')).toHaveTextContent(/Working on it · Finance/)
    expect(screen.getByText('Balance')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    release()
    expect(await screen.findByText('Done')).toBeInTheDocument()
    expect(screen.queryByTestId('live-trail')).toBeNull()
  })

  it('shows an error line when the stream fails', async () => {
    script([{ type: 'error', message: 'The assistant hit an error. Please try again.' }])
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('hit an error')
  })

  it('shows the server reason when the request itself is refused', async () => {
    streamMessage.mockRejectedValue(new Error('Daily message limit reached.'))
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Daily message limit reached.')
  })

  it('loads the latest conversation when the panel opens', async () => {
    assistantApi.listConversations.mockResolvedValue({ data: [{ id: 8 }] })
    assistantApi.getMessages.mockResolvedValue({ data: {
      messages: [{ id: 1, role: 'user', content: 'earlier question', actions: [], tool_calls: [] }, { id: 2, role: 'assistant', content: 'earlier answer', actions: [], tool_calls: [], sub_agents: [] }],
      memory: { used: 2, limit: 10 },
    } })
    await openOrb()
    expect(await screen.findByText('earlier answer')).toBeInTheDocument()
    expect(screen.getByLabelText('Memory 2 of 10 messages')).toBeInTheDocument()
  })

  it('New chat clears the conversation and starts a fresh one on the next message', async () => {
    script([finalWith('first answer')])
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'one{Enter}')
    await screen.findByText('first answer')
    await userEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(screen.queryByText('first answer')).toBeNull()
    assistantApi.createConversation.mockResolvedValue({ data: { id: 4 } })
    script([finalWith('second answer')])
    await userEvent.type(screen.getByLabelText('Message'), 'two{Enter}')
    await screen.findByText('second answer')
    expect(streamMessage).toHaveBeenLastCalledWith(4, 'two', expect.any(Function), expect.anything())
  })

  it('Escape minimises the panel', async () => {
    await openOrb()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('AssistantOrb cards', () => {
  it('approving a card updates it and the badge count goes away', async () => {
    script([{ type: 'card', action: pendingCard() }, finalWith('Review the card.', { actions: [pendingCard()] })])
    assistantApi.approveAction.mockResolvedValue({ data: pendingCard({ status: 'executed', can_act: false, result: { saved: 1 } }) })
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'mark ali absent{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(assistantApi.approveAction).toHaveBeenCalledWith(21)
    expect(await screen.findByText(/saved 1/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })

  it('a minimised orb shows how many changes still wait for approval', async () => {
    script([finalWith('Review.', { actions: [pendingCard()] })])
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'mark{Enter}')
    await screen.findByText('Review.')
    await userEvent.click(screen.getByRole('button', { name: 'Minimise' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByLabelText('1 waiting for approval')).toBeInTheDocument()
  })

  it('when the data changed, the refreshed card replaces the old one and the reason is shown', async () => {
    script([finalWith('Review.', { actions: [pendingCard()] })])
    const refreshed = pendingCard({ status: 'edited', preview: { ...pendingCard().preview, summary: 'Class 5A: 2 absent' } })
    assistantApi.approveAction.mockRejectedValue({ response: { status: 409, data: { error: 'The data changed since this card was prepared.', code: 'changed', action: refreshed } } })
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'mark{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('Class 5A: 2 absent')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('data changed')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('rejecting marks the card rejected', async () => {
    script([finalWith('Review.', { actions: [pendingCard()] })])
    assistantApi.rejectAction.mockResolvedValue({ data: pendingCard({ status: 'rejected', can_act: false }) })
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'mark{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }))
    expect(await screen.findByText('rejected')).toBeInTheDocument()
  })

  it('an edit goes to the server and the updated card is shown', async () => {
    script([finalWith('Review.', { actions: [pendingCard()] })])
    const updated = pendingCard({ status: 'edited', preview: { ...pendingCard().preview, summary: 'Class 5A: 1 leave' } })
    assistantApi.editAction.mockResolvedValue({ data: updated })
    await openOrb()
    await userEvent.type(screen.getByLabelText('Message'), 'mark{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    await userEvent.selectOptions(screen.getByLabelText('Status for Ali Raza'), 'LEAVE')
    await userEvent.click(screen.getByRole('button', { name: 'Update card' }))
    await waitFor(() => expect(assistantApi.editAction).toHaveBeenCalledWith(21, { statuses: { 5: 'LEAVE' } }))
    expect(await screen.findByText('Class 5A: 1 leave')).toBeInTheDocument()
  })
})
