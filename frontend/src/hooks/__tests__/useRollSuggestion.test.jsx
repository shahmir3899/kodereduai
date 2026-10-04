import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRollSuggestion } from '../useRollSuggestion'

const setup = (overrides = {}) => {
  const onAutoFill = vi.fn()
  const props = {
    enabled: true,
    hasClass: true,
    occupiedRolls: ['1', '2', '4'],
    currentRoll: '',
    manuallyEdited: false,
    onAutoFill,
    ...overrides,
  }
  const hook = renderHook((p) => useRollSuggestion(p), { initialProps: props })
  return { ...hook, onAutoFill, props }
}

describe('useRollSuggestion', () => {
  it('recommends the first free roll and auto-fills an empty field', () => {
    const { result, onAutoFill } = setup()
    expect(result.current.recommendedRoll).toBe('3')
    expect(onAutoFill).toHaveBeenCalledWith('3')
  })

  it('does not overwrite a roll that is already filled in', () => {
    const { result, onAutoFill } = setup({ currentRoll: '9' })
    expect(result.current.recommendedRoll).toBe('3')
    expect(onAutoFill).not.toHaveBeenCalled()
  })

  it('does not auto-fill after the user edited the roll themselves', () => {
    const { onAutoFill } = setup({ manuallyEdited: true })
    expect(onAutoFill).not.toHaveBeenCalled()
  })

  it('recommends nothing without a class or when disabled', () => {
    expect(setup({ hasClass: false }).result.current.recommendedRoll).toBe('')
    expect(setup({ enabled: false }).result.current.recommendedRoll).toBe('')
  })

  it('does not re-fire for a new array with the same contents', () => {
    const { rerender, onAutoFill, props } = setup()
    rerender({ ...props, occupiedRolls: ['1', '2', '4'] })
    expect(onAutoFill).toHaveBeenCalledTimes(1)
  })

  it('updates the recommendation when the occupied rolls change', () => {
    const { result, rerender, props } = setup()
    rerender({ ...props, occupiedRolls: ['1', '2', '3', '4'] })
    expect(result.current.recommendedRoll).toBe('5')
  })

  it('ignores non-numeric rolls when picking the next one', () => {
    expect(setup({ occupiedRolls: ['A1', '1'] }).result.current.recommendedRoll).toBe('2')
  })
})
