import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useStudentSelection } from '../useStudentSelection'

const selectable = [{ id: 1 }, { id: 2 }, { id: 3 }]

describe('useStudentSelection', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useStudentSelection(selectable))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('toggles one student on and off', () => {
    const { result } = renderHook(() => useStudentSelection(selectable))
    act(() => result.current.toggle(2))
    expect([...result.current.selectedIds]).toEqual([2])
    act(() => result.current.toggle(2))
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('selects everyone selectable, then clears on the second press', () => {
    const { result } = renderHook(() => useStudentSelection(selectable))
    act(() => result.current.toggleAll())
    expect([...result.current.selectedIds].sort()).toEqual([1, 2, 3])
    act(() => result.current.toggleAll())
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('selects all when only some are selected', () => {
    const { result } = renderHook(() => useStudentSelection(selectable))
    act(() => result.current.toggle(1))
    act(() => result.current.toggleAll())
    expect(result.current.selectedIds.size).toBe(3)
  })

  it('does nothing harmful when there is nobody to select', () => {
    const { result } = renderHook(() => useStudentSelection([]))
    act(() => result.current.toggleAll())
    expect(result.current.selectedIds.size).toBe(0)
  })

  it('clear empties the selection', () => {
    const { result } = renderHook(() => useStudentSelection(selectable))
    act(() => result.current.toggle(1))
    act(() => result.current.clear())
    expect(result.current.selectedIds.size).toBe(0)
  })
})
