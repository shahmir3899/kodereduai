import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import InventoryItemsPage from '../InventoryItemsPage'
import ToastProvider from '../../../components/Toast'

let mockRole = 'ACCOUNTANT'
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 2, role: mockRole }, effectiveRole: mockRole, activeSchool: { id: 1 } }),
}))

const page = (results) => Promise.resolve({ data: { results } })
vi.mock('../../../services/api', () => ({
  inventoryApi: {
    getItems: () => page([{ id: 1, name: 'Chalk Box', current_stock: 0, minimum_stock: 5, unit: 'BOX', unit_price: 120 }]),
    getCategories: () => page([]),
    getVendors: () => page([]),
  },
}))

describe('Inventory Items write controls', () => {
  it('are hidden from an accountant, who can only read', async () => {
    mockRole = 'ACCOUNTANT'
    renderWithProviders(<ToastProvider><InventoryItemsPage /></ToastProvider>)
    await waitFor(() => expect(screen.getByText('Chalk Box')).toBeInTheDocument())
    expect(screen.queryByText('+ Add Item')).not.toBeInTheDocument()
    expect(screen.queryByText('AI Suggest')).not.toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.queryByText('Delete')).not.toBeInTheDocument()
  })

  it('stay visible for a school admin', async () => {
    mockRole = 'SCHOOL_ADMIN'
    renderWithProviders(<ToastProvider><InventoryItemsPage /></ToastProvider>)
    await waitFor(() => expect(screen.getByText('+ Add Item')).toBeInTheDocument())
    expect(screen.getByText('AI Suggest')).toBeInTheDocument()
  })
})
