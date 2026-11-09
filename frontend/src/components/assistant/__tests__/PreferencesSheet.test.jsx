import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../../test/utils'

vi.mock('../../../services/assistantApi', () => ({
  assistantApi: { getPreferences: vi.fn(), updatePreferences: vi.fn() },
}))

import { assistantApi } from '../../../services/assistantApi'
import PreferencesSheet from '../PreferencesSheet'

const DATA = {
  preferences: { language: 'roman', default_class: '5A' },
  languages: { auto: 'x', en: 'x', ur: 'x', roman: 'x' },
  accounts: [{ id: 3, name: 'Cash' }],
}

describe('PreferencesSheet', () => {
  beforeEach(() => {
    assistantApi.getPreferences.mockResolvedValue({ data: DATA })
    assistantApi.updatePreferences.mockResolvedValue({ data: DATA })
  })

  it('shows the saved values and saves changes, clearing an emptied class', async () => {
    renderWithProviders(<PreferencesSheet onClose={() => {}} />)
    const cls = await screen.findByDisplayValue('5A')
    await userEvent.clear(cls)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(assistantApi.updatePreferences).toHaveBeenCalledWith({ language: 'roman', default_class: '', default_account_id: '' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved')
  })

  it('shows the server message when a class is refused', async () => {
    assistantApi.updatePreferences.mockRejectedValue({ response: { data: { error: 'No class matching "9Z" in the current academic year.' } } })
    renderWithProviders(<PreferencesSheet onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No class matching "9Z"')
  })
})
