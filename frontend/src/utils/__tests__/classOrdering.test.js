import { describe, expect, it } from 'vitest'
import {
  buildClassOrderMaps,
  compareClassLabels,
  getClassSortMeta,
  sortClassOptions,
} from '../classOrdering'

describe('classOrdering utilities', () => {
  it('sortClassOptions orders by grade_level then name then section', () => {
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
