import { describe, expect, it } from 'vitest'
import {
  buildClassOrderMaps,
  compareClassLabels,
  getClassSortMeta,
  sortClassOptions,
} from '../classOrdering'

describe('classOrdering utilities', () => {
  it('sortClassOptions orders by grade_level → section → name (canonical contract)', () => {
    const options = [
      { id: 3, name: 'Class 2', section: 'B', grade_level: 4 },
      { id: 1, name: 'Class 1', section: '', grade_level: 3 },
      { id: 4, name: 'Class 2', section: 'A', grade_level: 4 },
      { id: 2, name: 'Prep', section: '', grade_level: 2 },
    ]

    const sorted = sortClassOptions(options)

    expect(sorted.map(o => `${o.name}${o.section ? ` - ${o.section}` : ''}`)).toEqual([
      'Prep',
      'Class 1',
      'Class 2 - A',
      'Class 2 - B',
    ])
  })

  it('section takes precedence over name at the same grade_level', () => {
    const options = [
      { id: 1, name: 'Zebra', section: 'A', grade_level: 3 },
      { id: 2, name: 'Alpha', section: 'B', grade_level: 3 },
      { id: 3, name: 'Alpha', section: 'A', grade_level: 3 },
    ]

    const sorted = sortClassOptions(options)

    // Section A comes before Section B regardless of name
    expect(sorted.map(o => `${o.name} - ${o.section}`)).toEqual([
      'Alpha - A',
      'Zebra - A',
      'Alpha - B',
    ])
  })

  it('classes without sections sort before sectioned classes at the same grade', () => {
    const options = [
      { id: 1, name: 'Class 3', section: 'A', grade_level: 5 },
      { id: 2, name: 'Class 3', section: '', grade_level: 5 },
    ]

    const sorted = sortClassOptions(options)

    expect(sorted.map(o => `${o.name}${o.section ? ` - ${o.section}` : ''}`)).toEqual([
      'Class 3',
      'Class 3 - A',
    ])
  })

  it('handles full school class list in canonical order', () => {
    const options = [
      { id: 8, name: 'Class 5', section: '', grade_level: 9 },
      { id: 1, name: 'Playgroup', section: '', grade_level: 0 },
      { id: 5, name: 'Class 2', section: 'B', grade_level: 6 },
      { id: 3, name: 'Prep', section: '', grade_level: 2 },
      { id: 4, name: 'Class 2', section: 'A', grade_level: 6 },
      { id: 7, name: 'Class 4', section: '', grade_level: 8 },
      { id: 6, name: 'Class 3', section: '', grade_level: 7 },
      { id: 2, name: 'Nursery', section: '', grade_level: 1 },
    ]

    const sorted = sortClassOptions(options)

    expect(sorted.map(o => o.name + (o.section ? ` - ${o.section}` : ''))).toEqual([
      'Playgroup',
      'Nursery',
      'Prep',
      'Class 2 - A',
      'Class 2 - B',
      'Class 3',
      'Class 4',
      'Class 5',
    ])
  })

  it('buildClassOrderMaps and getClassSortMeta resolve metadata for class and session class', () => {
    const maps = buildClassOrderMaps({
      classes: [{ id: 11, name: 'Class 2', section: 'A', grade_level: 4 }],
      sessionClasses: [{ id: 91, display_name: 'Class 2', section: 'B', grade_level: 4, label: 'Class 2 - B' }],
    })

    expect(getClassSortMeta({ class_id: 11, class_name: 'Class 2 - A' }, maps)).toEqual({ level: 4, sectionOrder: 1 })
    expect(getClassSortMeta({ session_class_id: 91, class_name: 'Class 2 - B' }, maps)).toEqual({ level: 4, sectionOrder: 2 })
  })

  it('compareClassLabels supports natural numeric ordering', () => {
    expect(compareClassLabels('Class 2', 'Class 10')).toBeLessThan(0)
  })
})
