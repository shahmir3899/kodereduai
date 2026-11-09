import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeedbackThumbs from '../FeedbackThumbs'
import { assistantApi } from '../../../services/assistantApi'

vi.mock('../../../services/assistantApi', () => ({ assistantApi: { sendFeedback: vi.fn() } }))

describe('FeedbackThumbs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows nothing without a message id', () => {
    const { container } = render(<FeedbackThumbs messageId={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('sends the rating and thanks the user', async () => {
    assistantApi.sendFeedback.mockResolvedValue({})
    render(<FeedbackThumbs messageId={7} />)
    await userEvent.click(screen.getByRole('button', { name: 'Not helpful' }))
    expect(assistantApi.sendFeedback).toHaveBeenCalledWith({ message_id: 7, rating: -1 })
    expect(await screen.findByText(/Thanks/)).toBeInTheDocument()
  })

  it('lets the user retry when sending fails', async () => {
    assistantApi.sendFeedback.mockRejectedValue(new Error('x'))
    render(<FeedbackThumbs messageId={7} />)
    await userEvent.click(screen.getByRole('button', { name: 'Helpful' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Helpful' })).toBeInTheDocument()
  })
})
