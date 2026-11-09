import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'

vi.mock('../../../services/assistantApi', () => ({
  assistantApi: {
    capabilities: vi.fn(),
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    getMessages: vi.fn(),
    approveAction: vi.fn(),
    rejectAction: vi.fn(),
    editAction: vi.fn(),
  },
  streamMessage: vi.fn(),
}))

import { assistantApi, streamMessage } from '../../../services/assistantApi'
import AssistantOrb from '../AssistantOrb'
import { splitBlocks } from '../RichText'

const CAPS = {
  agents: [{ name: 'finance', label: 'Finance', tools: 20, can_write: true }],
  suggestions: [],
  memory_limit: 10,
}
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString()
const LIST = [
  { id: 1, title: 'Old chat', pinned: false, last_active: iso(5) },
  { id: 2, title: 'Pinned chat', pinned: true, last_active: iso(9) },
  { id: 3, title: 'Newest chat', pinned: false, last_active: iso(0) },
]
const MEMORY = { used: 2, limit: 10 }

async function openPanel() {
  renderWithProviders(<AssistantOrb />)
  await userEvent.click(await screen.findByRole('button', { name: 'Open Aura' }))
}

beforeEach(() => {
  window.localStorage.setItem('assistant_beta', '1')
  assistantApi.capabilities.mockResolvedValue({ data: CAPS })
  assistantApi.listConversations.mockResolvedValue({ data: LIST })
  assistantApi.getMessages.mockResolvedValue({ data: { messages: [], actions: [], memory: MEMORY } })
})
afterEach(() => { window.localStorage.clear(); vi.clearAllMocks() })

describe('past conversations', () => {
  it('lists pinned first, then newest, and opens the one you pick', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    const titles = (await screen.findAllByText(/^(Pinned|Newest|Old) chat$/)).map((n) => n.textContent)
    expect(titles).toEqual(['Pinned chat', 'Newest chat', 'Old chat'])

    assistantApi.getMessages.mockClear()
    await userEvent.click(screen.getByText('Old chat'))
    await waitFor(() => expect(assistantApi.getMessages).toHaveBeenCalledWith(1))
    expect(screen.queryByTestId('history-list')).toBeNull()
  })

  it('pins a conversation', async () => {
    assistantApi.updateConversation.mockResolvedValue({ data: {} })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Pin Old chat' }))
    expect(assistantApi.updateConversation).toHaveBeenCalledWith(1, { pinned: true })
  })

  it('asks once before deleting, and Keep cancels', async () => {
    assistantApi.deleteConversation.mockResolvedValue({})
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Old chat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(assistantApi.deleteConversation).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Delete Old chat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(assistantApi.deleteConversation).toHaveBeenCalledWith(1))
  })

  it('says so when there is nothing yet, and when loading fails', async () => {
    assistantApi.listConversations.mockResolvedValue({ data: [] })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument()
  })

  it('Back returns to the chat', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: 'History' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Back' }))
    expect(screen.queryByTestId('history-list')).toBeNull()
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
  })
})

describe('tables in answers', () => {
  const TABLE = 'Pending fees:\n| Student | Amount |\n|---|---:|\n| Ahmad | 1,500 |\n| Sana | 2,000 |\nTotal 3,500.'

  it('splits a markdown table from the text around it', () => {
    const blocks = splitBlocks(TABLE)
    expect(blocks.map((b) => b.type)).toEqual(['text', 'table', 'text'])
    expect(blocks[1].head).toEqual(['Student', 'Amount'])
    expect(blocks[1].rows).toEqual([['Ahmad', '1,500'], ['Sana', '2,000']])
  })

  it('leaves text with no table, and a lone pipe line, exactly as written', () => {
    expect(splitBlocks('a | b | c').map((b) => b.type)).toEqual(['text'])
    expect(splitBlocks('| only one row |').map((b) => b.type)).toEqual(['text'])
  })

  it('draws the table in a reply', async () => {
    streamMessage.mockImplementation(async (_id, _msg, onEvent) => {
      onEvent({ type: 'final', content: TABLE, memory: MEMORY, sub_agents: [], tool_calls: [],
        message: { id: 9, role: 'assistant', content: TABLE, sub_agents: [], tool_calls: [], actions: [] } })
    })
    assistantApi.createConversation.mockResolvedValue({ data: { id: 3 } })
    await openPanel()
    await userEvent.type(screen.getByLabelText('Message'), 'fees{Enter}')
    expect(await screen.findByRole('columnheader', { name: 'Amount' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByRole('cell', { name: '1,500' })).toBeInTheDocument()
    expect(screen.getByText('Total 3,500.')).toBeInTheDocument()
  })
})

describe('marks card', () => {
  it('shows each mark, Absent for an absent student, and offers editing', async () => {
    const card = {
      id: 31, status: 'pending', can_act: true,
      preview: { kind: 'marks_entry', title: 'Enter marks', summary: 'Mid Term, Maths (out of 50): 2 student(s)', columns: ['Student', 'Now', 'Marks'],
        rows: [{ student_id: 1, student: 'Ali Raza', was: '—', marks: 40, absent: false }, { student_id: 2, student: 'Sara Khan', was: '—', marks: null, absent: true }],
        totals: { count: 2, average: 40 }, warnings: [] },
    }
    streamMessage.mockImplementation(async (_id, _msg, onEvent) => {
      onEvent({ type: 'final', content: 'Check the card.', memory: MEMORY, sub_agents: ['exams'], tool_calls: [],
        message: { id: 9, role: 'assistant', content: 'Check the card.', sub_agents: ['exams'], tool_calls: [], actions: [card] } })
    })
    assistantApi.createConversation.mockResolvedValue({ data: { id: 3 } })
    await openPanel()
    await userEvent.type(screen.getByLabelText('Message'), 'marks{Enter}')
    expect(await screen.findByText('Ali Raza')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('Absent')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })
})
