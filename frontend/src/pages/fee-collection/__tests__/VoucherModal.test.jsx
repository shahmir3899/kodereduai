import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../../../test/utils'
import VoucherModal from '../VoucherModal'
import { financeApi } from '../../../services/api'

vi.mock('../../../services/api', () => ({
  financeApi: {
    getVoucherSettings: vi.fn(),
    updateVoucherSettings: vi.fn(),
    downloadFeeVouchers: vi.fn(),
  },
}))

const settings = {
  due_day: 10, voucher_bank_account_id: null, voucher_note: '', kuickpay_enabled: false,
  bank_accounts: [{ id: 3, name: 'HBL', account_number: '1234' }],
}

describe('VoucherModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    financeApi.getVoucherSettings.mockResolvedValue({ data: settings })
    global.URL.createObjectURL = vi.fn(() => 'blob:x')
    global.URL.revokeObjectURL = vi.fn()
  })

  it('downloads vouchers for the selected students of the month', async () => {
    financeApi.downloadFeeVouchers.mockResolvedValue({ data: new Blob(['%PDF']), headers: { 'x-voucher-count': '2' } })
    const onClose = vi.fn()
    renderWithProviders(
      <VoucherModal open onClose={onClose} month={11} year={2026} studentIds={[5, 7]} scopeParams={{ academic_year: 1 }} scopeLabel="Class 1" canEditSettings />,
    )
    expect(screen.getByText('2 selected')).toBeInTheDocument()
    await waitFor(() => expect(financeApi.getVoucherSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    // due_date is added too (school due day, or a week from today once it has passed).
    expect(financeApi.downloadFeeVouchers).toHaveBeenCalledWith(expect.objectContaining({
      month: 11, year: 2026, only_unpaid: 1, academic_year: 1, student_ids: '5,7',
    }))
  })

  it('says so when nobody owes anything', async () => {
    financeApi.downloadFeeVouchers.mockResolvedValue({ data: new Blob(['%PDF']), headers: { 'x-voucher-count': '0' } })
    renderWithProviders(
      <VoucherModal open onClose={vi.fn()} month={11} year={2026} studentIds={null} scopeParams={{}} scopeLabel="All Classes" canEditSettings />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }))
    expect(await screen.findByText(/nobody in this list owes anything/)).toBeInTheDocument()
  })

  it('saves a new due day before printing', async () => {
    financeApi.updateVoucherSettings.mockResolvedValue({ data: { ...settings, due_day: 15 } })
    renderWithProviders(
      <VoucherModal open onClose={vi.fn()} month={11} year={2026} studentIds={null} scopeParams={{}} scopeLabel="All" canEditSettings />,
    )
    const dueDay = await screen.findByLabelText('Due day of the month')
    await waitFor(() => expect(dueDay).toHaveValue('10'))
    fireEvent.change(dueDay, { target: { value: '15' } })
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(financeApi.updateVoucherSettings).toHaveBeenCalledWith({
      due_day: 15, voucher_bank_account_id: null, voucher_note: '',
    }))
  })

  it('settings are read-only for non-admins', async () => {
    renderWithProviders(
      <VoucherModal open onClose={vi.fn()} month={11} year={2026} studentIds={null} scopeParams={{}} scopeLabel="All" canEditSettings={false} />,
    )
    expect(await screen.findByLabelText('Due day of the month')).toBeDisabled()
  })
})
