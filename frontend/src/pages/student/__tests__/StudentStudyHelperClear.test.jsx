import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import StudentStudyHelper from '../StudentStudyHelper'
import { ToastProvider } from '../../../components/Toast'

const page = () => <ToastProvider><StudentStudyHelper /></ToastProvider>

// jsdom has no scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

const clearHistory = vi.fn().mockResolvedValue({ data: { deleted: 2 } })

vi.mock('../../../services/api', () => ({
  studentPortalApi: {
    getStudyHelperHistory: () => Promise.resolve({ data: [
      { id: 1, role: 'user', content: 'Hello', created_at: '2026-10-28T09:00:00Z' },
      { id: 2, role: 'assistant', content: 'Hi there', created_at: '2026-10-28T09:00:05Z' },
    ] }),
    clearStudyHelperHistory: (...a) => clearHistory(...a),
  },
}))

describe('Study Helper Clear Chat', () => {
  it('asks first, then clears and shows a toast', async () => {
    renderWithProviders(page())
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Chat' }))
    // nothing is deleted until the question is answered
    expect(clearHistory).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Clear chat' }))
    await waitFor(() => expect(clearHistory).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Chat cleared')).toBeInTheDocument()
  })

  it('keeps the chat when the question is cancelled', async () => {
    clearHistory.mockClear()
    renderWithProviders(page())
    fireEvent.click(await screen.findByRole('button', { name: 'Clear Chat' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Clear chat' })).toBeNull())
    expect(clearHistory).not.toHaveBeenCalled()
    expect(screen.getByText('Hi there')).toBeInTheDocument()
  })
})
