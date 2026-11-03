import { describe, it, expect } from 'vitest'
import { bankSummary, maskAccountNumber } from './bankDetails'

describe('maskAccountNumber', () => {
  it('keeps only the last four characters', () => {
    expect(maskAccountNumber('0123-4567 8901')).toBe('••••8901')
    expect(maskAccountNumber('PK36HABB0000012345678901')).toBe('••••8901')
  })

  it('is empty when there is no number', () => {
    expect(maskAccountNumber('')).toBe('')
    expect(maskAccountNumber(undefined)).toBe('')
    expect(maskAccountNumber(' - ')).toBe('')
  })
})

describe('bankSummary', () => {
  it('joins the bank name and the masked number', () => {
    expect(bankSummary({ bank_name: 'HBL', account_number: '0123-4567 8901' })).toBe('HBL ••••8901')
  })

  it('still works when the server hid the number from this role', () => {
    expect(bankSummary({ bank_name: 'HBL' })).toBe('HBL')
  })

  it('is empty for an account with no bank details', () => {
    expect(bankSummary({ name: 'Petty Cash' })).toBe('')
    expect(bankSummary(null)).toBe('')
  })
})
