import { describe, expect, it } from 'vitest'
import { matchingFromComposer, matchingProblem, matchingToComposer } from '../matchingData'

describe('matching data (composer text pairs <-> the server shape)', () => {
  it('saves complete pairs as left_items, right_items and index pairs', () => {
    const out = matchingFromComposer({ pairs: [{ left: 'Fish', right: 'Water' }, { left: ' ', right: 'x' }, { left: 'Bird', right: ' Nest ' }] })
    expect(out).toEqual({
      left_items: ['Fish', 'Bird'],
      right_items: ['Water', 'Nest'],
      pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }],
    })
    expect(out).not.toHaveProperty('extra_left')
  })

  it('opens a saved question as text pairs and keeps unmatched items so saving does not drop them', () => {
    const saved = {
      left_items: ['Fish', 'Bird', 'Bee'], right_items: ['Nest', 'Water', 'Hive', 'Cave'],
      pairs: [{ left: 0, right: 1 }, { left: 1, right: 0 }, { left: 2, right: 2 }],
    }
    const composer = matchingToComposer(saved)
    expect(composer.pairs).toEqual([{ left: 'Fish', right: 'Water' }, { left: 'Bird', right: 'Nest' }, { left: 'Bee', right: 'Hive' }])
    expect(composer.extra_right).toEqual(['Cave'])
    expect(composer.extra_left).toEqual([])
    expect(composer).not.toHaveProperty('left_items', expect.anything())
    const again = matchingFromComposer(composer)
    expect(again.left_items).toEqual(['Fish', 'Bird', 'Bee'])
    expect(again.right_items).toEqual(['Water', 'Nest', 'Hive', 'Cave'])
    expect(again.pairs).toEqual([{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }])
  })

  it('lets a pair be edited after opening and still saves a valid question', () => {
    const composer = matchingToComposer({ left_items: ['A', 'B'], right_items: ['x', 'y'], pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] })
    composer.pairs[1] = { left: 'B', right: 'z' }
    expect(matchingFromComposer(composer)).toEqual({ left_items: ['A', 'B'], right_items: ['x', 'z'], pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] })
  })

  it('leaves composer-shaped or empty data alone', () => {
    const composer = { pairs: [{ left: 'a', right: 'b' }] }
    expect(matchingToComposer(composer)).toBe(composer)
    expect(matchingToComposer(undefined)).toEqual({})
    expect(matchingFromComposer(undefined)).toEqual({ left_items: [], right_items: [], pairs: [] })
  })

  it('asks for two complete pairs, as the server does', () => {
    expect(matchingProblem({ pairs: [] })).toBe('Add at least two complete pairs.')
    expect(matchingProblem({ pairs: [{ left: 'a', right: 'b' }, { left: 'c', right: '' }] })).toBe('Add at least two complete pairs.')
    expect(matchingProblem({ pairs: [{ left: 'a', right: 'b' }, { left: 'c', right: 'd' }] })).toBeNull()
    expect(matchingProblem(undefined)).toBe('Add at least two complete pairs.')
  })
})
